/** Toasts: what just happened, in a line. Built from the rules engine's events. */
import {
  ATTACHMENTS, BOTTLES, HULL_TIERS, ISLANDS_BY_ID, NODES_BY_ID, QUESTS, RECIPES, REGIONS_BY_ID, WEATHER,
} from '../../data/index.ts';
import type { ItemId } from '../../data/index.ts';
import type { GameEvent, GameState, PlayerId } from '../../sim/index.ts';
import { selectTimeOfDay } from '../../sim/index.ts';
import { countedName, itemName, needsText } from './format.ts';
import { crewName } from './hud.ts';
import { takeBackAction } from './takeback.ts';
import type { ToastModel, Tone } from './types.ts';

export interface ToastInput {
  text: string;
  tone: Tone;
  /** The item a loot toast is about, for its icon. */
  itemId?: ItemId;
  /** The note of a drop made by hand: it offers to take that drop back, by its number (`takeback.ts`). */
  takeBack?: number;
  /** The drops this note says are back: their own notes go. */
  undoes?: number[];
}

const toast = (text: string, tone: Tone = 'info', itemId?: ItemId): ToastInput => (itemId ? { text, tone, itemId } : { text, tone });

/**
 * True for an event whose note belongs to the whole crew, whoever caused it. Tools and key items
 * are the crew's the moment one player has them, so the news is everyone's.
 */
export function isCrewNote(event: GameEvent): boolean {
  return event.type === 'item_gained' && (event.container === 'belt' || event.container === 'key_items');
}

/**
 * Who a crew note is about, as the reader sees it: "You", or the finder's label. Null when playing
 * alone (there is nobody else to tell apart) and when the event names no player.
 */
function finderName(event: GameEvent, state: GameState, readerId: PlayerId): string | null {
  if (state.players.length < 2 || event.playerId === undefined) return null;
  return event.playerId === readerId ? 'You' : crewName(state, event.playerId);
}

/**
 * One event as a toast, or null when it needs no words (the HUD already shows it).
 * `readerId` is the player reading it. `made` is true for a tool that came off a bench this frame.
 */
