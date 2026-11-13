/**
 * The interface model: everything the DOM UI draws, already worded, counted
 * and sorted. View models build it from the selectors; the UI only renders it
 * and sends back the intent attached to whatever was clicked.
 */
import type { AttachmentId, IslandId, ItemId, QuestId, RecipeId, ToolId } from '../../data/index.ts';
import type { InputAction } from '../../settings/index.ts';
import type { PlayerId } from '../../sim/index.ts';
import type { InterfaceIntent, SettingId, SettingValue } from '../intents.ts';
import type { PanelId, ScreenId, SettingsTabId } from '../panels.ts';

export type Tone = 'info' | 'good' | 'warning' | 'danger';

/** A clickable control. `note` says why it is disabled, or adds a detail. */
export interface ButtonModel {
  label: string;
  intent: InterfaceIntent;
  enabled: boolean;
  note: string | null;
}

// --- HUD ---------------------------------------------------------------------

export interface MeterModel {
  id: 'hunger' | 'thirst' | 'energy';
  label: string;
  /** 0 to 100, whole numbers. */
  value: number;
  /** Energy only: the ceiling while starving or parched. 100 otherwise. */
  cap: number;
  low: boolean;
  /** Fill pattern for the patterned-meters setting. */
  pattern: 'stripes' | 'dots' | 'waves';
}

export interface WaterGaugeModel {
  /** False on foot with a dry canoe: nothing to show. */
  visible: boolean;
  /** 0 to 100, whole numbers. 100 capsizes. */
  value: number;
  warning: boolean;
  trend: 'rising' | 'falling' | 'steady';
  /** One line of status, for example "Taking on water". */
  label: string;
}

export interface HotbarSlotModel {
  /** 1 to 5. */
  number: number;
  keyLabel: string;
  toolId: ToolId | null;
  /** The tool as an item, for its icon. Null for an empty slot. */
  itemId: ItemId | null;
  name: string;
  selected: boolean;
  /** Selects the tool, or puts it away when it is already selected. Null for an empty slot. */
  intent: InterfaceIntent | null;
}

export interface ObjectiveRowModel {
  text: string;
  /** "2 / 4", or an empty string for a single step. */
  progressText: string;
  done: boolean;
}

export interface QuestTrackerModel {
  questId: QuestId;
  name: string;
  kind: 'main' | 'side';
  /** True when it only needs handing in. */
  ready: boolean;
  objectives: ObjectiveRowModel[];
}

export interface CompassMarkModel {
  id: string;
  kind: 'cardinal' | 'quest' | 'canoe' | 'respawn' | 'crew';
  label: string;
  /** Crew marks only: the crewmate's toque colour, and their place in the crew (0 to 3). */
  color?: string;
  crewIndex?: number;
  /** Bearing from the player, degrees, 0 = north, clockwise. */
  bearingDegrees: number;
  /** Bearing relative to where the camera looks, -180 to 180, to a hundredth of a degree. 0 is dead ahead. */
  relativeDegrees: number;
  /** "420 m", or an empty string for cardinal points. */
  distanceText: string;
}

export interface CompassModel {
  /** Bearing the camera looks along, degrees, 0 to 360, to a hundredth of a degree. */
  headingDegrees: number;
  /** "N", "NE", ... */
  cardinal: string;
  marks: CompassMarkModel[];
}

export interface PromptModel {
  text: string;
  /** The key that does it. Empty when no key would: the prompt then only tells (a bed by day). */
  keyLabel: string;
  /** `press`: one tap does it. `blocked`: something is missing. */
  mode: 'press' | 'blocked';
}

/** One crew member in the crew list. Built from that player's own state, nothing else. */
export interface CrewRowModel {
  playerId: PlayerId;
  /** The player's name, or "Player 2" from `CREW_MARKS` when they have none. */
  label: string;
  /** The toque colour the look dresses them in, as `#rrggbb`. */
  color: string;
  /** True for the row of the player this screen belongs to. */
  you: boolean;
  /** True for the player whose browser runs the game. Always false outside a shared game. */
  host: boolean;
  /** True while the player is away. Where they are and their meters still hold: both stand still. */
  away: boolean;
  where: 'aboard' | 'ashore' | 'asleep';
  /** "Aboard", "Ashore · Home Knoll", "Asleep · Home Knoll". */
  placeText: string;
  /** "420 m" to a crewmate who is somewhere else. Empty for you and for anyone within a few steps. */
  distanceText: string;
  /** Hunger, thirst, energy: the same numbers that player's own HUD shows. */
  meters: MeterModel[];
  /** "low energy", "low hunger, thirst", or an empty string when nothing is low. */
  lowText: string;
}

