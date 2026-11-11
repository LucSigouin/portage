# Portage: design brief

Working name. Browser survival-crafting game. Source of truth for every worker.

## Luc's calls (2026-11-10)

- Flooded world, all you have is a canoe. Scavenge islands for stock food and tools. Quests give tools and materials. The canoe gets fixed up, then grows attachments that unlock more crafting, until it is crazy impressive.
- 3D, camera behind the canoe. Desktop first (keyboard + mouse). Phone is a later round.
- Light survival: hunger, thirst, storms matter. Failing washes you ashore and costs cargo. No enemies.
- Art style: **B2, Ink & Wash drawn sharp** (`art-r1/b2/`). Luc picked it on 2026-11-11 after comparing it with B side by side. The game is built in this look. A, B and C are reference only.
  - Nothing on screen may shimmer, ripple or re-wobble. The old "line boil" made Luc motion sick. It stays off by default, and every drawn stroke rides on its object, never on the screen.
  - It must draw at the screen's full size (1080p, 1440p, 4K). When frames run long it drops reflections first and resolution last.
  - B's menus, lobby and HUD are the approved interface style.
- Runs in the browser, hosted on Luc's site. Needs a proper lobby, menus and settings.
- Only Fable 5.2 works on this (`claude-fable-5-2`; the CNVS alias `fable` is Fable 5, do not use it).

## Luc's calls (2026-11-11, after playing step 1)

- **Co-op, up to 4 players.** The rules are shaped for 4 players now. The networking comes after the solo game is finished. Solo is co-op with one player.
  - One shared canoe with a crew of up to four. Anyone aboard can paddle, bail, fish or craft. On an island everyone walks off on their own.
  - Each player has their own hunger, thirst, energy, backpack and tool belt. The canoe, its cargo, the quests and the world are shared.
  - A player at 0 energy wakes alone at the respawn point. A capsize takes everyone aboard.
  - Later: the host's browser runs the game, a small relay on Cloudflare passes messages, friends join by a link on sigouin.net.
