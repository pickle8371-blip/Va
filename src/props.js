// Rocks, pebbles, trees and landmarks, placed deterministically per world cell
// and streamed around the player as instanced meshes. Solid props register
// colliders with the ColliderWorld.

import * as THREE from 'three';
import { getHeight, getNormal, pathMask, mountainMask, SPAWN } from './world.js';
import { createNoise2D, createRandom, hash2 } from './noise.js';
import { withAtmosphere, atmosphereUniforms } from './atmosphere.js';
import { windUniforms } from './grass.js';
import {
  createRockGeometry,
  createPebbleGeometry,
  createPineGeometry,
  createBroadleafGeometry,
  createToriiGeometry,
  createLanternGeometry,
  createPostGeometry,
} from './prop-geometry.js';

const ROCK_CELL = 32;
const TREE_CELL = 48;
const PEBBLE_RADIUS = 70;
const SHRINE_CELL = 320;

const groveNoise = createNoise2D(4141);
const normalScratch = { x: 0, y: 1, z: 0 };

function makeInstanced(geometry, material, capacity, castShadow = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // instances span a large area; bounds are recomputed instead
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function rockCell(cx, cz) {
  const out = [];
  const rand = createRandom(Math.floor(hash2(cx, cz, 1) * 4294967295));
  const x0 = cx * ROCK_CELL;
  const z0 = cz * ROCK_CELL;
  const mtn = mountainMask(x0, z0);
  const clusterChance = 0.2 + mtn * 0.4;
  const place = (x, z, scale, flatten, variant) => {
    if (pathMask(x, z) > 0.2) return;
    const h = getHeight(x, z);
    getNormal(x, z, normalScratch, 1);
    const sy = scale * flatten;
    const sink = sy * (0.22 + (1 - normalScratch.y) * 0.8);
    out.push({
      kind: 'rock',
      variant,
      x,
      y: h - sink,
      z,
      rotY: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.25,
      sx: scale,
      sy,
      sz: scale * (0.75 + rand() * 0.4),
      collider: scale > 0.3 ? { type: 'rock', x, z, r: scale * 1.08, base: h - sink, top: sy * 1.05 } : null,
    });
  };
  if (rand() < clusterChance) {
    const ccx = x0 + rand() * ROCK_CELL;
    const ccz = z0 + rand() * ROCK_CELL;
    const n = 2 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = i === 0 ? 0 : 1.5 + rand() * 4;
      const s = (i === 0 ? 0.8 + rand() * 0.9 : 0.25 + rand() * 0.6) * (1 + mtn);
      place(ccx + Math.cos(a) * d, ccz + Math.sin(a) * d, s, 0.55 + rand() * 0.35, Math.floor(rand() * 4));
    }
  }
  if (rand() < 0.045 + mtn * 0.1) {
    // A lone large boulder.
    place(x0 + rand() * ROCK_CELL, z0 + rand() * ROCK_CELL, 1.8 + rand() * 1.8, 0.6 + rand() * 0.3, Math.floor(rand() * 4));
  }
  return out;
}

function pebbleCell(cx, cz) {
  const out = [];
  const rand = createRandom(Math.floor(hash2(cx, cz, 5) * 4294967295));
  const n = 4 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    const x = (cx + rand()) * ROCK_CELL;
    const z = (cz + rand()) * ROCK_CELL;
    const s = 0.08 + rand() * 0.2;
    const onPath = pathMask(x, z) > 0.3;
    if (!onPath && rand() < 0.4) continue;
    const h = getHeight(x, z);
    out.push({ kind: 'pebble', variant: i % 2, x, y: h - s * 0.3, z, rotY: rand() * 6.28, tilt: 0, sx: s, sy: s * 0.6, sz: s * 0.8, collider: null });
  }
  return out;
}

