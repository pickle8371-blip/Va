// Instanced, wind-animated grass streamed in chunks around the player.
//
// Each chunk is one draw call holding thousands of blades. Blades are generated
// in a fixed random order, so a chunk can be rebuilt with more blades as the
// player approaches without existing blades moving. The vertex shader thins and
// widens blades with distance and shrinks them to nothing at the edge of the
// grass radius, so there is no visible popping or hard border.

import * as THREE from 'three';
import { getHeight, getSurface } from './world.js';
import { createRandom, hash2 } from './noise.js';
import { withAtmosphere, atmosphereUniforms } from './atmosphere.js';

const CHUNK = 16;
const GRID = CHUNK + 1; // 1 m sample grid

export const windUniforms = {
  uTime: atmosphereUniforms.uTime,
  uWindDir: { value: new THREE.Vector2(0.82, -0.57).normalize() },
  uWindStrength: { value: 1 },
  uWindTex: { value: null },
  uPlayerPos: { value: new THREE.Vector3(0, -1000, 0) },
  uGrassRadius: { value: 90 },
  uDensityNear: { value: 14 },
  uSunColor: { value: new THREE.Color(0xffc98a) },
};

/** Fraction of blades kept at a given distance (matches the vertex shader). */
export function densityAtDistance(d, near = windUniforms.uDensityNear.value) {
  if (d <= near) return 1;
  return Math.max(0.035, Math.pow(near / d, 1.55));
}

function createBladeGeometry(segments = 4) {
  // A tapered, slightly curved blade, height 1, width 1 at the base.
  const positions = [];
  const uvs = [];
  for (let i = 0; i <= segments; i++) {
    const y = i / segments;
    const w = (1 - Math.pow(y, 1.4)) * 0.5;
    const z = y * y * 0.22;
    if (i === segments) {
      positions.push(0, y, z);
      uvs.push(0.5, y);
    } else {
      positions.push(-w, y, z, w, y, z);
      uvs.push(0, y, 1, y);
    }
  }
  const indices = [];
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, last + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(indices);
  return g;
}

