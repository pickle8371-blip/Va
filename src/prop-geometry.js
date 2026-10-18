// Procedural geometry for environment props: rocks, pebbles, trees and a few
// handmade landmarks (torii gate, stone lanterns, wooden posts).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise2D, createRandom } from './noise.js';

const tmpColor = new THREE.Color();

/** Prepare a geometry for merging: non-indexed, position + normal + colour only. */
function painted(geometry, hex, jitter = 0, seed = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const rand = createRandom(seed);
  tmpColor.set(hex);
  for (let i = 0; i < count; i += 3) {
    const k = 1 + (rand() - 0.5) * jitter;
    for (let v = 0; v < 3 && i + v < count; v++) {
      colors[(i + v) * 3] = tmpColor.r * k;
      colors[(i + v) * 3 + 1] = tmpColor.g * k;
      colors[(i + v) * 3 + 2] = tmpColor.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** A weathered boulder of roughly unit radius, flat-ish underside. */
export function createRockGeometry(seed, detail = 3) {
  const noise = createNoise2D(seed);
  const noiseB = createNoise2D(seed + 99);
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  // Weld vertices so the displaced surface shades smoothly.
  const g = mergeVertices(ico);
  ico.dispose();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  const stretchX = 1 + (noise(seed, 0.5) * 0.5 + 0.5) * 0.35;
  const stretchZ = 1 - (noise(0.5, seed) * 0.5 + 0.5) * 0.2;
  const base = new THREE.Color(0x99928a);
  const dark = new THREE.Color(0x645e55);
  const moss = new THREE.Color(0x737a42);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const big = noise(n.x * 1.3 + n.z * 0.7, n.y * 1.3 - n.z * 0.4);
    const small = noiseB(n.x * 4.1 + n.y * 1.7, n.z * 4.1 - n.y * 2.3);
    // Planar facets give the cleaved look of volcanic stone.
    const facet = Math.round(big * 3) / 3;
    const r = 1 + big * 0.22 + facet * 0.08 + small * 0.06;
    v.copy(n).multiplyScalar(r);
    v.x *= stretchX;
    v.z *= stretchZ;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
    const crevice = Math.max(0, -small) * 0.8 + Math.max(0, -big) * 0.3;
    tmpColor.copy(base).lerp(dark, Math.min(1, crevice));
    if (n.y > 0.55) tmpColor.lerp(moss, (n.y - 0.55) * 1.3 * (0.5 + small * 0.5));
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Japanese black pine: a leaning, twisting trunk with flat cloud-like foliage pads. */
export function createPineGeometry(seed) {
  const rand = createRandom(seed);
  const parts = [];
  const lean = (rand() - 0.5) * 0.9;
  const height = 7 + rand() * 4;
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(Math.sin(t * 2.2 + seed) * 0.5 * t + lean * t * t * 3, t * height, Math.cos(t * 1.7 + seed) * 0.35 * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 14, 0.28, 7, false);
  // Taper the trunk.
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const t = y / height;
    const c = curve.getPoint(Math.min(1, Math.max(0, t)));
    const k = 1.25 - t * 0.8;
    tp.setX(i, c.x + (tp.getX(i) - c.x) * k);
    tp.setZ(i, c.z + (tp.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  parts.push(painted(trunk, 0x4a3628, 0.2, seed));

  const padCount = 6 + Math.floor(rand() * 4);
  for (let i = 0; i < padCount; i++) {
    const t = 0.45 + (i / padCount) * 0.55;
    const c = curve.getPoint(Math.min(1, t));
    const ang = rand() * Math.PI * 2;
    const reach = (1 - t) * 3.2 + 0.8 + rand() * 0.8;
    const px = c.x + Math.cos(ang) * reach;
    const pz = c.z + Math.sin(ang) * reach;
    const py = c.y + (rand() - 0.3) * 0.6;
    // Branch to the pad.
    const branchCurve = new THREE.LineCurve3(new THREE.Vector3(c.x, c.y - 0.3, c.z), new THREE.Vector3(px, py - 0.2, pz));
    parts.push(painted(new THREE.TubeGeometry(branchCurve, 2, 0.07, 5, false), 0x4a3628, 0.2, seed + i));
    const pad = new THREE.IcosahedronGeometry(1, 1);
    const sx = 1.4 + rand() * 1.1;
    pad.scale(sx, 0.42 + rand() * 0.2, sx * (0.7 + rand() * 0.4));
    pad.rotateY(rand() * Math.PI);
    pad.translate(px, py, pz);
    parts.push(painted(pad, rand() < 0.5 ? 0x2f3f22 : 0x384a28, 0.35, seed * 7 + i));
  }
  // Crown pad.
  const top = curve.getPoint(1);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  crown.scale(2.1, 0.7, 1.8);
  crown.translate(top.x, top.y + 0.2, top.z);
  parts.push(painted(crown, 0x33452a, 0.35, seed * 13));
  return merge(parts);
}

/** A broadleaf tree with a rounded, lumpy crown. */
export function createBroadleafGeometry(seed) {
  const rand = createRandom(seed);
  const noise = createNoise2D(seed);
  const parts = [];
  const height = 4.5 + rand() * 2.5;
  const trunk = new THREE.CylinderGeometry(0.16, 0.32, height, 7, 4);
  trunk.translate(0, height / 2, 0);
  parts.push(painted(trunk, 0x55402e, 0.2, seed));
  const lobes = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : 1.2 + rand() * 1.2;
    const lobe = new THREE.IcosahedronGeometry(1.6 + rand() * 1.1, 2);
    const p = lobe.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const d = 1 + noise(x * 0.9 + i, z * 0.9 + y * 0.5) * 0.18;
      p.setXYZ(k, x * d, y * d * 0.8, z * d);
    }
    lobe.computeVertexNormals();
    lobe.translate(Math.cos(a) * r, height + 0.6 + rand() * 1.4 - r * 0.25, Math.sin(a) * r);
    parts.push(painted(lobe, [0x4a5a2a, 0x56622e, 0x3f5026][i % 3], 0.3, seed * 3 + i));
  }
  return merge(parts);
}

/** Small pebble cluster geometry. */
export function createPebbleGeometry(seed) {
  return createRockGeometry(seed, 1);
}

/** A weathered torii gate (about 5 m tall). */
export function createToriiGeometry() {
  const parts = [];
  const vermilion = 0x8d3b26;
  const black = 0x26211d;
  const pillarH = 4.6;
  for (const x of [-1.9, 1.9]) {
    const pillar = new THREE.CylinderGeometry(0.2, 0.24, pillarH, 12);
    pillar.rotateZ(x > 0 ? -0.03 : 0.03);
    pillar.translate(x, pillarH / 2, 0);
    parts.push(painted(pillar, vermilion, 0.15, 3));
    const foot = new THREE.CylinderGeometry(0.3, 0.32, 0.4, 12);
    foot.translate(x, 0.2, 0);
    parts.push(painted(foot, black, 0.1, 4));
  }
  const nuki = new THREE.BoxGeometry(5.0, 0.26, 0.2);
  nuki.translate(0, pillarH - 0.85, 0);
  parts.push(painted(nuki, vermilion, 0.1, 5));
  const gakuzuka = new THREE.BoxGeometry(0.25, 0.6, 0.18);
  gakuzuka.translate(0, pillarH - 0.4, 0);
  parts.push(painted(gakuzuka, vermilion, 0.1, 6));
  // Curved top beam (kasagi + shimaki).
  for (const [y, h, color, w] of [
    [pillarH - 0.05, 0.3, vermilion, 5.6],
    [pillarH + 0.25, 0.26, black, 6.4],
  ]) {
    const beam = new THREE.BoxGeometry(w, h, 0.42, 24, 1, 1);
    const p = beam.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setY(i, p.getY(i) + Math.pow(Math.abs(x) / (w / 2), 2.2) * 0.32);
    }
    beam.computeVertexNormals();
    beam.translate(0, y, 0);
    parts.push(painted(beam, color, 0.1, 7));
  }
  return merge(parts);
}

/** Moss-covered stone lantern (tōrō). */
export function createLanternGeometry() {
  const parts = [];
  const stone = 0x77736a;
  const add = (g, y, hex = stone) => {
    g.translate(0, y, 0);
    parts.push(painted(g, hex, 0.25, parts.length + 11));
  };
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 8), 0.09);
  add(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 8), 0.58);
  add(new THREE.CylinderGeometry(0.32, 0.22, 0.14, 6), 1.04);
  add(new THREE.BoxGeometry(0.4, 0.34, 0.4), 1.28);
  add(new THREE.ConeGeometry(0.52, 0.32, 6), 1.61);
  add(new THREE.SphereGeometry(0.08, 8, 6), 1.8, 0x5f5c52);
  return merge(parts);
}

/** Old wooden post (fence remnants along paths). */
export function createPostGeometry(seed) {
  const rand = createRandom(seed);
  const post = new THREE.CylinderGeometry(0.07, 0.09, 1.2, 6);
  post.rotateZ((rand() - 0.5) * 0.15);
  post.translate(0, 0.55, 0);
  return merge([painted(post, 0x5b4a38, 0.3, seed)]);
}
