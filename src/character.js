// Procedurally modelled wandering samurai. The model is a hierarchy of joints
// (hips, spine, chest, neck, head, arms, legs) with meshes attached, so it can
// be animated procedurally in animation.js. Proportions follow a ~1.76 m adult.
//
// Facing direction: +Z. The character's left side is +X.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { createFabricTexture, createStrawTexture } from './textures.js';

const RIM_PATCH = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    /* glsl */ `
    #include <emissivemap_fragment>
    {
      // Soft warm rim so the silhouette reads against the grass, even when backlit.
      vec3 rimView = normalize(vViewPosition);
      float rim = pow(1.0 - clamp(dot(normal, rimView), 0.0, 1.0), 3.0);
      vec3 wView = normalize((vec4(-vViewPosition, 0.0) * viewMatrix).xyz);
      float towardSun = 0.35 + 0.65 * pow(max(dot(wView, uSunDir), 0.0), 2.0);
      totalEmissiveRadiance += vec3(1.0, 0.78, 0.52) * rim * towardSun * 0.5;
      // Gentle fill so dark fabrics keep their form against the low sun.
      totalEmissiveRadiance += diffuseColor.rgb * vec3(0.16, 0.15, 0.14);
    }
    `,
  );
};

function charMaterial(params, key) {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, ...params });
  return withAtmosphere(m, RIM_PATCH, `char-${key}`);
}

function lathe(profile, segments = 16) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

