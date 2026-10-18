// DOM user interface: loading, title, pause menu, settings, hints and FPS readout.

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`UI element #${id} is missing from index.html`);
  return el;
};

export class UI {
  constructor(settings, handlers) {
    this.settings = settings;
    this.handlers = handlers;
    this.el = {
      loading: $('loading'),
      loadingBar: $('loading-bar'),
      loadingStatus: $('loading-status'),
      title: $('title'),
      start: $('start-button'),
      pause: $('pause'),
      resume: $('resume-button'),
      restart: $('restart-button'),
      fullscreen: $('fullscreen-button'),
      quality: $('quality-select'),
      volume: $('volume-range'),
      volumeValue: $('volume-value'),
      sensitivity: $('sensitivity-range'),
      sensitivityValue: $('sensitivity-value'),
      distance: $('distance-range'),
      distanceValue: $('distance-value'),
      invert: $('invert-check'),
      dynres: $('dynres-check'),
      fpsCheck: $('fps-check'),
      hint: $('hint'),
      fps: $('fps'),
      fade: $('fade'),
      error: $('error'),
      errorMessage: $('error-message'),
    };
    this._bind();
    this.syncSettings();
    if (!document.fullscreenEnabled) {
      this.el.fullscreen.disabled = true;
      this.el.fullscreen.title = 'Fullscreen is not supported in this browser';
    }
  }

  _bind() {
    const e = this.el;
    const h = this.handlers;
    e.start.addEventListener('click', () => h.onStart());
    e.resume.addEventListener('click', () => h.onResume());
    e.restart.addEventListener('click', () => h.onRestart());
    e.fullscreen.addEventListener('click', () => h.onFullscreen());
    e.quality.addEventListener('change', () => h.onSetting('quality', e.quality.value));
    e.volume.addEventListener('input', () => h.onSetting('volume', parseFloat(e.volume.value)));
    e.sensitivity.addEventListener('input', () => h.onSetting('sensitivity', parseFloat(e.sensitivity.value)));
    e.distance.addEventListener('input', () => h.onSetting('cameraDistance', parseFloat(e.distance.value)));
    e.invert.addEventListener('change', () => h.onSetting('invertY', e.invert.checked));
    e.dynres.addEventListener('change', () => h.onSetting('dynamicResolution', e.dynres.checked));
    e.fpsCheck.addEventListener('change', () => h.onSetting('showFps', e.fpsCheck.checked));
    // Keep keyboard events inside the menu from leaking to the game.
    e.pause.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.stopPropagation();
    });
  }

  syncSettings() {
    const s = this.settings;
    const e = this.el;
    e.quality.value = s.quality;
    e.volume.value = String(s.volume);
    e.volumeValue.textContent = `${Math.round(s.volume * 100)}%`;
    e.sensitivity.value = String(s.sensitivity);
    e.sensitivityValue.textContent = `${s.sensitivity.toFixed(2)}×`;
    e.distance.value = String(s.cameraDistance);
    e.distanceValue.textContent = `${s.cameraDistance.toFixed(1)} m`;
    e.invert.checked = s.invertY;
    e.dynres.checked = s.dynamicResolution;
    e.fpsCheck.checked = s.showFps;
    e.fps.classList.toggle('hidden', !s.showFps);
  }

  setLoading(progress, status) {
    this.el.loadingBar.style.width = `${Math.round(progress * 100)}%`;
    if (status) this.el.loadingStatus.textContent = status;
  }

  show(name, visible) {
    this.el[name].classList.toggle('hidden', !visible);
  }

  setHint(text) {
    if (text) this.el.hint.textContent = text;
    this.el.hint.classList.toggle('hidden', !text);
  }

  setFps(text) {
    this.el.fps.textContent = text;
  }

  fade(on) {
    this.el.fade.classList.toggle('on', on);
  }

  showError(message) {
    this.el.errorMessage.textContent = message;
    this.show('error', true);
    this.show('loading', false);
  }
}
