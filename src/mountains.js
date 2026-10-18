// Distant mountain silhouettes: three concentric ridgeline rings beyond the
// streamed terrain. They follow the player horizontally so the ranges always sit
// on the horizon, and the shared haze turns them into layered silhouettes.

import * as THREE from 'three';
import { createNoise2D } from './noise.js';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphere.js';

const LAYERS = [
  { radius: 13500, peak: 1150, base: -250, seed: 71, color: 0x34402f, rough: 2.4, haze: 0.62 },
  { radius: 18500, peak: 1900, base: -400, seed: 72, color: 0x3f4a50, rough: 1.9, haze: 0.74 },
  { radius: 25000, peak: 2800, base: -600, seed: 73, color: 0x4b5560, rough: 1.5, haze: 0.84 },
];

function ridgeProfile(noise, angle, rough) {
  // Sample noise on a circle so the profile wraps seamlessly.
  const cx = Math.cos(angle);
  const sz = Math.sin(angle);
  let h = 0;
  let amp = 1;
  let f = rough;
  let norm = 0;
  for (let o = 0; o < 6; o++) {
    const raw = noise(cx * f + o * 7.3, sz * f - o * 3.1);
    // Blend smooth and ridged noise: rounded volcanic shoulders with some crests.
    const ridge = 1 - Math.abs(raw);
    const n = o < 2 ? raw * 0.5 + 0.5 : ridge * ridge;
    h += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.15;
  }
  return h / norm;
}

function buildRing(layer) {
  const noise = createNoise2D(layer.seed);
  const segments = 720;
  const rows = 6;
  const positions = [];
  const colors = [];
  const color = new THREE.Color(layer.color);
  const low = color.clone().multiplyScalar(0.7);
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      let peak = ridgeProfile(noise, a, layer.rough);
      // A broad volcanic cone on the far range, Aso/Fuji-like, as a distant landmark.
      if (layer.seed === 73) {
        const d = Math.atan2(Math.sin(a - 4.25), Math.cos(a - 4.25));
        peak = Math.max(peak, 1.15 - Math.abs(d) * 4.2);
      }
      const top = layer.base + peak * layer.peak;
      const y = layer.base + (top - layer.base) * Math.pow(t, 0.85);
      // Slopes lean back so the silhouette has depth when lit.
      const radius = layer.radius + (1 - t) * -layer.radius * 0.06;
      positions.push(Math.sin(a) * radius, y, -Math.cos(a) * radius);
      const c = low.clone().lerp(color, t);
      colors.push(c.r, c.g, c.b);
    }
  }
  const indices = [];
  const stride = segments + 1;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Each ring gets a fixed amount of haze (rather than distance fog) so the three
// ranges read as distinct, progressively lighter silhouettes.
function createLayerMaterial(haze) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms);
    shader.uniforms.uLayerHaze = { value: haze };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `${ATMOSPHERE_GLSL}\nuniform float uLayerHaze;`)
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
        {
          vec3 wOff = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
          vec3 dir = normalize(wOff);
          // Peaks stand slightly clearer of the haze than the feet of the range.
          float amt = uLayerHaze * mix(1.0, 0.82, smoothstep(0.0, 0.08, dir.y));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoHaze(dir), amt);
        }
        `,
      );
  };
  material.customProgramCacheKey = () => `mountain-layer-${haze}`;
  return material;
}

export class Mountains {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'distant-mountains';
    for (const layer of LAYERS) {
      const mesh = new THREE.Mesh(buildRing(layer), createLayerMaterial(layer.haze));
      mesh.frustumCulled = false;
      mesh.renderOrder = -10;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(cameraPosition) {
    this.group.position.set(cameraPosition.x, 0, cameraPosition.z);
  }
}