function treeCell(cx, cz) {
  const out = [];
  const rand = createRandom(Math.floor(hash2(cx, cz, 9) * 4294967295));
  const x0 = cx * TREE_CELL;
  const z0 = cz * TREE_CELL;
  const grove = groveNoise((x0 + 24) / 380, (z0 + 24) / 380) * 0.7 + groveNoise((x0 + 24) / 90, (z0 + 24) / 90) * 0.3;
  let n = 0;
  if (grove > 0.42) n = 1 + Math.floor(rand() * 3 * (grove - 0.3) * 3);
  else if (rand() < 0.035) n = 1;
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * TREE_CELL;
    const z = z0 + rand() * TREE_CELL;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 12) continue;
    if (pathMask(x, z) > 0.05) continue;
    const h = getHeight(x, z);
    getNormal(x, z, normalScratch, 1);
    if (normalScratch.y < 0.8 || h > 260) continue;
    const pine = rand() < 0.62;
    const s = 0.8 + rand() * 0.45;
    out.push({
      kind: pine ? 'pine' : 'broadleaf',
      variant: Math.floor(rand() * 3),
      x,
      y: h - 0.2,
      z,
      rotY: rand() * Math.PI * 2,
      tilt: 0,
      sx: s,
      sy: s,
      sz: s,
      collider: { type: 'tree', x, z, r: 0.3 * s, height: h + 40 },
    });
  }
  return out;
}

/** Roadside shrines on local high points: a reward for wandering. */
function shrineCell(cx, cz) {
  if (hash2(cx, cz, 23) > 0.3) return [];
  const rand = createRandom(Math.floor(hash2(cx, cz, 29) * 4294967295));
  let best = null;
  for (let i = 0; i < 25; i++) {
    const x = (cx + 0.15 + rand() * 0.7) * SHRINE_CELL;
    const z = (cz + 0.15 + rand() * 0.7) * SHRINE_CELL;
    const h = getHeight(x, z);
    getNormal(x, z, normalScratch, 2);
    if (normalScratch.y < 0.93 || mountainMask(x, z) > 0.3 || pathMask(x, z) > 0.05) continue;
    if (!best || h > best.h) best = { x, z, h };
  }
  if (!best) return [];
  return landmarkCluster(best.x, best.z, rand() * Math.PI * 2, rand() < 0.35);
}

function landmarkCluster(x, z, facing, withTorii) {
  const out = [];
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const rx = Math.cos(facing);
  const rz = -Math.sin(facing);
  const push = (kind, px, pz, rotY, scale = 1, collider = null) => {
    out.push({ kind, variant: 0, x: px, y: getHeight(px, pz) - 0.05, z: pz, rotY, tilt: 0, sx: scale, sy: scale, sz: scale, collider });
  };
  if (withTorii) {
    push('torii', x, z, facing, 1, null);
    for (const side of [-1, 1]) {
      const px = x + rx * side * 1.9;
      const pz = z + rz * side * 1.9;
      out.push({ kind: 'collider-only', x: px, z: pz, collider: { type: 'tree', x: px, z: pz, r: 0.3, height: getHeight(px, pz) + 6 } });
    }
  }
  for (const side of [-1, 1]) {
    const px = x + rx * side * 3.2 + fx * 3.5;
    const pz = z + rz * side * 3.2 + fz * 3.5;
    push('lantern', px, pz, facing, 1, { type: 'tree', x: px, z: pz, r: 0.42, height: getHeight(px, pz) + 1.9 });
  }
  for (let i = 0; i < 4; i++) {
    const d = 7 + i * 2.6;
    for (const side of [-1, 1]) {
      const px = x + rx * side * 2.6 + fx * d;
      const pz = z + rz * side * 2.6 + fz * d;
      push('post', px, pz, facing + i, 1, { type: 'tree', x: px, z: pz, r: 0.1, height: getHeight(px, pz) + 1.2 });
    }
  }
  return out;
}

