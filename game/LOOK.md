# The look: Ink & Wash (B2) in the game

`src/look/` draws the game in Luc's pick, B2. It reads the state and never changes it. All of it sits behind `createWorldView()`.

**The rule that outranks the rest: nothing shimmers, ripples or re-wobbles.** Every stroke is worked out from the object it is on, never from the screen. Line boil stays off. One clock, `paintTime`, drives all motion: it follows `state.time`, capped at real time, and stops when paused. Cloth is slow on purpose and trees do not sway. Do not add screen-space effects.

## Where things are

| File | What it holds |
|---|---|
| `b2/*.js` (+ `.d.ts`) | B2's code, moved: `post` (pen, paper), `palette` (washes, shared uniforms `GU`), `detail` (pen marks by material), `geo` (`Builder`), `water`, `sky`, `waves`, `canoe`, `attachments`, `flora` |
| `world-view.ts` | The `WorldView`. Builds the scene, syncs it each frame, culls, renders |
| `presets.ts`, `scatter.ts`, `props.ts`, `terrain.ts` | Region presets, seeded placement, instanced props, the ground |
| `nodes.ts`, `landmarks.ts`, `characters.ts`, `attachments.ts` | One registry each. Step 2 adds meshes here |
| `daylight.ts`, `quality.ts`, `surface.ts`, `marks.ts`, `effects.ts`, `canoe.ts` | Time of day, quality ladder, wave and shore numbers, world marks, puffs, hull and crew |
| `crew.ts`, `hero-windows.ts` | Who the players are (`crewOf`), and where each hero is on the window |

## Heroes: the crew and the canoe never go soft

Luc's rule: the player never goes blurry and never loses drawn detail, at any zoom and any window size. It holds for every crew member and for the canoe with its attachments. These are the **heroes**. Everything else is the **world**, and may shed detail.

- **The canvas is always the window's own pixels** (`windowPixelRatio`). The pixel budget, the render scale and the ladder only shrink the world, which is then stretched to the canvas.
- **The world's passes leave the heroes out.** They are still in the mirrored pass, so they reflect.
- **The hero pass draws them apart** (`b2/post.js`, "The hero pass"). Each hero gets a window: a rectangle of the canvas round it (`hero-windows.ts`). Inside it:
  1. The world's depth is copied in, then the heroes are drawn at one sample per canvas pixel, 4x multisampled. So a tree in front still hides them.
  2. The world's ink buffer is copied in, then the heroes are drawn over it at two ink texels per pixel, fine strokes on.
  3. The same pen shader as the world's runs on that merged buffer. It writes only pixels a hero touches: the hero, its outline, its foam line. Every other pixel keeps the world.
- **No seam.** One pen, and its widths are in canvas pixels at both sizes. A hero's outline is worked out against the world behind it, at the canvas's size.
- **At rung 0 with the world at full size the picture is the old one.** Only pixels on a hero differ, by sub-pixel rounding (0.1% of the frame).
- The heroes always get the full pen and fine strokes, whatever the settings or the ladder say.
- A hero is: `CanoeView.group` (the canoe and all aboard), and each figure ashore. To make something else a hero, put it under the world view's `heroes` group and return it from `CanoeView.heroes()`.
- The whole crew is drawn (`crewOf(state).others`): seated ahead of the paddler aboard, standing where the state puts them ashore. Seat places are the look's own guess until the rules name them.

## The ladder

`FrameLadder` in `quality.ts` moves the world's quality one change at a time. The heroes are not on it.

- **Down**: two seconds of long frames (under 49 a second) step one rung down. Under 29 a second it drops two, under 20 three.
- **Up**: ten seconds of good frames step one rung back up.
- **Never pumping**: at most one change every ten seconds. A rung that ran long twice is left alone for the session. So a rung that cannot hold is tried twice, then never again.
- A graphics settings change starts it over.
- Do not shorten the ten seconds. A ladder that flips is shimmer.

## What a frame costs

1920×1080, rung 0, this Mac (M5), milliseconds per pass: reflection 0.7, colour 3.5, ink 2.2 to 3.0, pen 3.3 on an island (1.8 on open water), heroes 0.0 to 0.2. The colour pass on open water is 6.8.

- Every surface material has a twin for the mirrored pass (`userData.mirror`). Only the twin can `discard`. A shader that can discard is shaded before the chip knows what hides it. Without it the colour and ink passes shade each pixel once. Keep `discard` out of the plain material.
- Measure with `&bench=N&benchpass=<pass>`: the slope of frame time against N is that pass's cost. Other pages share the chip, so compare A and B in the same page, in turns.

## Building a mesh

Everything is built with `Builder` (`b2/geo.d.ts` lists every call). Ground at y = 0, metres, front toward -z.

```ts
builder.box(1, 0.5, 1, PAL.wood, { pos: [0, 0.25, 0], kind: KIND.WOOD });
builder.beam([0, 0, 0], [0, 2, 0], 0.03, PAL.iron, { id: THIN });
```

