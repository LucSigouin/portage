# The look: Ink & Wash (B2) in the game

`src/look/` draws the game in Luc's pick, B2. It reads the state and never changes it. All of it sits behind `createWorldView()`.

**The rule that outranks the rest: nothing shimmers, ripples or re-wobbles.** Every stroke is worked out from the object it is on, never from the screen. Line boil stays off. One clock, `paintTime`, drives all motion: it follows `state.time`, capped at real time, and stops when paused. Cloth is slow on purpose and trees do not sway. Do not add screen-space effects.

## Where things are

| File | What it holds |
|---|---|
| `b2/*.js` (+ `.d.ts`) | B2's code, moved: `post` (pen, paper), `palette` (washes, shared uniforms `GU`), `detail` (pen marks by material), `geo` (`Builder`), `water`, `sky`, `waves`, `canoe`, `flora` |
| `world-view.ts` | The `WorldView`. Builds the scene, syncs it each frame, culls, renders |
| `canoe/*.ts` | The 19 attachments and what they are drawn with. Guide: `LOOK-canoe.md` |
| `world/*.ts` | Landmark drawings by region, island dressing, detail by distance, the node material. Guide: `LOOK-world.md` |
| `presets.ts`, `scatter.ts`, `props.ts`, `terrain.ts` | Region presets, seeded placement, instanced props, the ground |
| `nodes.ts`, `landmarks.ts`, `characters.ts`, `attachments.ts` | One registry each. Step 2 adds meshes here |
| `daylight.ts`, `quality.ts`, `surface.ts`, `marks.ts`, `effects.ts`, `canoe.ts` | Time of day, quality ladder, wave and shore numbers, world marks, puffs, hull and crew |
| `crew.ts`, `hero-windows.ts` | Who the players are (`crewOf`), what each wears (`outfitOf`), and where each hero is on the window |
| `weather.ts`, `rain.ts`, `lamps.ts` | The rules' weather as eased numbers, the rain's pen strokes, the lights and their glows |

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
- **A small hero gets a finer pen** (`heroPen` in `b2/post.js`). The pen's width is in pixels, so the full pen round an 80-pixel figure was a black blob. The share of its width the pen keeps comes from how many metres of world the window's height covers at the hero's depth:
  - all of it up to `HERO_PEN.start` = 16.5 m (14.3 m away at 60 degrees). That is past every normal play distance, and past the long hull's far end in the staged `upgraded` view. Nothing near changes: not one pixel.
  - then less, smoothly: 0.76 at 16 m, 0.50 at 18 m (the walking camera fully out), settling on `HERO_PEN.floor` = 0.3. Its steepest 3% of zoom moves it by 0.087.
  - a thinned pen never goes under one ink texel, and its lines wander less (the wobble thins with it).
  - It is worked out per pixel, from the depth of the nearest hero texel in the pen's reach. So it does not depend on which window a hero is in, and two heroes side by side at one depth get one line weight.
  - Only pen points within the thinned pen's reach of a hero use it. The rest of the window goes round a second time for the world's own lines at the world's width, with the hero's texels left out.
  - Raise `start` and the far figure gets heavier. Lower it under 16.5 and the staged near views change.

## The crew

Every player is drawn from their own state by `CanoeView` (`canoe.ts`), the local one the same way as the rest. It reads players through `crewOf` only.

