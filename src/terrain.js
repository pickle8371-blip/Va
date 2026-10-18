// Streaming quadtree terrain. Nodes near the player are finely tessellated,
// distant nodes are coarse; skirts hide the cracks between levels. The terrain
// is generated from the analytic height function in world.js, so it continues
// indefinitely in every direction.

import * as THREE from 'three';
import { getHeight, getSurface } from './world.js';
import { withAtmosphere } from './atmosphere.js';
import { createGroundDetailTexture } from './textures.js';
import { smoothstep } from './noise.js';

const ROOT_SIZE = 4096;
const ROOT_RANGE = 2; // roots in a (2*range+1)^2 grid around the player
const MIN_SIZE = 64;

const lin = (hex) => new THREE.Color(hex);
const PALETTE = {
  gold: lin(0xa48745),
  olive: lin(0x7f7c3d),
  green: lin(0x5c6b30),
  meadow: lin(0x7c8a44),
  dirt: lin(0x8b7656),
  rock: lin(0x726c62),
  forest: lin(0x2e3b24),
  scrub: lin(0x6a6346),
  peak: lin(0x9a948a),
};

const surface = {};
const tmp = new THREE.Color();
const tmp2 = new THREE.Color();

export function terrainColor(x, z, h, slopeY, out) {
  getSurface(x, z, h, slopeY, surface);
  // Grass colour: green -> olive -> gold.
  const t = surface.tint;
  if (t < 0.5) out.copy(PALETTE.green).lerp(PALETTE.olive, t * 2);
  else out.copy(PALETTE.olive).lerp(PALETTE.gold, (t - 0.5) * 2);
  out.lerp(PALETTE.meadow, surface.clearing * 0.6);

  // Mountains: forested slopes, scrub and bare rock higher up.
  if (surface.mountain > 0) {
    const forest = smoothstep(30, 110, h) * surface.mountain;
    tmp.copy(PALETTE.forest).lerp(PALETTE.scrub, smoothstep(260, 420, h));
    out.lerp(tmp, forest * 0.92);
    out.lerp(PALETTE.peak, smoothstep(420, 560, h) * surface.mountain * 0.6);
  }
  out.lerp(PALETTE.rock, surface.steep * 0.85);
  out.lerp(PALETTE.dirt, surface.path);
  return surface;
}

class TerrainNode {
  constructor(key, x, z, size) {
    this.key = key;
    this.x = x;
    this.z = z;
    this.size = size;
    this.mesh = null;
    this.lastUsed = 0;
  }
}

export class Terrain {
  constructor(scene, { detail = 1, grassRadius = 70 } = {}) {
    this.scene = scene;
    this.detail = detail;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.cache = new Map();
    this.visible = new Set();
    this.pending = null;
    this.lastCenter = { x: Infinity, z: Infinity };
    this.frame = 0;
    this.uniforms = {
      uGrassRadius: { value: grassRadius },
    };
    this.material = this._createMaterial();
  }