/** Hand-placed features around the start for a composed first view. */
function spawnLandmarks() {
  // A torii on the high ground ahead of the start, facing back towards the player.
  let best = { x: 0, z: -220, h: -Infinity };
  for (let x = SPAWN.x - 140; x <= SPAWN.x + 140; x += 10) {
    for (let z = SPAWN.z - 330; z <= SPAWN.z - 140; z += 10) {
      const h = getHeight(x, z);
      getNormal(x, z, normalScratch, 2);
      if (normalScratch.y < 0.95 || pathMask(x, z) > 0.05) continue;
      // Prefer spots roughly in the initial view direction.
      const score = h - Math.abs(x - SPAWN.x) * 0.08;
      if (score > best.h) best = { x, z, h: score };
    }
  }
  const facing = Math.atan2(SPAWN.x - best.x, SPAWN.z - best.z);
  const out = landmarkCluster(best.x, best.z, facing, true);
  // A lone windswept pine on the knoll beside the start.
  const px = SPAWN.x - 17;
  const pz = SPAWN.z - 21;
  out.push({ kind: 'pine', variant: 1, x: px, y: getHeight(px, pz) - 0.2, z: pz, rotY: 0.6, tilt: 0, sx: 1.15, sy: 1.15, sz: 1.15, collider: { type: 'tree', x: px, z: pz, r: 0.36, height: 60 } });
  // A small rock outcrop close by.
  const rand = createRandom(77);
  for (let i = 0; i < 5; i++) {
    const x = SPAWN.x + 9 + (rand() - 0.5) * 6;
    const z = SPAWN.z - 7 + (rand() - 0.5) * 6;
    const s = i === 0 ? 1.25 : 0.35 + rand() * 0.5;
    const sy = s * 0.7;
    const h = getHeight(x, z);
    out.push({ kind: 'rock', variant: i % 4, x, y: h - sy * 0.25, z, rotY: rand() * 6, tilt: 0.1, sx: s, sy, sz: s * 0.85, collider: s > 0.3 ? { type: 'rock', x, z, r: s * 1.08, base: h - sy * 0.25, top: sy * 1.05 } : null });
  }
  return { items: out, torii: best };
}

export class Props {
  constructor(scene, colliders, { rockRadius = 300, treeRadius = 600 } = {}) {
    this.scene = scene;
    this.colliders = colliders;
    this.rockRadius = rockRadius;
    this.treeRadius = treeRadius;
    this.cellCache = new Map();
    this.colliderCells = new Set();
    this.lastCenter = { x: Infinity, z: Infinity };
    const spawn = spawnLandmarks();
    this.fixed = spawn.items;
    this.toriiLocation = spawn.torii;
    this.colliders.addGroup('fixed', this.fixed.filter((i) => i.collider).map((i) => i.collider));
    this._createMeshes();
  }

