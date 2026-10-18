import { describe, it, expect } from 'vitest';
import { getHeight, getNormal, mountainMask, pathMask, SPAWN } from '../src/world.js';
import { createNoise2D, hash2 } from '../src/noise.js';

describe('noise', () => {
  it('is deterministic for a given seed', () => {
    const a = createNoise2D(5);
    const b = createNoise2D(5);
    expect(a(1.3, 7.7)).toBe(b(1.3, 7.7));
  });
  it('stays within [-1, 1]', () => {
    const n = createNoise2D(9);
    for (let i = 0; i < 5000; i++) {
      const v = n(i * 0.173, i * 0.311);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
    }
  });
  it('hash2 returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, -i * 3, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('terrain', () => {
  it('is deterministic and finite everywhere sampled', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i * 97.31) % 40000 - 20000;
      const z = (i * 53.77) % 40000 - 20000;
      const h = getHeight(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(getHeight(x, z)).toBe(h);
    }
  });

  it('keeps the start area as gentle walkable grassland', () => {
    for (let x = -150; x <= 150; x += 15) {
      for (let z = -150; z <= 150; z += 15) {
        const n = getNormal(SPAWN.x + x, SPAWN.z + z);
        expect(n.y).toBeGreaterThan(0.8);
      }
    }
    expect(mountainMask(SPAWN.x, SPAWN.z)).toBe(0);
  });

  it('has mountains in the distance towards the initial view', () => {
    let maxH = -Infinity;
    for (let x = -3000; x <= 3000; x += 250) maxH = Math.max(maxH, getHeight(x, -4000));
    expect(maxH).toBeGreaterThan(200);
  });

  it('has a dirt path passing just in front of the start', () => {
    expect(pathMask(SPAWN.x + 6, SPAWN.z - 16)).toBeGreaterThan(0.9);
  });

  it('produces unit normals', () => {
    const n = getNormal(123, -456);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
  });
});
