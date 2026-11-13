import type {
  AttachmentId, BottleId, Difficulty, FlagId, IslandId, ItemAmount, ItemId, NodeId, NpcId, QuestId,
  QuestStatus, RecipeId, RegionId, StationId, ToolId, WeatherKind,
} from '../data/types.ts';

/** Bump when the shape of GameState changes; add a migration in `src/save/`. */
export const STATE_VERSION = 3;

/** The crew: one to four players share the canoe. */
export const MAXIMUM_PLAYERS = 4;

/** 0 to 3. Stable for the life of a player; also their index into a crew's inputs. */
export type PlayerId = number;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** A stack in the backpack or the cargo. */
export type ItemStack = ItemAmount;

export interface GameOptions {
  difficulty?: Difficulty;
  /** Players in the canoe at the start, 1 to 4. Default 1. */
  crew?: number;
}

/**
 * The input for one step: a single `StepInput` drives player 0, or a list
 * indexed by player id drives the crew. A player with no entry holds still.
 */
export type CrewInput = StepInput | readonly (StepInput | undefined)[];

/**
 * Per-frame analog intent. Never key codes: the client maps keys, sticks or
 * touch onto these. Every field is optional in spirit; use `NEUTRAL_INPUT` as
 * the base.
 */
export interface StepInput {
  /** Canoe: -1 back-paddle to +1 paddle. */
  paddle: number;
  /** Canoe: -1 turn to port to +1 turn to starboard. */
  steer: number;
  /** Canoe: hold for a power stroke (costs energy). */
  powerStroke: boolean;
  /** Canoe: hold to bail. Paddling stops while bailing. */
  bail: boolean;
  /** On foot: strafe, -1 left to +1 right of the camera. */
  moveX: number;
  /** On foot: -1 toward the camera to +1 away from it. */
  moveY: number;
  /** On foot: hold to run (costs energy). */
  run: boolean;
  /**
   * On foot: nothing was heard from this player for this step (a guest whose walk has not reached the host yet).
   * They stay exactly as they are, speed and all, instead of slowing down as if they had let go of the keys.
   */
  hold?: boolean;
  /** Bearing the camera looks along, radians (0 = north, clockwise). */
  cameraYaw: number;
}

export interface NodeState {
  /**
   * Per action: the world time it is available again. null = gone for good.
   * A node with no entry in `GameState.nodes` has never been touched.
   */
  readyAt: (number | null)[];
  /** Loot that did not fit, waiting to be picked up. */
  leftover: ItemStack[];
}

/** Longest name a player may carry, in letters. The crew list has room for this many. */
export const MAXIMUM_NAME_LENGTH = 12;

/** A walker's way of going: see `PlayerState.gait`. */
export interface Gait {
  speed: number;
  x: number;
  z: number;
}

export interface PlayerState {
  id: PlayerId;
  /** What the player typed as their name, at most `MAXIMUM_NAME_LENGTH` letters. Empty: show the crew mark's label. */
  name: string;
  /**
   * False while the player is away: their screen closed or never opened. They keep
   * their seat or their spot ashore, their backpack and their place in the crew; their
   * meters stand still, they cannot fail and the night does not wait for them.
   * Change it only through `setConnected`.
   */
  connected: boolean;
  mode: 'canoe' | 'foot';
  /** Seat in the canoe while aboard, 0 to 3 (see `seatTransformForHull`). null on foot. */
  seat: number | null;
  position: Vector3;
  /** Bearing the player faces, radians. */
  heading: number;
  /**
   * On foot: the walking speed along the heading, metres per second, and where the last step on foot left the player.
   * A player found anywhere else was put there by something other than walking (a landing, a fail, a load) and
   * starts from a stand. Absent until the first step on foot, and in saves from before it existed.
   */
  gait?: Gait;
  hunger: number;
  thirst: number;
  energy: number;
  backpack: ItemStack[];
  /** The tool in this player's hand, picked from the crew's tools (`GameState.tools`). */
  selectedTool: ToolId | null;
  /** Island the player stands on, when on foot. */
  islandId: IslandId | null;
  regionId: RegionId;
  running: boolean;
  /** True while a power stroke, run or bail is draining energy. */
  exerting: boolean;
  /** True while this player is paddling the canoe, forward or back. */
  paddling: boolean;
  /** True while this player is bailing the canoe. */
  bailing: boolean;
  /** Lying down at a bed, waiting for the rest of the crew. The night skips once everyone is. */
  asleep: boolean;
  /** The conversation this player is in. It holds them still, nobody else. */
  dialogue: DialogueState | null;
}

