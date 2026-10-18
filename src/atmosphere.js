// Shared atmosphere: golden-hour palette, sun-aware height fog and the sky dome.
// Every scene material is patched with the same fog code so that distant hills,
// mountains and the sky's horizon blend into one continuous haze.

import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3();
{
  // Low golden-hour sun, ahead and to the right of the initial view (which looks towards -Z).
  const elevation = THREE.MathUtils.degToRad(11);
  const azimuth = THREE.MathUtils.degToRad(38);
  SUN_DIRECTION.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).normalize();
}

export const atmosphereUniforms = {
  uSunDir: { value: SUN_DIRECTION },
  uHazeColor: { value: new THREE.Color(0xaab2b6) },
  uSunHazeColor: { value: new THREE.Color(0xf3c286) },
  uFogDensity: { value: 0.00015 },
  uFogHeightFalloff: { value: 0.0009 },
  uFogBaseHeight: { value: -30 },
  uTime: { value: 0 },
};

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHazeColor;
uniform vec3 uSunHazeColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseHeight;

vec3 atmoHaze(vec3 dir) {
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  // Cool blue-grey haze away from the sun, warm gold towards it.
  float glow = pow(sunAmt, 2.5) * 0.7 + pow(sunAmt, 16.0) * 0.4;
  return mix(uHazeColor, uSunHazeColor, clamp(glow, 0.0, 1.0));
}

// Exponential height fog integrated along the view ray.
float atmoFogAmount(float dist, float camY, float pointY) {
  float k = uFogHeightFalloff;
  float h0 = camY - uFogBaseHeight;
  float h1 = pointY - uFogBaseHeight;
  float dh = h1 - h0;
  float avg;
  if (abs(dh) < 1.0) {
    avg = exp(-k * max(h0, 0.0));
  } else {
    avg = (exp(-k * max(h0, 0.0)) - exp(-k * max(h1, 0.0))) / (k * dh);
  }
  avg = max(avg, 0.0);
  float depth = uFogDensity * dist * avg;
  return 1.0 - exp(-depth);
}
`;

// Replaces three.js' fog with the shared aerial-perspective fog. Works with any
// built-in material that defines vViewPosition (standard, lambert, phong).
export function patchAtmosphere(shader) {
  Object.assign(shader.uniforms, atmosphereUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', ATMOSPHERE_GLSL)
    .replace(
      '#include <fog_fragment>',
      /* glsl */ `
      {
        vec3 atmoViewPos = -vViewPosition;
        vec3 atmoWorldOffset = (vec4(atmoViewPos, 0.0) * viewMatrix).xyz;
        float atmoDist = length(atmoWorldOffset);
        vec3 atmoDir = atmoWorldOffset / max(atmoDist, 1e-4);
        float atmoAmt = atmoFogAmount(atmoDist, cameraPosition.y, cameraPosition.y + atmoWorldOffset.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoHaze(atmoDir), atmoAmt);
      }
      `,
    );
}

/**
 * Attach the atmosphere patch (plus an optional extra patch) to a material.
 * `key` must be unique per distinct extraPatch so three.js does not reuse the
 * wrong cached shader program.
 */
export function withAtmosphere(material, extraPatch, key = 'base') {
  material.fog = true;
  material.customProgramCacheKey = () => `atmo-${key}`;
  material.onBeforeCompile = (shader, renderer) => {
    patchAtmosphere(shader);
    if (extraPatch) extraPatch(shader, renderer);
  };
  return material;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uUpper;
uniform vec3 uSunColor;
uniform float uCloudCover;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  float sunAmt = max(dot(dir, uSunDir), 0.0);

  vec3 haze = atmoHaze(dir);
  float up = smoothstep(0.0, 0.42, y);
  vec3 sky = mix(haze, uUpper, smoothstep(0.02, 0.22, y));
  sky = mix(sky, uZenith, smoothstep(0.25, 0.95, y));
  // Broad warm glow around the low sun.
  sky += uSunColor * (pow(sunAmt, 4.0) * 0.32 + pow(sunAmt, 48.0) * 0.9) * (1.0 - up * 0.5);

  // Clouds on a virtual plane, drifting slowly with the wind.
  if (y > 0.01) {
    vec2 uv = dir.xz / (y + 0.08) * 0.9;
    uv += vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(uv * 1.3);
    float wisps = fbm(uv * 3.1 + vec2(n * 1.4, 0.0));
    float cover = smoothstep(uCloudCover, uCloudCover + 0.32, n * 0.75 + wisps * 0.35);
    float fade = smoothstep(0.015, 0.2, y);
    vec3 shade = mix(vec3(0.82, 0.72, 0.68), vec3(1.0, 0.86, 0.7), wisps);
    vec3 lit = shade * mix(vec3(1.0), uSunColor * 1.15, pow(sunAmt, 3.0));
    float silver = pow(sunAmt, 12.0) * (1.0 - cover) * 2.0;
    sky = mix(sky, lit * (0.95 + silver), cover * fade * 0.78);
  }

  // Sun disc (kept soft and only mildly above white to avoid blowing out).
  float disc = smoothstep(0.99955, 0.99985, sunAmt);
  sky += uSunColor * disc * 4.0;

  // Below the horizon the "sky" is pure haze so distant terrain blends in.
  sky = mix(haze, sky, smoothstep(-0.04, 0.02, y));
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky() {
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      uZenith: { value: new THREE.Color(0x4d6f9a) },
      uUpper: { value: new THREE.Color(0x9fb0b8) },
      uSunColor: { value: new THREE.Color(0xffc98a) },
      uCloudCover: { value: 0.5 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.scale.setScalar(10);
  return sky;
}
