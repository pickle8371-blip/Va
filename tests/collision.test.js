import { describe, it, expect } from 'vitest';
import { ColliderWorld, colliderSurfaceHeight, resolveColliders } from '../src/collision.js';

describe('ColliderWorld spatial hash', () => {
  it('finds nearby colliders and ignores distant ones', () => {
    const w = new ColliderWorld(16);
    const near = { type: 'rock', x: 3, z: 3, r: 1, base: 0, top: 1 };
    const far = { type: 'rock', x: 300, z: 300, r: 1, base: 0, top: 1 };
    w.addGroup('a', [near, far]);
    const hits = w.query(0, 0, 4);
    expect(hits).toContain(near);
    expect(hits).not.toContain(far);
  });

  it('does not return duplicates for colliders spanning several cells', () => {
    const w = new ColliderWorld(4);
    const big = { type: 'rock', x: 0, z: 0, r: 10, base: 0, top: 3 };
    w.addGroup('a', [big]);
    expect(w.query(0, 0, 1).filter((c) => c === big)).toHaveLength(1);
  });

  it('removes groups cleanly', () => {
    const w = new ColliderWorld(16);
    w.addGroup('a', [{ type: 'tree', x: 0, z: 0, r: 0.3, height: 10 }]);
    w.addGroup('b', [{ type: 'tree', x: 1, z: 0, r: 0.3, height: 10 }]);
    expect(w.size).toBe(2);
    w.removeGroup('a');
    expect(w.size).toBe(1);
    expect(w.query(1, 0, 0.5)).toHaveLength(1);
    w.removeGroup('b');
    expect(w.query(0, 0, 5)).toHaveLength(0);
    expect(w.cells.size).toBe(0);
  });
});

describe('rock surface', () => {
  const rock = { type: 'rock', x: 0, z: 0, r: 2, base: 1, top: 2 };
  it('is highest at the centre', () => {
    expect(colliderSurfaceHeight(rock, 0, 0)).toBeCloseTo(3);
  });
  it('slopes down towards the edge and is absent outside', () => {
    expect(colliderSurfaceHeight(rock, 1.9, 0)).toBeLessThan(2);
    expect(colliderSurfaceHeight(rock, 2.1, 0)).toBe(-Infinity);
  });
});

describe('resolveColliders', () => {
  it('pushes a body out of a tall rock', () => {
    const w = new ColliderWorld();
    w.addGroup('a', [{ type: 'rock', x: 0, z: 0, r: 1, base: 0, top: 3 }]);
    const pos = { x: 0.5, z: 0 };
    resolveColliders(w, pos, 0.3, 0);
    // The dome is slightly narrower at step height than at its base.
    const blockR = Math.sqrt(1 - (0.4 / 3) ** 2);
    expect(Math.hypot(pos.x, pos.z)).toBeCloseTo(blockR + 0.3, 5);
  });

  it('pushes a body out of a tree trunk even when exactly centred', () => {
    const w = new ColliderWorld();
    w.addGroup('a', [{ type: 'tree', x: 0, z: 0, r: 0.3, height: 20 }]);
    const pos = { x: 0, z: 0 };
    resolveColliders(w, pos, 0.3, 0);
    expect(Math.hypot(pos.x, pos.z)).toBeCloseTo(0.6);
  });

  it('reports a low rock as walkable support instead of blocking', () => {
    const w = new ColliderWorld();
    w.addGroup('a', [{ type: 'rock', x: 0, z: 0, r: 1, base: 0, top: 0.3 }]);
    const pos = { x: 0.2, z: 0 };
    const support = resolveColliders(w, pos, 0.3, 0);
    expect(pos.x).toBe(0.2);
    expect(support).toBeGreaterThan(0.25);
  });

  it('lets a body standing above a rock pass over it', () => {
    const w = new ColliderWorld();
    w.addGroup('a', [{ type: 'rock', x: 0, z: 0, r: 1, base: 0, top: 1 }]);
    const pos = { x: 1.1, z: 0 };
    resolveColliders(w, pos, 0.3, 1.5);
    expect(pos.x).toBe(1.1);
  });

  it('separates a body wedged between two rocks', () => {
    const w = new ColliderWorld();
    w.addGroup('a', [
      { type: 'rock', x: -1, z: 0, r: 0.9, base: 0, top: 3 },
      { type: 'rock', x: 1, z: 0, r: 0.9, base: 0, top: 3 },
    ]);
    const pos = { x: 0.05, z: 0.2 };
    resolveColliders(w, pos, 0.3, 0);
    expect(Math.hypot(pos.x + 1, pos.z)).toBeGreaterThan(1.1);
    expect(Math.hypot(pos.x - 1, pos.z)).toBeGreaterThan(1.1);
  });
});
