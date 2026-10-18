// Keyboard, mouse and pointer-lock handling. Keys are cleared whenever the page
// loses focus so the samurai never keeps walking on their own.

const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
};

const MAX_MOUSE_DELTA = 250;

export class Input {
  constructor(element) {
    this.element = element;
    this.held = new Set();
    this.jumpQueued = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.enabled = false;
    this.listeners = { action: [], pointerlock: [] };
    this._bind();
  }

  on(type, fn) {
    this.listeners[type].push(fn);
  }

  _emit(type, value) {
    for (const fn of this.listeners[type]) fn(value);
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      // Let menu controls keep their keys, except Escape, which always toggles the pause menu.
      if ((e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) && e.code !== 'Escape') return;
      const action = MOVE_KEYS[e.code];
      if (action) {
        if (this.enabled) e.preventDefault();
        if (action === 'jump' && !e.repeat && this.enabled) this.jumpQueued = true;
        this.held.add(action);
        return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyR') this._emit('action', 'reset');
      else if (e.code === 'KeyF') this._emit('action', 'fullscreen');
      else if (e.code === 'Escape') this._emit('action', 'escape');
      else if (e.code === 'KeyP') this._emit('action', 'pause');
    });
    window.addEventListener('keyup', (e) => {
      const action = MOVE_KEYS[e.code];
      if (action) this.held.delete(action);
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked()) return;
      this.injectMouse(e.movementX, e.movementY);
    });
    this.element.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      const locked = this.isLocked();
      if (!locked) this.clear();
      this._emit('pointerlock', locked);
    });
    document.addEventListener('pointerlockerror', () => {
      console.warn('[input] Pointer lock was refused by the browser.');
      this._emit('pointerlock', false);
    });
  }

  /** Mouse delta in pixels. Large spikes (a known browser quirk) are clamped. */
  injectMouse(dx, dy) {
    this.mouseDX += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, dx || 0));
    this.mouseDY += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, dy || 0));
  }

  isLocked() {
    return document.pointerLockElement === this.element;
  }

  requestLock() {
    if (this.isLocked()) return;
    try {
      const result = this.element.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => console.warn('[input] Pointer lock request failed:', err.message));
      }
    } catch (err) {
      console.warn('[input] Pointer lock unavailable:', err.message);
    }
  }

  releaseLock() {
    if (this.isLocked()) document.exitPointerLock();
  }

  clear() {
    this.held.clear();
    this.jumpQueued = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Read and consume this frame's input. */
  sample(out) {
    const h = this.held;
    const active = this.enabled;
    out.x = active ? (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0) : 0;
    out.y = active ? (h.has('forward') ? 1 : 0) - (h.has('back') ? 1 : 0) : 0;
    out.sprint = active && h.has('sprint');
    out.jump = active && this.jumpQueued;
    out.mouseX = active ? this.mouseDX : 0;
    out.mouseY = active ? this.mouseDY : 0;
    out.wheel = active ? this.wheel : 0;
    this.jumpQueued = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    return out;
  }
}
