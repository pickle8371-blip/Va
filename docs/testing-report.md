# Testing report

All results below were actually run in the build environment (Linux container, Node 22.22, headless Chromium 141 via Playwright 1.56 with **SwiftShader software WebGL**, since the container has no GPU). There were **no manual tests with a human at a keyboard and mouse.** Results are labelled by how they were obtained.

## 1. Unit tests (automated, Vitest) — 51 / 51 passed

`npm test`

| File | Tests | Covers |
|---|---|---|
| `tests/movement.test.js` | 17 | camera-relative input, diagonal speed normalisation, acceleration and deceleration, sprint speed, coming to a full stop with no input and staying still, facing direction, jump only when grounded, apex height, falling and landing, large frame times (no tunnelling), staying grounded walking downhill (no bouncing), uphill slow-down, steep-slope blocking, boulder / low-stone / jump-onto-rock / tree-trunk collisions |
| `tests/collision.test.js` | 10 | spatial-hash queries, no duplicate results, group removal, rock dome surface, push-out from rocks and trunks (including exact-centre case), stepping onto low rocks, passing over rocks from above, being wedged between two rocks |
| `tests/camera.test.js` | 12 | orbit maths, pitch clamping (including via mouse), full distance in the open, pulling in for terrain and boulders, never below the ground, no drift when nothing moves, smooth following at sprint speed (bounded lag, no snapping), zoom limits |
| `tests/world.test.js` | 8 | noise determinism and range, finite deterministic terrain, gentle walkable start area, distant mountains towards the first view, the dirt path in front of the start, unit normals |

Two expectations were corrected during development after the tests exposed that they did not match the intended design (not the code): the rock blocking radius is measured at step height on a dome, and the critically damped camera follows a sprinting player with a constant ~1.2 m lag.

## 2. Automated browser checks (Playwright + real game) — 19 / 19 passed

The figures below are from the final run, made after the last code change that affects gameplay or rendering (an Escape-key tweak for focused menu controls came afterwards and is covered only by reasoning, not by a re-run).

`npm run test:browser` (`tests/e2e/browser-check.mjs`, Low preset, 960×540)

The script starts the Vite dev server, opens the real game, clicks **Start Exploring** and drives it with **real keyboard events** (`keydown` / `keyup` for W, A, S, D, Shift, Space, Escape, R) and real clicks on the menu, and reads state through `window.__game.debugSnapshot()`.

Caveats:
- **Mouse look** is driven by `Input.injectMouse()` (the handler the `mousemove` listener calls), because headless Chromium cannot grant pointer lock. The real pointer-lock path was not exercised.
- Software WebGL renders about **0.4–1 frame per second**, so the page is opened with `?simMaxDt=3`. This lets one frame simulate up to 3 s of game time in 1/90 s physics substeps, so movement keeps pace with real time. Because a whole jump can then happen inside one frame, jumps and landings are checked through the player's event callbacks.
- Audible sound cannot be verified headless; only that the `AudioContext` is running.