- **Clothes follow the player id**: `outfitOf(id)` is that player's row of `CREW_MARKS` (coat, toque, legs). Player 0 is B2's paddler. A person looks the same on every screen. Figures are kept by player id, and player 0's is made first so its pen seeds are the lone paddler's.
- **Seats come from the rules**: `seatTransformForHull(tier, player.seat)`, on every hull tier. Seats 0 (stern) and 1 (bow) sit on the cane seats. Seats 2 and 3 kneel between them. A player aboard with no seat (the rules never make one; a staged shot does) takes the first seat nobody holds.
- **The starter kit makes room**: on the two bare hulls, with someone kneeling amidships, the pack, the tin and the small things are drawn shoved up to the thwart (`buildStarterKit(shape, true)`).
- **What each one does is their own flag**: `paddling` (a stroke), `bailing` (a tin, bilge to gunwale, the paddle laid down), `asleep` (slumped aboard, laid on their back ashore), else at rest. Each eases in and out. Never the canoe's speed: a drifting canoe shows nobody paddling.
- **One stroke clock** for the crew, so paddlers are in time. Counted along the hull from the stern, every second one works and rests their paddle on the other side.
- **A paddle changes sides early in the recovery** (stroke clock 0.46 to 0.6), when the hands are drawn back over the paddler's own lap. Never across the catch: there the leading hand is furthest forward, over whatever stands ahead.
- **Kneelers beside an outrigger deck paddle in the well.** The deck's inner edge is never nearer the centreline than `DECK.inner` (`canoe/deck-parts.ts`). A kneeler's recovery runs the pull backwards with the blade turned edge on, and `clearOfDecks` draws a paddle in along its own shaft wherever its tip would pass the planks' ends. Past the deck's ends there is open water and nothing is changed.
- **The patched hull wears its bark where the paddling camera sees it** (`canoe/mends.ts`, hung by `CanoeView` on tier 1 only): laps folded over the rails and a sheet on the bow deck, edged in pitch. No lap lies where the lone paddler's blade crosses the rail.
- **Walking is each player's own change in position.** Stepping out of the canoe, or a new state, is not a stride.
- New pose: add it to `createCrew` in `b2/canoe.js` (`paddle(..., more)` for seated ones, `stand(..., lying)` ashore), drive it from a player flag in `CanoeView.sync`, and report it in `figures()`.

## The ladder

`FrameLadder` in `quality.ts` moves the world's quality one change at a time. The heroes are not on it.

- **Order**: rung 1 sheds the weather's fine work (rain rings, whitecaps, half the rain strokes). Then reflections (2, 3), fine strokes (4), the pen's anti-aliasing (5, 6), and last the resolution: 90%, 80%, 72%, 60%, 50% (7 to 11). Twelve rungs, 0 to 11.
- **The floor is half size** (`WORLD_FLOOR`). At 40% the land's pen lines break into dots. Only the player's own render scale goes lower, and then the ladder takes nothing more.
- **The chip test** (`startOnFittingRung` in `world-view.ts`): on the first frame, before anything is shown, the frame is drawn back to back on a few rungs and the chip waited for. Before the first timing two frames are drawn and thrown away, and one before every other (`FIRST_WARM_UP_FRAMES`, `WARM_UP_FRAMES`): the frame after the one that compiles the shaders still runs long. The game starts on the best rung whose frame fits (`fittingRung`): 90% of the gap, so 15 ms on a 60 Hz screen. Rung 0 fits up to what the ladder itself calls on time (17.5 ms, `topFitMilliseconds`): the margin never takes a pixel from a machine at the line. This Mac on a 5120×2160 window is such a machine (about 17 ms). Up to five rungs are timed, then the top once more if there is time, inside half a second (`CHIP_TEST_MILLISECONDS`; the rung being timed when it runs out is finished). A chip too slow to finish starts on the last rung. `&chiptest=0`, `&rung=N` and `&hold=1` leave it out.
- **Long** is judged against the gap the frame was meant to have (`FrameInfo.dueSeconds`, never under a 60th): half a second of frames is long when they come over 5% further apart than meant. On a 60 Hz screen that is 17.5 ms, under 57 a second. A 30 Hz screen or a 30 cap is not a slow chip. A 144 Hz screen sheds nothing to chase 144.
- **Warm-up**: the first 3 seconds by the clock count for nothing.
- **Down**: two seconds of long frames step one rung down. Past twice the gap it drops two, past three times three.
- **Finding its level**: at the start, after a settings change and when a game begins, steps down may follow each other two seconds apart. That ends at the first ten seconds of good frames, or after thirty seconds, whichever comes first. From then on every change is ten seconds from the last.
- **Up**: after ten seconds of good frames the ladder asks (`asking`). The world view times the rung above inside one frame (`answerLadder`) and the ladder climbs only if it fits. Told no, it asks again after a minute of good frames, then after five, then leaves that rung alone. When the rung above fits with room to spare, the chip was busy at load: it goes to the best rung that fits in one change (`climbTo`).
- **Never pumping**: a rung that was climbed to and then runs long is out for the session, and the ladder goes back to the rung it left in one change. After a failed climb of several rungs every later climb is one rung. A rung that ran long twice is out too. So a rung is tried and dropped once at most.
- A graphics settings change starts it over from rung 0, without a new chip test.
- Do not shorten the ten seconds. A ladder that flips is shimmer.
- Asking costs one long frame (three draws of the rung above): at most three a rung in a session.