export interface HudModel {
  /** Everyone in the crew, in player order. Empty when playing alone: the crew list is not drawn. */
  crew: CrewRowModel[];
  meters: MeterModel[];
  water: WaterGaugeModel;
  hotbar: HotbarSlotModel[];
  tracker: QuestTrackerModel | null;
  compass: CompassModel;
  prompt: PromptModel | null;
  /** "Day 2, 14:05". */
  clockText: string;
  night: boolean;
  /** "Clear, rain in 3 min". */
  weatherText: string;
  stormWarning: boolean;
  /** "The Shallows", or the island name when standing on one. */
  placeText: string;
  /**
   * True while the world names the islands: aboard, or on foot within `SHORE_METRES` (12 m) of open water.
   * Inland, at a camp or among the trees, false. (`shore.ts`; the look draws the names.)
   */
  islandNames: boolean;
  /** Canoe status lines: speed, sail, lantern, rough water. Empty on foot. */
  canoeLines: { text: string; tone: Tone }[];
  /** A one-line tip, when the hints setting is on and one applies. */
  hint: string | null;
  /**
   * How the line to the host is doing, when a guest needs telling: no word from the host. It stands where the tip
   * does, in its place, for as long as it is true, whatever the hints setting. Null for a host and alone.
   */
  lineNote: string | null;
}

export interface ToastModel {
  id: number;
  text: string;
  tone: Tone;
  /** The item a loot toast is about (gained, lost, left behind, made), for its icon. Null otherwise. */
  itemId: ItemId | null;
  /** 1 fresh to 0 about to go. */
  life: number;
}

// --- Lobby and menus ----------------------------------------------------------

export interface LobbyModel {
  title: string;
  tagline: string;
  buttons: ButtonModel[];
}

export interface SaveSlotModel {
  slot: number;
  title: string;
  empty: boolean;
  corrupt: boolean;
  /** "Day 3, 1 h 12 min played, Standard". */
  summary: string;
  /** "Quest 5: A proper edge". */
  questText: string;
  /** "Saved 4 min ago". */
  savedText: string;
  /** True for the slot the running game saves into. */
  current: boolean;
  buttons: ButtonModel[];
}

export type SettingRowModel = { setting: SettingId; label: string; valueText: string } & (
  | { kind: 'slider'; value: number; minimum: number; maximum: number; step: number }
  | { kind: 'choice'; value: SettingValue; options: { value: SettingValue; label: string }[] }
  | { kind: 'toggle'; value: boolean }
);

export interface BindingRowModel {
  action: InputAction;
  label: string;
  /** "Canoe", "On foot" or "Always". */
  contextLabel: string;
  /** Two slots. `keyLabel` is null for an empty slot. */
  slots: { slot: number; keyLabel: string | null; capturing: boolean; rebind: InterfaceIntent; clear: InterfaceIntent | null }[];
  /** True when the action has no key at all. */
  unbound: boolean;
}

/** A line of text the player types: a name, a room code. */
export interface TextFieldModel {
  field: 'name' | 'code';
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  enabled: boolean;
}

export interface ControlLineModel {
  label: string;
  keys: string;
}

// --- Panels --------------------------------------------------------------------

export interface ItemSlotModel {
  itemId: ItemId | null;
  name: string;
  count: number;
  description: string;
  buttons: ButtonModel[];
}

export interface CostRowModel {
  /** The item or tool this row asks for, for its icon. */
  itemId: ItemId;
  name: string;
  have: number;
  need: number;
  enough: boolean;
}

export interface RecipeRowModel {
  recipeId: RecipeId;
  /** The item the recipe makes, for its icon. Null while the recipe is untaught. */
  itemId: ItemId | null;
  name: string;
  description: string;
  /** "2 x Plank". */
  outputText: string;
  /** False until a survivor teaches it. */
  known: boolean;
  inputs: CostRowModel[];
  /** "Needs 3 more plank, hammer", or an empty string when craftable. */
  missingText: string;
  /**
   * Where a missing ingredient comes from, when it comes from nowhere a player would look: dirty water is scooped,
   * and the button for it is in the inventory. An empty string otherwise.
   */
  sourceText: string;
  craft: ButtonModel;
  /** Present when more than one can be made. */
  craftAll: ButtonModel | null;
}

export interface BuildRowModel {
  id: AttachmentId | 'hull';
  name: string;
  description: string;
  built: boolean;
  costs: CostRowModel[];
  missingText: string;
  build: ButtonModel | null;
}

export interface QuestRowModel {
  questId: QuestId;
  name: string;
  description: string;
  kind: 'main' | 'side';
  /** "Active", "Ready to hand in", "On offer", "Done". */
  statusText: string;
  done: boolean;
  tracked: boolean;
  giverText: string;
  objectives: ObjectiveRowModel[];
  /** The items handing it in will give, for their icons. Empty when the reward is not an item, and once the quest is done. */
  rewards: { itemId: ItemId; name: string; count: number }[];
  track: ButtonModel | null;
}

export interface MapIslandModel {
  islandId: IslandId;
  name: string;
  /** Position on the map, 0 to 1 from the west and north edges. */
  left: number;
  top: number;
  /** Size on the map, as shares of its width and height. */
  width: number;
  height: number;
  /** Degrees to rotate the outline, clockwise. */
  rotationDegrees: number;
  /** "NNE, 420 m" with the map table, otherwise an empty string. */
  bearingText: string;
}

