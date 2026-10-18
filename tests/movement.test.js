import { describe, it, expect } from 'vitest';
import { inputToWishDir, createBodyState, stepBody, MOVE_PARAMS, wrapAngle } from '../src/movement.js';
import { ColliderWorld } from '../src/collision.js';

const flat = (h = 0) => ({
  groundHeight: () => h,
  groundNormal: (x, z, out) => Object.assign(out, { x: 0, y: 1, z: 0 }),
  colliders: null,
});

// A plane rising towards -Z with the given slope (rise / run).
const slope = (k) => ({
  groundHeight: (x, z) => -z * k,
  groundNormal: (x, z, out) => {
    const len = Math.hypot(k, 1);
    return Object.assign(out, { x: 0, y: 1 / len, z: k / len });
  },
  colliders: null,
});

const NO_INPUT = { x: 0, y: 0, sprint: false, jump: false };
const run = (state, input, yaw, env, seconds, dt = 1 / 60) => {
  const events = [];
  for (let t = 0; t < seconds; t += dt) events.push({ ...stepBody(state, input, yaw, dt, env) });
  return events;
};

describe('inputToWishDir', () => {
  it('maps forward to -Z for camera yaw 0', () => {
    const d = inputToWishDir(0, 1, 0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-1);
  });
  it('maps right to +X for camera yaw 0', () => {
    const d = inputToWishDir(1, 0, 0);
    expect(d.x).toBeCloseTo(1);
    expect(d.z).toBeCloseTo(0);
  });
  it('is camera relative', () => {
    const d = inputToWishDir(0, 1, Math.PI / 2);
    expect(d.x).toBeCloseTo(-1);
    expect(d.z).toBeCloseTo(0);
  });
  it('never makes diagonals faster than straight movement', () => {
    const d = inputToWishDir(1, 1, 0.3);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });
  it('returns zero for no input', () => {
    const d = inputToWishDir(0, 0, 1);
    expect(d.x).toBe(0);
    expect(d.z).toBe(0);
  });
});

describe('stepBody on flat ground', () => {
  it('accelerates smoothly to walking speed', () => {
    const s = createBodyState();
    stepBody(s, { x: 0, y: 1, sprint: false, jump: false }, 0, 1 / 60, flat());
    const early = Math.hypot(s.vel.x, s.vel.z);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(MOVE_PARAMS.walkSpeed);
    run(s, { x: 0, y: 1, sprint: false, jump: false }, 0, flat(), 1);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(MOVE_PARAMS.walkSpeed, 3);
    expect(s.pos.z).toBeLessThan(0);
  });

  it('sprints faster than walking', () => {
    const s = createBodyState();
    run(s, { x: 0, y: 1, sprint: true, jump: false }, 0, flat(), 1.5);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(MOVE_PARAMS.runSpeed, 3);
  });

  it('diagonal movement is not faster than forward movement', () => {
    const a = createBodyState();
    const b = createBodyState();
    run(a, { x: 0, y: 1, sprint: false, jump: false }, 0, flat(), 2);
    run(b, { x: 1, y: 1, sprint: false, jump: false }, 0, flat(), 2);
    expect(Math.hypot(b.vel.x, b.vel.z)).toBeCloseTo(Math.hypot(a.vel.x, a.vel.z), 5);
  });

  it('decelerates to a complete stop with no input and then stays still', () => {
    const s = createBodyState();
    run(s, { x: 0, y: 1, sprint: true, jump: false }, 0, flat(), 1);
    run(s, NO_INPUT, 0, flat(), 1);
    expect(s.vel.x).toBe(0);
    expect(s.vel.z).toBe(0);
    const { x, z } = s.pos;
    run(s, NO_INPUT, 0, flat(), 3);
    expect(s.pos.x).toBe(x);
    expect(s.pos.z).toBe(z);
  });

  it('turns the character towards the direction of travel', () => {
    const s = createBodyState(0, 0, 0, 0);
    run(s, { x: 1, y: 0, sprint: false, jump: false }, 0, flat(), 1);
    // Moving towards +X means facing atan2(1, 0) = PI/2.
    expect(wrapAngle(s.facing - Math.PI / 2)).toBeCloseTo(0, 2);
  });
});