export interface CanoeState {
  /** Hull centre. y follows the water surface, or the ground when beached. */
  position: Vector3;
  heading: number;
  /** Forward speed along the heading, metres per second. Negative when backing. */
  speed: number;
  /** Radians, positive bow up. For rendering. */
  pitch: number;
  /** Radians, positive starboard down. For rendering. */
  roll: number;
  /** 0 to 100. 100 capsizes. */
  waterLevel: number;
  hullTier: number;
  attachments: AttachmentId[];
  cargo: ItemStack[];
  /** Touching ground, or pulled up by the player. */
  beached: boolean;
  /** Where the canoe last touched ground. The canopy respawns here. */
  lastBeached: { x: number; z: number; heading: number; islandId: IslandId };
  sailRaised: boolean;
  lanternLit: boolean;
  /** True while anyone aboard is bailing. */
  bailing: boolean;
  /** True while the fog is turning the canoe around. */
  lostInFog: boolean;
  /** True while rough water is coming over the side. */
  takingWater: boolean;
  swampWarned: boolean;
  /** Fractions toward the next clean water, fish. */
  rainProgress: number;
  fishProgress: number;
}

export interface WeatherState {
  kind: WeatherKind;
  /** Seconds until `nextKind` takes over. The sky shows what is coming. */
  secondsRemaining: number;
  nextKind: WeatherKind;
  nextSeconds: number;
  /** 0 to 1. Eases in and out; scales the storm roughness bonus. */
  stormLevel: number;
  /** Bearing the wind blows toward, radians. It swings to a new bearing, it never jumps. */
  windDirection: number;
  /**
   * Radians the wind still has to swing, signed (positive is clockwise). 0 when it is steady.
   * A save from before the wind swung has no such number: missing reads as 0, so it loads as it is.
   */
  windTurn?: number;
  /** Metres per second, eased toward `windTarget`. */
  windSpeed: number;
  windTarget: number;
  stormWarned: boolean;
  /** Weather changes since the last storm ended. Storms need a gap. */
  changesSinceStorm: number;
}

export interface QuestState {
  status: QuestStatus;
  /** One number per objective. An objective is done at its required count. */
  progress: number[];
}

export interface DialogueState {
  npcId: NpcId;
  nodeId: string;
}

export interface Statistics {
  fails: number;
  itemsCrafted: number;
  nodesHarvested: number;
  smokedCount: number;
  cachesHauled: number;
  distancePaddled: number;
  distanceWalked: number;
}

/**
 * The whole game. Plain JSON data: no classes, functions, Maps or Sets, no
 * undefined, NaN or Infinity. `JSON.stringify(state)` is a complete save.
 */
