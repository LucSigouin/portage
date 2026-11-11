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
| `daylight.ts`, `quality.ts`, `surface.ts`, `marks.ts`, `effects.ts`, `canoe.ts` | Time of day, quality ladder, wave and shore numbers, world marks, puffs, hull and paddler |

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

`e2e/tests/look.spec.ts` checks full-size drawing, 0 changed land pixels, canoe on the drawn water, 55 fps, clean console.

## Debug switches

| Switch | Does |
|---|---|
| `?look=greybox` | The old placeholder, to compare |
| `&rung=N` | Start N rungs down the quality ladder (0 to 8) |
| `&hold=1` | Pin the ladder |
| `&bench=N` | Draw each frame N times: true cost, and a way to fail the fps test |
| `&boil=1` | Line boil on. Only to prove the steadiness test can fail |
| `window.portage.worldView.probe()` | Drawing size, ladder rung, canoe and water heights |
