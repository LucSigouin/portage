/**
 * Which quests each player follows on their quest card.
 *
 * Tracking is each player's own (`PlayerState.trackedQuestIds`), not the
 * crew's. The quests and their progress are shared, but a crew splits up on
 * the islands and each screen has its own card, compass and quest mark: what
 * one player follows says where they are going, and nobody else's card
 * changes when they pick. A player follows up to `MAXIMUM_TRACKED` open
 * quests, in the order they picked them; the first one is the one the world's
 * quest mark points to.
 */
import type { QuestId } from '../data/types.ts';
import { MAIN_QUESTS, QUESTS } from '../data/quests.ts';
import type { GameState, PlayerState } from './types.ts';

/**
 * Three at most: the main line and two side quests is all a player works on
 * at once, and the quest card (top left) holds three with their steps at
 * 1366x768 without reaching the meters.
 */
export const MAXIMUM_TRACKED = 3;

const isOpen = (state: GameState, questId: QuestId): boolean =>
  state.quests[questId]?.status === 'active' || state.quests[questId]?.status === 'ready';

/** The main quest in progress, if any. */
const currentMain = (state: GameState): QuestId | null =>
  MAIN_QUESTS.find((quest) => state.quests[quest.id]?.status === 'active' || state.quests[quest.id]?.status === 'ready')?.id ?? null;

/** What a player who has picked nothing yet follows: the main quest in progress. A new player starts so. */
export function defaultTracking(state: GameState): QuestId[] {
  const main = currentMain(state);
  return main ? [main] : [];
}

export type TrackRefusal = 'unknown_id' | 'quest_not_available' | 'tracking_full';

/**
 * Follow a quest (`tracked` true) or stop following it. `questId` null stops
 * following everything. Only an open quest (given and not handed in) can be
 * followed, and only `MAXIMUM_TRACKED` at once. Following one already followed,
 * or dropping one that is not, changes nothing and is no error.
 */
export function setTracked(state: GameState, player: PlayerState, questId: QuestId | null, tracked: boolean): TrackRefusal | null {
  if (questId === null) {
    player.trackedQuestIds = [];
    return null;
  }
  if (!QUESTS[questId]) return 'unknown_id';
  const list = player.trackedQuestIds;
  if (!tracked) {
    player.trackedQuestIds = list.filter((id) => id !== questId);
    return null;
  }
  if (list.includes(questId)) return null;
  if (!isOpen(state, questId)) return 'quest_not_available';
  // A quest finished since it was picked (or carried in from an old save) holds no place on the card.
  const open = list.filter((id) => isOpen(state, id));
  if (open.length >= MAXIMUM_TRACKED) return 'tracking_full';
  player.trackedQuestIds = [...open, questId];
  return null;
}

/**
 * A quest was handed in or finished by itself. It leaves every card. When it
 * was the main line, the next main quest takes its place on each card that
 * followed it, and on each card that followed nothing at all.
 */
export function afterQuestCompleted(state: GameState, questId: QuestId): void {
  const main = QUESTS[questId]?.kind === 'main' ? currentMain(state) : null;
  for (const player of state.players) {
    const list = player.trackedQuestIds;
    const index = list.indexOf(questId);
    if (main && !list.includes(main) && (index >= 0 || list.length === 0)) {
      player.trackedQuestIds = index >= 0 ? list.map((id) => (id === questId ? main : id)) : [main];
    } else if (index >= 0) {
      player.trackedQuestIds = list.filter((id) => id !== questId);
    }
    // A card left with nothing follows the main line again.
    if (player.trackedQuestIds.length === 0) player.trackedQuestIds = defaultTracking(state);
  }
}

/** A side quest was just given to `actor`: it goes on their card, if their card has room. */
export function afterQuestAccepted(actor: PlayerState, questId: QuestId): void {
  if (actor.trackedQuestIds.length < MAXIMUM_TRACKED && !actor.trackedQuestIds.includes(questId)) {
    actor.trackedQuestIds = [...actor.trackedQuestIds, questId];
  }
}
