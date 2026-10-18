// Game orchestration: renderer, world systems, state machine (loading -> title
// -> playing <-> paused) and the main loop.

import * as THREE from 'three';
import { atmosphereUniforms, createSky } from './atmosphere.js';
import { Terrain } from './terrain.js';
import { Grass, windUniforms, sampleWindGust } from './grass.js';
import { Props } from './props.js';
import { Mountains } from './mountains.js';
import { Lighting } from './lighting.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { AmbientAudio } from './audio.js';
import { UI } from './ui.js';
import { PostFX } from './postfx.js';
import { ColliderWorld } from './collision.js';
import { QUALITY_PRESETS, loadSettings, saveSettings, suggestQuality } from './settings.js';
import { createWindTexture } from './textures.js';
import { getHeight, SPAWN } from './world.js';
import { wrapAngle, MOVE_PARAMS } from './movement.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.settings = loadSettings();
    this.firstRun = !this._hasSavedSettings();
    this.clock = new THREE.Clock(false);
    this.frameInput = {};
    this.stats = { fps: 0, frameMs: 0, frames: 0, acc: 0, slowTime: 0, fastTime: 0 };
    this.resolutionScale = 1;
    this.titleTime = 0;
    // Longest frame step simulated in one go. Tests running on software WebGL raise it
    // (?simMaxDt=2) so that game time keeps pace with real time at very low frame rates.
    const simMaxDt = Number(new URLSearchParams(window.location.search).get('simMaxDt'));
    this.maxFrameDt = simMaxDt > 0 ? Math.min(simMaxDt, 5) : 0.1;
    this.moveParams = { ...MOVE_PARAMS, maxFrameDt: this.maxFrameDt };
    this._lastStatsTime = performance.now();
  }

  _hasSavedSettings() {
    try {
      return !!window.localStorage.getItem('samurai-endless-plains.settings.v1');
    } catch {
      return false;
    }
  }

  async init() {
    this.ui = new UI(this.settings, {
      onStart: () => this.startExploring(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onFullscreen: () => this.toggleFullscreen(),
      onSetting: (k, v) => this.applySetting(k, v),
    });

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.error('[game] WebGL initialisation failed:', err);
      this.ui.showError('This game needs WebGL. Please use an up-to-date Chrome or Edge with hardware acceleration enabled.');
      throw err;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.error('[game] WebGL context lost.');
      this.ui.showError('The graphics context was lost. Please reload the page (try a lower graphics quality).');
    });

    if (this.firstRun) {
      this.settings.quality = suggestQuality(r);
      this.ui.syncSettings();
    }
    const preset = QUALITY_PRESETS[this.settings.quality];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.15, 42000);
    this.colliders = new ColliderWorld();

    this.ui.setLoading(0.05, 'Raising the hills…');
    await nextFrame();

    this.sky = createSky();
    this.scene.add(this.sky);
    this.lighting = new Lighting(this.scene);
    this.mountains = new Mountains(this.scene);
    this.terrain = new Terrain(this.scene, { detail: preset.terrainDetail, grassRadius: preset.grassRadius });
    this.grass = new Grass(this.scene, { radius: preset.grassRadius, density: preset.grassDensity, windTexture: createWindTexture() });
    this.props = new Props(this.scene, this.colliders, { rockRadius: preset.rockRadius, treeRadius: preset.treeRadius });
    this.player = new Player(this.scene, this.colliders, this.moveParams);
    this.rig = new CameraRig(this.camera, { groundHeight: getHeight, colliders: this.colliders });
    this.input = new Input(this.canvas);
    this.audio = new AmbientAudio();
    this.audio.volume = this.settings.volume;

    this.player.on('step', (i) => this.audio.footstep(i));
    this.player.on('land', (s) => this.audio.land(s));
    this.input.on('action', (a) => this._onAction(a));
    this.input.on('pointerlock', (locked) => this._onPointerLock(locked));
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('fullscreenchange', () => this._resize());

    this.applyQuality(this.settings.quality, true);
    this._applyCameraSettings();
    this._resize();

    // Generate the world around the start before showing it.
    const p = this.player.position;
    let progress = 0;
    while (progress < 1) {
      progress = this.terrain.update(p.x, p.z, 40);
      this.ui.setLoading(0.1 + progress * 0.5, 'Raising the hills…');
      await nextFrame();
    }
    this.ui.setLoading(0.62, 'Growing the grass…');
    await nextFrame();
    for (let i = 0; i < 60; i++) {
      if (this.grass.update(p.x, p.z, this.player.object.position, 60) === 0) break;
      this.ui.setLoading(0.62 + Math.min(0.25, i * 0.02), 'Growing the grass…');
      await nextFrame();
    }
    this.props.update(p.x, p.z, true);
    this.lighting.update(p);
    this.rig.distance = 7.2;
    this.rig.pitch = 0.1;
    this.rig.snapTo(p, 2.4);

    this.ui.setLoading(0.92, 'Calling the wind…');
    await nextFrame();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (err) {
      console.warn('[game] Shader pre-compilation failed; shaders will compile on first use.', err);
    }
    this.ui.setLoading(1, 'Ready');
    await nextFrame();

    this.state = 'title';
    this.ui.show('loading', false);
    this.ui.show('title', true);
    this.clock.start();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------------------------------------------------------------- states

  async startExploring() {
    if (this.state !== 'title') return;
    this.state = 'playing';
    this.ui.show('title', false);
    this.input.enabled = true;
    this.input.clear();
    this.input.requestLock();
    this.canvas.focus();
    this._transition = { t: 0, duration: 1.6, fromYaw: this.rig.yaw, fromPitch: this.rig.pitch, fromDist: this.rig.distance };
    this.ui.setHint(this.input.isLocked() ? '' : 'Click to look around');
    const ok = await this.audio.start();
    if (!ok) console.warn('[game] Continuing without audio:', this.audio.error);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._pausedAt = performance.now();
    this.input.enabled = false;
    this.input.clear();
    this.input.releaseLock();
    this.ui.setHint('');
    this.ui.syncSettings();
    this.ui.show('pause', true);
    this.audio.pause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.show('pause', false);
    this.input.clear();
    this.input.enabled = true;
    this.input.requestLock();
    this.canvas.focus();
    this.audio.resume();
    // Chrome refuses an immediate re-lock after Escape; offer a click instead.
    setTimeout(() => {
      if (this.state === 'playing' && !this.input.isLocked()) this.ui.setHint('Click to look around');
    }, 400);
  }

  restart() {
    if (this.state === 'paused') this.resume();
    this.respawn();
  }

  respawn() {
    this.ui.fade(true);
    setTimeout(() => {
      this.player.respawn();
      this.rig.pitch = 0.14;
      this.rig.snapTo(this.player.position, SPAWN.yaw);
      this.terrain.update(this.player.position.x, this.player.position.z, 1000);
      this.grass.update(this.player.position.x, this.player.position.z, this.player.object.position, 200);
      this.props.update(this.player.position.x, this.player.position.z, true);
      this.ui.fade(false);
    }, 360);
  }

  toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done
      .then(() => {
        if (this.state === 'playing') this.input.requestLock();
      })
      .catch((err) => console.warn('[game] Fullscreen request failed:', err.message));
  }

  _onAction(action) {
    if (action === 'escape' || action === 'pause') {
      // The Escape press that released pointer lock already paused the game.
      if (performance.now() - (this._pausedAt || 0) < 350) return;
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    } else if (action === 'reset') {
      if (this.state === 'playing') this.respawn();
    } else if (action === 'fullscreen') {
      if (this.state === 'playing' || this.state === 'paused') this.toggleFullscreen();
    }
  }

  _onPointerLock(locked) {
    if (locked) {
      this.ui.setHint('');
      return;
    }
    // Losing pointer lock while playing (usually Escape) opens the pause menu.
    if (this.state === 'playing' && !document.fullscreenElement) this.pause();
    else if (this.state === 'playing') this.ui.setHint('Click to look around');
  }

  // -------------------------------------------------------------- settings

  applySetting(key, value) {
    this.settings[key] = value;
    if (key === 'quality') this.applyQuality(value);
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'sensitivity' || key === 'cameraDistance' || key === 'invertY') this._applyCameraSettings();
    if (key === 'dynamicResolution' && !value) {
      this.resolutionScale = 1;
      this._resize();
    }
    saveSettings(this.settings);
    this.ui.syncSettings();
  }

  _applyCameraSettings() {
    this.rig.sensitivity = this.settings.sensitivity;
    this.rig.invertY = this.settings.invertY;
    if (this.state === 'playing' || this.state === 'paused') this.rig.distance = this.settings.cameraDistance;
  }

  applyQuality(name, initial = false) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.preset = preset;
    this.lighting.setShadows(preset.shadows, preset.shadowMapSize);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.lighting.setShadowExtent(preset.shadowMapSize >= 2048 ? 70 : 50);
    if (!initial) {
      this.terrain.setDetail(preset.terrainDetail);
      this.grass.setQuality(preset.grassRadius, preset.grassDensity);
      this.props.setRadii(preset.rockRadius, preset.treeRadius);
      // Material programs depend on whether shadows are enabled.
      this.scene.traverse((o) => {
        if (o.material) o.material.needsUpdate = true;
      });
    }
    this.terrain.setGrassRadius(preset.grassRadius);
    if (preset.postprocessing && !this.postfx) this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    if (!preset.postprocessing && this.postfx) {
      this.postfx.dispose();
      this.postfx = null;
    }
    this.resolutionScale = 1;
    this._resize();
  }

  _resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const ratio = Math.min(2, (window.devicePixelRatio || 1) * this.preset.pixelRatio * this.resolutionScale);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setSize(w, h);
  }

  _adaptResolution(dt) {
    if (!this.settings.dynamicResolution || this.state !== 'playing') return;
    const s = this.stats;
    if (dt > 1 / 40) {
      s.slowTime += dt;
      s.fastTime = 0;
    } else if (dt < 1 / 58) {
      s.fastTime += dt;
      s.slowTime = Math.max(0, s.slowTime - dt);
    }
    if (s.slowTime > 2 && this.resolutionScale > 0.55) {
      this.resolutionScale = Math.max(0.55, this.resolutionScale - 0.1);
      s.slowTime = 0;
      this._resize();
    } else if (s.fastTime > 6 && this.resolutionScale < 1) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      s.fastTime = 0;
      this._resize();
    }
  }

  // ------------------------------------------------------------------ loop

  _frame() {
    const dt = Math.min(this.clock.getDelta(), this.maxFrameDt);
    const time = this.clock.elapsedTime;
    atmosphereUniforms.uTime.value = time;
    const input = this.input.sample(this.frameInput);
    const p = this.player.position;
    const gust = sampleWindGust(p.x, p.z, time);

    if (this.state === 'title') {
      // Slow cinematic orbit around the samurai.
      this.titleTime += dt;
      this.rig.yaw = 2.4 + Math.sin(this.titleTime * 0.05) * 0.5;
      this.rig.pitch = 0.08 + Math.sin(this.titleTime * 0.08) * 0.03;
      this.player.update(dt, { x: 0, y: 0, sprint: false, jump: false }, this.rig.yaw, gust);
    } else if (this.state === 'playing') {
      if (this._transition) this._updateTransition(dt);
      else {
        if (input.mouseX || input.mouseY) this.rig.rotate(input.mouseX, input.mouseY);
        if (input.wheel) {
          this.rig.zoom(input.wheel * 0.5);
          this.settings.cameraDistance = this.rig.distance;
        }
      }
      this.player.update(dt, input, this.rig.yaw, gust);
    } else {
      this.player.update(dt, { x: 0, y: 0, sprint: false, jump: false }, this.rig.yaw, gust);
    }

    this.rig.update(this.player.object.position, dt);
    this.terrain.update(p.x, p.z, 4);
    this.grass.update(p.x, p.z, this.player.object.position, 3);
    this.props.update(p.x, p.z);
    this.lighting.update(p);
    this.mountains.update(this.camera.position);
    this.sky.position.copy(this.camera.position);
    windUniforms.uWindStrength.value = 0.85 + Math.sin(time * 0.05) * 0.15;

    this.audio.update(dt, {
      gust,
      speed: this.player.speed,
      grounded: this.player.state.grounded,
      windYaw: Math.atan2(-windUniforms.uWindDir.value.x, -windUniforms.uWindDir.value.y),
      cameraYaw: this.rig.yaw,
    });

    // Resolution changes resize (and clear) the canvas, so they must happen before drawing.
    this._updateStats();
    this._adaptResolution(this.stats.frameMs / 1000 || dt);

    if (this.postfx) this.postfx.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _updateTransition(dt) {
    const tr = this._transition;
    tr.t += dt / tr.duration;
    const k = tr.t >= 1 ? 1 : 1 - Math.pow(1 - tr.t, 3);
    this.rig.yaw = tr.fromYaw + wrapAngle(SPAWN.yaw - tr.fromYaw) * k;
    this.rig.pitch = tr.fromPitch + (0.14 - tr.fromPitch) * k;
    this.rig.distance = tr.fromDist + (this.settings.cameraDistance - tr.fromDist) * k;
    if (tr.t >= 1) this._transition = null;
  }

  _updateStats() {
    // Measured with wall-clock time, independent of the clamped simulation step.
    const s = this.stats;
    const now = performance.now();
    s.frames++;
    s.acc += (now - this._lastStatsTime) / 1000;
    this._lastStatsTime = now;
    if (s.acc >= 0.5) {
      s.fps = s.frames / s.acc;
      s.frameMs = (s.acc / s.frames) * 1000;
      s.frames = 0;
      s.acc = 0;
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        this.ui.setFps(`${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms\n${info.calls} draws  ${(info.triangles / 1e6).toFixed(2)}M tris\nres ×${this.resolutionScale.toFixed(2)}`);
      }
    }
  }

  /** Read-only snapshot used by automated browser tests. */
  debugSnapshot() {
    const s = this.player.state;
    return {
      state: this.state,
      pos: { ...s.pos },
      vel: { ...s.vel },
      grounded: s.grounded,
      facing: s.facing,
      terrainY: getHeight(s.pos.x, s.pos.z),
      cameraYaw: this.rig.yaw,
      cameraPitch: this.rig.pitch,
      cameraPos: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      cameraGround: getHeight(this.camera.position.x, this.camera.position.z),
      cameraDistance: this.rig.currentDistance,
      fps: this.stats.fps,
      terrainNodes: this.terrain.visibleCount,
      grassInstances: this.grass.instanceCount,
      props: this.props.counts,
      colliders: this.colliders.size,
      audio: this.audio.started ? this.audio.ctx.state : 'not-started',
      quality: this.settings.quality,
      time: atmosphereUniforms.uTime.value,
      drawCalls: this.renderer.info.render.calls,
      torii: this.props.toriiLocation,
    };
  }
}