  _createMaterial() {
    const map = createGroundDetailTexture();
    // Lambert shading: visually equivalent for this very rough ground, and much cheaper per pixel.
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map,
    });
    const uniforms = this.uniforms;
    withAtmosphere(
      material,
      (shader) => {
        shader.uniforms.uGrassRadius = uniforms.uGrassRadius;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute float aGrass;\nvarying float vGrass;\nvarying float vDist;',
          )
          .replace(
            '#include <fog_vertex>',
            '#include <fog_vertex>\nvGrass = aGrass;\nvDist = length(mvPosition.xyz);',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform float uGrassRadius;\nvarying float vGrass;\nvarying float vDist;',
          )
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
            {
              vec3 d1 = texture2D(map, vMapUv).rgb;
              vec3 d2 = texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.11)).rgb;
              float detailFade = 1.0 - smoothstep(60.0, 400.0, vDist);
              vec3 detail = mix(vec3(0.61), d1 * d2, detailFade) * 1.62;
              diffuseColor.rgb *= detail;
              // Under the grass the soil is darker; far away the terrain shows the colour of the field.
              float under = vGrass * (1.0 - smoothstep(uGrassRadius * 0.55, uGrassRadius * 0.98, vDist));
              diffuseColor.rgb *= mix(1.0, 0.5, under);
            }
            `,
          );
      },
      'terrain',
    );
    return material;
  }

  setGrassRadius(r) {
    this.uniforms.uGrassRadius.value = r;
  }

  setDetail(detail) {
    if (detail === this.detail) return;
    this.detail = detail;
    // Keep the old meshes on screen until the re-tessellated set is complete.
    this.retired = [...(this.retired || []), ...this.cache.values()];
    this.cache = new Map();
    this.visible = new Set();
    this.lastCenter.x = Infinity;
  }

  _segmentsFor(size) {
    const base = size <= MIN_SIZE ? 64 : 36;
    return Math.max(8, Math.round((base * this.detail) / 4) * 4);
  }

  _buildGeometry(node) {
    const seg = this._segmentsFor(node.size);
    const size = node.size;
    const step = size / seg;
    const x0 = node.x - size / 2;
    const z0 = node.z - size / 2;

    // Heights with a one-sample border for normals.
    const n = seg + 3;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = z0 + (j - 1) * step;
      for (let i = 0; i < n; i++) heights[j * n + i] = getHeight(x0 + (i - 1) * step, z);
    }

    const gridVerts = (seg + 1) * (seg + 1);
    const skirtVerts = 4 * (seg + 1);
    const total = gridVerts + skirtVerts;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const grass = new Float32Array(total);
    const color = new THREE.Color();

    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const v = j * (seg + 1) + i;
        const x = x0 + i * step;
        const z = z0 + j * step;
        const hi = (j + 1) * n + (i + 1);
        const h = heights[hi];
        const nx = heights[hi - 1] - heights[hi + 1];
        const nz = heights[hi - n] - heights[hi + n];
        const ny = 2 * step;
        const len = Math.hypot(nx, ny, nz);
        positions[v * 3] = x - node.x;
        positions[v * 3 + 1] = h;
        positions[v * 3 + 2] = z - node.z;
        normals[v * 3] = nx / len;
        normals[v * 3 + 1] = ny / len;
        normals[v * 3 + 2] = nz / len;
        const s = terrainColor(x, z, h, ny / len, color);
        colors[v * 3] = color.r;
        colors[v * 3 + 1] = color.g;
        colors[v * 3 + 2] = color.b;
        uvs[v * 2] = x / 6;
        uvs[v * 2 + 1] = z / 6;
        grass[v] = s.grassDensity;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }

    // Skirts: copies of the edge vertices pushed downwards.
    const skirtDepth = Math.max(2, step * 1.5);
    const edges = [];
    for (let i = 0; i <= seg; i++) edges.push(i); // north edge (j = 0)
    for (let i = 0; i <= seg; i++) edges.push(seg * (seg + 1) + i); // south edge
    for (let j = 0; j <= seg; j++) edges.push(j * (seg + 1)); // west edge
    for (let j = 0; j <= seg; j++) edges.push(j * (seg + 1) + seg); // east edge
    for (let k = 0; k < edges.length; k++) {
      const src = edges[k];
      const dst = gridVerts + k;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - skirtDepth;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      for (let c = 0; c < 3; c++) {
        normals[dst * 3 + c] = normals[src * 3 + c];
        colors[dst * 3 + c] = colors[src * 3 + c];
      }
      uvs[dst * 2] = uvs[src * 2];
      uvs[dst * 2 + 1] = uvs[src * 2 + 1];
      grass[dst] = grass[src];
    }

    const indices = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + (seg + 1);
        const d = c + 1;
        // Alternate the diagonal to avoid visible directional artefacts.
        if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, c, d, a, d, b);
      }
    }
    const strip = (offset, flip) => {
      for (let i = 0; i < seg; i++) {
        const top0 = edges[offset + i];
        const top1 = edges[offset + i + 1];
        const bot0 = gridVerts + offset + i;
        const bot1 = gridVerts + offset + i + 1;
        if (flip) indices.push(top0, top1, bot0, top1, bot1, bot0);
        else indices.push(top0, bot0, top1, top1, bot0, bot1);
      }
    };
    strip(0, true); // north (-z) faces outwards when flipped
    strip(seg + 1, false); // south (+z)
    strip(2 * (seg + 1), false); // west (-x)
    strip(3 * (seg + 1), true); // east (+x)

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
    geometry.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-size / 2, minY - skirtDepth, -size / 2),
      new THREE.Vector3(size / 2, maxY, size / 2),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    return geometry;
  }

  _buildNode(node) {
    const mesh = new THREE.Mesh(this._buildGeometry(node), this.material);
    mesh.position.set(node.x, 0, node.z);
    mesh.receiveShadow = true;
    mesh.castShadow = node.size <= 512;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    mesh.name = `terrain-${node.key}`;
    this.group.add(mesh);
    node.mesh = mesh;
  }

  _disposeNode(node) {
    if (!node.mesh) return;
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    node.mesh = null;
  }

  _desiredNodes(px, pz) {
    const result = [];
    const rcx = Math.round(px / ROOT_SIZE);
    const rcz = Math.round(pz / ROOT_SIZE);
    const visit = (x, z, size) => {
      const half = size / 2;
      const dx = Math.max(Math.abs(px - x) - half, 0);
      const dz = Math.max(Math.abs(pz - z) - half, 0);
      const dist = Math.hypot(dx, dz);
      if (size > MIN_SIZE && dist < size * 0.85) {
        const q = size / 4;
        visit(x - q, z - q, half);
        visit(x + q, z - q, half);
        visit(x - q, z + q, half);
        visit(x + q, z + q, half);
      } else {
        result.push({ key: `${x},${z},${size}`, x, z, size });
      }
    };
    for (let i = -ROOT_RANGE; i <= ROOT_RANGE; i++) {
      for (let j = -ROOT_RANGE; j <= ROOT_RANGE; j++) {
        visit((rcx + i) * ROOT_SIZE, (rcz + j) * ROOT_SIZE, ROOT_SIZE);
      }
    }
    return result;
  }

  /**
   * Stream terrain around (px, pz). Builds missing nodes within budgetMs and only
   * swaps the visible set once every node it needs exists, so holes never appear.
   * Returns the fraction of the target set that is ready (1 when complete).
   */
  update(px, pz, budgetMs = 4) {
    this.frame++;
    const moved = Math.hypot(px - this.lastCenter.x, pz - this.lastCenter.z);
    if (moved > 6) {
      this.lastCenter.x = px;
      this.lastCenter.z = pz;
      this.pending = this._desiredNodes(px, pz);
    }
    if (!this.pending) return 1;

    const start = performance.now();
    let ready = 0;
    for (const want of this.pending) {
      let node = this.cache.get(want.key);
      if (!node) {
        node = new TerrainNode(want.key, want.x, want.z, want.size);
        this.cache.set(want.key, node);
      }
      if (!node.mesh) {
        if (performance.now() - start > budgetMs) continue;
        this._buildNode(node);
      }
      ready++;
    }
    const progress = ready / this.pending.length;
    if (ready === this.pending.length) {
      const keys = new Set(this.pending.map((p) => p.key));
      for (const key of this.visible) {
        if (!keys.has(key)) {
          const node = this.cache.get(key);
          if (node && node.mesh) node.mesh.visible = false;
          if (node) node.lastUsed = this.frame;
        }
      }
      for (const key of keys) {
        const node = this.cache.get(key);
        node.mesh.visible = true;
        node.lastUsed = this.frame;
      }
      this.visible = keys;
      this.pending = null;
      if (this.retired) {
        for (const node of this.retired) this._disposeNode(node);
        this.retired = null;
      }
      this._evict();
    }
    return progress;
  }

  _evict() {
    const maxCached = this.visible.size + 80;
    if (this.cache.size <= maxCached) return;
    const hidden = [...this.cache.values()].filter((n) => !this.visible.has(n.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.cache.size > maxCached && hidden.length) {
      const node = hidden.shift();
      this._disposeNode(node);
      this.cache.delete(node.key);
    }
  }

  get visibleCount() {
    return this.visible.size;
  }
}
