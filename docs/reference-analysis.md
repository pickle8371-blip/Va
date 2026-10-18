# Visual reference analysis

## What was available

| Source | Status |
|---|---|
| `Reference images/` folder in the project | **Missing.** The repository contained only one unrelated file (`Val`, an obfuscated Roblox Lua GUI script). No reference images were present, so none were inspected. |
| https://jal.japantravel.com/kumamoto/kamenoi-hotel-aso-park-resort/71220 | **Not reachable** from the build sandbox (network policy: HTTP 403 / DNS failure). Images on the page were not seen. |
| https://www.analogstickgaming.com/game-reviews/2020/7/30/ghost-of-tsushima | **Not reachable** (same reason). |
| https://yamap.com/activities/19058525 | **Not reachable** (same reason). |
| Image hosts (Wikimedia Commons, Poly Haven, ambientCG, Freesound, CDNs) | **Not reachable**, so no external photographs, textures or sounds could be downloaded. |

Because no image could actually be opened, **no claim is made that any reference image was inspected.** The art direction below comes from the written brief, from text-only web search results about the referenced places and game, and from general knowledge of the Aso region and of Japanese-inspired landscape art.

## Text research used

- **Aso / Kusasenri grasslands (Kumamoto)** — the Aso grasslands are about 22,000 ha of rolling, treeless highland kept open by *noyaki* controlled burning each spring; in autumn *susuki* (Japanese pampas grass) covers the slopes in silver-gold plumes; the plains sit below volcanic peaks such as Mount Eboshi and Naka-dake.
- **Ghost of Tsushima art direction** (developer interviews, SIGGRAPH 2021 talks on procedural grass and wind): wind is a primary visual element; huge fields of grass move in coherent gusts; lighting is realistic while plant composition is exaggerated for readability; colour, light and weather are used to carry mood; Kurosawa's samurai films are a touchstone.

## How the references shaped the game

| Aspect | Reference idea | Implementation |
|---|---|---|
| Landform | Aso's soft, rolling, burned-open grassland under volcanic ranges | Low-amplitude multi-octave hills (mostly under 15° slope), long ridgelines, a broad valley ahead of the start, rounded volcanic massifs from ~2 km out, three hazy distant ranges with a broad volcanic cone on the far ring. |
| Vegetation | Golden *susuki* and olive/green grass, few trees | ~70k–120k instanced grass blades blending green → olive → gold by region; *susuki* plumes in patches; sparse windswept Japanese black pines and a few broadleaf groves; open meadow clearings. |
| Wind | Ghost of Tsushima's coordinated gusts | One wind direction drives everything: large gust patches travel across the field (scrolling noise), rolling waves, per-blade flutter, a silvery sheen where blades lay over, tree sway, the cloak and the wind audio. |
| Light | Golden hour, long shadows, hazy horizon | Sun at 11° elevation, warm key light, cool sky fill + warm ground bounce, ACES tone mapping, back-lit grass translucency, height fog that is warm towards the sun and blue-grey away from it. |
| Composition | A lone figure in a vast field (cinematic, Kurosawa-like) | The first view puts the samurai on a ridge in tall grass looking down a valley towards the mountains, with a lone pine framing the left and a torii on a distant rise as a destination. |
| Character | Wandering samurai, muted and weathered | Original design: wide *amigasa* straw hat, dark kimono and hakama, muted lacquered lamellar armour with rust lacing, a weathered travel cloak, katana and wakizashi on the left hip. Not modelled on any existing game character. |
| Culture cues | Rural Japan | Torii gates, moss-covered stone lanterns, old wooden posts at hilltop shrines; a distant bush warbler call in the ambience. |

## Screenshots of the result

Screenshots captured from the running game (software WebGL in a headless browser, Low preset) are kept with the test output in `tests/e2e/output/` when the checks are run; a selection is copied to `docs/images/`.
