// Third-person orbit camera with smoothing, pitch limits and collision avoidance.

import { colliderSurfaceHeight } from './collision.js';
import { clamp } from './noise.js';

export const CAMERA_LIMITS = Object.freeze({
  minPitch: -0.42, // looking slightly up at the sky
  maxPitch: 1.15, // looking down at the character
  minDistance: 2.2,
  maxDistance: 9,
  clearance: 0.32,
});

/** Unit vector from the pivot towards the camera for a given yaw / pitch. */
export function orbitOffset(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  // Camera looks along (-sin yaw, -cos yaw); it sits behind the pivot.
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(yaw) * cp;
  return out;
}

export function clampPitch(pitch, limits = CAMERA_LIMITS) {
  return clamp(pitch, limits.minPitch, limits.maxPitch);
}

const queryScratch = [];

/**
 * March from the pivot towards the desired camera distance and return the
 * largest distance that keeps the camera above the terrain and outside rocks.
 */
export function collideCameraDistance(pivot, dir, desired, env, limits = CAMERA_LIMITS) {
  const steps = 24;
  const clearance = limits.clearance;
  let allowed = desired;
  for (let i = 1; i <= steps; i++) {
    const d = (desired * i) / steps;
    const x = pivot.x + dir.x * d;
    const y = pivot.y + dir.y * d;
    const z = pivot.z + dir.z * d;
    let blocked = y < env.groundHeight(x, z) + clearance;
    if (!blocked && env.colliders) {
      const hits = env.colliders.query(x, z, clearance, queryScratch);
      for (const c of hits) {
        if (c.type === 'rock') {
          const top = colliderSurfaceHeight(c, x, z);
          const dx = x - c.x;
          const dz = z - c.z;
          const inside = Math.sqrt(dx * dx + dz * dz) < c.r + clearance * 0.5;
          if (inside && y < Math.max(top, c.base + c.top * 0.3) + clearance) {
            blocked = true;
            break;
          }
        } else if (c.type === 'tree' && y < c.height) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      allowed = Math.max(0.6, (desired * (i - 1)) / steps - 0.1);
      break;
    }
  }
  return Math.min(allowed, desired);
}

export class CameraRig {
  constructor(camera, env) {
    this.camera = camera;
    this.env = env;
    this.yaw = 0;
    this.pitch = 0.14;
    this.distance = 5;
    this.currentDistance = 5;
    this.sensitivity = 1;
    this.invertY = false;
    this.pivot = { x: 0, y: 0, z: 0 };
    this.pivotVel = { x: 0, y: 0, z: 0 };
    this.shoulder = 0.38;
    this.pivotHeight = 1.55;
    this._dir = { x: 0, y: 0, z: 0 };
    this._initialized = false;
  }

  /** Mouse delta in pixels. */
  rotate(dx, dy) {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch = clampPitch(this.pitch + (this.invertY ? -dy : dy) * k);
  }

  zoom(delta) {
    this.distance = clamp(this.distance + delta, CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance);
  }

  snapTo(target, yaw = this.yaw) {
    this.yaw = yaw;
    this.pivot.x = target.x;
    this.pivot.y = target.y + this.pivotHeight;
    this.pivot.z = target.z;
    this.pivotVel.x = this.pivotVel.y = this.pivotVel.z = 0;
    this.currentDistance = this.distance;
    this._initialized = true;
    this.update(target, 0);
  }

  update(target, dt) {
    if (!this._initialized) {
      this.snapTo(target);
      return;
    }
    // Critically damped follow: smooth but without lag building up while sprinting.
    const omega = 14;
    const tx = target.x;
    const ty = target.y + this.pivotHeight;
    const tz = target.z;
    if (dt > 0) {
      const t = Math.min(dt, 0.5);
      const f = 1 + 2 * t * omega;
      const oo = omega * omega;
      const hoo = t * oo;
      const hhoo = t * hoo;
      const detInv = 1 / (f + hhoo);
      for (const [axis, goal] of [['x', tx], ['y', ty], ['z', tz]]) {
        const x = this.pivot[axis];
        const v = this.pivotVel[axis];
        const detX = f * x + t * v + hhoo * goal;
        const detV = v + hoo * (goal - x);
        this.pivot[axis] = detX * detInv;
        this.pivotVel[axis] = detV * detInv;
      }
    }

    const dir = orbitOffset(this.yaw, this.pitch, this._dir);
    const allowed = collideCameraDistance(this.pivot, dir, this.distance, this.env);
    if (dt <= 0) this.currentDistance = allowed;
    else if (allowed < this.currentDistance) {
      // Pull in quickly to avoid clipping, ease out slowly.
      this.currentDistance += (allowed - this.currentDistance) * Math.min(1, dt * 25);
    } else {
      this.currentDistance += (allowed - this.currentDistance) * Math.min(1, dt * 3);
    }
    const d = this.currentDistance;

    // Slight over-the-shoulder offset (to the right of the view).
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const shoulder = this.shoulder * clamp(d / this.distance, 0.3, 1);
    let cx = this.pivot.x + dir.x * d + rx * shoulder;
    let cy = this.pivot.y + dir.y * d;
    let cz = this.pivot.z + dir.z * d + rz * shoulder;
    const floor = this.env.groundHeight(cx, cz) + CAMERA_LIMITS.clearance;
    if (cy < floor) cy = floor;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.pivot.x + rx * shoulder, this.pivot.y + 0.1, this.pivot.z + rz * shoulder);
  }
}
