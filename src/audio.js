// Procedural ambient soundscape built with the Web Audio API: layered wind that
// follows the visual gusts, grass rustle driven by the samurai's movement, soft
// footsteps, and occasional distant birds. Nothing is loaded from disk.
// The AudioContext is only created after a user gesture (browser autoplay rules).

function createNoiseBuffer(ctx, seconds = 4, color = 'pink') {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'brown') {
        brown = (brown + 0.02 * white) / 1.02;
        data[i] = brown * 3.5;
      } else {
        // Paul Kellet's pink noise filter.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    // Crossfade the ends so the loop is seamless.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[length - fade + i] * (1 - t);
    }
  }
  return buffer;
}

function createReverbImpulse(ctx, seconds = 2.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buffer;
}

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.started = false;
    this.paused = false;
    this.birdTimer = 6;
    this.error = null;
  }

  /** Must be called from a user gesture (click / key press). */
  async start() {
    if (this.started) {
      await this.resume();
      return true;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      this.error = 'Web Audio API is not supported in this browser.';
      console.warn('[audio]', this.error);
      return false;
    }
    try {
      this.ctx = new AudioCtx();
      this._build();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.started = true;
      this.setVolume(this.volume);
      return true;
    } catch (err) {
      this.error = err.message;
      console.error('[audio] Failed to start ambient audio:', err);
      return false;
    }
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createReverbImpulse(ctx);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    const pink = createNoiseBuffer(ctx, 6, 'pink');
    const brown = createNoiseBuffer(ctx, 6, 'brown');
    const loop = (buffer, rate = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(0, Math.random() * buffer.duration);
      return src;
    };

    // Low body of the wind.
    this.windLow = ctx.createGain();
    this.windLow.gain.value = 0.0;
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.value = 380;
    loop(brown).connect(lowFilter).connect(this.windLow).connect(this.master);

    // Airy, moving band of the wind through the grass.
    this.windHigh = ctx.createGain();
    this.windHigh.gain.value = 0.0;
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass';
    this.windBand.frequency.value = 900;
    this.windBand.Q.value = 0.7;
    this.windPan = ctx.createStereoPanner();
    loop(pink, 0.9).connect(this.windBand).connect(this.windHigh).connect(this.windPan).connect(this.master);

    // Rustle of grass around the samurai's legs.
    this.rustle = ctx.createGain();
    this.rustle.gain.value = 0;
    const rustleHp = ctx.createBiquadFilter();
    rustleHp.type = 'highpass';
    rustleHp.frequency.value = 1800;
    const rustleBp = ctx.createBiquadFilter();
    rustleBp.type = 'peaking';
    rustleBp.frequency.value = 4200;
    rustleBp.gain.value = 6;
    loop(pink, 1.3).connect(rustleHp).connect(rustleBp).connect(this.rustle).connect(this.master);

    this.noiseBuffer = pink;
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx) return;
    const target = this.paused ? v * 0.25 : v;
    this.master.gain.setTargetAtTime(target * 0.9, this.ctx.currentTime, 0.4);
  }

  async pause() {
    this.paused = true;
    this.setVolume(this.volume);
  }

  async resume() {
    this.paused = false;
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    this.setVolume(this.volume);
  }

  /** Called every frame with the current wind gust (0..1+) and player motion. */
  update(dt, { gust, speed, grounded, windYaw, cameraYaw }) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = Math.max(0, gust);
    this.windLow.gain.setTargetAtTime(0.16 + g * 0.22, t, 0.6);
    this.windHigh.gain.setTargetAtTime(0.035 + g * 0.11, t, 0.5);
    this.windBand.frequency.setTargetAtTime(650 + g * 900, t, 0.8);
    // Pan the wind towards the side it is coming from relative to the view.
    this.windPan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, Math.sin(windYaw - cameraYaw) * 0.5)), t, 1.0);
    const move = grounded ? Math.min(1, speed / 8) : 0;
    this.rustle.gain.setTargetAtTime(move * 0.16 + g * 0.015, t, 0.15);

    if (!this.paused) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 9 + Math.random() * 20;
        if (Math.random() < 0.35) this._warbler();
        else this._chirps();
      }
    }
  }

  footstep(intensity) {
    if (!this.started || this.paused) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500 + Math.random() * 400;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12 * intensity, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 3, 0.2);
  }

  land(speed) {
    if (!this.started || this.paused) return;
    this.footstep(Math.min(1.6, 0.5 + speed / 10));
  }

  _voice(pan) {
    const out = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p);
    p.connect(this.master);
    p.connect(this.reverb);
    return out;
  }

  _tone(dest, start, dur, f0, f1, peak) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** A short series of distant chirps. */
  _chirps() {
    const t = this.ctx.currentTime + 0.1;
    const v = this._voice((Math.random() - 0.5) * 1.4);
    v.gain.value = 0.05 + Math.random() * 0.03;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 1500;
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.12 + Math.random() * 0.08);
      this._tone(v, s, 0.07 + Math.random() * 0.05, base * (1 + Math.random() * 0.2), base * (1.25 + Math.random() * 0.3), 0.6);
    }
  }

  /** A distant bush warbler's call: a long whistle, then a quick flourish. */
  _warbler() {
    const t = this.ctx.currentTime + 0.1;
    const v = this._voice((Math.random() - 0.5) * 1.2);
    v.gain.value = 0.035;
    this._tone(v, t, 0.9, 1250, 1320, 0.7);
    this._tone(v, t + 1.05, 0.14, 2100, 2500, 0.8);
    this._tone(v, t + 1.22, 0.1, 2600, 2300, 0.8);
    this._tone(v, t + 1.36, 0.3, 2350, 1900, 0.7);
  }
}
