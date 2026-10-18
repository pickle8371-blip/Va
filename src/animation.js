// Procedural animation for the samurai: idle breathing, walk and run cycles,
// jump / fall / land poses, turn leaning, a two-bone IK that keeps the left hand
// on the katana, and the travel cloak's spring dynamics.
//
// This is a procedural fallback for a missing animation set: each state is a
// parametric pose and the states are blended continuously.

import * as THREE from 'three';
import { updateCloakGeometry } from './character.js';
import { clamp, lerp } from './noise.js';

const FIELDS = [
  'hipsY', 'hipsPitch', 'hipsYaw', 'hipsRoll',
  'spinePitch', 'spineYaw', 'chestPitch', 'chestRoll',
  'neckPitch', 'headYaw', 'headPitch',
  'thighLP', 'thighLR', 'kneeL', 'ankleL',
  'thighRP', 'thighRR', 'kneeR', 'ankleR',
  'shoulderRP', 'shoulderRR', 'elbowR',
  'breath',
];
const IDX = Object.fromEntries(FIELDS.map((f, i) => [f, i]));

class Pose {
  constructor() {
    this.v = new Float32Array(FIELDS.length);
  }
  set(name, value) {
    this.v[IDX[name]] = value;
    return this;
  }
  get(name) {
    return this.v[IDX[name]];
  }
  zero() {
    this.v.fill(0);
    return this;
  }
  copy(p) {
    this.v.set(p.v);
    return this;
  }
  lerp(p, t) {
    for (let i = 0; i < this.v.length; i++) this.v[i] += (p.v[i] - this.v[i]) * t;
    return this;
  }
}

const smoothPos = (x) => (x > 0 ? x * x * (3 - 2 * Math.min(x, 1)) : 0);

function idlePose(p, t, look) {
  p.zero();
  const breath = Math.sin(t * 1.55);
  p.set('breath', breath);
  p.set('hipsY', breath * 0.004 - 0.01);
  p.set('hipsRoll', Math.sin(t * 0.37) * 0.015);
  p.set('hipsYaw', Math.sin(t * 0.21) * 0.03);
  p.set('spinePitch', 0.03 + breath * 0.012);
  p.set('chestPitch', -0.02 - breath * 0.015);
  p.set('headYaw', look);
  p.set('headPitch', Math.sin(t * 0.29) * 0.04);
  p.set('thighLP', 0.02);
  p.set('thighLR', 0.06);
  p.set('kneeL', 0.08);
  p.set('ankleL', -0.06);
  p.set('thighRP', -0.04);
  p.set('thighRR', -0.08);
  p.set('kneeR', 0.05);
  p.set('ankleR', 0.0);
  p.set('shoulderRP', 0.05 + breath * 0.01);
  p.set('shoulderRR', -0.1);
  p.set('elbowR', 0.25);
  return p;
}

function gaitPose(p, phase, run) {
  p.zero();
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const sR = Math.sin(phase + Math.PI);
  const cR = Math.cos(phase + Math.PI);
  const hipAmp = lerp(0.42, 0.78, run);
  const kneeAmp = lerp(0.85, 1.7, run);
  // Hips bob twice per cycle, lowest at mid-stance.
  p.set('hipsY', lerp(-0.015, -0.07, run) + Math.abs(Math.cos(phase)) * lerp(0.035, 0.06, run) - lerp(0.02, 0.03, run));
  p.set('hipsYaw', s * lerp(0.1, 0.14, run));
  p.set('hipsRoll', Math.sin(phase * 2) * lerp(0.02, 0.012, run));
  p.set('hipsPitch', lerp(0.02, 0.16, run));
  p.set('spinePitch', lerp(0.03, 0.14, run));
  p.set('spineYaw', -s * lerp(0.14, 0.22, run));
  p.set('chestPitch', lerp(0.0, 0.06, run));
  p.set('neckPitch', -lerp(0.02, 0.2, run));
  p.set('headPitch', -lerp(0.0, 0.08, run));
  // Legs: forward swing positive.
  p.set('thighLP', s * hipAmp + run * 0.12);
  p.set('kneeL', 0.1 + smoothPos(c) * kneeAmp + run * 0.25);
  p.set('ankleL', -0.15 * smoothPos(-c) + smoothPos(c) * 0.2 * run);
  p.set('thighRP', sR * hipAmp + run * 0.12);
  p.set('kneeR', 0.1 + smoothPos(cR) * kneeAmp + run * 0.25);
  p.set('ankleR', -0.15 * smoothPos(-cR) + smoothPos(cR) * 0.2 * run);
  p.set('thighLR', 0.03);
  p.set('thighRR', -0.03);
  // Right arm swings opposite to the right leg.
  p.set('shoulderRP', s * lerp(0.42, 0.85, run) + run * 0.15);
  p.set('shoulderRR', -0.12 - run * 0.08);
  p.set('elbowR', lerp(0.35, 1.35, run) + Math.max(0, s) * 0.3);
  return p;
}