function createPlumeGeometry() {
  // Susuki (Japanese pampas grass): a thin stem with a feathery drooping plume.
  const positions = [];
  const uvs = [];
  const parts = [];
  const indices = [];
  const quad = (x0, y0, z0, x1, y1, z1, w, part) => {
    const base = positions.length / 3;
    positions.push(x0 - w, y0, z0, x0 + w, y0, z0, x1 - w * 0.4, y1, z1, x1 + w * 0.4, y1, z1);
    uvs.push(0, y0, 1, y0, 0, y1, 1, y1);
    parts.push(part, part, part, part);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  // Stem in three segments.
  quad(0, 0, 0, 0, 0.35, 0.01, 0.012, 0);
  quad(0, 0.35, 0.01, 0, 0.7, 0.04, 0.009, 0);
  quad(0, 0.7, 0.04, 0, 0.82, 0.08, 0.007, 0);
  // Plume: several feathery strands fanning out and drooping.
  const strands = 7;
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2;
    const sx = Math.cos(a) * 0.035;
    const sz = Math.sin(a) * 0.035 + 0.08;
    quad(0, 0.8, 0.08, sx, 1.0, sz + 0.06, 0.012, 1);
    quad(sx, 1.0, sz + 0.06, sx * 1.6, 1.08, sz + 0.16, 0.01, 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(indices);
  return g;
}

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec4 aOffset;  // xyz base position, w yaw
attribute vec4 aShape;   // height, width, tint, rank (0..1, generation order)
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform sampler2D uWindTex;
uniform vec3 uPlayerPos;
uniform float uGrassRadius;
uniform float uDensityNear;
varying vec3 vGrassColor;
varying float vBladeY;
varying float vGust;

vec3 grassPalette(float tint, float rnd) {
  vec3 green = vec3(0.19, 0.25, 0.065);
  vec3 olive = vec3(0.36, 0.33, 0.10);
  vec3 gold  = vec3(0.66, 0.46, 0.15);
  vec3 straw = vec3(0.70, 0.57, 0.32);
  vec3 c = tint < 0.5 ? mix(green, olive, tint * 2.0) : mix(olive, gold, (tint - 0.5) * 2.0);
  c = mix(c, straw, step(0.9, rnd) * 0.5);
  return c * (0.8 + rnd * 0.4);
}
`;

const GRASS_VERTEX_MAIN = /* glsl */ `
  vec3 base = aOffset.xyz;
  float yaw = aOffset.w;
  float bladeH = aShape.x;
  float bladeW = aShape.y;
  float rank = aShape.w;
  float rnd = fract(rank * 91.7 + yaw * 3.1);

  float camDist = distance(base.xz, cameraPosition.xz);
  float keep = camDist <= uDensityNear ? 1.0 : max(0.035, pow(uDensityNear / camDist, 1.55));
  float visible = step(rank, keep);
  float edge = 1.0 - smoothstep(uGrassRadius * 0.72, uGrassRadius, camDist);
  // Sparse distant blades are widened so the field keeps its coverage.
  float widen = clamp(inversesqrt(max(keep, 0.04)), 1.0, 3.6);
  #ifdef PLUME
    widen = 1.0;
  #endif
  // Blades right in front of the lens shrink away so they never wall off the view.
  float lens = smoothstep(0.9, 2.6, distance(base, cameraPosition));
  float scaleH = bladeH * visible * edge * lens;

  float yN = position.y;
  vec3 p = vec3(position.x * bladeW * widen, yN * scaleH, position.z * scaleH);
  float cy = cos(yaw), sy = sin(yaw);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);

  // Wind: large gust patches travelling with the wind plus rolling waves and flutter.
  float t = uTime;
  vec2 wuv = base.xz * 0.0055 - uWindDir * t * 0.038;
  float gust = smoothstep(0.32, 0.82, texture2D(uWindTex, wuv).r);
  float gust2 = texture2D(uWindTex, base.xz * 0.019 - uWindDir * t * 0.1).g;
  float wave = sin(dot(base.xz, uWindDir) * 0.3 - t * 1.9 + rnd * 0.6) * 0.5 + 0.5;
  float g = clamp(gust * 0.85 + gust2 * 0.3 + wave * 0.2, 0.0, 1.4);
  vGust = g;
  float bend = uWindStrength * (0.18 + g * 0.75);
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float flutter = sin(t * (2.6 + rnd * 2.2) + rnd * 37.0 + base.x * 0.7) * (0.05 + g * 0.08);
  vec2 disp = uWindDir * bend + perp * flutter;

  // Blades part around the samurai.
  vec2 toBlade = base.xz - uPlayerPos.xz;
  float pd = length(toBlade);
  float nearGround = 1.0 - smoothstep(0.4, 1.4, abs(base.y - uPlayerPos.y));
  float push = (1.0 - smoothstep(0.25, 1.25, pd)) * nearGround;
  disp += (toBlade / max(pd, 0.001)) * push * 1.3;

  float curve = yN * yN;
  float dispLen = length(disp);
  float lean = min(dispLen, 1.35);
  p.xz += disp / max(dispLen, 0.0001) * lean * curve * scaleH;
  p.y -= (1.0 - cos(lean)) * curve * scaleH * 0.9;

  vec3 transformed = base + p;
  vBladeY = yN;

  vec3 col = grassPalette(aShape.z, rnd);
  vGrassColor = col;
`;

const GRASS_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSunColor;
varying vec3 vGrassColor;
varying float vBladeY;
varying float vGust;
`;

function grassPatch(extraVertex = '', extraColor = '') {
  return (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}\n${extraVertex}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        // Normals lean towards the sky so the field is softly lit from all sides.
        float nYaw = aOffset.w;
        vec3 objectNormal = normalize(vec3(sin(nYaw) * 0.35, 1.0, cos(nYaw) * 0.35));
        `,
      )
      .replace('#include <begin_vertex>', GRASS_VERTEX_MAIN + extraColor);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GRASS_FRAGMENT_PARS}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        {
          float ao = mix(0.32, 1.0, smoothstep(0.0, 0.75, vBladeY));
          // Silvery sheen where gusts lay the blades over.
          vec3 c = vGrassColor * (1.0 + vGust * 0.18 * vBladeY);
          diffuseColor.rgb = c * ao;
        }
        `,
      )
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          // Back-lit translucency when looking towards the low sun.
          vec3 wView = normalize((vec4(-vViewPosition, 0.0) * viewMatrix).xyz);
          float back = pow(max(dot(wView, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += vGrassColor * uSunColor * back * vBladeY * vBladeY * 1.4;
        }
        `,
      );
  };
}

function makeGrassMaterial(key, extraVertex, extraColor, defines) {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  if (defines) material.defines = defines;
  withAtmosphere(material, grassPatch(extraVertex, extraColor), key);
  return material;
}

class GrassChunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.mesh = null;
    this.plumes = null;
    this.allocated = 0;
    this.fullCount = 0;
    this.lastSeen = 0;
  }
}

const surf = {};

export class Grass {
  constructor(scene, { radius = 90, density = 0.8, windTexture }) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    scene.add(this.group);
    windUniforms.uWindTex.value = windTexture;
    this.bladeGeometry = createBladeGeometry();
    this.plumeGeometry = createPlumeGeometry();
    this.material = makeGrassMaterial('grass');
    this.plumeMaterial = makeGrassMaterial(
      'plume',
      'attribute float aPart;',
      /* glsl */ `
      // Pale silver-gold plumes on darker stems.
      vGrassColor = mix(col * 0.75, vec3(0.62, 0.5, 0.33) * (0.85 + rnd * 0.3), aPart);
      `,
      { PLUME: '' },
    );
    this.chunks = new Map();
    this.frame = 0;
    this.setQuality(radius, density);
  }

  setQuality(radius, density) {
    this.radius = radius;
    this.density = density;
    windUniforms.uGrassRadius.value = radius;
    // Blades per square metre at full density.
    this.bladesPerM2 = 34 * density;
    for (const chunk of this.chunks.values()) this._disposeChunk(chunk);
    this.chunks.clear();
  }

  _sampleChunk(cx, cz) {
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const heights = new Float32Array(GRID * GRID);
    const density = new Float32Array(GRID * GRID);
    const tint = new Float32Array(GRID * GRID);
    const height = new Float32Array(GRID * GRID);
    let any = 0;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) heights[j * GRID + i] = getHeight(x0 + i, z0 + j);
    }
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const k = j * GRID + i;
        const hx = heights[j * GRID + Math.min(i + 1, GRID - 1)] - heights[j * GRID + Math.max(i - 1, 0)];
        const hz = heights[Math.min(j + 1, GRID - 1) * GRID + i] - heights[Math.max(j - 1, 0) * GRID + i];
        const slopeY = 2 / Math.hypot(hx, 2, hz);
        getSurface(x0 + i, z0 + j, heights[k], slopeY, surf);
        density[k] = surf.grassDensity;
        tint[k] = surf.tint;
        height[k] = surf.grassHeight;
        any += surf.grassDensity;
      }
    }
    return { heights, density, tint, height, any };
  }

  _buildChunk(chunk, count) {
    const samples = this._sampleChunk(chunk.cx, chunk.cz);
    this._disposeMeshes(chunk);
    chunk.allocated = count;
    if (samples.any < 0.5) {
      chunk.empty = true;
      return;
    }
    const x0 = chunk.cx * CHUNK;
    const z0 = chunk.cz * CHUNK;
    const rand = createRandom(Math.floor(hash2(chunk.cx, chunk.cz, 17) * 4294967295));
    const offsets = new Float32Array(count * 4);
    const shapes = new Float32Array(count * 4);
    let n = 0;
    const bilerp = (arr, fx, fz) => {
      const i = Math.min(Math.floor(fx), CHUNK - 1);
      const j = Math.min(Math.floor(fz), CHUNK - 1);
      const tx = fx - i;
      const tz = fz - j;
      const a = arr[j * GRID + i];
      const b = arr[j * GRID + i + 1];
      const c = arr[(j + 1) * GRID + i];
      const d = arr[(j + 1) * GRID + i + 1];
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    };
    for (let k = 0; k < count; k++) {
      const fx = rand() * CHUNK;
      const fz = rand() * CHUNK;
      const yaw = rand() * Math.PI * 2;
      const r1 = rand();
      const r2 = rand();
      const dens = bilerp(samples.density, fx, fz);
      if (r1 > dens) continue; // keep rank order stable even when skipping
      const h = bilerp(samples.heights, fx, fz);
      const baseH = bilerp(samples.height, fx, fz);
      const t = bilerp(samples.tint, fx, fz);
      offsets[n * 4] = x0 + fx;
      offsets[n * 4 + 1] = h - 0.05;
      offsets[n * 4 + 2] = z0 + fz;
      offsets[n * 4 + 3] = yaw;
      shapes[n * 4] = baseH * (0.6 + r2 * 0.6);
      shapes[n * 4 + 1] = 0.035 + rand() * 0.035;
      shapes[n * 4 + 2] = Math.min(1, Math.max(0, t + (r2 - 0.5) * 0.25));
      shapes[n * 4 + 3] = k / chunk.fullCount;
      n++;
    }
    if (n === 0) {
      chunk.empty = true;
      return;
    }
    chunk.empty = false;
    const geometry = this.bladeGeometry.clone();
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets.subarray(0, n * 4), 4));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes.subarray(0, n * 4), 4));
    geometry.instanceCount = n;
    this._setBounds(geometry, chunk, samples);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    chunk.mesh = mesh;

    // Susuki plumes grow in patches, mostly where the grass is golden.
    const patch = hash2(Math.floor(chunk.cx / 3), Math.floor(chunk.cz / 3), 91);
    const plumeCount = Math.floor((count / chunk.fullCount) * CHUNK * CHUNK * 0.9 * (patch > 0.35 ? 1 : 0.15));
    if (plumeCount > 0) {
      const po = new Float32Array(plumeCount * 4);
      const ps = new Float32Array(plumeCount * 4);
      let m = 0;
      for (let k = 0; k < plumeCount; k++) {
        const fx = rand() * CHUNK;
        const fz = rand() * CHUNK;
        const t = bilerp(samples.tint, fx, fz);
        const dens = bilerp(samples.density, fx, fz);
        const r = rand();
        if (r > dens * (0.3 + t)) continue;
        po[m * 4] = x0 + fx;
        po[m * 4 + 1] = bilerp(samples.heights, fx, fz) - 0.05;
        po[m * 4 + 2] = z0 + fz;
        po[m * 4 + 3] = rand() * Math.PI * 2;
        ps[m * 4] = 1.25 + rand() * 0.6;
        ps[m * 4 + 1] = 1;
        ps[m * 4 + 2] = t;
        ps[m * 4 + 3] = (k / plumeCount) * (count / chunk.fullCount);
        m++;
      }
      if (m > 0) {
        const pg = this.plumeGeometry.clone();
        pg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(po.subarray(0, m * 4), 4));
        pg.setAttribute('aShape', new THREE.InstancedBufferAttribute(ps.subarray(0, m * 4), 4));
        pg.instanceCount = m;
        this._setBounds(pg, chunk, samples);
        const pm = new THREE.Mesh(pg, this.plumeMaterial);
        pm.receiveShadow = true;
        pm.matrixAutoUpdate = false;
        this.group.add(pm);
        chunk.plumes = pm;
      }
    }
  }

  _setBounds(geometry, chunk, samples) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const h of samples.heights) {
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
    const x0 = chunk.cx * CHUNK;
    const z0 = chunk.cz * CHUNK;
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - 2, minY - 1, z0 - 2), new THREE.Vector3(x0 + CHUNK + 2, maxY + 2.5, z0 + CHUNK + 2));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }

  _disposeMeshes(chunk) {
    for (const key of ['mesh', 'plumes']) {
      const m = chunk[key];
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
        chunk[key] = null;
      }
    }
  }

  _disposeChunk(chunk) {
    this._disposeMeshes(chunk);
  }

  /** Stream chunks around (px, pz) within a time budget. */
  update(px, pz, playerPos, budgetMs = 3) {
    this.frame++;
    windUniforms.uPlayerPos.value.copy(playerPos);
    const start = performance.now();
    const r = this.radius;
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    const span = Math.ceil(r / CHUNK) + 1;
    const fullCount = Math.round(CHUNK * CHUNK * this.bladesPerM2);
    const wanted = [];
    for (let j = -span; j <= span; j++) {
      for (let i = -span; i <= span; i++) {
        const cx = pcx + i;
        const cz = pcz + j;
        const nx = Math.max(cx * CHUNK, Math.min(px, (cx + 1) * CHUNK));
        const nz = Math.max(cz * CHUNK, Math.min(pz, (cz + 1) * CHUNK));
        const d = Math.hypot(nx - px, nz - pz);
        if (d > r) continue;
        wanted.push({ cx, cz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);

    let built = 0;
    for (const w of wanted) {
      const key = `${w.cx},${w.cz}`;
      let chunk = this.chunks.get(key);
      if (!chunk) {
        chunk = new GrassChunk(w.cx, w.cz);
        chunk.fullCount = fullCount;
        this.chunks.set(key, chunk);
      }
      chunk.lastSeen = this.frame;
      // Allocate enough blades for the densest point of the chunk (with margin for camera offset).
      const need = Math.ceil(fullCount * Math.min(1, densityAtDistance(Math.max(0, w.d - 6)) * 1.05));
      const stale = chunk.allocated === 0 || need > chunk.allocated * 1.25;
      if (stale && (built === 0 || performance.now() - start < budgetMs)) {
        this._buildChunk(chunk, Math.min(fullCount, need));
        built++;
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (chunk.lastSeen !== this.frame) {
        this._disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }
    return built;
  }

  get instanceCount() {
    let n = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) n += c.mesh.geometry.instanceCount;
      if (c.plumes) n += c.plumes.geometry.instanceCount;
    }
    return n;
  }
}

/** CPU mirror of the shader's gust function, used for audio and the cloak. */
export function sampleWindGust(x, z, t) {
  const tex = windUniforms.uWindTex.value;
  if (!tex) return 0.5;
  const { data, width } = tex.image;
  const dir = windUniforms.uWindDir.value;
  const sample = (u, v, channel) => {
    const fx = (u - Math.floor(u)) * width - 0.5;
    const fy = (v - Math.floor(v)) * width - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (xx, yy) => data[((((yy % width) + width) % width) * width + (((xx % width) + width) % width)) * 4 + channel] / 255;
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const r = sample(x * 0.0055 - dir.x * t * 0.038, z * 0.0055 - dir.y * t * 0.038, 0);
  const e = Math.min(1, Math.max(0, (r - 0.32) / 0.5));
  const gust = e * e * (3 - 2 * e);
  const gust2 = sample(x * 0.019 - dir.x * t * 0.1, z * 0.019 - dir.y * t * 0.1, 1);
  const wave = Math.sin((x * dir.x + z * dir.y) * 0.3 - t * 1.9) * 0.5 + 0.5;
  return Math.min(1.4, Math.max(0, gust * 0.85 + gust2 * 0.3 + wave * 0.2));
}