export function toastForEvent(event: GameEvent, state: GameState, readerId: PlayerId = 0, made = false): ToastInput | null {
  switch (event.type) {
    case 'item_gained': {
      const finder = isCrewNote(event) ? finderName(event, state, readerId) : null;
      if (event.container === 'belt') {
        return toast(finder
          ? `${finder} ${made ? 'made' : 'found'} a new tool: ${itemName(event.itemId)}`
          : `New tool: ${itemName(event.itemId)}`, 'good', event.itemId);
      }
      if (event.container === 'key_items') {
        return toast(`${finder ? `${finder} found` : 'Found'}: ${itemName(event.itemId)}`, 'good', event.itemId);
      }
      return toast(`+${event.count} ${itemName(event.itemId)}`, 'info', event.itemId);
    }
    case 'item_lost': {
      const lost = toast(`-${event.count} ${itemName(event.itemId)}`, 'warning', event.itemId);
      return event.dropId === undefined ? lost : { ...lost, takeBack: event.dropId };
    }
    case 'item_left_behind':
      return toast(`No room: ${countedName(event.itemId, event.count)} left at the ${NODES_BY_ID[event.nodeId].name.toLowerCase()}`, 'warning', event.itemId);
    case 'crafted': {
      const output = RECIPES[event.recipeId].output;
      return toast(`Made ${countedName(output.itemId, output.count * event.count)}`, 'good', output.itemId);
    }
    case 'harvest_blocked':
      return toast(`${NODES_BY_ID[event.nodeId].name}: ${needsText(event.missing).toLowerCase()}`, 'warning');
    case 'bottle_found':
      return toast(`${BOTTLES[event.bottleId].name} (${state.bottlesFound.length} of 10): "${BOTTLES[event.bottleId].text}"`, 'good');
    case 'cache_hauled':
      return toast('Hauled up a sunken cache', 'good');
    case 'quest_started':
      return toast(`New quest: ${QUESTS[event.questId].name}`, 'good');
    case 'quest_advanced':
      return event.progress >= event.required
        ? toast(`Done: ${QUESTS[event.questId].objectives[event.objectiveIndex].text}`, 'good')
        : null;
    case 'quest_ready':
      return toast(`Ready to hand in: ${QUESTS[event.questId].name}`, 'good');
    case 'quest_completed':
      return toast(`Quest complete: ${QUESTS[event.questId].name}`, 'good');
    case 'hull_upgraded':
      return toast(`Hull rebuilt: ${HULL_TIERS[event.tier].name}`, 'good');
    case 'attachment_built':
      return toast(`Built: ${ATTACHMENTS[event.attachmentId].name}`, 'good');
    case 'weather_changed':
      return toast(`Weather: ${WEATHER[event.kind].name.toLowerCase()}`, event.kind === 'storm' ? 'danger' : 'info');
    case 'storm_warning':
      return toast(`Storm in ${Math.round(event.secondsUntilStorm)} s. Get ashore.`, 'danger');
    case 'rough_water':
      return toast(`Rough water (${event.roughness.toFixed(1)}) against stability ${event.stability}. She is taking on water.`, 'danger');
    case 'swamping_warning':
      return toast('Nearly swamped. Bail, or land.', 'danger');
    case 'capsized':
      return toast('Capsized.', 'danger');
    case 'exhausted':
      return toast('You collapse, exhausted.', 'danger');
    case 'washed_ashore': {
      const lost = event.lost.map((stack) => countedName(stack.itemId, stack.count)).join(', ');
      return toast(`Washed ashore on ${ISLANDS_BY_ID[event.islandId].name}.${lost ? ` Lost: ${lost}.` : ' Nothing lost.'}`, 'danger');
    }
    case 'landed':
      return event.islandId ? toast(`Ashore on ${ISLANDS_BY_ID[event.islandId].name}`) : null;
    case 'slept':
      return toast(`Slept ${Math.round(event.hours)} h. Day ${selectTimeOfDay(state).day}.`);
    case 'region_entered':
      return toast(`Entering ${REGIONS_BY_ID[event.regionId].name}`);
    case 'island_discovered':
      return toast(`Charted: ${ISLANDS_BY_ID[event.islandId].name}`, 'good');
    case 'fog_turned_back':
      return toast('The fog turns you around. It takes a lantern mast and a radio to cross.', 'warning');
    case 'meter_low':
      return toast({ hunger: 'Hungry.', thirst: 'Thirsty.', energy: 'Worn out.' }[event.meter], 'warning');
    case 'lantern_toggled':
      return toast(event.lit ? 'Lantern lit' : 'Lantern out');
    case 'sail_changed':
      return toast(event.raised ? 'Sail raised' : 'Sail lowered');
    case 'rain_collected':
      return toast('The rain catcher filled a jar');
    case 'fish_caught':
      return toast('The fishing rig landed a fish');
    case 'planter_harvested':
      return toast('The planter is ready: berries and roots');
    case 'rewards_pending':
      return toast('No room for the reward. Claim it from the inventory.', 'warning');
    case 'game_completed':
      return toast('The Beacon is lit.', 'good');
    case 'spot_marked':
      // Your own mark is on your map already: the note is for the rest of the crew.
      return event.who === readerId ? null : toast(`${crewName(state, event.who)} marked a spot on the map`);
    case 'crew_changed': {
      // Your own coming and going is no news to you.
      if (event.who === readerId) return null;
      const name = crewName(state, event.who);
      return toast({ joined: `${name} joined the crew`, away: `${name} is away`, back: `${name} is back` }[event.change]);
    }
    // The HUD, the prompt, the dialogue panel or the arrival card (`arrival.ts`) already shows these.
    case 'place_reached':
    case 'ate':
    case 'drank':
    case 'harvest_started':
    case 'node_depleted':
    case 'canoe_beached':
    case 'canoe_launched':
    case 'boarded':
    case 'dialogue_opened':
    case 'dialogue_closed':
    case 'autosave_requested':
      return null;
  }
}

/**
 * A frame's events as toasts. Gains of the same item add up into one line,
 * and what a capsize took is told once, by the washed-ashore toast.
 * `readerId` is the player reading them: it only changes how a crew note names its finder.
 * `frame` is everything that happened this frame, when `events` is only the part one player hears.
 */