function mesh(geometry, material, parent, { pos, rot, scale, shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(name, parent, x, y, z) {
  const j = new THREE.Group();
  j.name = name;
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/** Horizontal lacing stripes for lamellar armour, as vertex colours. */
function stripe(geometry, base, lace, bands, axis = 'y') {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(base);
  const b = new THREE.Color(lace);
  const c = new THREE.Color();
  geometry.computeBoundingBox();
  const min = geometry.boundingBox.min[axis];
  const max = geometry.boundingBox.max[axis];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis === 'y' ? 1 : axis === 'x' ? 0 : 2) - min) / (max - min || 1);
    const band = Math.abs(Math.sin(t * Math.PI * bands));
    c.copy(a).lerp(b, band < 0.13 ? 1 - band / 0.13 : 0);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A curved armour plate made of stacked lames (for shoulders and tassets). */
function lamellarPlate(width, height, lames, curve, base, lace) {
  const geos = [];
  const lameH = height / lames;
  const radius = width / curve;
  for (let i = 0; i < lames; i++) {
    const g = new THREE.CylinderGeometry(radius + i * 0.004, radius + (i + 1) * 0.006, lameH * 1.15, 10, 1, true, -curve / 2, curve);
    g.translate(0, -i * lameH - lameH / 2, -radius);
    geos.push(g);
  }
  const merged = new THREE.BufferGeometry();
  // Merge manually (all same attributes).
  const parts = geos.map((g) => g.toNonIndexed());
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  stripe(merged, base, lace, lames);
  return merged;
}

export function createSamurai() {
  const fabricTex = createFabricTexture();
  fabricTex.repeat.set(3, 3);
  const strawTex = createStrawTexture();

  const mat = {
    kimono: charMaterial({ color: 0x2b2c33, map: fabricTex, roughness: 0.95 }, 'kimono'),
    hakama: charMaterial({ color: 0x3b362f, map: fabricTex, roughness: 0.97 }, 'hakama'),
    cloak: charMaterial({ color: 0x65574a, map: fabricTex, roughness: 0.98, side: THREE.DoubleSide }, 'cloak'),
    armor: charMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }, 'armor'),
    armorPlain: charMaterial({ color: 0x2a201d, roughness: 0.6, metalness: 0.05 }, 'armor-plain'),
    obi: charMaterial({ color: 0x7a6640, map: fabricTex, roughness: 0.9 }, 'obi'),
    skin: charMaterial({ color: 0xb58566, roughness: 0.72 }, 'skin'),
    hair: charMaterial({ color: 0x15120f, roughness: 0.8 }, 'hair'),
    straw: charMaterial({ map: strawTex, roughness: 0.9, side: THREE.DoubleSide }, 'straw'),
    cord: charMaterial({ color: 0x5c2f22, roughness: 0.8 }, 'cord'),
    saya: charMaterial({ color: 0x1b1414, roughness: 0.32, metalness: 0.05 }, 'saya'),
    tsuka: charMaterial({ color: 0x2e2620, roughness: 0.85 }, 'tsuka'),
    metal: charMaterial({ color: 0x4a4540, roughness: 0.4, metalness: 0.75 }, 'metal'),
    tabi: charMaterial({ color: 0xb8ad96, roughness: 0.95 }, 'tabi'),
    sandal: charMaterial({ color: 0x8a744f, roughness: 0.95 }, 'sandal'),
    glove: charMaterial({ color: 0x231f1d, roughness: 0.75 }, 'glove'),
  };

  const root = new THREE.Group();
  root.name = 'samurai';
  const j = {};

  // --- Hips and lower body -------------------------------------------------
  j.hips = joint('hips', root, 0, 0.95, 0);
  // Pelvis / waist under the clothing.
  mesh(lathe([[0.0, -0.1], [0.15, -0.09], [0.17, 0.0], [0.15, 0.1], [0.0, 0.11]]), mat.hakama, j.hips, { scale: [1.15, 1, 0.85] });
  // Obi sash.
  mesh(new THREE.CylinderGeometry(0.168, 0.172, 0.11, 18), mat.obi, j.hips, { pos: [0, 0.07, 0], scale: [1.12, 1, 0.86] });
  // Knot of the sash at the back.
  mesh(new THREE.BoxGeometry(0.12, 0.07, 0.05), mat.obi, j.hips, { pos: [0, 0.07, -0.16] });

  // Kusazuri: tassets hanging from the waist (front, sides, back).
  j.tassets = [];
  for (const [angle, w] of [[0, 0.2], [Math.PI * 0.5, 0.18], [-Math.PI * 0.5, 0.18], [Math.PI, 0.2], [Math.PI * 0.25, 0.14], [-Math.PI * 0.25, 0.14]]) {
    const t = joint('tasset', j.hips, Math.sin(angle) * 0.19, 0.03, Math.cos(angle) * 0.16);
    t.rotation.y = angle;
    // The pivot swings outwards (about local X) when a leg pushes against the plate.
    const pivot = joint('tassetPivot', t, 0, 0, 0);
    const plate = lamellarPlate(w, 0.26, 4, 0.9, 0x2a201d, 0x5e2e22);
    mesh(plate, mat.armor, pivot, { rot: [-0.12, 0, 0] });
    pivot.userData.angle = angle;
    j.tassets.push(pivot);
  }

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const thigh = joint(`thigh${side}`, j.hips, 0.095 * s, -0.03, 0);
    // Wide hakama trouser leg.
    mesh(lathe([[0.1, 0.03], [0.14, -0.08], [0.15, -0.3], [0.15, -0.46]], 14), mat.hakama, thigh, { scale: [1, 1, 1.05] });
    const knee = joint(`knee${side}`, thigh, 0, -0.44, 0);
    mesh(lathe([[0.14, 0.04], [0.155, -0.15], [0.165, -0.3], [0.15, -0.37]], 14), mat.hakama, knee);
    // Suneate (shin guard) peeking from the hakama.
    mesh(lathe([[0.055, -0.3], [0.06, -0.36], [0.055, -0.41]], 10), mat.armorPlain, knee, { pos: [0, 0, 0.012] });
    const ankle = joint(`ankle${side}`, knee, 0, -0.43, 0);
    // Tabi foot with waraji sandal.
    mesh(new THREE.CapsuleGeometry(0.045, 0.14, 4, 8), mat.tabi, ankle, { pos: [0, -0.03, 0.06], rot: [Math.PI / 2, 0, 0] });
    mesh(new THREE.BoxGeometry(0.1, 0.02, 0.27), mat.sandal, ankle, { pos: [0, -0.075, 0.06] });
    j[`thigh${side}`] = thigh;
    j[`knee${side}`] = knee;
    j[`ankle${side}`] = ankle;
  }

  // --- Upper body ----------------------------------------------------------
  j.spine = joint('spine', j.hips, 0, 0.1, 0);
  mesh(lathe([[0.15, 0.0], [0.155, 0.1], [0.17, 0.2]], 16), mat.kimono, j.spine, { scale: [1.15, 1, 0.82] });
  j.chest = joint('chest', j.spine, 0, 0.18, 0);
  // Torso beneath armour.
  mesh(lathe([[0.155, 0.0], [0.17, 0.1], [0.165, 0.2], [0.13, 0.27], [0.06, 0.3]], 18), mat.kimono, j.chest, { scale: [1.15, 1, 0.8] });
  // Dō: lamellar chest armour with laced bands.
  const dou = stripe(lathe([[0.165, -0.12], [0.175, 0.0], [0.185, 0.12], [0.175, 0.22], [0.14, 0.26]], 22), 0x2a201d, 0x5e2e22, 6);
  mesh(dou, mat.armor, j.chest, { scale: [1.12, 1, 0.84] });
  // Collar of the kimono (V-shaped crossing).
  for (const s of [1, -1]) {
    mesh(new THREE.BoxGeometry(0.035, 0.2, 0.025), mat.kimono, j.chest, { pos: [0.04 * s, 0.22, 0.135], rot: [0.25, 0, 0.5 * s] });
  }

  // Shoulders and arms.
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const shoulder = joint(`shoulder${side}`, j.chest, 0.19 * s, 0.215, 0);
    mesh(new THREE.SphereGeometry(0.075, 12, 10), mat.kimono, shoulder);
    // Upper arm inside a wide kimono sleeve.
    mesh(lathe([[0.065, 0.02], [0.085, -0.1], [0.105, -0.24], [0.11, -0.3]], 12), mat.kimono, shoulder);
    // Sode shoulder guard hangs from the chest so it stays put when the arm moves.
    const sode = joint(`sode${side}`, j.chest, 0.225 * s, 0.27, 0);
    mesh(lamellarPlate(0.22, 0.22, 5, 1.1, 0x2a201d, 0x5e2e22), mat.armor, sode, { pos: [0.06 * s, 0, 0], rot: [0, (Math.PI / 2) * s, 0.14 * s] });
    const elbow = joint(`elbow${side}`, shoulder, 0, -0.29, 0);
    mesh(lathe([[0.05, 0.02], [0.048, -0.12], [0.038, -0.24]], 10), mat.glove, elbow);
    // Kote: armoured sleeve plate on the forearm.
    mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.18, 10, 1, true, -1.2, 2.4), mat.armorPlain, elbow, { pos: [0, -0.12, 0], rot: [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0] });
    const wrist = joint(`wrist${side}`, elbow, 0, -0.26, 0);
    mesh(new THREE.SphereGeometry(0.045, 10, 8), mat.glove, wrist, { pos: [0, -0.045, 0.005], scale: [0.75, 1.15, 1] });
    j[`shoulder${side}`] = shoulder;
    j[`elbow${side}`] = elbow;
    j[`wrist${side}`] = wrist;
    j[`sode${side}`] = sode;
  }

  // --- Neck and head --------------------------------------------------------
  j.neck = joint('neck', j.chest, 0, 0.27, 0.0);
  mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 10), mat.skin, j.neck, { pos: [0, 0.04, 0] });
  j.head = joint('head', j.neck, 0, 0.12, 0.01);
  mesh(new THREE.SphereGeometry(0.1, 20, 16), mat.skin, j.head, { scale: [0.88, 1.08, 0.98] });
  // Jaw and nose give the face a profile.
  mesh(new THREE.SphereGeometry(0.075, 14, 10), mat.skin, j.head, { pos: [0, -0.05, 0.02], scale: [0.95, 0.75, 1.0] });
  mesh(new THREE.ConeGeometry(0.016, 0.045, 6), mat.skin, j.head, { pos: [0, -0.005, 0.098], rot: [Math.PI / 2 + 0.3, 0, 0] });
  // Short beard and hair with a topknot.
  mesh(new THREE.SphereGeometry(0.06, 12, 8), mat.hair, j.head, { pos: [0, -0.085, 0.035], scale: [0.85, 0.45, 0.8] });
  mesh(new THREE.SphereGeometry(0.104, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat.hair, j.head, { pos: [0, 0.008, -0.01], scale: [0.92, 1.08, 1.02] });
  mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.08, 8), mat.hair, j.head, { pos: [0, 0.11, -0.03], rot: [-0.9, 0, 0] });
  // Eyes in shadow under the brow.
  for (const s of [1, -1]) mesh(new THREE.SphereGeometry(0.009, 6, 4), mat.hair, j.head, { pos: [0.033 * s, 0.012, 0.087], shadow: false });

  // Amigasa: a wide, shallow conical straw hat.
  j.hat = joint('hat', j.head, 0, 0.085, 0.0);
  j.hat.rotation.x = -0.08;
  mesh(lathe([[0.0, 0.11], [0.08, 0.085], [0.2, 0.035], [0.34, -0.015], [0.37, -0.03], [0.36, -0.04], [0.33, -0.032], [0.2, 0.012], [0.08, 0.05], [0.0, 0.06]], 32), mat.straw, j.hat);
  // Chin cord.
  for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 4), mat.cord, j.head, { pos: [0.075 * s, -0.02, 0.0], rot: [0, 0, 0.35 * s], shadow: false });

  // --- Swords on the left hip ----------------------------------------------
  j.swords = joint('swords', j.hips, 0.18, 0.05, 0.02);
  const addSword = (len, hilt, offset, pitch) => {
    const sword = joint('sword', j.swords, offset[0], offset[1], offset[2]);
    sword.rotation.set(pitch, 0.12, 0);
    // Scabbard runs backwards (-Z), handle forwards (+Z).
    mesh(new THREE.CylinderGeometry(0.017, 0.02, len, 8), mat.saya, sword, { pos: [0, 0, -len / 2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.7] });
    mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 14), mat.metal, sword, { pos: [0, 0, 0.012], rot: [Math.PI / 2, 0, 0] });
    mesh(new THREE.CylinderGeometry(0.016, 0.017, hilt, 8), mat.tsuka, sword, { pos: [0, 0, 0.02 + hilt / 2], rot: [Math.PI / 2, 0, 0] });
    mesh(new THREE.SphereGeometry(0.018, 8, 6), mat.metal, sword, { pos: [0, 0, 0.02 + hilt], scale: [1, 1, 0.6] });
    return sword;
  };
  // Negative pitch tips the scabbard down behind and the handle up in front.
  j.katana = addSword(0.78, 0.26, [0, 0, 0], -0.42);
  j.wakizashi = addSword(0.52, 0.19, [-0.03, 0.04, 0.03], -0.32);
  // Where the left hand rests on the katana's handle.
  j.hiltTarget = joint('hiltTarget', j.katana, 0, 0.0, 0.12);

  // --- Travel cloak (simulated cloth strip) ---------------------------------
  j.cloakAnchor = joint('cloakAnchor', j.chest, 0, 0.255, -0.12);
  const cloak = createCloak(mat.cloak);
  j.cloakAnchor.add(cloak.mesh);

  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  return { root, joints: j, cloak, materials: mat };
}