- **Material tags** (`kind`) pick the pen marks drawn inside a wash: `PLAIN WOOD BARK NEEDLE LEAF CLOTH METAL ROPE SHINGLE STONE DRIFT BIRCH PAINT SIDING PATCH CANE SOIL`. Left out, it is guessed from the colour. Tag it.
- **Ink ids** (`id`): the pen draws a line wherever two ids meet. Each piece gets its own. Pass a shared `id` to merge pieces. `id: THIN` is never outlined: use it for ropes, wires and lattice.
- **`glow`**: 0 to 1 of the flat colour showing through shade and mist. Loot uses 0.14. A lamp is 1.
- Colours come from `PAL` (`b2/palette.d.ts`). Do not invent a second palette.

## Adding things (step 2)

Call these before the view mounts. Each replaces the stand-in drawn today.

- **Attachment**: `registerAttachment(id, (context) => ({ object, update? }))`. Build in the mount's own space: origin is the rules engine's mount, +y up. `context` gives hull tier, half beam, gunwale height. `update(canoe, time)` runs each frame. Still placeholders: `forge`, `map_table`, `figurehead`. The other 16 reuse B2's meshes through `fromB2(anchor)`.
- **Landmark**: `registerLandmark(kind, (builder) => { ... })`. One mesh per kind, placed by the island table.
- **Scavenge node**: `registerNode(typeId, build)`. Used-up nodes wash out by themselves. Set its mark height in `NODE_MARK_HEIGHT`.
- **Character**: `registerCharacter(npcId, build)`. Faces -z, feet at the origin.
- **Prop** (tree, rock, reed): add a kind to `VARIANTS` in `scatter.ts`, a builder to `PROP_BUILDERS` in `props.ts`, and a placement rule in `scatterIsland`. Props are instanced, so no per-instance code.
- **Region preset**: add an id and an entry to `PRESETS` in `presets.ts` (rock, moss and sand colours, moss rule, bedding spacing, flora mix), then a rule in `presetIdFor`. Rules read island data only. Never tune one island by name.

## Time of day (step 3 starts here)

`daylight.ts` blends three palettes (`DAY`, `DUSK`, `NIGHT`) and an overcast one, by hour and weather. `DAY` is B2 exactly and is flat from 07:00 to 19:30. `world-view.ts` copies the result into `GU`:

| Uniform | Drives |
|---|---|
| `uLight`, `uShadowTint`, `uPaper`, `uLightDir` | Lit wash, shade, highlight, light direction |
| `uFogColor`, `uFogDensity` | Mist. Density comes from the weather's visibility |
| `uSkyTop`, `uSkyLow`, `uCloud`, `uCloudLight`, `uOvercast`, `uFarTint` | Sky, cloud cover, the painted far ridges |
| `uSunColor`, `uSunDir`, `uSunGlow` | Sun or moon as painted |
| `uWaterDeep`, `uWaterMid`, `uWaterPale`, `uInkBlue`, `uFoam` | Water washes and strokes |

Not built yet: lantern light, rain, storm water marks, wind in the trees.

## Water and ground

- The water mesh is displaced by the rules engine's wave table (`b2/waves.js`). The same code gives the foam line on hulls and rocks.
- The water shader works the shore out from the island table (`groundAt` in `b2/water.js`). No shore map to bake.
- `surface.ts` packs the numbers and mirrors both shaders in JavaScript for the tests. Change one, change the other.

## Gates

```
npm --prefix game run check                                   # typecheck + unit tests (tests/look/)
PORTAGE_URL=http://localhost:5221 npm --prefix e2e test       # browser: bot, keys, settings, look
```

`e2e/tests/look.spec.ts` checks:

- full-size drawing, 0 changed land pixels, canoe on the drawn water, clean console
- 55 fps afloat, with the full canoe, mid-game, and zoomed fully out on an island at rung 0
- the heroes at the window's size on rung 8 and at 5120×2160
- the player as sharp on rung 8 as on rung 0 (edges measured in a crop of the player)
- the ladder climbing back after a slow spell, never twice within ten seconds
- the whole crew drawn

`PORTAGE_LOOK_BREAK='&hero=0'` (or `&rung=8`, `&boil=1`, `&bench=24`) makes the matching checks fail. Run it when you change them.

## Debug switches

| Switch | Does |
|---|---|
| `?look=greybox` | The old placeholder, to compare |
| `&rung=N` | Start N rungs down the quality ladder (0 to 8) |
| `&hold=1` | Pin the ladder |
| `&bench=N` | Draw each frame N times: true cost, and a way to fail the fps test |
| `&benchpass=<pass>` | With `bench`: only that pass (`reflection`, `colour`, `ink`, `composite`, `hero`) |
| `&hero=0` | Leave the heroes in the world, as it was. Only to prove the sharpness tests can fail |
| `&fakecrew=N` | Draw a crew of N (2 to 4). The extra people are made up by the look |
| `&stall=N` | Hold every frame N milliseconds: a slow spell, to watch the ladder |
| `&boil=1` | Line boil on. Only to prove the steadiness test can fail |
| `window.portage.worldView.probe()` | World and canvas size, ladder rung and history, hero windows, canoe and water heights |
| `window.portage.worldView.bench(n, pass)`, `.stall(ms)` | The same switches, while it runs |
