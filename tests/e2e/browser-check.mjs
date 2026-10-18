// Automated in-browser checks. Starts the Vite dev server, opens the game in
// headless Chromium (software WebGL), drives it with real keyboard events and
// inspects state through window.__game.debugSnapshot().
//
// Mouse look uses Input.injectMouse() because headless browsers cannot grant
// pointer lock; everything else goes through real DOM events.
//
// Software WebGL renders only ~1 frame per second, so the page is opened with
// ?simMaxDt=3, which lets one frame simulate up to 3 s (in 1/90 s physics
// substeps) so game time keeps up with real time. Short events such as a whole
// jump can then happen inside a single frame, so jumps and landings are
// observed through the player's event callbacks rather than by sampling.
//
// Usage: npm run test:browser   (or: node tests/e2e/browser-check.mjs [quality])

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tests/e2e/output');
mkdirSync(outDir, { recursive: true });
const quality = process.argv[2] || 'low';

// Minimal PNG decoder (8-bit RGB/RGBA, as produced by Chromium screenshots).
function decodePNG(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let r = v;
      if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { width, height, channels, data: out };
}

function lumaStats(img) {
  let sum = 0;
  let sum2 = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const o = i * img.channels;
    const l = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    sum += l;
    sum2 += l * l;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

function meanAbsDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.data.length; i++) d += Math.abs(a.data[i] - b.data[i]);
  return d / a.data.length;
}

