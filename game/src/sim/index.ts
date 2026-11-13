/**
 * Portage rules engine: the single public entry point.
 *
 * Rendering, UI and audio import from here (and the tables from `src/data/`).
 * They read state and send commands. They never own rules.
 *
 * ## The loop
 *
 * ```ts
 * const state = createGame(seed, { difficulty: 'standard' });
 * // every frame:
 * step(state, input, frameSeconds);        // analog intent, runs whole 1/60 s steps
 * for (const event of drainEvents(state)) { ... }   // sounds, toasts, effects
 * // on key presses and panel clicks:
 * const result = dispatch(state, { type: 'craft', recipeId: 'plank' });
 * if (!result.ok) showWhy(result.reason, result.missing);
 * ```
 *
 * ## The crew
 *
 * A game has one to four players (`state.players`, in id order; `createGame`
 * takes `crew`, `addPlayer` seats one more). Solo is a crew of one. Each
 * player has their own position, mode, seat, meters, backpack, tool in hand,
 * conversation and bed. The canoe, its cargo and attachments, the tool belt
 * (`state.tools`: a tool one player finds or makes is everyone's), the key
 * items, the quests, the world, the clock and the
 * weather are shared.
 *
 * - `step(state, input, dt)`: `input` is one `StepInput` (player 0) or a list
 *   indexed by player id. Players are stepped in id order.
 * - `dispatch(state, command, playerId)`: the command is that player's.
 * - Selectors about a player take a `playerId`. Both default to player 0.
 * - An event one player caused carries their `playerId`; `eventsFor(events,
 *   playerId)` keeps one screen's own events and the crew-wide ones.
 *
 * Crew rules: the canoe moves for whoever is aboard. The strongest stroke
 * sets the pace and every other paddler adds a quarter of their own (four:
 * 1.75x); steering is everyone's added up, clamped; a power stroke costs the
 * paddler who makes it; every bailer bails at the full rate. Players board
 * and land one by one (`seatTransformForHull` says where each sits), and the
 * canoe may leave someone ashore and fetch them later. Any player's action
 * counts for a quest. The night skips only when everyone is asleep. A player
 * at 0 energy fails alone; a capsize fails everyone aboard.
 *
 * Coming and going: a player can be away (`player.connected` false, set with
 * `setConnected`). Nobody is ever removed. An away player keeps their seat or
 * their spot ashore, their backpack and their place in the crew. Their meters
 * stand still, they cannot fail, no command acts for them (`player_away`),
 * their backpack is left alone, and the night skips once everyone who is not
 * away is asleep. A canoe with only away players aboard waits where it is.
 * `setConnected(state, id, true)` gives them their player back. A player may
 * carry a `name` (`setPlayerName`, 12 letters at most).
 *
 * ## Contract
 *
 * - `GameState` is plain JSON. `JSON.stringify(state)` is a save. `step` and
 *   `dispatch` mutate it in place; selectors and world functions never do.
 * - Deterministic: the same seed and the same sequence of `step` and
 *   `dispatch` calls give the same state (`hashState`). No clock, no
 *   `Math.random`, no DOM, no Three.js in here.
 * - Units: metres, seconds, radians. Y up, water rest level y = 0, north is
 *   -z, east is +x. A heading or bearing is 0 at north and grows clockwise
 *   seen from above; forward = (sin heading, 0, -cos heading). For Three.js
 *   use `object.rotation.y = -heading`.
 * - Canoe space (attachment transforms): origin at the hull centre on the
 *   waterline, bow toward -z, starboard +x, up +y.
 * - Time: `state.time` is the world clock in seconds; one day is 1440 s
 *   (16 minutes of day, 8 of night). Sleep and fails jump it.
 *   `state.playedSeconds` only counts stepped time.
 *
 * ## Input
 *
 * `StepInput` is per-frame intent, not key codes: `paddle` and `steer` axes,
 * `powerStroke`, `bail`, `moveX` / `moveY` with `cameraYaw` for
 * camera-relative walking, and `run`. Start from `NEUTRAL_INPUT`.
 *
 * The interact key is context-sensitive: read `selectInteractable(state)` and
 * dispatch the `command` it carries on key press. One press does it, for a
 * node too: `scavenge` rolls the loot and hands it over at once.
 *
 * ## Commands
 *
 * `dispatch(state, command)` returns `{ ok: true, gained, spent }` or
 * `{ ok: false, reason, missing }`. `missing` lists items (with the count
 * still needed), tools, the station, the hull tier, attachments or the flag,
 * so a panel can say "needs hammer" or "needs 3 more plank".
 *
 * | Command | Does |
 * |---|---|
 * | `craft` | Make a recipe `count` times at a station in reach |
 * | `upgrade_hull` | Build the next hull tier (canoe beached, player at it) |
 * | `build_attachment` | Bolt on an attachment (canoe beached, player at it) |
 * | `stow_backpack` | Move the whole backpack into the cargo |
 * | `transfer` / `discard` | Move a stack between backpack and cargo, or drop it |
 * | `eat` / `drink` | Consume one food or drink |
 * | `fill_water` | Scoop dirty water with the bailing can, at the water |
 * | `scavenge` | Scavenge the node in reach, or pick up what it left, in one press |
 * | `sleep` / `wake` | Lie down at a camp, or aboard with the canopy; the night skips once the whole crew has. Get up again |
 * | `board` / `disembark` | Get in the canoe, or step ashore and pull it up |
 * | `talk`, `choose_dialogue_option`, `end_dialogue` | Conversations |
 * | `accept_quest`, `turn_in_quest` | Side quests |
 * | `track_quest` | Follow a quest on this player's own card, or stop (`tracked: false`); up to three (`MAXIMUM_TRACKED`) |
 * | `toggle_lantern`, `set_sail`, `select_tool` | Canoe and tool belt switches |
 * | `claim_rewards` | Collect rewards that did not fit earlier |
 * | `set_difficulty` | Relaxed (0.6 drain) or Standard |
 *
 * ## Selectors (read-only, safe to call every frame)
 *
 * | Selector | Gives |
 * |---|---|
 * | `selectInteractable` | What the interact key would act on, its prompt, the command to send, what it is missing |
 * | `selectCraftableRecipes` | Every recipe: known, craftable, how many, missing inputs, tools and station |
 * | `selectBuildOptions` | The next hull tier and all 19 attachments: built, buildable, missing, transform |
 * | `selectCanoeStats` | Stability, roughness here, cargo, speeds, leak, flood rate, sail factor, fog gear |
 * | `selectActiveQuests` / `selectQuestLog` | Quests with objective text, progress and required count |
 * | `selectCurrentMainQuest` | Id of the main quest in progress, null once the Beacon is lit |
 * | `selectMap` | Islands (discovered or not), markers, bearings with the map table |
 * | `selectTrackedQuestTarget` | Where the tracked quest's next step is in the world, or null |
 * | `selectRespawnPoint` | Where a fail would put the player |
 * | `selectTimeOfDay` | Day, hour, clock text, night flag, whether sleep is allowed |
 * | `selectWeather` | Kind, next kind and when, storm level, wind, rain, visibility |
 * | `selectDialogue` | The open conversation: speaker, text, options |
 * | `selectInventory` | Backpack, cargo, tool belt, key items, stations in reach, pending rewards |
 * | `selectMeters` | Hunger, thirst, energy and its cap, water level, shelter, low warnings |
 *
 * ## World functions (pure, shared with rendering)
 *
 * - `waveHeight(x, z, time, roughness)`, `waveGradient`, `waveNormal`: the water
 *   surface. A sum of the components in `WAVE_TABLE`; the exact formula is on
 *   `waveHeight`, ready to copy into a shader. Pass `state.time` and
 *   `waterRoughnessAt(x, z, state.weather.stormLevel)`.
 * - `terrainHeight(x, z)`: ground height from the island table, the seabed and
 *   the valley walls. Negative is under water.
 * - `groundHeight(x, z)`: where feet stand. The terrain, or the top of a quarry
 *   bench where one is drawn on it. A player on foot is at this height.
 * - `regionAt`, `baseRoughnessAt`, `waterRoughnessAt`, `currentAt`,
 *   `valleyHalfWidth`: the region bands, their roughness and the Narrows current.
 * - `islandAt`, `nearestIsland`, `islandLanding`, `landingBerth`,
 *   `hullGrounding`: islands, their landing beaches, and where a hull touches.
 * - `bearingVector`, `bearingBetween`, `bearingDifference`: bearing maths in
 *   the game's convention.
 * - `attachmentTransformForHull(attachmentId, hullTier)`: where an attachment
 *   sits on a given hull, in canoe space. `seatTransformForHull(hullTier,
 *   seat)`: where a crew member sits (`player.seat`, 0 to 3).
 *
 * ## Events
 *
 * `drainEvents(state)` returns everything since the last call, in order. The
 * `GameEvent` union is the list: items gained, lost or left behind; crafting,
 * eating, drinking; scavenging started, blocked, node depleted; bottles and
 * caches; quest started, advanced, ready, completed; hull and attachment
 * built; weather changed, storm warning, rough water, swamping warning;
 * capsized, exhausted, washed ashore; canoe beached and launched, boarded,
 * landed, slept; region entered, island discovered, turned back by the fog;
 * meter low; dialogue opened and closed; lantern, sail; rain collected, fish
 * caught, planter harvested; rewards pending; autosave requested; game
 * completed.
 *
 * ## Rules worth knowing when building UI
 *
 * - Rough water floods the canoe at 3.5 points per second per point of
 *   (roughness - stability). `selectCanoeStats` has both numbers. Storms add
 *   up to 1 roughness everywhere, easing in over 45 s; `selectWeather` shows
 *   the next weather and when, and a `storm_warning` event fires 90 s ahead.
 * - The fog wall is not a wall: inside the Fog without the lantern mast and
 *   the radio the canoe is turned south until it comes back out
 *   (`state.canoe.lostInFog`, `fog_turned_back` event).
 * - Fail (energy 0 or water level 100): `capsized` or `exhausted`, then
 *   `washed_ashore` with what was lost. A capsize takes everyone aboard and
 *   half of every cargo stack. In a crew, exhaustion takes one player and
 *   half of each of their backpack stacks; alone (or last aboard a floating
 *   canoe) it takes the canoe too, as a capsize does. Power strokes, running,
 *   chopping and bailing are refused below 5 energy, so effort alone never
 *   causes a fail.
 * - Cargo and aboard stations are in reach when aboard, within 8 m of the
 *   canoe, or at a camp on the island where the canoe is beached.
 * - `autosave_requested` events fire on landing and sleeping; the save layer
 *   in `src/save/` adds the timer, and saves by itself when a quest completes
 *   and when a tool joins the belt.
 */

