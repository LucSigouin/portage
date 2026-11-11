/** Toasts: what just happened, in a line. Built from the rules engine's events. */
import {
  ATTACHMENTS, BOTTLES, HULL_TIERS, ISLANDS_BY_ID, NODES_BY_ID, QUESTS, RECIPES, REGIONS_BY_ID, WEATHER,
} from '../../data/index.ts';
import type { GameEvent, GameState } from '../../sim/index.ts';
import { selectTimeOfDay } from '../../sim/index.ts';
import { countedName, itemName, needsText } from './format.ts';
import type { ToastModel, Tone } from './types.ts';

export interface ToastInput {
  text: string;
  tone: Tone;
}

const toast = (text: string, tone: Tone = 'info'): ToastInput => ({ text, tone });

/** One event as a toast, or null when it needs no words (the HUD already shows it). */
export function toastForEvent(event: GameEvent, state: GameState): ToastInput | null {
  switch (event.type) {
    case 'item_gained':
      if (event.container === 'belt') return toast(`New tool: ${itemName(event.itemId)}`, 'good');
      if (event.container === 'key_items') return toast(`Found: ${itemName(event.itemId)}`, 'good');
      return toast(`+${event.count} ${itemName(event.itemId)}`);
    case 'item_lost':
      return toast(`-${event.count} ${itemName(event.itemId)}`, 'warning');
    case 'item_left_behind':
      return toast(`No room: ${countedName(event.itemId, event.count)} left at the ${NODES_BY_ID[event.nodeId].name.toLowerCase()}`, 'warning');
    case 'crafted':
      return toast(`Made ${countedName(RECIPES[event.recipeId].output.itemId, RECIPES[event.recipeId].output.count * event.count)}`, 'good');
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
    // The HUD, the prompt or the dialogue panel already shows these.
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
 */
export function toastsFromEvents(events: readonly GameEvent[], state: GameState): ToastInput[] {
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
      toasts.push(toast(`+${gains.get(event.itemId)} ${itemName(event.itemId)}`));
      continue;
    }
    const built = toastForEvent(event, state);
    if (built) toasts.push(built);
  }
  return toasts;
}

export const TOAST_SECONDS: Readonly<Record<Tone, number>> = { info: 3.5, good: 5, warning: 5, danger: 7 };
export const MAXIMUM_TOASTS = 6;

/** The toasts on screen. Runs on real time, so they fade while the game is paused too. */
export class ToastQueue {
  private entries: { id: number; text: string; tone: Tone; seconds: number; total: number }[] = [];
  private nextId = 1;

  add(input: ToastInput): void {
    // The same line again restarts its clock instead of stacking up.
    const existing = this.entries.find((entry) => entry.text === input.text);
    if (existing) {
      existing.seconds = existing.total;
      return;
    }
    const total = TOAST_SECONDS[input.tone];
    this.entries.push({ id: this.nextId, text: input.text, tone: input.tone, seconds: total, total });
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

  /** Oldest first. */
  models(): ToastModel[] {
    return this.entries.map((entry) => ({
      id: entry.id, text: entry.text, tone: entry.tone, life: Math.round((entry.seconds / entry.total) * 10) / 10,
    }));
  }
}
