// Procedurally generated, tileable textures (no image files needed).

import * as THREE from 'three';
import { createRandom } from './noise.js';

function tileableValueNoise(size, period, seed) {
  const rand = createRandom(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const ux = tx * tx * (3 - 2 * tx);
      const uy = ty * ty * (3 - 2 * ty);
      const x0 = ix % period;
      const y0 = iy % period;
      const x1 = (ix + 1) % period;
      const y1 = (iy + 1) % period;
      const a = lattice[y0 * period + x0];
      const b = lattice[y0 * period + x1];
      const c = lattice[y1 * period + x0];
      const d = lattice[y1 * period + x1];
      out[y * size + x] = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }
  }
  return out;
}

function tileableFbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = tileableValueNoise(size, basePeriod << o, seed + o * 31);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function makeDataTexture(data, size, { srgb = false, repeat = true } = {}) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft ground detail (multiplied over the terrain's vertex colours). */
export function createGroundDetailTexture() {
  const size = 256;
  const large = tileableFbm(size, 4, 4, 11);
  const fine = tileableFbm(size, 32, 2, 77);
  const rand = createRandom(5);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const speck = rand() < 0.08 ? (rand() - 0.5) * 0.25 : 0;
    const v = 0.78 + (large[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.22 + speck;
    const c = Math.max(0, Math.min(255, v * 255));
    data[i * 4] = c;
    data[i * 4 + 1] = c * (0.97 + fine[i] * 0.05);
    data[i * 4 + 2] = c * 0.94;
    data[i * 4 + 3] = 255;
  }
  return makeDataTexture(data, size);
}

/** Large tileable noise used to drive coordinated wind gusts across the grass. */
export function createWindTexture() {
  const size = 128;
  const a = tileableFbm(size, 3, 4, 202);
  const b = tileableFbm(size, 6, 3, 303);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = a[i] * 255;
    data[i * 4 + 1] = b[i] * 255;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = makeDataTexture(data, size);
  tex.anisotropy = 1;
  return tex;
}

/** Woven straw for the samurai's hat. */
export function createStrawTexture() {
  const size = 128;
  const n = tileableFbm(size, 16, 2, 909);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const weave = Math.sin((x / size) * Math.PI * 2 * 24) * 0.5 + 0.5;
      const ring = Math.sin((y / size) * Math.PI * 2 * 40 + weave * 1.4) * 0.5 + 0.5;
      const v = 0.62 + ring * 0.28 + (n[i] - 0.5) * 0.3;
      data[i * 4] = Math.min(255, v * 196);
      data[i * 4 + 1] = Math.min(255, v * 160);
      data[i * 4 + 2] = Math.min(255, v * 104);
      data[i * 4 + 3] = 255;
    }
  }
  return makeDataTexture(data, size, { srgb: true });
}

/** Subtle woven fabric bump/variation, greyscale (used as a colour multiplier). */
export function createFabricTexture() {
  const size = 128;
  const n = tileableFbm(size, 8, 3, 515);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const warp = Math.sin((x / size) * Math.PI * 2 * 64) * 0.5 + 0.5;
      const weft = Math.sin((y / size) * Math.PI * 2 * 64) * 0.5 + 0.5;
      const v = 0.8 + (warp * weft - 0.25) * 0.12 + (n[i] - 0.5) * 0.35;
      const c = Math.max(0, Math.min(255, v * 255));
      data[i * 4] = c;
      data[i * 4 + 1] = c;
      data[i * 4 + 2] = c;
      data[i * 4 + 3] = 255;
    }
  }
  return makeDataTexture(data, size, { srgb: true });
}

/** Lichen-speckled stone colour variation. */
export function createRockTexture() {
  const size = 256;
  const n = tileableFbm(size, 8, 5, 4242);
  const m = tileableFbm(size, 4, 3, 999);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = 0.55 + (n[i] - 0.5) * 0.7;
    const lichen = Math.max(0, (m[i] - 0.58) * 3.5);
    const r = v * (1 - lichen) + lichen * 0.62;
    const g = v * (1 - lichen) + lichen * 0.6;
    const b = v * 0.96 * (1 - lichen) + lichen * 0.38;
    data[i * 4] = Math.min(255, r * 255);
    data[i * 4 + 1] = Math.min(255, g * 255);
    data[i * 4 + 2] = Math.min(255, b * 255);
    data[i * 4 + 3] = 255;
  }
  return makeDataTexture(data, size, { srgb: true });
}