export function toastsFromEvents(
  events: readonly GameEvent[], state: GameState, readerId: PlayerId = 0, frame: readonly GameEvent[] = events,
): ToastInput[] {
  // A tool that a recipe turned out this frame was made, not found. The bench note is the maker's
  // own, so it is looked for in the whole frame, not in what this reader hears.
  const madeBy = new Set<string>();
  for (const event of frame) {
    if (event.type === 'crafted') madeBy.add(`${event.playerId}:${RECIPES[event.recipeId].output.itemId}`);
  }
  const washedAshore = events.some((event) => event.type === 'washed_ashore');
  const gains = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'item_gained' && (event.container === 'backpack' || event.container === 'cargo')) {
      gains.set(event.itemId, (gains.get(event.itemId) ?? 0) + event.count);
    }
  }
  const toasts: ToastInput[] = [];
  const told = new Set<string>();
  for (const event of events) {
    if (event.type === 'item_lost' && washedAshore) continue;
    if (event.type === 'item_gained' && gains.has(event.itemId)) {
      if (told.has(event.itemId)) continue;
      told.add(event.itemId);
      const gained = toast(`+${gains.get(event.itemId)} ${itemName(event.itemId)}`, 'info', event.itemId);
      // A drop taken back: the note that offered it goes as this one comes.
      const undoes = events.flatMap((other) => (other.type === 'item_gained' && other.itemId === event.itemId && other.dropId !== undefined ? [other.dropId] : []));
      toasts.push(undoes.length > 0 ? { ...gained, undoes } : gained);
      continue;
    }
    const made = event.type === 'item_gained' && madeBy.has(`${event.playerId}:${event.itemId}`);
    const built = toastForEvent(event, state, readerId, made);
    if (built) toasts.push(built);
  }
  return toasts;
}

/**
 * The notes one player reads this frame: their own, the ones nobody in particular caused, and
 * the crew's (a new tool, a key item), whoever found it.
 */
export function toastsForPlayer(events: readonly GameEvent[], state: GameState, playerId: PlayerId): ToastInput[] {
  const heard = events.filter((event) => event.playerId === undefined || event.playerId === playerId || isCrewNote(event));
  return toastsFromEvents(heard, state, playerId, events);
}

export const TOAST_SECONDS: Readonly<Record<Tone, number>> = { info: 3.5, good: 5, warning: 5, danger: 7 };
export const MAXIMUM_TOASTS = 6;

/** The toasts on screen. Runs on real time, so they fade while the game is paused too. */
export class ToastQueue {
  private entries: { id: number; text: string; tone: Tone; itemId: ItemId | null; seconds: number; total: number; takeBack: number | null }[] = [];
  private nextId = 1;

  add(input: ToastInput): void {
    // A drop came back: its own note, with its offer, is done.
    const undoes = input.undoes;
    if (undoes) this.entries = this.entries.filter((entry) => entry.takeBack === null || !undoes.includes(entry.takeBack));
    // The same line again restarts its clock instead of stacking up. A drop's note is its own: each has its own way back.
    const existing = input.takeBack === undefined ? this.entries.find((entry) => entry.text === input.text && entry.takeBack === null) : undefined;
    if (existing) {
      existing.seconds = existing.total;
      return;
    }
    const total = TOAST_SECONDS[input.tone];
    this.entries.push({
      id: this.nextId, text: input.text, tone: input.tone, itemId: input.itemId ?? null, seconds: total, total, takeBack: input.takeBack ?? null,
    });
    this.nextId += 1;
    if (this.entries.length > MAXIMUM_TOASTS) this.entries.splice(0, this.entries.length - MAXIMUM_TOASTS);
  }

  addAll(inputs: readonly ToastInput[]): void {
    for (const input of inputs) this.add(input);
  }

  update(frameSeconds: number): void {
    for (const entry of this.entries) entry.seconds -= frameSeconds;
    this.entries = this.entries.filter((entry) => entry.seconds > 0);
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Oldest first. `standing` says whether a drop may still be taken back (`standingDrop`): a note offers it only
   * while it may, and the newest such note has the key. Left out: no note offers anything.
   */
  models(standing?: (dropId: number) => boolean): ToastModel[] {
    const offering = standing ? this.entries.filter((entry) => entry.takeBack !== null && standing(entry.takeBack)) : [];
    const newest = offering.at(-1);
    return this.entries.map((entry) => ({
      id: entry.id, text: entry.text, tone: entry.tone, itemId: entry.itemId,
      life: Math.round((entry.seconds / entry.total) * 10) / 10,
      ...(entry.takeBack !== null && offering.includes(entry) ? { action: takeBackAction(entry.takeBack, entry === newest) } : {}),
    }));
  }
}