## What a frame costs

1920×1080, rung 0, this Mac (M5), milliseconds per pass: reflection 0.7, colour 3.5, ink 2.2 to 3.0, pen 3.3 on an island (1.8 on open water), heroes 0.0 to 0.2. The colour pass on open water is 6.8.

- By rung, a whole 1920×1080 frame afloat with the chip to itself, as a share of rung 0 (5.9 ms): rungs 1 to 3 save 5%, rung 6 is 79%, rung 9 is 52%, rung 10 (60%) is 45%, rung 11 (50%) is 38%. About a quarter of a frame is fixed: no rung removes it, and the heroes' full-size pass is part of it.
- Every surface material has a twin for the mirrored pass (`userData.mirror`). Only the twin can `discard`. A shader that can discard is shaded before the chip knows what hides it. Without it the colour and ink passes shade each pixel once. Keep `discard` out of the plain material.
- Measure with `&bench=N&benchpass=<pass>` (`overlay` is the rain's strokes and the marks): the slope of frame time against N is that pass's cost. Other pages share the chip, so compare A and B in the same page, in turns.
- Weather and night, whole frame on open water, measured in one quiet minute by drawing 24 frames back to back and reading a pixel: clear day 9.7, rain 9.8, storm 10.4, night with lamps 10.1, storm at night 11.5, the same with rung 1 shed 10.0. Every weather shader branch is behind a uniform, so a clear day pays nothing.

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

- **Attachment**: `registerAttachment(id, (context) => ({ object, update? }))`. Build in the mount's own space: origin is the rules engine's mount, +y up. `context` gives hull tier, half beam, gunwale height. `update(canoe, time)` runs each frame. All 19 are drawn in `canoe/`: author in canoe space with `partBuilder(context, seed)`. See `LOOK-canoe.md`.
- **Landmark**: `registerLandmark(kind, (builder, detail) => { ... })`. Built twice: `detail` true for near, false for the far outline. See `LOOK-world.md`.
- **Scavenge node**: `registerNode(typeId, (builder, stage) => { ... })`. Parts inside `stage.fresh()` go when it is used up, parts inside `stage.spent()` only show then. Set its mark height in `NODE_MARK_HEIGHT`. See `LOOK-world.md`.
- **Character**: `registerCharacter(npcId, build)`. Faces -z, feet at the origin.
- **Prop** (tree, rock, reed): add a kind to `VARIANTS` in `scatter.ts`, a builder to `PROP_BUILDERS` in `props.ts`, and a placement rule in `scatterIsland`. Props are instanced, so no per-instance code.
- **Region preset**: add an id and an entry to `PRESETS` in `presets.ts` (rock, moss and sand colours, moss rule, bedding spacing, flora mix), then a rule in `presetIdFor`. Rules read island data only. Never tune one island by name.

## Time of day

`daylight.ts` blends three palettes (`DAY`, `DUSK`, `NIGHT`) and an overcast one, by hour and weather. `DAY` is B2 exactly and is flat from 07:00 to 19:30. `world-view.ts` copies the result into `GU`:

| Uniform | Drives |
|---|---|
| `uLight`, `uShadowTint`, `uPaper`, `uLightDir` | Lit wash, shade, highlight, light direction |
| `uFogColor`, `uFogDensity` | Mist. Density comes from the weather's visibility |
| `uSkyTop`, `uSkyLow`, `uCloud`, `uCloudLight`, `uOvercast`, `uFarTint` | Sky, cloud cover, the painted far ridges |
| `uSunColor`, `uSunDir`, `uSunGlow` | Sun or moon as painted |
| `uWaterDeep`, `uWaterMid`, `uWaterPale`, `uInkBlue`, `uFoam` | Water washes and strokes |

`paletteAt(hour, overcast, storm)`: a storm pulls the greyed sky and water down to slate and takes a quarter of the light. The foam stays bright.

## Weather and night

The rules own the weather. `weather.ts` turns `state.weather` into a handful of numbers (`weatherGoals`) and eases them on paint time (`easeWeather`), so a paused game holds them still. `world-view.ts` (`syncLight`, `syncLamps`) copies them into `GU`. Nothing has a clock of its own. Nothing flashes: there is no lightning.

| Effect | Follows | Where |
|---|---|---|
| Rain strokes | `WEATHER[kind].rain`, `stormLevel`, the wind | `rain.ts`. 2400 slanted pen strokes, each with a place in the world, in a 30 × 18 × 30 m box round the eye. A stroke leaving the box comes back on the far side, clear at that moment. Drawn last, at the window's size. A stroke stops at whatever stands in front of it: a tree, a roof, the ground, the canopy, the crew (see below). Pale at night, lamp-coloured inside a pool |
| Rings on the water | rain level | `rainRings` in `b2/water.js`. Each cell keeps its own time. A ring is clear at both ends of its life, so none pops |
| Wet ground | rain level | `uWet` in `b2/palette.js`: what faces the sky darkens |
| Storm sky | `stormLevel` | the storm palette, and a second darker cloud wash hung low (`b2/sky.js`) |
| Whitecaps | wind speed (from 5.5 m/s, full at 9.5), region roughness, the chop | `b2/water.js`. White marks in the ripple strokes' own hand. Each keeps its own slow time. Near the eye the big marks were bands ten pixels thick: within 8 m the wind whitens the pen's own ripple strokes instead (the set a metre across), so nothing is drawn twice. The middle set takes over by 18 m and the biggest comes in from 30 to 48 m. Do not tie them to a passing crest alone: that whitened the whole view every few seconds (the brightness test caught it as a pulse) |
| Fog | `kind === 'fog'` (`uVeil`) | the sky closes and the ridges and far shore go into it; the foot of a near island softens before its top. The Beacon's fog wall is untouched: 35% visibility, no veil |
| What is coming | `nextKind`, `secondsRemaining`, the wind | a cloud bank in the next weather's colour stands on the upwind horizon for the last 90 s (the rules' storm warning) and climbs. Slate for a storm, grey for rain, low and pale for fog, light for a clearing |
| Stars, moon | hour, cloud, fog | fixed on the dome, never under a pixel across, no twinkle |
| Lamp pools | `canoe.lanternLit` + `lantern_mast`, `firebox` fitted, a camp on the island, `flags.beacon_lit` | `lamps.ts`, `uLamp` in `b2/palette.js` and `b2/water.js`. A warm pool in two flat tones with a hand-wobbled edge. On the water the wash is thin and the pen marks carry the light: the ripple strokes inside the pool are drawn in the lamp's colour. Inside it a thing has its own colours back. Four slots: lantern, firebox, Beacon, nearest camp fire |
| Glows | the same | `LampGlows`: a wash on a card facing the eye, round every burning flame. In the mirror, out of the ink buffer |