/**
 * A short weathered cloak hanging from the shoulders. Each row hangs at an
 * angle that is integrated by the animation code; rows lag behind the row
 * above, which gives a travelling wave in wind and movement.
 */
function createCloak(material) {
  const cols = 9;
  const rows = 12;
  const length = 0.82;
  const topWidth = 0.46;
  const bottomWidth = 0.66;
  const g = new THREE.BufferGeometry();
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      uvs[i * 2] = c / (cols - 1);
      uvs[i * 2 + 1] = 1 - r / (rows - 1);
    }
  }
  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;

  const state = {
    mesh: m,
    cols,
    rows,
    length,
    topWidth,
    bottomWidth,
    angles: new Float32Array(rows).fill(0.08),
    velocities: new Float32Array(rows),
    sway: new Float32Array(rows),
    swayVel: new Float32Array(rows),
    time: 0,
  };
  updateCloakGeometry(state);
  return state;
}

export function updateCloakGeometry(state) {
  const { cols, rows, length, topWidth, bottomWidth, angles, sway } = state;
  const pos = state.mesh.geometry.attributes.position;
  const seg = length / (rows - 1);
  let y = 0;
  let z = 0;
  const t = state.time;
  for (let r = 0; r < rows; r++) {
    const f = r / (rows - 1);
    if (r > 0) {
      const a = angles[r];
      y -= Math.cos(a) * seg;
      z -= Math.sin(a) * seg;
    }
    const w = topWidth + (bottomWidth - topWidth) * f;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1) - 0.5;
      // Wrap around the shoulders at the top, flare and ripple lower down.
      const wrap = (1 - f) * (1 - f) * Math.abs(u) * 0.22;
      const ripple = Math.sin(u * 9 + t * 3.1 + f * 4) * 0.012 * f;
      const x = u * w + sway[r] * f * 0.6 * (0.6 + Math.abs(u));
      pos.setXYZ(r * cols + c, x, y + Math.abs(u) * 0.03 * (1 - f), z + wrap + ripple - 0.004);
    }
  }
  pos.needsUpdate = true;
  state.mesh.geometry.computeVertexNormals();
}