function jumpPose(p, rising) {
  p.zero();
  p.set('hipsPitch', 0.12);
  p.set('spinePitch', 0.08);
  p.set('neckPitch', -0.08);
  p.set('thighLP', lerp(0.35, 0.95, rising));
  p.set('kneeL', lerp(0.9, 1.5, rising));
  p.set('ankleL', 0.25);
  p.set('thighRP', lerp(0.15, -0.25, rising));
  p.set('kneeR', lerp(0.75, 0.55, rising));
  p.set('ankleR', 0.35);
  p.set('thighLR', 0.08);
  p.set('thighRR', -0.08);
  p.set('shoulderRP', lerp(0.3, -0.5, rising));
  p.set('shoulderRR', -0.55);
  p.set('elbowR', 0.6);
  return p;
}

function landPose(p) {
  p.zero();
  p.set('hipsY', -0.2);
  p.set('hipsPitch', 0.32);
  p.set('spinePitch', 0.18);
  p.set('neckPitch', -0.3);
  p.set('thighLP', 0.85);
  p.set('kneeL', 1.55);
  p.set('ankleL', -0.6);
  p.set('thighRP', 0.55);
  p.set('kneeR', 1.25);
  p.set('ankleR', -0.55);
  p.set('thighLR', 0.12);
  p.set('thighRR', -0.12);
  p.set('shoulderRP', 0.45);
  p.set('shoulderRR', -0.45);
  p.set('elbowR', 0.7);
  return p;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Analytic two-bone IK in the shoulder's parent space. The upper bone and lower
 * bone both point along local -Y in their rest pose.
 */
export function solveTwoBoneIK(shoulder, elbow, targetLocal, upperLen, lowerLen, pole) {
  const start = shoulder.position;
  const toTarget = _v1.subVectors(targetLocal, start);
  let dist = toTarget.length();
  const maxReach = (upperLen + lowerLen) * 0.999;
  dist = clamp(dist, Math.abs(upperLen - lowerLen) + 1e-3, maxReach);
  toTarget.normalize();
  const cosA = clamp((upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist), -1, 1);
  const a = Math.acos(cosA);
  const axis = _v2.crossVectors(toTarget, pole);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  // Rotate towards the pole side by angle a.
  const upperDir = _v3.copy(toTarget).applyAxisAngle(axis, a);
  shoulder.quaternion.setFromUnitVectors(DOWN, upperDir);
  // Elbow position and forearm direction.
  const elbowPos = upperDir.clone().multiplyScalar(upperLen).add(start);
  const targetClamped = toTarget.clone().multiplyScalar(dist).add(start);
  const foreDir = targetClamped.sub(elbowPos).normalize();
  _qInv.copy(shoulder.quaternion).invert();
  foreDir.applyQuaternion(_qInv);
  elbow.quaternion.setFromUnitVectors(DOWN, foreDir);
  return dist;
}

export class SamuraiAnimator {
  constructor(model) {
    this.model = model;
    this.j = model.joints;
    this.time = 0;
    this.phase = 0;
    this.moveBlend = 0; // 0 idle -> 1 moving
    this.runBlend = 0; // 0 walk -> 1 run
    this.airBlend = 0;
    this.land = 0; // landing crouch weight (decays)
    this.landStrength = 0;
    this.lean = 0;
    this.prevFacing = null;
    this.lookYaw = 0;
    this.lookTarget = 0;
    this.lookTimer = 4;
    this.footstepCallback = null;
    this._lastStepPhase = 0;
    this.poses = { idle: new Pose(), gait: new Pose(), air: new Pose(), land: new Pose(), out: new Pose() };
    this._hilt = new THREE.Vector3();
    this._pole = new THREE.Vector3(0.8, -0.1, -0.6).normalize();
  }

  onLanding(speed) {
    const strength = clamp((speed - 3) / 12, 0.15, 1);
    this.land = 1;
    this.landStrength = strength;
  }

  update(dt, state) {
    const { speed, grounded, vy, facing, sprinting, windGust } = state;
    this.time += dt;
    const t = this.time;

    // Blend weights.
    const moving = clamp(speed / 1.2, 0, 1);
    this.moveBlend += (moving - this.moveBlend) * Math.min(1, dt * 8);
    const runTarget = clamp((speed - 3.6) / 4.2, 0, 1);
    this.runBlend += (runTarget - this.runBlend) * Math.min(1, dt * 5);
    this.airBlend += ((grounded ? 0 : 1) - this.airBlend) * Math.min(1, dt * (grounded ? 14 : 9));
    this.land = Math.max(0, this.land - dt / (0.22 + this.landStrength * 0.25));

    // Gait phase advances with distance travelled.
    const stride = lerp(1.9, 3.1, this.runBlend);
    if (grounded) this.phase += (speed / stride) * Math.PI * 2 * dt;
    const stepPhase = Math.floor(this.phase / Math.PI);
    if (stepPhase !== this._lastStepPhase) {
      this._lastStepPhase = stepPhase;
      if (grounded && speed > 0.8 && this.footstepCallback) this.footstepCallback(clamp(speed / 8.4, 0.2, 1));
    }

    // Occasional idle glances around the landscape.
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 3 + Math.random() * 5;
      this.lookTarget = (Math.random() - 0.5) * 0.9;
    }
    const look = this.moveBlend > 0.5 ? 0 : this.lookTarget;
    this.lookYaw += (look - this.lookYaw) * Math.min(1, dt * 1.5);

    // Lean into turns.
    if (this.prevFacing === null) this.prevFacing = facing;
    let dYaw = facing - this.prevFacing;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.prevFacing = facing;
    const turnRate = dt > 0 ? dYaw / dt : 0;
    const leanTarget = clamp(-turnRate * speed * 0.012, -0.22, 0.22);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);

    const P = this.poses;
    idlePose(P.idle, t, this.lookYaw);
    gaitPose(P.gait, this.phase, this.runBlend);
    jumpPose(P.air, clamp(vy / 6, 0, 1));
    landPose(P.land);

    const out = P.out.copy(P.idle).lerp(P.gait, this.moveBlend);
    out.lerp(P.air, this.airBlend);
    const landW = smoothPos(this.land) * this.landStrength;
    out.lerp(P.land, landW);

    this._apply(out, dt, { speed, windGust: windGust || 0, sprinting });
  }

  _apply(p, dt, { speed, windGust }) {
    const j = this.j;
    const g = (n) => p.get(n);
    j.hips.position.y = 0.95 + g('hipsY');
    j.hips.rotation.set(g('hipsPitch'), g('hipsYaw'), g('hipsRoll') + this.lean * 0.5);
    j.spine.rotation.set(g('spinePitch'), g('spineYaw') * 0.5, this.lean * 0.4);
    j.chest.rotation.set(g('chestPitch'), g('spineYaw') * 0.5, g('chestRoll'));
    const breath = g('breath');
    j.chest.scale.set(1 + breath * 0.008, 1 + breath * 0.006, 1 + breath * 0.012);
    j.neck.rotation.set(g('neckPitch'), -g('spineYaw') * 0.4 - g('hipsYaw') * 0.6, 0);
    j.head.rotation.set(g('headPitch'), g('headYaw'), 0);

    j.thighL.rotation.set(-g('thighLP'), 0, g('thighLR'));
    j.kneeL.rotation.set(g('kneeL'), 0, 0);
    j.ankleL.rotation.set(g('ankleL') + g('thighLP') - g('kneeL'), 0, -g('thighLR'));
    j.thighR.rotation.set(-g('thighRP'), 0, g('thighRR'));
    j.kneeR.rotation.set(g('kneeR'), 0, 0);
    j.ankleR.rotation.set(g('ankleR') + g('thighRP') - g('kneeR'), 0, -g('thighRR'));
    // Ankle joint pitch is relative: undo leg rotation so feet stay roughly level.
    j.ankleL.rotation.x = clamp(j.ankleL.rotation.x, -1.1, 0.9);
    j.ankleR.rotation.x = clamp(j.ankleR.rotation.x, -1.1, 0.9);

    // Tassets follow the thighs a little so the legs don't clip through them.
    for (const t of j.tassets) {
      const a = t.userData.angle;
      const front = Math.cos(a);
      const side = Math.sin(a);
      const legP = side >= 0 ? g('thighLP') : g('thighRP');
      const swing = Math.max(0, legP) * Math.max(0, front) * 0.7 + Math.max(0, -legP) * Math.max(0, -front) * 0.6;
      t.rotation.x = -swing;
    }

    j.shoulderR.rotation.set(-g('shoulderRP'), 0, g('shoulderRR'));
    j.elbowR.rotation.set(-g('elbowR'), 0, 0);
    // Shoulder guards lift slightly as the arms swing.
    j.sodeR.rotation.set(-Math.max(0, g('shoulderRP')) * 0.35, 0, Math.min(0, g('shoulderRR')) * 0.4);

    // Left hand stays on the katana handle.
    j.hips.parent.updateMatrixWorld(true);
    j.hiltTarget.getWorldPosition(this._hilt);
    j.chest.worldToLocal(this._hilt);
    solveTwoBoneIK(j.shoulderL, j.elbowL, this._hilt, 0.29, 0.29, this._pole);
    j.sodeL.rotation.set(-0.12, 0, 0.08);

    this._updateCloak(dt, speed, windGust);
  }

  _updateCloak(dt, speed, windGust) {
    const cloak = this.model.cloak;
    cloak.time += dt;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    const air = this.airBlend;
    for (let s = 0; s < steps; s++) {
      for (let r = 1; r < cloak.rows; r++) {
        const f = r / (cloak.rows - 1);
        const flutter = Math.sin(cloak.time * (5.5 + r * 0.4) - r * 0.8) * (0.03 + speed * 0.012 + windGust * 0.04) * f;
        const target = 0.06 + speed * 0.05 * f + air * 0.5 * f + windGust * 0.15 * f + flutter + this.land * -0.05;
        const prev = cloak.angles[r - 1];
        // Spring towards the target, coupled to the row above for a travelling wave.
        const acc = (target - cloak.angles[r]) * 60 + (prev - cloak.angles[r]) * 25 - cloak.velocities[r] * 7;
        cloak.velocities[r] += acc * h;
        cloak.angles[r] = clamp(cloak.angles[r] + cloak.velocities[r] * h, 0.02, 1.35);
        const swayTarget = -this.lean * 0.6 * f + Math.sin(cloak.time * 1.7 + r * 0.5) * 0.02 * (windGust + 0.3);
        const sacc = (swayTarget - cloak.sway[r]) * 40 - cloak.swayVel[r] * 6;
        cloak.swayVel[r] += sacc * h;
        cloak.sway[r] += cloak.swayVel[r] * h;
      }
    }
    // When a leg swings backwards the cloak must clear it.
    const legBack = Math.max(-this.poses.out.get('thighLP'), -this.poses.out.get('thighRP'), 0);
    for (let r = 4; r < cloak.rows; r++) cloak.angles[r] = Math.max(cloak.angles[r], 0.08 + legBack * 0.6 * (r / cloak.rows));
    updateCloakGeometry(cloak);
  }
}