- Lamp light shows by `lampShareAt`: none in daylight, all of it at night, 40% under a full storm by day.
- No lamp flickers. A flame that pulsed would break the first rule.
- An attachment with a flame returns `lamp: [x, y, z]` (canoe space) from its builder. `CanoeView.lights()` reports them in the world.
- The rules have no "firebox is burning" flag: it shelters whenever it is fitted, so it glows whenever it is fitted.
- **Rain behind things.** The canvas has no depth of its own, so each pixel of a stroke is held against two depths (`behind` in `rain.ts`): the world's (the ink buffer's), and the heroes'. The heroes are not in the world's depth, so `b2/post.js` hands the rain each hero window's depth as it draws it, and the rain copies it into one buffer of its own: one triangle per window, nothing drawn twice. A stroke's quad is mostly clear paper, so the depths are read only where the stroke marks the pixel, and the heroes' only in a frame that has a hero window: read on every fragment it cost 0.2 ms in a storm. `post.js` finds the hook as `userData.behind` on a layer it draws over the sheet. A stroke nearer the eye than 2.2 m is not drawn at all, so close to the ground there is no rain between the eye and it.
- New weather effect: add a number to `WeatherLook`, a goal in `weatherGoals`, a rate in `EASE`, and a uniform in `GU`. Gate the shader work on the uniform so a clear day pays nothing.

