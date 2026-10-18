// Optional post-processing for higher quality presets: restrained bloom and a
// gentle filmic grade with vignette. Lower presets render directly.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.04 },
    uLift: { value: new THREE.Vector3(0.006, 0.004, 0.0) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.96) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform vec3 uLift;
    uniform vec3 uGain;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uGain + uLift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      gl_FragColor = vec4(col * v, c.a);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
