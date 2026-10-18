// The player: physics body + samurai model + procedural animation.

import * as THREE from 'three';
import { createSamurai } from './character.js';
import { SamuraiAnimator } from './animation.js';
import { createBodyState, resetBody, stepBody } from './movement.js';
import { getHeight, getNormal, SPAWN } from './world.js';

export class Player {
  constructor(scene, colliders, moveParams) {
    this.moveParams = moveParams;
    this.model = createSamurai();
    this.object = this.model.root;
    scene.add(this.object);
    this.animator = new SamuraiAnimator(this.model);
    this.colliders = colliders;
    this.env = {
      groundHeight: getHeight,
      groundNormal: (x, z, out) => getNormal(x, z, out, 0.6),
      colliders,
    };
    this.state = createBodyState(SPAWN.x, getHeight(SPAWN.x, SPAWN.z), SPAWN.z, Math.PI);
    this.events = {};
    this.visualY = this.state.pos.y;
    this.listeners = { jump: [], land: [], step: [] };
    this.animator.footstepCallback = (intensity) => this._emit('step', intensity);
    this.position = new THREE.Vector3();
    this._syncObject(0);
  }

  on(type, fn) {
    this.listeners[type].push(fn);
  }

  _emit(type, v) {
    for (const fn of this.listeners[type]) fn(v);
  }

  respawn() {
    resetBody(this.state, SPAWN.x, getHeight(SPAWN.x, SPAWN.z), SPAWN.z, Math.PI);
    this.visualY = this.state.pos.y;
    this.animator.prevFacing = null;
    this._syncObject(0);
  }

  get speed() {
    return Math.hypot(this.state.vel.x, this.state.vel.z);
  }

  update(dt, input, cameraYaw, windGust) {
    const ev = stepBody(this.state, input, cameraYaw, dt, this.env, this.moveParams, this.events);
    if (ev.jumped) this._emit('jump');
    if (ev.landed) {
      this.animator.onLanding(ev.landingSpeed);
      this._emit('land', ev.landingSpeed);
    }
    this.animator.update(dt, {
      speed: this.speed,
      grounded: this.state.grounded,
      vy: this.state.vel.y,
      facing: this.state.facing,
      sprinting: this.state.sprinting,
      windGust,
    });
    this._syncObject(dt);
  }

  _syncObject(dt) {
    const s = this.state;
    // Smooth small vertical steps (onto rocks, over bumps) visually; never lag on big falls.
    const dy = s.pos.y - this.visualY;
    if (!s.grounded || Math.abs(dy) > 0.6 || dt === 0) this.visualY = s.pos.y;
    else this.visualY += dy * Math.min(1, dt * 18);
    this.object.position.set(s.pos.x, this.visualY, s.pos.z);
    this.object.rotation.y = s.facing;
    this.position.set(s.pos.x, s.pos.y, s.pos.z);
  }
}