// --- Core -------------------------------------------------------------------
export { createGame, step, drainEvents, hashState, FIXED_STEP, NEUTRAL_INPUT, addPlayer } from './step.ts';
export { setConnected, setPlayerName, cleanPlayerName } from './step.ts';
export { dispatch } from './commands.ts';
// The on-foot step by itself, for a guest's screen to walk its own player ahead of the host's answer (`src/net/walk.ts`).
export { stepOnFoot } from './foot.ts';
export { playerOf, playersAboard, connectedPlayers, eventsFor } from './inventory.ts';

// --- State, input, commands, events -----------------------------------------
export { STATE_VERSION, MAXIMUM_PLAYERS, MAXIMUM_NAME_LENGTH } from './types.ts';
export type {
  GameState, GameOptions, PlayerState, CanoeState, WeatherState, QuestState, NodeState, DialogueState,
  Statistics, ItemStack, Vector3, StepInput, CrewInput, PlayerId, Command, Container, CommandResult, CommandSuccess,
  CommandFailure, FailureReason, Missing, GameEvent, GameEventType, FailCause,
} from './types.ts';

// --- Selectors --------------------------------------------------------------
export {
  selectInteractable, selectCraftableRecipes, selectBuildOptions, selectCanoeStats, selectActiveQuests,
  selectQuestLog, selectCurrentMainQuest, selectMap, selectRespawnPoint, selectTimeOfDay, selectWeather,
  selectDialogue, selectInventory, selectMeters, selectTrackedQuestTarget,
} from './selectors.ts';
export type {
  RecipeAvailability, BuildOptions, CanoeStats, ObjectiveView, QuestView, MapMarker, MapData,
  RespawnPoint, TimeOfDay, WeatherView, DialogueView, InventoryView, Meters, QuestTarget,
} from './selectors.ts';
export type { Interactable } from './interact.ts';
export type { SleepBlock } from './survival.ts';

// --- The crew's chart and each player's quest card --------------------------
// `state.seen` is the fog of war: every cell anyone in the crew has seen, shared, saved, never fogged again.
// `player.trackedQuestIds` is the quests on one player's card, their own pick.
export {
  FOG, SEEN_CELLS, SEEN_LENGTH, emptySeen, fullSeen, cellSeen, cellOf, seenAt, seenCount, revealCircle, chartKnownWaters,
} from './fog.ts';
export { MAXIMUM_TRACKED, defaultTracking } from './tracking.ts';

// --- World functions shared with rendering ----------------------------------
export {
  waveHeight, waveGradient, waveNormal, terrainHeight, groundHeight, regionAt, baseRoughnessAt, waterRoughnessAt,
  currentAt, valleyHalfWidth, islandAt, nearestIsland, islandLanding, landingBerth, hullGrounding,
  bearingVector, bearingBetween, bearingDifference,
} from './world.ts';
export type { Landing } from './world.ts';
export { WAVE_TABLE } from '../data/world.ts';
export type { WaveComponent } from '../data/world.ts';
export { attachmentTransformForHull, seatTransformForHull } from '../data/canoe.ts';
