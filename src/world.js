// The analytic description of the world. Terrain meshes, grass, rocks, trees,
// player physics and the camera all sample these functions, so what you see and
// what you collide with always agree.

import { createNoise2D, smoothstep, clamp } from './noise.js';

const nHills = createNoise2D(1101);
const nDetail = createNoise2D(2202);
const nRidge = createNoise2D(3303);
const nMountain = createNoise2D(4404);
const nMask = createNoise2D(5505);
const nPath = createNoise2D(6606);
const nWarp = createNoise2D(7707);
const nTint = createNoise2D(8808);
const nClearing = createNoise2D(9909);

export const SPAWN = Object.freeze({ x: -60, z: 10, yaw: 0 });
// Direction the player initially faces (towards -Z, where the main range rises).
export const SPAWN_FORWARD = Object.freeze({ x: 0, z: -1 });

const PATH_ANCHOR = { x: SPAWN.x + 6, z: SPAWN.z - 16 };
let pathOffset = 0;

function fbm(noise, x, z, octaves, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x, z) * amp;
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    z *= lacunarity;
  }
  return sum / norm;
}

function ridged(noise, x, z, octaves) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, z));
    n *= n;
    n *= weight;
    weight = clamp(n * 1.6, 0, 1);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.1;
    z *= 2.1;
  }
  return sum / norm;
}

// 0 near spawn, rising to 1 where mountain ranges are allowed.
export function mountainMask(x, z) {
  const d = Math.sqrt(x * x + z * z);
  const regional = nMask(x / 4200 + 3.1, z / 4200 - 1.7) * 0.5 + 0.5;
  // A dependable range to the north (the initial view direction) and broken ranges elsewhere.
  const north = smoothstep(-1700, -3600, z) * 0.55;
  const m = smoothstep(0.5, 0.78, regional + north);
  return m * smoothstep(1100, 2800, d);
}

function pathField(x, z) {
  const wx = x + nWarp(x / 160, z / 160) * 28;
  const wz = z + nWarp(x / 160 + 9.2, z / 160 - 4.4) * 28;
  return nPath(wx / 520, wz / 520) - pathOffset;
}
pathOffset = 0;
pathOffset = pathField(PATH_ANCHOR.x, PATH_ANCHOR.z);

// 1 on the centre of a dirt path, 0 away from it.
export function pathMask(x, z) {
  const v = Math.abs(pathField(x, z));
  // Typical gradient of the warped noise is ~1/300 per metre -> half-width ~1.1 m.
  const halfWidth = 0.0042;
  const m = 1 - smoothstep(halfWidth * 0.45, halfWidth, v);
  if (m <= 0) return 0;
  return m * (1 - mountainMask(x, z));
}

// 1 inside open meadow clearings where the grass is short.
export function clearingMask(x, z) {
  const c = nClearing(x / 110, z / 110) * 0.7 + nClearing(x / 37 + 4, z / 37) * 0.3;
  return smoothstep(0.42, 0.62, c);
}

export function getHeight(x, z) {
  const sx = x - SPAWN.x;
  const sz = z - SPAWN.z;
  const d2 = sx * sx + sz * sz;

  // Broad rolling hills with softened tops.
  const broad = fbm(nHills, x / 640, z / 640, 3, 2.03, 0.4) * 30;
  const rolling = nHills(x / 240 + 11.3, z / 240 - 7.9) * 4.5;
  // Occasional long ridgelines.
  const r = 1 - Math.abs(nRidge(x / 760, z / 760));
  const ridge = r * r * 16 * (nRidge(x / 2100 + 5, z / 2100) * 0.5 + 0.5);
  const detail = nDetail(x / 52, z / 52) * 0.55 + nDetail(x / 14 + 3.3, z / 14) * 0.1;

  let h = broad + rolling + ridge + detail;

  // A gentle rise at the start so the first view looks out over the plains.
  h += 5 * Math.exp(-d2 / (180 * 180));
  // Lower the land in front of spawn into a wide valley.
  const vx = x - 40;
  const vz = z + 420;
  h -= 14 * Math.exp(-(vx * vx + vz * vz) / (330 * 330));

  const mask = mountainMask(x, z);
  if (mask > 0) {
    // Rounded volcanic massifs with ridged crests, rather than sharp pyramids.
    const crest = ridged(nMountain, x / 2300, z / 2300, 5);
    const body = fbm(nMountain, x / 3100 + 17, z / 3100 - 9, 3) * 0.5 + 0.5;
    h += mask * ((crest * 0.5 + body * 0.5) * 460 + 30);
  }

  const p = pathMask(x, z);
  if (p > 0) h -= p * 0.18;

  return h;
}

// Approximate surface normal from central differences.
export function getNormal(x, z, out = { x: 0, y: 1, z: 0 }, eps = 0.5) {
  const hl = getHeight(x - eps, z);
  const hr = getHeight(x + eps, z);
  const hd = getHeight(x, z - eps);
  const hu = getHeight(x, z + eps);
  const nx = hl - hr;
  const nz = hd - hu;
  const ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

// Golden (1) vs. green (0) grass tint, varying smoothly across the landscape.
export function grassTint(x, z) {
  const t = fbm(nTint, x / 260, z / 260, 3) * 0.75 + nTint(x / 40 + 7, z / 40) * 0.25;
  return clamp(0.55 + t * 0.9, 0, 1);
}

/**
 * Surface description used to colour terrain and place vegetation.
 * slopeY is the normal's Y component (1 = flat).
 */
export function getSurface(x, z, height, slopeY, out) {
  const mask = mountainMask(x, z);
  const path = pathMask(x, z);
  const clearing = clearingMask(x, z);
  const tint = grassTint(x, z);
  const alpine = smoothstep(90, 200, height) * mask;
  const steep = 1 - smoothstep(0.62, 0.8, slopeY);

  let density = 1;
  density *= 1 - path;
  density *= 1 - steep;
  density *= 1 - alpine;
  density *= 1 - clearing * 0.55;

  out.path = path;
  out.clearing = clearing;
  out.tint = tint;
  out.alpine = alpine;
  out.steep = steep;
  out.mountain = mask;
  out.grassDensity = clamp(density, 0, 1);
  out.grassHeight = (0.62 + tint * 0.45) * (1 - clearing * 0.6);
  return out;
}