export interface GameState {
  version: number;
  seed: number;
  /** Seeded generator state. Advance only through `src/sim/random.ts`. */
  randomState: number;
  difficulty: Difficulty;
  /** Fixed steps simulated. */
  tick: number;
  /** Frame time not yet simulated, seconds. */
  stepAccumulator: number;
  /** World clock, seconds since midnight of day 1. Sleep and fails jump it. */
  time: number;
  /** Seconds actually played (stepped). */
  playedSeconds: number;
  /** The crew, one to four, always in id order. Player 0 is there from the start. */
  players: PlayerState[];
  canoe: CanoeState;
  weather: WeatherState;
  /** Sparse: only nodes that have been touched. */
  nodes: Record<NodeId, NodeState>;
  quests: Record<QuestId, QuestState>;
  trackedQuestId: QuestId | null;
  /** The crew's tool belt: a tool anyone finds, makes or is given is everyone's at once. Takes no slot, never lost. */
  tools: ToolId[];
  /** Unique finds and quest items, held by the crew as one. Take no slot, never lost. */
  keyItems: Partial<Record<ItemId, number>>;
  flags: Partial<Record<FlagId, boolean>>;
  discoveredIslands: IslandId[];
  /**
   * The places the crew has reached (`data/places.ts`): each gets its arrival card once. A save from before the
   * cards has no such list: `sim/places.ts` then works out what that crew already knows.
   */
  reachedPlaces?: string[];
  bottlesFound: BottleId[];
  /** Island of the last camp slept at. */
  respawnCampIslandId: IslandId;
  /** Rewards that did not fit. Collected with `claim_rewards`. */
  pendingRewards: ItemStack[];
  statistics: Statistics;
  /** Drained by the client each frame with `drainEvents`. */
  events: GameEvent[];
}

// --- Commands ---------------------------------------------------------------

export type Container = 'backpack' | 'cargo';

/** Discrete actions of one player. Send with `dispatch(state, command, playerId)`. */
export type Command =
  | { type: 'craft'; recipeId: RecipeId; count?: number }
  | { type: 'upgrade_hull' }
  | { type: 'build_attachment'; attachmentId: AttachmentId }
  | { type: 'stow_backpack' }
  | { type: 'transfer'; from: Container; itemId: ItemId; count: number }
  | { type: 'discard'; from: Container; itemId: ItemId; count: number }
  | { type: 'eat'; itemId: ItemId }
  | { type: 'drink'; itemId: ItemId }
  | { type: 'fill_water'; count: number }
  /** Scavenge, or pick up what was left, at the node the interact key points at. One press, done. */
  | { type: 'scavenge' }
  | { type: 'sleep' }
  /** Get up again while waiting for the rest of the crew to sleep. */
  | { type: 'wake' }
  | { type: 'board' }
  | { type: 'disembark' }
  | { type: 'talk'; npcId: NpcId }
  | { type: 'choose_dialogue_option'; optionIndex: number }
  | { type: 'end_dialogue' }
  | { type: 'accept_quest'; questId: QuestId }
  | { type: 'turn_in_quest'; questId: QuestId }
  | { type: 'track_quest'; questId: QuestId | null }
  | { type: 'toggle_lantern' }
  | { type: 'select_tool'; toolId: ToolId | null }
  | { type: 'set_sail'; raised: boolean }
  | { type: 'claim_rewards' }
  | { type: 'set_difficulty'; difficulty: Difficulty };

export type FailureReason =
  | 'unknown_id'
  | 'recipe_locked'
  | 'missing_requirements'
  | 'inventory_full'
  | 'hull_at_maximum'
  | 'already_built'
  | 'canoe_not_beached'
  | 'not_at_canoe'
  | 'not_aboard'
  | 'already_aboard'
  | 'no_shore_in_reach'
  | 'item_not_held'
  | 'not_edible'
  | 'not_drinkable'
  | 'no_water_in_reach'
  | 'no_bed_in_reach'
  | 'not_tired'
  | 'too_tired'
  | 'nothing_in_reach'
  | 'npc_out_of_reach'
  | 'no_dialogue_open'
  | 'invalid_option'
  | 'in_dialogue'
  | 'quest_not_available'
  | 'quest_not_ready'
  | 'tool_not_owned'
  | 'nothing_to_claim'
  /** The command was sent for a player who is away. */
  | 'player_away'
  | 'invalid_amount';

/**
 * What a failed command still needs. The UI turns this into
 * "needs hammer" or "needs 3 more plank".
 */
export interface Missing {
  /** Items short, with the count still needed. */
  items: ItemAmount[];
  tools: ToolId[];
  station: StationId | null;
  /** Hull tier required, when the hull is too small. */
  hullTier: number | null;
  attachments: AttachmentId[];
  flag: FlagId | null;
}

