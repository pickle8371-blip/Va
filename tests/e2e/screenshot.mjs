// Visual check: start the dev server, load the game, capture a set of screenshots.
// Usage: node tests/e2e/screenshot.mjs [quality] [shot,shot,...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tests/e2e/output');
mkdirSync(out, { recursive: true });
const quality = process.argv[2] || 'low';
const shots = (process.argv[3] || 'title,play,front,side,run').split(',');
const width = Number(process.env.W || 960);
const height = Number(process.env.H || 540);

const server = await createServer({ root, server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.addInitScript((q) => localStorage.setItem('samurai-endless-plains.settings.v1', JSON.stringify({ quality: q, dynamicResolution: false })), quality);
await page.goto('http://localhost:5199/?simMaxDt=3');
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
await page.waitForTimeout(1000);
const snap = async (name) => page.screenshot({ path: path.join(out, `${name}-${quality}.png`), timeout: 180000 });

for (const shot of shots) {
  if (shot === 'title') await snap('title');
  if (shot === 'play') {
    await page.click('#start-button');
    await page.waitForTimeout(2500);
    await snap('play');
  }
  if (shot === 'front' || shot === 'side' || shot === 'back') {
    const yaw = { front: Math.PI, side: Math.PI / 2, back: 0 }[shot];
    await page.evaluate((y) => {
      const g = window.__game;
      g._transition = null;
      g.rig.distance = 2.4;
      g.rig.pitch = 0.05;
      g.rig.yaw = y;
    }, yaw);
    await page.waitForTimeout(1200);
    await snap(shot);
  }
  if (shot === 'run' || shot === 'walk') {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 3.2;
      g.rig.pitch = 0.1;
      g.rig.yaw = Math.PI / 2 + 0.3;
    });
    await page.keyboard.down('KeyA');
    if (shot === 'run') await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(1500);
    await snap(shot);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ShiftLeft');
  }
  if (shot === 'jump') {
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    await snap('jump');
  }
  if (shot === 'vista') {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 5;
      g.rig.pitch = 0.02;
      g.rig.yaw = 0;
    });
    await page.waitForTimeout(1200);
    await snap('vista');
  }
  if (shot === 'sun') {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 5;
      g.rig.pitch = -0.05;
      g.rig.yaw = -0.66;
    });
    await page.waitForTimeout(1200);
    await snap('sun');
  }
}
console.log(JSON.stringify(await page.evaluate(() => window.__game.debugSnapshot())));
console.log(logs.filter((l) => !l.includes('[vite]')).join('\n'));
await browser.close();
await server.close();