## Water and ground

- The water mesh is displaced by the rules engine's wave table (`b2/waves.js`). The same code gives the foam line on hulls and rocks.
- The water shader works the shore out from the island table (`groundAt` in `b2/water.js`). No shore map to bake.
- `surface.ts` packs the numbers and mirrors both shaders in JavaScript for the tests. Change one, change the other.

## Gates

```
npm --prefix game run check                                   # typecheck + unit tests (tests/look/)
PORTAGE_URL=http://localhost:5221 npm --prefix e2e test       # browser: bot, keys, settings, interface, look, canoe, world
```

`e2e/tests/look.spec.ts` checks:

- full-size drawing, 0 changed land pixels, canoe on the drawn water, clean console
- 55 fps afloat, with the full canoe, mid-game, and zoomed fully out on an island at rung 0
- the heroes at the window's size on rung 11 (the world at half size) and at 5120×2160
- the player as sharp on rung 11 as on rung 0, in a crop of the player: at least 30% of the crop is pixel for pixel the same on both rungs (39 to 51% measured: that is the player; 2 to 5% with `&hero=0`), and its edges keep 85% of their strength (90 to 97% measured: the world in the crop is softer; 48 to 70% with `&hero=0`)
- what is aboard below the waterline is drawn: with `&floor=0.05` the water left in the hull (`&hullwater=1`) paints over 1,456 pixels of the canoe's window, and with today's floor 0
- the chip test at load: 24 times the work starts on rung 11 with no change, this machine at the top, `&chiptest=0` leaves it out
- the ladder climbing back after a slow spell, never twice within ten seconds
- the whole crew drawn (real players, `?crew=N`), each at their own seat on every hull tier
- one paddling while three rest, nobody paddling on a drifting canoe, bailing and sleeping and walking by the player who does them
- the same picture whichever player the screen follows
- the far figure: thinner pen, less ink, scarf and coat showing, at 1920×1080 and 5120×2160
- the thin pen leaving the near views alone (0 pixels), and thinning without a jump through a zoom

`e2e/tests/weather.spec.ts` checks:

