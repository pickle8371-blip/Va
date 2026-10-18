// Golden-hour lighting: a low warm sun with a shadow frustum that follows the
// player, plus soft sky/ground ambient light.

import * as THREE from 'three';
import { SUN_DIRECTION } from './atmosphere.js';

export class Lighting {
  constructor(scene) {
    this.sun = new THREE.DirectionalLight(0xffcf98, 3.6);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 400;
    this.setShadowExtent(55);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool sky fill from above, warm bounce from the golden field below.
    this.hemi = new THREE.HemisphereLight(0xaebbd0, 0x8a6f3c, 1.35);
    scene.add(this.hemi);
    this._snap = new THREE.Vector3();
    // Light-space basis used to snap the shadow frustum to whole texels.
    this._right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIRECTION).normalize();
    this._up = new THREE.Vector3().crossVectors(SUN_DIRECTION, this._right).normalize();
  }

  setShadowExtent(extent) {
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
    this.extent = extent;
  }

  setShadows(enabled, mapSize) {
    this.sun.castShadow = enabled;
    if (mapSize && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  update(focus) {
    // Snap the shadow frustum to texel increments to stop shadow edges shimmering.
    const texel = (this.extent * 2) / this.sun.shadow.mapSize.x;
    const r = Math.round(this._right.dot(focus) / texel) * texel;
    const u = Math.round(this._up.dot(focus) / texel) * texel;
    const f = SUN_DIRECTION.dot(focus);
    this._snap.copy(this._right).multiplyScalar(r).addScaledVector(this._up, u).addScaledVector(SUN_DIRECTION, f);
    this.sun.target.position.copy(this._snap);
    this.sun.position.copy(this._snap).addScaledVector(SUN_DIRECTION, 200);
    this.sun.target.updateMatrixWorld();
  }
}