  _createMeshes() {
    const rockMaterial = withAtmosphere(new THREE.MeshLambertMaterial({ vertexColors: true }), null, 'rock');
    const woodMaterial = withAtmosphere(new THREE.MeshLambertMaterial({ vertexColors: true }), null, 'wood');
    const treeMaterial = withAtmosphere(
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      (shader) => {
        shader.uniforms.uTime = atmosphereUniforms.uTime;
        shader.uniforms.uWindStrength = windUniforms.uWindStrength;
        shader.uniforms.uWindDir = windUniforms.uWindDir;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;')
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            vec3 transformed = vec3(position);
            #ifdef USE_INSTANCING
              vec2 ip = instanceMatrix[3].xz;
            #else
              vec2 ip = vec2(0.0);
            #endif
            float hgt = max(position.y - 1.2, 0.0);
            float ph = ip.x * 0.07 + ip.y * 0.05;
            float sway = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7 + position.x) * 0.25;
            vec2 sw = uWindDir * (0.6 + sway) * hgt * hgt * 0.0045 * uWindStrength;
            transformed.xz += sw;
            `,
          );
      },
      'tree',
    );

    this.materials = [rockMaterial, woodMaterial, treeMaterial];
    this.meshes = {
      rock: [0, 1, 2, 3].map((i) => makeInstanced(createRockGeometry(300 + i * 17, 2), rockMaterial, 1600)),
      pebble: [0, 1].map((i) => makeInstanced(createPebbleGeometry(900 + i), rockMaterial, 2500, false)),
      pine: [0, 1, 2].map((i) => makeInstanced(createPineGeometry(11 + i * 5), treeMaterial, 700)),
      broadleaf: [0, 1, 2].map((i) => makeInstanced(createBroadleafGeometry(41 + i * 3), treeMaterial, 500)),
      torii: [makeInstanced(createToriiGeometry(), woodMaterial, 40)],
      lantern: [makeInstanced(createLanternGeometry(), rockMaterial, 120)],
      post: [makeInstanced(createPostGeometry(5), woodMaterial, 500)],
    };
    this.group = new THREE.Group();
    this.group.name = 'props';
    for (const list of Object.values(this.meshes)) for (const m of list) this.group.add(m);
    this.scene.add(this.group);
  }

  setRadii(rockRadius, treeRadius) {
    this.rockRadius = rockRadius;
    this.treeRadius = treeRadius;
    this.lastCenter.x = Infinity;
  }

  _cell(kind, cx, cz) {
    const key = `${kind}:${cx},${cz}`;
    let items = this.cellCache.get(key);
    if (!items) {
      if (kind === 'rock') items = rockCell(cx, cz);
      else if (kind === 'pebble') items = pebbleCell(cx, cz);
      else if (kind === 'tree') items = treeCell(cx, cz);
      else items = shrineCell(cx, cz);
      this.cellCache.set(key, items);
    }
    return items;
  }

  /** Rebuild instance lists when the player has moved far enough. */
  update(px, pz, force = false) {
    if (!force && Math.hypot(px - this.lastCenter.x, pz - this.lastCenter.z) < 16) return false;
    this.lastCenter.x = px;
    this.lastCenter.z = pz;

    const lists = {};
    for (const k of Object.keys(this.meshes)) lists[k] = this.meshes[k].map(() => []);
    const add = (item) => {
      if (item.kind === 'collider-only') return;
      const variants = lists[item.kind];
      variants[item.variant % variants.length].push(item);
    };
    const wantedColliderCells = new Set();

    const gather = (kind, cell, radius) => {
      const r = Math.ceil(radius / cell);
      const pcx = Math.floor(px / cell);
      const pcz = Math.floor(pz / cell);
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          const cx = pcx + i;
          const cz = pcz + j;
          const ccx = (cx + 0.5) * cell;
          const ccz = (cz + 0.5) * cell;
          if (Math.hypot(ccx - px, ccz - pz) > radius + cell) continue;
          const items = this._cell(kind, cx, cz);
          for (const it of items) add(it);
          if (kind !== 'pebble' && items.some((it) => it.collider) && Math.hypot(ccx - px, ccz - pz) < 260) {
            const key = `${kind}:${cx},${cz}`;
            wantedColliderCells.add(key);
            if (!this.colliderCells.has(key)) this.colliders.addGroup(key, items.filter((it) => it.collider).map((it) => it.collider));
          }
        }
      }
    };
    gather('rock', ROCK_CELL, this.rockRadius);
    gather('pebble', ROCK_CELL, PEBBLE_RADIUS);
    gather('tree', TREE_CELL, this.treeRadius);
    gather('shrine', SHRINE_CELL, Math.max(this.treeRadius, 900));
    for (const it of this.fixed) add(it);

    for (const key of this.colliderCells) if (!wantedColliderCells.has(key)) this.colliders.removeGroup(key);
    this.colliderCells = wantedColliderCells;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const [kind, variants] of Object.entries(lists)) {
      variants.forEach((items, vi) => {
        const mesh = this.meshes[kind][vi];
        const n = Math.min(items.length, mesh.instanceMatrix.count);
        for (let i = 0; i < n; i++) {
          const it = items[i];
          e.set(it.tilt, it.rotY, it.tilt * 0.5);
          q.setFromEuler(e);
          pos.set(it.x, it.y, it.z);
          scl.set(it.sx, it.sy, it.sz);
          m4.compose(pos, q, scl);
          mesh.setMatrixAt(i, m4);
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      });
    }

    // Forget far-away cells to bound memory during long walks.
    if (this.cellCache.size > 6000) {
      for (const [key, items] of this.cellCache) {
        const it = items[0];
        if (!it || Math.hypot(it.x - px, it.z - pz) > Math.max(this.treeRadius, 900) * 2) this.cellCache.delete(key);
      }
    }
    return true;
  }

  get counts() {
    const out = {};
    for (const [k, list] of Object.entries(this.meshes)) out[k] = list.reduce((s, m) => s + m.count, 0);
    return out;
  }
}