export interface CommandSuccess {
  ok: true;
  /** Items the command put in the player's hands, if any. */
  gained: ItemAmount[];
  /** Items the command used up, if any. */
  spent: ItemAmount[];
}

export interface CommandFailure {
  ok: false;
  reason: FailureReason;
  missing: Missing | null;
}

export type CommandResult = CommandSuccess | CommandFailure;

// --- Events -----------------------------------------------------------------

export type FailCause = 'capsized' | 'exhausted';

/**
 * Things that happened, for sounds, toasts and effects. An event one player
 * caused or suffered carries their `playerId`; an event about the canoe, the
 * quests or the world carries none and is for the whole crew.
 */
export type GameEvent = GameEventBody & { playerId?: PlayerId };

type GameEventBody =
  | { type: 'item_gained'; itemId: ItemId; count: number; container: Container | 'belt' | 'key_items' }
  | { type: 'item_lost'; itemId: ItemId; count: number }
  | { type: 'item_left_behind'; nodeId: NodeId; itemId: ItemId; count: number }
  | { type: 'crafted'; recipeId: RecipeId; count: number }
  | { type: 'ate'; itemId: ItemId }
  | { type: 'drank'; itemId: ItemId }
  | { type: 'harvest_started'; nodeId: NodeId; actionIndex?: number }
  | { type: 'harvest_blocked'; nodeId: NodeId; missing: Missing }
  | { type: 'node_depleted'; nodeId: NodeId }
  | { type: 'bottle_found'; bottleId: BottleId }
  | { type: 'cache_hauled'; nodeId: NodeId }
  | { type: 'quest_started'; questId: QuestId }
  | { type: 'quest_advanced'; questId: QuestId; objectiveIndex: number; progress: number; required: number }
  | { type: 'quest_ready'; questId: QuestId }
  | { type: 'quest_completed'; questId: QuestId }
  | { type: 'hull_upgraded'; tier: number }
  | { type: 'attachment_built'; attachmentId: AttachmentId }
  | { type: 'weather_changed'; kind: WeatherKind }
  | { type: 'storm_warning'; secondsUntilStorm: number }
  | { type: 'rough_water'; roughness: number; stability: number }
  | { type: 'swamping_warning'; waterLevel: number }
  | { type: 'capsized' }
  | { type: 'exhausted' }
  | { type: 'washed_ashore'; cause: FailCause; islandId: IslandId; lost: ItemAmount[] }
  | { type: 'canoe_beached'; islandId: IslandId | null }
  | { type: 'canoe_launched' }
  | { type: 'boarded' }
  | { type: 'landed'; islandId: IslandId | null }
  | { type: 'slept'; hours: number; islandId: IslandId | null }
  | { type: 'region_entered'; regionId: RegionId }
  | { type: 'island_discovered'; islandId: IslandId }
  /** The crew got to a place for the first time (`sim/places.ts`). Crew-wide: it carries no `playerId`. */
  | { type: 'place_reached'; placeId: string }
  | { type: 'fog_turned_back' }
  | { type: 'meter_low'; meter: 'hunger' | 'thirst' | 'energy' }
  | { type: 'dialogue_opened'; npcId: NpcId }
  | { type: 'dialogue_closed'; npcId: NpcId }
  | { type: 'lantern_toggled'; lit: boolean }
  | { type: 'sail_changed'; raised: boolean }
  | { type: 'rain_collected' }
  | { type: 'fish_caught' }
  | { type: 'planter_harvested' }
  | { type: 'rewards_pending' }
  | { type: 'autosave_requested'; reason: 'landing' | 'sleeping' }
  | { type: 'game_completed' }
  /** The crew changed: `who` joined, went away or came back. Crew-wide: it carries no `playerId`. */
  | { type: 'crew_changed'; who: PlayerId; change: 'joined' | 'away' | 'back' };

export type GameEventType = GameEvent['type'];