export interface MapMarkerModel {
  kind: 'player' | 'canoe' | 'respawn' | 'quest' | 'survivor' | 'crew';
  label: string;
  left: number;
  top: number;
  /** Crew marks only: the crewmate's toque colour, and their place in the crew (0 to 3). */
  color?: string;
  crewIndex?: number;
}

export type PanelModel = { title: string; close: ButtonModel } & (
  | {
    id: 'settings';
    tabs: { tab: SettingsTabId; label: string; selected: boolean; intent: InterfaceIntent }[];
    rows: SettingRowModel[];
    /** Controls tab only. */
    bindings: BindingRowModel[];
    /** "Press a key for Paddle. Esc cancels.", a conflict report, or an empty string. */
    bindingNotice: string;
    resetBindings: ButtonModel | null;
    /** "Version 1.0.185 · 931d4b0": which build this is, for a player to read out. */
    version: string;
  }
  | { id: 'how_to_play'; sections: { heading: string; lines: string[]; controls: ControlLineModel[] }[] }
  | { id: 'credits'; lines: string[]; completed: boolean }
  | { id: 'pause'; buttons: ButtonModel[]; summary: string }
  | { id: 'save_slots'; slots: SaveSlotModel[] }
  | {
    id: 'inventory';
    backpack: { label: string; slots: ItemSlotModel[] };
    cargo: { label: string; slots: ItemSlotModel[]; accessible: boolean };
    tools: { toolId: ToolId; itemId: ItemId; name: string; selected: boolean; intent: InterfaceIntent }[];
    keyItems: { itemId: ItemId; name: string; count: number }[];
    stow: ButtonModel;
    fillWater: ButtonModel;
    /** Rewards that did not fit, with the button that claims them. */
    pendingRewards: { text: string; items: { itemId: ItemId; name: string; count: number }[]; claim: ButtonModel } | null;
    stationsText: string;
  }
  | { id: 'crafting'; stations: { name: string; inReach: boolean; recipes: RecipeRowModel[] }[] }
  | {
    id: 'canoe_builder';
    /** Why nothing can be built right now, or an empty string. */
    blockedText: string;
    statLines: string[];
    hull: BuildRowModel | null;
    attachments: BuildRowModel[];
  }
  | { id: 'quest_log'; groups: { heading: string; quests: QuestRowModel[] }[] }
  | {
    id: 'map';
    fullChart: boolean;
    /** "9 of 15 islands charted". */
    summary: string;
    regions: { name: string; top: number; height: number; roughness: number }[];
    islands: MapIslandModel[];
    markers: MapMarkerModel[];
  }
  | { id: 'dialogue'; speaker: string; text: string; options: ButtonModel[] }
  | {
    id: 'crew_host';
    phase: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed';
    name: TextFieldModel;
    /** How the line to the relay is doing, in one sentence. Empty when there is nothing to say. */
    status: string;
    statusTone: Tone;
    /** The room, once there is one: its code as read aloud ("FHJ-K3M"), the link to send, and the button that copies it. */
    room: { code: string; link: string; copy: ButtonModel } | null;
    lines: string[];
    /** What to do next: open the room, try again, start a game. The first is the one Enter presses. */
    actions: ButtonModel[];
    stop: ButtonModel | null;
  }
  | {
    id: 'crew_join';
    code: TextFieldModel;
    name: TextFieldModel;
    status: string;
    statusTone: Tone;
    lines: string[];
    join: ButtonModel;
    cancel: ButtonModel | null;
  }
);

export interface ConfirmModel {
  title: string;
  message: string;
  accept: ButtonModel;
  cancel: ButtonModel;
}

export interface DebugModel {
  /** False when only the extra lines are wanted. */
  showFrameRate: boolean;
  framesPerSecond: number;
  /** Milliseconds from one frame to the next. */
  frameMilliseconds: number;
  /** Milliseconds of work inside the frame. */
  workMilliseconds: number;
  /** Extra debug lines: the bot's status, the staged shot. */
  lines: string[];
}

/**
 * The built view's slip (`builtview.ts`): what the screen says under the canoe while it holds the new piece.
 * While this is set the panel, the HUD and the notes are put away, and a click anywhere sends `dismiss`.
 */
export interface BuiltModel {
  /** "Built", or "Hull rebuilt". */
  kicker: string;
  /** The piece's name. */
  title: string;
  /** The builder's own line about it. */
  text: string;
  /** How to get the screen back sooner. */
  hint: string;
  dismiss: InterfaceIntent;
}

/** One frame of UI. `update` gets a fresh one every frame. */
export interface InterfaceModel {
  screen: ScreenId;
  /** 0.75 to 1.5, from the accessibility settings. */
  uiScale: number;
  patternedMeters: boolean;
  /** True while the simulation is frozen. */
  paused: boolean;
  lobby: LobbyModel | null;
  hud: HudModel | null;
  toasts: ToastModel[];
  /** The panel that has the keyboard, or null. A confirm dialog sits on top of it. */
  panel: PanelModel | null;
  /** Ids of every open panel, bottom to top. */
  openPanels: PanelId[];
  confirm: ConfirmModel | null;
  /** Set while the built view holds the screen. */
  built: BuiltModel | null;
  debug: DebugModel | null;
}