- **The player never goes blurry and never loses drawn detail**, at any zoom and any window size. This holds for every crew member, and (Claude's call) for the canoe they sit in. Everything else may shed detail when frames run long.
- **Item icons.** Wherever an item is named (inventory, crafting, builder, hotbar, loot notes), it shows a drawn icon beside the words.
- **F is the main action key**: land, interact, scavenge, board. The lantern moves to L (Claude's call, F used to be the lantern).
- **Scavenging takes one press.** No holding.

## Pitch

The valley flooded and stayed flooded. You have a leaky canoe. Paddle between drowned hilltops and rooftops, scavenge on foot, craft, and bolt what you build onto the canoe until it is a floating homestead that can reach the Beacon.

## Pillars

1. The canoe is the character. Every upgrade is a visible bolted-on piece.
2. Short trips, real choices: what fits in the hull, when to turn back.
3. Light survival. Meters push you outward. Failure costs cargo, never the save.
4. No invisible walls. Rough water gates regions: you may try, you will swamp.
5. Everything is drawn in code. No asset packs, no downloads, 60 fps on a laptop.

## Setting

Flooded boreal valley, Canadian Shield feel. Pine-topped granite knolls, cabin roofs, a church steeple, grain silos, hydro pylons, a truss bridge, a fire tower, a dam. Loons, herons, fish. Three survivors. No combat.

## Core loop

Paddle, land, scavenge on foot, haul back, craft and cook, bolt on an attachment, reach rougher water, repeat. Quests steer the order.

## Controls (defaults, all rebindable)

| Context | Keys |
|---|---|
| Canoe | W paddle, S back-paddle, A/D steer, Shift power stroke, R bail (hold), L lantern, F land / interact |
| On foot | WASD move (camera-relative), Shift run, F interact and scavenge (one press), F at canoe to board |
| Camera | Mouse drag orbit, wheel zoom, auto-recentre behind heading |
| Panels | Tab inventory, C craft, B canoe builder (canoe beached), J quest log, M map, 1-5 tool hotbar, Esc pause |

## Units and scale

Metres, seconds, Y up, water rest level y = 0. World about 3000 x 3000 m. Canoe 2.2 m/s paddling, 3.2 m/s power stroke, up to 5 m/s under sail. One day = 24 real minutes (16 day, 8 night).

## Survival rules

- Hunger and thirst, 0 to 100. Hunger empties in about 2 days, thirst in about 1.25 days. Hard paddling, running and chopping drain faster.
- Energy, 0 to 100. Spent by power strokes, running, chopping, bailing. Regenerates at rest. Sleeping at a camp (or aboard with the canopy) refills it and skips to morning.
- Hunger or thirst at 0 caps energy and drains it. Cold nights and storms drain energy faster unless near a fire, lantern or canopy.
- Canoe water level, 0 to 100. Leaks (hull tier 0) and rough water add water. Rough water adds water in proportion to `region roughness - canoe stability` when that is above 0. Bailing removes it. 100 means capsize.
- Fail (energy 0, or capsize): wake at the respawn point, canoe beached beside you, six hours later, meters at 50. Lose half of every non-tool stack in the canoe cargo. Tools, attachments and quest items are never lost.
- Respawn point: the last camp you slept at. Home Knoll by default. With the canopy, wherever the canoe was last beached.
- Weather: clear, fog, rain, storm. Rain fills the rain catcher. Storms raise roughness by 1 in open regions. Never in the Shallows before the first outrigger.
- Difficulty setting scales meter drain: Relaxed 0.6, Standard 1.0.

## Inventory

- Backpack: 8 stacks, carried on foot. Canoe cargo: 8 stacks (hull tier 0 and 1), 12 (tier 2), 16 (tier 3), +6 with the cargo rack. Stack size 20.
- Tools live on a tool belt and take no slot. Quest items take no slot.
- At the canoe, one action stows the backpack into cargo. Crafting at the canoe or a camp draws from both.

## World

Fixed layout from a seed, so everyone gets the same valley. Roughness is the gate.

| Region | Roughness | Islands |
|---|---|---|
| The Shallows | 1 | Home Knoll (start, camp: campfire, stump bench, lean-to), Cabin Roofs, Birch Islet, Orchard Hill (Odile), The Boathouse |
| The Reach | 2 | Steeple Rock (Wren), Silo Twins, Pylon Line, Scrapyard Bar (Tink), Heron Marsh |
| The Narrows | 3 | Truss Bridge (sunken wrecks), Quarry Face, Fire Tower Ridge, Dam Crest |
| The Fog | 3, plus fog wall | The Beacon (radio tower on High Ridge) |

Canoe stability: 1 base, +1 per outrigger. The fog wall turns you around unless you carry the lantern mast and the radio.

Scavenge nodes: driftwood pile, cattail stand, berry bush, apple tree, mushroom log, birch (bark, needs knife), spruce (gum by hand, logs need hatchet), stone outcrop, clay bank, crate (pry bar), attic or shed (search, loot table), junk heap, boat wreck, machinery (wrench), rain barrel, garden bed, fishing spot (rod), sunken wreck buoy (winch), message bottle. Most respawn after 2 to 4 days. Unique caches never respawn.

## Items

- Raw: driftwood, log, birch_bark, spruce_gum, fiber, stone, clay, scrap_metal, nails, wire, cloth, rope, glass_jar, tin_can, seeds, copper_coil, battery, steel_cable.
- Unique finds: hatchet_head, saw_blade, pry_bar, wrench, lens, lodestone, radio_crystal.
- Food and water, raw: berries, apple, cattail_root, mushroom, raw_fish, dirty_water.
- Refined: plank, pitch, charcoal, sailcloth, metal_sheet, hardware, clean_water, cooked_fish, roast_roots, stew.
- Stock food (preserved, best value, needed for the last crossing): smoked_fish, jam, dried_apple.
- Tools: bailing_can (start), stone_knife, hatchet, pry_bar, saw, hammer, fishing_rod, wrench.

## Crafting stations

| Station | Where | Makes |
|---|---|---|
| Hands | anywhere | stone_knife, rope, hatchet, fishing_rod |
| Fire | Home Knoll campfire, then the firebox attachment | pitch, charcoal, clean_water, cooked_fish, roast_roots, stew, jam |
| Bench | Home Knoll stump bench, then the workbench attachment | saw, hammer, plank, sailcloth |
| Smoker | attachment | smoked_fish, dried_apple |
| Forge | attachment | metal_sheet, hardware |

Tuning (exact costs) belongs to the rules worker. The proof is the solvability test and the bot run below.

## The canoe

Hull tiers:

| Tier | Name | Needs | Gives |
|---|---|---|---|
| 0 | Leaky canoe | start | leaks, 8 cargo |
| 1 | Patched canoe | pitch, birch_bark | no leak |
| 2 | Ribbed canoe | plank, nails, rope, hammer | 12 cargo, mount points for everything below |
| 3 | Long canoe | plank, hardware, pitch, metal_sheet | 16 cargo, faster, two extra mounts |

Attachments. Each has one fixed mount, so the finished canoe looks designed. All need hull tier 2 unless noted.

| Id | Mount | Effect |
|---|---|---|
| cargo_rack | mid aft, in hull | +6 cargo |
| rain_catcher | stern quarter frame | clean water from rain |
| firebox | mid forward, on a stone slab | Fire station aboard, warmth |
| fishing_rig | starboard gunwale | fish while beached or asleep |
| outrigger_port | port float and deck | stability +1, port deck mounts |
| outrigger_starboard | starboard float and deck | stability +1, starboard deck mounts |
| workbench | port deck forward | Bench station aboard |
| smoker | port deck aft | Smoker station |
| planter | starboard deck forward | berries and roots each morning |
| forge | starboard deck aft | Forge station |
| mast_sail | mast step, centre | wind propulsion |
| rudder | stern | tighter turning, sail upwind |
| lantern_mast | bow pole | light at night, needed for the Fog |
| canopy | hoops over the cockpit | sleep aboard, rain shelter, mobile respawn |
| map_table | cockpit | full chart with bearings (needs lens, lodestone) |
| winch | bow crane, hull tier 3 | haul sunken caches |
| radio | stern shack and antenna, hull tier 3 | hear the Beacon, quest markers |
| flag, figurehead | stern rail, bow stem | cosmetic, quest rewards |

## Quests

Main line, also the tutorial:

1. Bail out: bail the canoe, land on Home Knoll.
2. First haul: gather driftwood and fiber, make a stone knife.
3. Stop the leak: spruce gum and birch bark, cook pitch, patch the hull.
4. Something to eat: forage, boil water, cook a meal, sleep.
5. A proper edge: find the hatchet head at Cabin Roofs, make the hatchet.
6. Ribs and rails: pry bar and saw blade from the Boathouse, planks, ribbed hull.
7. Steady now: build the port outrigger, cross into the Reach.
8. The bellkeeper: reach Steeple Rock, meet Wren, sew sailcloth.
9. Catch the wind: mast and sail, rudder.
10. Voices: coil, battery, wire and crystal from the Reach and the Narrows, long hull, radio.
11. Through the Narrows: second outrigger, lantern mast, reach Fire Tower Ridge for the bearing.
12. The Beacon: stock 6 stock food and 6 clean water, cross the Fog, light the Beacon. Credits, then free play.

Side quests, about 8: Odile (orchard, jam, planter), Wren (bell rope, flag), Tink (forge, winch, figurehead), ten message bottles, smoke a full rack, haul every sunken cache.

## Screens

- Lobby: live scene behind the title. Continue, New Game (3 save slots), Settings, How to Play, Credits.
- Settings (lobby and pause): Audio (master, music, effects, ambience), Graphics (quality preset, render scale, shadows, water detail, field of view, fps cap, show fps), Controls (rebind every key, mouse sensitivity, invert Y, camera auto-centre), Gameplay (difficulty, autosave interval, hints), Accessibility (UI scale, reduce camera motion, patterned meters).
- In game: HUD (three meters, water gauge, hotbar, quest tracker, compass, prompts), inventory, crafting, canoe builder, quest log, map, dialogue, pause.

## Tech

- `game/`: Vite, TypeScript strict, Three.js, Vitest. Dev server on 5220.
- `src/sim/` is pure TypeScript: no DOM, no Three.js, deterministic, fixed 1/60 s step, seeded random. Rendering, UI and audio read sim state and send commands. They never own rules.
- `src/data/` holds typed tables: items, recipes, hull tiers, attachments, islands, nodes, quests, dialogue, tuning.
- Wave height and terrain height are pure functions shared by sim and rendering, so the canoe sits on the water you see.
- Saves: versioned JSON in `localStorage`, 3 slots, autosave on landing, sleeping and on a timer.
- Sound is synthesised with WebAudio. No audio files.
- Gates: `npm run check` (typecheck + tests). The tests include a solvability test (every item obtainable, every quest completable in order) and a headless bot that plays the main line to the Beacon through the same inputs a player uses.

## Not in v1

Co-op networking (it follows the finished solo game; the rules are already shaped for 4 players), combat, food spoilage, phone controls, free placement of attachments, building on islands, more than one valley.