describe('jumping and gravity', () => {
  it('jumps only when grounded and lands again', () => {
    const s = createBodyState();
    const first = stepBody(s, { x: 0, y: 0, sprint: false, jump: true }, 0, 1 / 60, flat());
    expect(first.jumped).toBe(true);
    expect(s.grounded).toBe(false);
    // A second jump press in mid-air does nothing.
    run(s, NO_INPUT, 0, flat(), 0.2);
    const vyBefore = s.vel.y;
    const mid = stepBody(s, { x: 0, y: 0, sprint: false, jump: true }, 0, 1 / 60, flat());
    expect(mid.jumped).toBe(false);
    expect(s.vel.y).toBeLessThan(vyBefore);
    const events = run(s, NO_INPUT, 0, flat(), 2);
    const landing = events.find((e) => e.landed);
    expect(landing).toBeTruthy();
    expect(landing.landingSpeed).toBeGreaterThan(5);
    expect(s.grounded).toBe(true);
    expect(s.pos.y).toBe(0);
  });

  it('reaches a sensible apex height', () => {
    const s = createBodyState();
    stepBody(s, { x: 0, y: 0, sprint: false, jump: true }, 0, 1 / 120, flat());
    let apex = 0;
    for (let i = 0; i < 240; i++) {
      stepBody(s, NO_INPUT, 0, 1 / 120, flat());
      apex = Math.max(apex, s.pos.y);
    }
    const expected = (MOVE_PARAMS.jumpSpeed * MOVE_PARAMS.jumpSpeed) / (2 * MOVE_PARAMS.gravity);
    expect(apex).toBeGreaterThan(expected * 0.9);
    expect(apex).toBeLessThan(expected * 1.05);
  });

  it('falls from a height and lands without going below the ground', () => {
    const s = createBodyState(0, 10, 0);
    s.grounded = false;
    let minY = Infinity;
    for (let i = 0; i < 180; i++) {
      stepBody(s, NO_INPUT, 0, 1 / 60, flat(2));
      minY = Math.min(minY, s.pos.y);
    }
    expect(minY).toBeGreaterThanOrEqual(2);
    expect(s.pos.y).toBe(2);
    expect(s.grounded).toBe(true);
  });

  it('is stable with large frame times (no tunnelling through the ground)', () => {
    const s = createBodyState(0, 30, 0);
    s.grounded = false;
    for (let i = 0; i < 20; i++) stepBody(s, NO_INPUT, 0, 0.5, flat(0));
    expect(s.pos.y).toBe(0);
    expect(s.grounded).toBe(true);
  });
});

describe('slopes', () => {
  it('stays grounded while walking down a moderate slope (no bouncing)', () => {
    const s = createBodyState(0, 0, 0);
    const env = slope(0.4);
    let airborneFrames = 0;
    for (let i = 0; i < 180; i++) {
      // Walk towards +Z, which is downhill.
      stepBody(s, { x: 0, y: -1, sprint: true, jump: false }, 0, 1 / 60, env);
      if (!s.grounded) airborneFrames++;
      expect(s.pos.y).toBeCloseTo(env.groundHeight(s.pos.x, s.pos.z), 5);
    }
    expect(airborneFrames).toBe(0);
  });

  it('walks up a moderate slope, a little slower than on flat ground', () => {
    const s = createBodyState(0, 0, 0);
    const env = slope(0.3);
    run(s, { x: 0, y: 1, sprint: false, jump: false }, 0, env, 2);
    expect(s.pos.z).toBeLessThan(-3);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThan(MOVE_PARAMS.walkSpeed);
    expect(s.pos.y).toBeCloseTo(env.groundHeight(0, s.pos.z), 5);
  });

  it('cannot climb a slope steeper than the limit', () => {
    const s = createBodyState(0, 0, 0);
    const env = slope(1.6); // ~58 degrees
    run(s, { x: 0, y: 1, sprint: true, jump: false }, 0, env, 2);
    expect(s.pos.z).toBeGreaterThan(-0.05);
  });
});

describe('collisions with environment colliders', () => {
  it('is blocked by a tall boulder', () => {
    const world = new ColliderWorld();
    world.addGroup('test', [{ type: 'rock', x: 0, z: -5, r: 1.5, base: 0, top: 2.5 }]);
    const env = { ...flat(0), colliders: world };
    const s = createBodyState(0, 0, 0);
    run(s, { x: 0, y: 1, sprint: true, jump: false }, 0, env, 3);
    expect(s.pos.z).toBeGreaterThan(-5 + 1.5);
  });

  it('steps onto a low stone', () => {
    const world = new ColliderWorld();
    world.addGroup('test', [{ type: 'rock', x: 0, z: -3, r: 1, base: 0, top: 0.3 }]);
    const env = { ...flat(0), colliders: world };
    const s = createBodyState(0, 0, 0);
    let maxY = 0;
    for (let i = 0; i < 90; i++) {
      stepBody(s, { x: 0, y: 1, sprint: false, jump: false }, 0, 1 / 60, env);
      maxY = Math.max(maxY, s.pos.y);
    }
    expect(maxY).toBeGreaterThan(0.2);
    expect(s.pos.z).toBeLessThan(-4); // walked over it
  });

  it('can jump onto a boulder and stand on it', () => {
    const world = new ColliderWorld();
    world.addGroup('test', [{ type: 'rock', x: 0, z: -2.2, r: 1.6, base: 0, top: 1.0 }]);
    const env = { ...flat(0), colliders: world };
    const s = createBodyState(0, 0, 0);
    stepBody(s, { x: 0, y: 1, sprint: false, jump: true }, 0, 1 / 60, env);
    run(s, { x: 0, y: 1, sprint: false, jump: false }, 0, env, 0.55);
    run(s, NO_INPUT, 0, env, 1.5);
    expect(s.grounded).toBe(true);
    expect(s.pos.y).toBeGreaterThan(0.5);
  });

  it('is blocked by a tree trunk', () => {
    const world = new ColliderWorld();
    world.addGroup('test', [{ type: 'tree', x: 0, z: -4, r: 0.35, height: 50 }]);
    const env = { ...flat(0), colliders: world };
    const s = createBodyState(0, 0, 0);
    run(s, { x: 0, y: 1, sprint: false, jump: false }, 0, env, 3);
    expect(Math.hypot(s.pos.x, s.pos.z + 4)).toBeGreaterThanOrEqual(0.35 + MOVE_PARAMS.radius - 1e-6);
  });
});