| # | Check | Result | Measured |
|---|---|---|---|
| 1 | Game starts without fatal console errors | PASS | state `playing`; 0 console errors (only warning: `KHR_parallel_shader_compile` unsupported by SwiftShader) |
| 2 | Terrain renders | PASS | 124 terrain nodes, 63,914 grass instances, 160 draw calls; ground region luma mean 65, std-dev 29.9 (not a blank frame) |
| 3 | Character appears at the start point | PASS | (-60.00, 23.97, 10.00), exactly on the terrain |
| 4 | WASD movement | PASS | 3 s presses moved W 11.9 m, S 12.7 m, A 9.7 m, D 11.8 m in the expected camera-relative directions (distances vary with slope and frame timing) |
| 5 | Mouse camera rotation | PASS (injected) | yaw 0.000 → −0.550 rad after 300 px |
| 6 | Shift sprinting | PASS | walk 3.40 m/s, sprint 8.40 m/s |
| 7 | Space jumping and landing | PASS | one jump event and one landing event, impact 8.33 m/s |
| 8 | Gravity | PASS | take-off 8.40 m/s, landing 8.33 m/s, grounded and on the surface afterwards |
| 9 | Collision with solid rocks | PASS | walked 4 s into a boulder (r 3.42 m, 2.34 m tall) from its downhill side; stopped 3.70 m from its centre |
| 9b | Collision with tree trunks | PASS | stopped 0.70 m from a trunk centre (trunk r 0.36 + body r 0.34) |
| 10 | Never falls through the terrain | PASS | minimum (feet − terrain) over the whole ~6 min run: 0.000 m |
| 11 | Camera angle limits and collision | PASS (injected) | pitch clamps to −0.42…1.15 rad; at the lowest angle the camera pulled in to 2.19 m and stayed 0.42 m above the ground |
| 12 | Grass moves continuously | PASS | mean per-channel pixel change 16.0/255 over 2.5 s with the samurai and camera still |
| 13 | Landscape coherent at a distance | Visual only | `check-distance.png` reviewed by eye (copy in `docs/images/browser-check-distance.png`); no automatic judgement |
| 14 | Pause, resume, restart, settings | PASS | Esc → paused with menu visible; quality Low → Medium → Low; volume slider → 0.35; Resume → playing and movement works; Return to Start → back at the start |
| 15 | Audio starts after user interaction | PASS (partial) | `AudioContext` state `running` after Start Exploring |
| 16 | Browser resize | PASS | viewport 700×600 → camera aspect 1.167, canvas resized (render scale reduced by adaptive resolution) |
| 17 | Focus loss does not leave movement stuck | PASS | 3.40 m/s while W held → 0.000 m/s 3.5 s after a window `blur`, with W still physically down |
| 18 | Extended exploration | PASS | 60 s of sprinting in five directions with jumps, 301 m covered, terrain/grass/props streamed (up to 154 terrain nodes), no errors |

### Bugs found by these checks and fixed

| Problem | Fix |
|---|---|
| The FPS counter used the clamped simulation step, so it reported ~10 fps when the real rate was ~1 fps | stats now use wall-clock time |
| Adaptive resolution resized the canvas *after* drawing, giving one blank frame per change | resize now happens before rendering |
| Rock test walked over a half-buried rock from the uphill side | intended behaviour (the samurai can step onto it); the test now approaches a tall boulder from downhill |
| Grass blades right in front of the camera could wall off the view in tall grass | blades within ~2.5 m of the lens shrink away |

## 3. Visual review (screenshots, judged by eye)

Screenshots were captured with `tests/e2e/screenshot.mjs` and inspected during development; a selection is in `docs/images/`. They led to these fixes: the opening view faced uphill (spawn moved onto a ridge); pampas plumes looked like white flags (thinner strands, warmer colour, no distance widening); the armour read as a bright red barrel (muted lacquer, slimmer torso, shoulder guards re-parented); distant mountains were brown pyramids (rounded massifs, cool haze away from the sun, layered haze rings); the samurai was a black silhouette when backlit (rim and fill light on the character); the katana pointed upwards (scabbard pitch sign).

## 4. Not tested / limitations

- **Real-GPU frame rate was not measured.** Software rendering here is roughly 100× slower than a desktop GPU (Low preset ~1 fps at 960×540), so the 60 fps target could not be verified. Geometry budgets per preset are listed in the README. On real hardware, use the in-game **Show frame rate** option and the quality presets.
- Pointer lock, fullscreen and real mouse input were not exercised (headless limitations).
- Audio was not listened to.
- Only Chromium was used; Edge is Chromium-based and expected to behave the same; Firefox and Safari were not tested.
- Windows was not available. The Windows instructions (`start-game.bat`, `npm install`, `npm start`) use only cross-platform npm scripts, but they have not been run on Windows.