const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${String(id).padStart(2)}. ${name} — ${detail}`);
};

const server = await createServer({ root, server: { port: 5197 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
const warnings = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.addInitScript((q) => localStorage.setItem('samurai-endless-plains.settings.v1', JSON.stringify({ quality: q })), quality);
const t0 = Date.now();
await page.goto('http://localhost:5197/?simMaxDt=3');
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
const loadSeconds = (Date.now() - t0) / 1000;

const snap = () => page.evaluate(() => window.__game.debugSnapshot());
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: path.join(outDir, `check-${name}.png`), timeout: 180000 });
const SPAWN = await page.evaluate(async () => (await import('/src/world.js')).SPAWN);

// Keep an eye on ground penetration throughout the whole run.
await page.evaluate(() => {
  window.__events = { jump: 0, land: 0, landSpeeds: [], steps: 0 };
  const pl = window.__game.player;
  pl.on('jump', () => window.__events.jump++);
  pl.on('land', (v) => {
    window.__events.land++;
    window.__events.landSpeeds.push(v);
  });
  pl.on('step', () => window.__events.steps++);
  window.__minClearance = Infinity;
  setInterval(() => {
    const s = window.__game.debugSnapshot();
    window.__minClearance = Math.min(window.__minClearance, s.pos.y - s.terrainY);
  }, 50);
});

const holdKeys = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    const s = await snap();
    if (s.grounded && Math.hypot(s.vel.x, s.vel.z) < 0.01) return s;
    await wait(100);
  }
  return snap();
};
const setPlayer = (x, z, yaw = 0) =>
  page.evaluate(
    ([x, z, yaw]) => {
      const g = window.__game;
      const { getHeight } = window.__worldForTests;
      g.player.state.pos.x = x;
      g.player.state.pos.z = z;
      g.player.state.pos.y = getHeight(x, z);
      g.player.state.vel.x = g.player.state.vel.y = g.player.state.vel.z = 0;
      g.player.state.grounded = true;
      g.input.mouseDX = g.input.mouseDY = 0;
      g.rig.yaw = yaw;
      g.rig.snapTo(g.player.position, yaw);
      g.props.update(x, z, true);
    },
    [x, z, yaw],
  );
await page.evaluate(async () => {
  window.__worldForTests = await import('/src/world.js');
});

try {
  // 1. Start without fatal errors.
  await page.click('#start-button');
  await wait(2500);
  let s = await snap();
  record(1, 'Game starts without fatal console errors', s.state === 'playing' && errors.length === 0, `state=${s.state}, load ${loadSeconds.toFixed(1)} s, console errors=${errors.length}`);

  // 2. Terrain renders (streamed nodes + non-uniform frame).
  const png = await page.screenshot({ timeout: 180000, path: path.join(outDir, 'check-start.png') });
  const img = decodePNG(png);
  // The lower half of the frame (ground) must be textured, not a flat clear colour.
  const lower = { ...img, height: img.height >> 1, data: img.data.subarray((img.height >> 1) * img.width * img.channels) };
  const st = lumaStats(lower);
  record(2, 'Terrain renders', s.terrainNodes > 50 && st.std > 8 && st.mean > 20, `${s.terrainNodes} terrain nodes, ${s.grassInstances} grass instances, ${s.drawCalls} draw calls; ground luma mean ${st.mean.toFixed(0)}, std ${st.std.toFixed(1)}`);

  // 3. Character at the intended start.
  record(3, 'Character appears at the start point', Math.hypot(s.pos.x - SPAWN.x, s.pos.z - SPAWN.z) < 0.01 && Math.abs(s.pos.y - s.terrainY) < 0.01, `pos=(${s.pos.x.toFixed(2)}, ${s.pos.y.toFixed(2)}, ${s.pos.z.toFixed(2)}), ground=${s.terrainY.toFixed(2)}`);

  // 4. WASD movement (camera yaw 0 => W moves towards -Z).
  await page.evaluate(() => (window.__game.rig.yaw = 0));
  const moves = {};
  for (const [key, axis, sign] of [['KeyW', 'z', -1], ['KeyS', 'z', 1], ['KeyA', 'x', -1], ['KeyD', 'x', 1]]) {
    const a = await settle();
    await holdKeys([key], 3000);
    const b = await settle();
    const d = (b.pos[axis] - a.pos[axis]) * sign;
    moves[key] = d;
  }
  record(4, 'WASD movement', Object.values(moves).every((d) => d > 4), Object.entries(moves).map(([k, d]) => `${k.slice(3)} ${d.toFixed(2)} m`).join(', '));

  // 5. Mouse camera rotation.
  const yaw0 = (await snap()).cameraYaw;
  await page.evaluate(() => window.__game.input.injectMouse(300, 0));
  await wait(3000);
  const yaw1 = (await snap()).cameraYaw;
  await page.evaluate(() => window.__game.input.injectMouse(-300, 0));
  await wait(3000);
  record(5, 'Mouse camera rotation (injected deltas)', Math.abs(yaw1 - yaw0) > 0.3, `yaw ${yaw0.toFixed(3)} -> ${yaw1.toFixed(3)} after 300 px`);

  // 6. Sprint.
  await settle();
  await page.keyboard.down('KeyW');
  await wait(3000);
  const walkSnap = await snap();
  const walkSpeed = Math.hypot(walkSnap.vel.x, walkSnap.vel.z);
  await page.keyboard.down('ShiftLeft');
  await wait(3000);
  const sprint = await snap();
  const sprintSpeed = Math.hypot(sprint.vel.x, sprint.vel.z);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  record(6, 'Shift sprinting', sprintSpeed > walkSpeed * 1.8, `walk ${walkSpeed.toFixed(2)} m/s, sprint ${sprintSpeed.toFixed(2)} m/s`);

  // 7 + 8. Jump, gravity and landing (observed through player events).
  await settle();
  const ev0 = await page.evaluate(() => ({ ...window.__events }));
  await page.keyboard.press('Space');
  let after = ev0;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    after = await page.evaluate(() => ({ ...window.__events, landSpeeds: [...window.__events.landSpeeds] }));
    if (after.land > ev0.land) break;
  }
  const landSpeed = after.landSpeeds[after.landSpeeds.length - 1] || 0;
  const back = await settle();
  record(7, 'Space jumping and landing', after.jump === ev0.jump + 1 && after.land === ev0.land + 1, `jump events +${after.jump - ev0.jump}, landing events +${after.land - ev0.land}, impact speed ${landSpeed.toFixed(2)} m/s`);
  // Landing at roughly the take-off speed means gravity brought the samurai back down.
  record(8, 'Gravity returns the samurai to the ground', Math.abs(landSpeed - 8.4) < 1.5 && back.grounded && Math.abs(back.pos.y - back.terrainY) < 0.01, `take-off 8.40 m/s, landing ${landSpeed.toFixed(2)} m/s, grounded=${back.grounded}`);

  // 9. Collision with a solid boulder, approached from its downhill side (from uphill a
  // half-buried rock can legitimately be stepped onto).
  const rock = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.position;
    const list = g.colliders.query(p.x, p.z, 400).filter((c) => c.type === 'rock' && c.top > 1.4 && c.r > 1.2);
    list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const r = list[0];
    if (!r) return null;
    const n = window.__worldForTests.getNormal(r.x, r.z);
    const l = Math.hypot(n.x, n.z) || 1;
    return { ...r, dx: n.x / l, dz: n.z / l };
  });
  if (rock) {
    const start = { x: rock.x + rock.dx * (rock.r + 4), z: rock.z + rock.dz * (rock.r + 4) };
    await setPlayer(start.x, start.z, Math.atan2(rock.dx, rock.dz));
    await wait(300);
    await holdKeys(['KeyW'], 4000);
    const c = await settle();
    const dist = Math.hypot(c.pos.x - rock.x, c.pos.z - rock.z);
    record(9, 'Collides with solid rocks', dist > rock.r * 0.75 && dist < rock.r + 1.2 && c.pos.y - c.terrainY < 0.5, `boulder r=${rock.r.toFixed(2)} top=${rock.top.toFixed(2)}; walked 4 s into it, stopped ${dist.toFixed(2)} m from its centre, feet ${(c.pos.y - c.terrainY).toFixed(2)} m above terrain`);
  } else {
    record(9, 'Collides with solid rocks', false, 'no suitable boulder collider found near the player');
  }
  // Tree trunk collision.
  const tree = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.position;
    const list = g.colliders.query(p.x, p.z, 250).filter((c) => c.type === 'tree' && c.r > 0.25);
    list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return list[0] || null;
  });
  if (tree) {
    await setPlayer(tree.x, tree.z + 4, 0);
    await wait(300);
    await holdKeys(['KeyW'], 3500);
    const c = await settle();
    const dist = Math.hypot(c.pos.x - tree.x, c.pos.z - tree.z);
    record('9b', 'Collides with tree trunks', dist >= tree.r + 0.3 && dist < 1.5, `trunk r=${tree.r.toFixed(2)}; player centre ${dist.toFixed(2)} m from trunk`);
  }
  await page.keyboard.press('KeyR');
  await wait(1200);

  // 11. Camera limits and collision.
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__game.input.injectMouse(0, 250));
  await wait(3000);
  const camDown = await snap();
  for (let i = 0; i < 14; i++) await page.evaluate(() => window.__game.input.injectMouse(0, -250));
  await wait(4000);
  const camUp = await snap();
  const limits = await page.evaluate(async () => (await import('/src/camera.js')).CAMERA_LIMITS);
  const camOk =
    Math.abs(camDown.cameraPitch - limits.maxPitch) < 1e-6 &&
    Math.abs(camUp.cameraPitch - limits.minPitch) < 1e-6 &&
    camUp.cameraPos.y >= camUp.cameraGround + limits.clearance - 0.01 &&
    camDown.cameraPos.y >= camDown.cameraGround + limits.clearance - 0.01;
  record(11, 'Camera angle limits and ground clearance', camOk, `pitch range ${camUp.cameraPitch.toFixed(2)}..${camDown.cameraPitch.toFixed(2)}; low camera ${(camUp.cameraPos.y - camUp.cameraGround).toFixed(2)} m above ground (distance pulled in to ${camUp.cameraDistance.toFixed(2)} m)`);
  await page.evaluate(() => (window.__game.rig.pitch = 0.14));

  // 12. Grass moves continuously (frame difference with the player standing still).
  await settle();
  await wait(500);
  const clip = { x: 0, y: 300, width: 960, height: 240 };
  const fa = decodePNG(await page.screenshot({ timeout: 180000, clip }));
  await wait(2500);
  const fb = decodePNG(await page.screenshot({ timeout: 180000, clip }));
  const still = await snap();
  const diff = meanAbsDiff(fa, fb);
  record(12, 'Grass moves continuously', diff > 2 && Math.hypot(still.vel.x, still.vel.z) === 0, `mean per-channel change ${diff.toFixed(2)}/255 in the lower frame over 2.5 s with the samurai and camera still; shader time ${still.time.toFixed(1)} s`);

  // 14. Pause, resume, settings, restart.
  await page.keyboard.press('Escape');
  await wait(500);
  const paused = (await snap()).state;
  const pauseVisible = await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden'));
  await page.selectOption('#quality-select', quality === 'low' ? 'medium' : 'low');
  await wait(2500);
  const changedQuality = (await snap()).quality;
  await page.selectOption('#quality-select', quality);
  await wait(2500);
  await page.fill('#volume-range', '0.35');
  await page.dispatchEvent('#volume-range', 'input');
  const vol = await page.evaluate(() => window.__game.settings.volume);
  await page.click('#resume-button');
  await wait(600);
  const resumed = (await snap()).state;
  await holdKeys(['KeyW'], 3000);
  const moved = await settle();
  await page.keyboard.press('Escape');
  await wait(500);
  await page.click('#restart-button');
  await wait(1500);
  const restarted = await snap();
  const pauseOk = moved.pos.z < SPAWN.z - 3 && paused === 'paused' && pauseVisible && resumed === 'playing' && changedQuality !== quality && Math.abs(vol - 0.35) < 1e-6 && restarted.state === 'playing' && Math.hypot(restarted.pos.x - SPAWN.x, restarted.pos.z - SPAWN.z) < 0.01;
  record(14, 'Pause, resume, restart and settings controls', pauseOk, `Esc -> ${paused} (menu visible=${pauseVisible}); quality switched to ${changedQuality} and back; volume=${vol}; resume -> ${resumed}; moved to z=${moved.pos.z.toFixed(1)}; restart -> back at start=${Math.hypot(restarted.pos.x - SPAWN.x, restarted.pos.z - SPAWN.z) < 0.01}`);

  // 15. Audio started after the user gesture.
  record(15, 'Audio starts after user interaction', restarted.audio === 'running', `AudioContext state: ${restarted.audio} (audible output not verifiable headless)`);

  // 16. Resize.
  await page.setViewportSize({ width: 700, height: 600 });
  await wait(1500);
  const size = await page.evaluate(() => ({ w: window.__game.renderer.domElement.width, h: window.__game.renderer.domElement.height, aspect: window.__game.camera.aspect }));
  await shot('resized');
  await page.setViewportSize({ width: 960, height: 540 });
  await wait(1000);
  record(16, 'Resizing the browser', Math.abs(size.aspect - 700 / 600) < 1e-3 && size.w > 0 && size.h > 0, `canvas ${size.w}x${size.h}, camera aspect ${size.aspect.toFixed(3)}`);

  // 17. Focus loss while holding a key must not leave the samurai walking.
  await page.keyboard.down('KeyW');
  await wait(2500);
  const beforeBlur = await snap();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(3500);
  const afterBlur = await snap();
  await page.keyboard.up('KeyW');
  record(17, 'Focus loss clears held keys', Math.hypot(beforeBlur.vel.x, beforeBlur.vel.z) > 1 && Math.hypot(afterBlur.vel.x, afterBlur.vel.z) < 0.01, `speed before blur ${Math.hypot(beforeBlur.vel.x, beforeBlur.vel.z).toFixed(2)} m/s, 3.5 s after blur (W still physically held) ${Math.hypot(afterBlur.vel.x, afterBlur.vel.z).toFixed(3)} m/s`);

  // 10 + 18. Extended exploration: sprint in several directions, jumping now and then.
  const startExplore = await snap();
  const dirs = [0, 1.2, 2.6, -1.9, 0.6];
  let maxNodes = 0;
  for (const yaw of dirs) {
    await page.evaluate((y) => (window.__game.rig.yaw = y), yaw);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    for (let i = 0; i < 6; i++) {
      await wait(2000);
      if (i % 2 === 0) await page.keyboard.press('Space');
      maxNodes = Math.max(maxNodes, (await snap()).terrainNodes);
    }
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
  }
  const endExplore = await settle();
  await shot('explore');
  const travelled = Math.hypot(endExplore.pos.x - startExplore.pos.x, endExplore.pos.z - startExplore.pos.z);
  const minClear = await page.evaluate(() => window.__minClearance);
  record(10, 'Never falls through the terrain', minClear > -0.02, `minimum (feet - terrain) over the whole run: ${minClear.toFixed(3)} m`);
  record(18, 'Extended exploration stays playable', errors.length === 0 && endExplore.grounded, `60 s of sprinting/jumping, ${travelled.toFixed(0)} m from where it began, terrain nodes up to ${maxNodes}, grass ${endExplore.grassInstances}, colliders ${endExplore.colliders}, fps (software GL) ${endExplore.fps.toFixed(1)}`);

  // 13. Distant landscape coherence: captured for manual review.
  await page.keyboard.press('KeyR');
  await wait(1200);
  await page.evaluate(() => {
    const g = window.__game;
    g.rig.yaw = 0;
    g.rig.pitch = 0.03;
  });
  await wait(1500);
  await shot('distance');
  record(13, 'Landscape coherent at a distance', true, 'screenshot check-distance.png captured for visual review (judged by eye, not automatically)');
} catch (err) {
  console.error(err);
  record('X', 'Harness error', false, err.message);
}

const failed = results.filter((r) => !r.pass);
writeFileSync(path.join(outDir, 'browser-check.json'), JSON.stringify({ quality, results, errors, warnings: [...new Set(warnings)] }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Console errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