- paused in a storm at night with the lantern lit: 0 pixels change
- playing in a storm at night: the mean brightness never steps more than 0.35 of 255 between two frames (read from the canvas on 120 frames in a row)
- playing in a storm with the strokes left out (`&rain=0`): 0 land pixels change. With them: a few percent. By the camp fire at night: 0
- clear, rain, storm and fog told apart by the sky, the far shore, the rain and the whitecaps (which go when the rules' wind drops)
- the lantern lights the canoe and the water beside it, and nothing far off; the canoe still shows without it
- the rain eases in, and neither falls nor builds while paused
- the next weather standing upwind as its time nears
- 55 fps in a storm, at night, and in a storm at night, 1920×1080, rung 0
- the heroes at the window's size with the full pen in a storm at night on rung 11
- rung 1 sheds the weather's fine work and nothing else
- a rain stroke stops at what stands in front of it: side on to the canoe from 2.6 m the strokes mark the view round it and not the canoe; looking down at the ground from 1.5 m they mark nothing
- the lantern's pool is strokes of lamp light (marks in the lamp's colour on the water beside the canoe, none with the lantern out), and the white marks nearest the eye in a storm are no heavier than a pen line (6 pixels at 1080p, under 8: they were 10)

`tests/look/weather.test.ts` checks the numbers with no graphics card: each goal against the rules' weather, the easing, the lamps against their flags, the rain's box, the storm palette, the chop against the rules' wave table.

`tests/look/crew.test.ts` checks the same from the figures themselves, with no graphics card: clothes by id, seats against the rules on all four tiers, nobody inside another or the hull, each pose by its flag, and the pen's law.

`PORTAGE_LOOK_BREAK='&hero=0'` (or `&rung=11`, `&boil=1`, `&bench=24`, `&heropen=0`, `&hullwater=1`) makes the matching checks fail. Run it when you change them. The crew checks have no switch: break the line in `canoe.ts` they guard (the outfit, the seat, the flag) and watch them fail. The weather checks likewise: feed the rain real time instead of paint time, dip `uDark` every 20th frame, pulse `uWet`, hand `weatherGoals` a clear sky, never light the lantern, snap `easeWeather`, zero `ahead`, swap rung 1, leave the copy of a hero window's depth out of `behind` (or leave `uBehind` at 1 there, or drop the world's depth test from the stroke's shader), drop the line that draws the ripple strokes in lamp light, set `capMid = 1.`.

## Debug switches

| Switch | Does |
|---|---|
| `?look=greybox` | The old placeholder, to compare |
| `&rung=N` | Start N rungs down the quality ladder (0 to 11). No chip test |
| `&chiptest=0` | Leave out the chip test at load: start on rung 0 and let the ladder find its level |
| `&rain=0` | Leave the rain's strokes out (rings, wet and sky stay). Only to prove the land changes nowhere else |
| `&hold=1` | Pin the ladder. No chip test |
| `&bench=N` | Draw each frame N times: true cost, and a way to fail the fps test |
| `&benchpass=<pass>` | With `bench`: only that pass (`reflection`, `colour`, `ink`, `composite`, `hero`) |
| `&hero=0` | Leave the heroes in the world, as it was. Only to prove the sharpness tests can fail |
| `&heropen=0` | The full pen on every hero, however small. Only to prove the far-figure tests can fail |
| `&hullwater=1` | Leave the world's water inside the hull, as it was. Only to prove the floor check can fail |
| `&floor=N` | Draw the hull's floor N metres above the keel (today: 5 cm above the waterline). For the floor check, and to try a lower floor |
| `?crew=N` | The client's switch, not the look's: a real crew of N (2 to 4), the extra players idle |
| `&stall=N` | Hold every frame N milliseconds: a slow spell, to watch the ladder |
| `&boil=1` | Line boil on. Only to prove the steadiness test can fail |
| `window.portage.worldView.probe()` | World and canvas size, ladder rung and history (`ladder.chipTest`: what the test at load timed and chose), hero windows, canoe and water heights. `hero.figures`: each crew figure's seat, place, pose and clothes as drawn. `hero.pen`: the pen's share on the local figure |
| `window.portage.worldView.bench(n, pass)`, `.stall(ms)` | The same switches, while it runs |
| `window.portage.worldView.settle()` | Land on the rules' weather at the next frame, without easing: for a staged view that is held still |
| `probe().weather` | Rain, storm, fog, wind, what is ahead, stars, lamp share, strokes drawn, how far the rain has fallen, pools and glows |
