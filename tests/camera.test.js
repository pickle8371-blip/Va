import { describe, it, expect } from 'vitest';
import { orbitOffset, clampPitch, collideCameraDistance, CameraRig, CAMERA_LIMITS } from '../src/camera.js';
import { ColliderWorld } from '../src/collision.js';

function fakeCamera() {
  return {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    target: null,
    lookAt(x, y, z) { this.target = { x, y, z }; },
  };
}

const flatEnv = { groundHeight: () => 0, colliders: null };

describe('orbitOffset', () => {
  it('places the camera behind (+Z) the pivot for yaw 0', () => {
    const o = orbitOffset(0, 0);
    expect(o.z).toBeCloseTo(1);
    expect(o.x).toBeCloseTo(0);
  });
  it('raises the camera with positive pitch', () => {
    expect(orbitOffset(0, 0.5).y).toBeGreaterThan(0);
  });
  it('is a unit vector', () => {
    const o = orbitOffset(1.2, 0.7);
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1);
  });
});

describe('pitch limits', () => {
  it('clamps pitch to the configured range', () => {
    expect(clampPitch(5)).toBe(CAMERA_LIMITS.maxPitch);
    expect(clampPitch(-5)).toBe(CAMERA_LIMITS.minPitch);
    expect(clampPitch(0.2)).toBe(0.2);
  });
  it('mouse rotation cannot exceed the limits', () => {
    const rig = new CameraRig(fakeCamera(), flatEnv);
    rig.rotate(0, 100000);
    expect(rig.pitch).toBe(CAMERA_LIMITS.maxPitch);
    rig.rotate(0, -100000);
    expect(rig.pitch).toBe(CAMERA_LIMITS.minPitch);
  });
});

describe('camera collision', () => {
  it('keeps the full distance on open ground', () => {
    const d = collideCameraDistance({ x: 0, y: 1.6, z: 0 }, orbitOffset(0, 0.2), 5, flatEnv);
    expect(d).toBeCloseTo(5);
  });

  it('pulls in when terrain rises behind the player', () => {
    // A wall of terrain 2 m behind the pivot.
    const env = { groundHeight: (x, z) => (z > 2 ? 10 : 0), colliders: null };
    const d = collideCameraDistance({ x: 0, y: 1.6, z: 0 }, orbitOffset(0, 0.1), 6, env);
    expect(d).toBeLessThan(2.2);
  });

  it('pulls in when a boulder is between camera and player', () => {
    const w = new ColliderWorld();
    w.addGroup('r', [{ type: 'rock', x: 0, z: 3, r: 1.2, base: 0, top: 3 }]);
    const d = collideCameraDistance({ x: 0, y: 1.6, z: 0 }, orbitOffset(0, 0.1), 6, { groundHeight: () => 0, colliders: w });
    expect(d).toBeLessThan(2.2);
  });

  it('never places the camera below the ground', () => {
    const cam = fakeCamera();
    const env = { groundHeight: (x, z) => z * 0.8, colliders: null };
    const rig = new CameraRig(cam, env);
    rig.pitch = CAMERA_LIMITS.minPitch;
    rig.snapTo({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 60; i++) rig.update({ x: 0, y: 0, z: 0 }, 1 / 60);
    expect(cam.position.y).toBeGreaterThanOrEqual(env.groundHeight(cam.position.x, cam.position.z) + CAMERA_LIMITS.clearance - 1e-6);
  });
});

describe('camera smoothing', () => {
  it('does not move when the target and input are still', () => {
    const cam = fakeCamera();
    const rig = new CameraRig(cam, flatEnv);
    rig.snapTo({ x: 3, y: 0, z: 4 }, 0.5);
    for (let i = 0; i < 30; i++) rig.update({ x: 3, y: 0, z: 4 }, 1 / 60);
    const before = { ...cam.position };
    for (let i = 0; i < 120; i++) rig.update({ x: 3, y: 0, z: 4 }, 1 / 60);
    expect(cam.position.x).toBeCloseTo(before.x, 6);
    expect(cam.position.y).toBeCloseTo(before.y, 6);
    expect(cam.position.z).toBeCloseTo(before.z, 6);
  });

  it('follows a moving target smoothly without snapping', () => {
    const cam = fakeCamera();
    const rig = new CameraRig(cam, flatEnv);
    rig.snapTo({ x: 0, y: 0, z: 0 }, 0);
    let maxStep = 0;
    let prev = { ...cam.position };
    for (let i = 1; i <= 120; i++) {
      rig.update({ x: 0, y: 0, z: -i * (8.4 / 60) }, 1 / 60);
      maxStep = Math.max(maxStep, Math.hypot(cam.position.x - prev.x, cam.position.z - prev.z));
      prev = { ...cam.position };
    }
    // Sprint speed is 8.4 m/s -> 0.14 m per frame; the camera should never jump much more.
    expect(maxStep).toBeLessThan(0.2);
    // A critically damped follow settles to a constant lag of 2v/omega (~1.2 m at sprint), never growing.
    expect(Math.abs(rig.pivot.z - -120 * (8.4 / 60))).toBeLessThan(1.3);
  });

  it('clamps zoom to the allowed distance range', () => {
    const rig = new CameraRig(fakeCamera(), flatEnv);
    rig.zoom(100);
    expect(rig.distance).toBe(CAMERA_LIMITS.maxDistance);
    rig.zoom(-100);
    expect(rig.distance).toBe(CAMERA_LIMITS.minDistance);
  });
});
