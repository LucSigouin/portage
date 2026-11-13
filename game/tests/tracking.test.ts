/**
 * Several quests on the card (Luc's round 2 list): each player follows up to three open quests, their own pick.
 * Track, untrack, a full card, finishing a quest, a crew, the wire, and an old save's one tracked quest.
 */
import { describe, expect, it } from 'vitest';
import { NPCS, ISLANDS_BY_ID, spotPosition } from '../src/data/index.ts';
import { readCommand } from '../src/net/index.ts';
import { PROTOCOL_VERSION } from '../src/net/messages.ts';
import { deserialize } from '../src/save/index.ts';
import { MAXIMUM_TRACKED, addPlayer, dispatch, selectActiveQuests, selectTrackedQuestTarget } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { buildHudModel, buildQuestLogPanel, TRACKING_FULL_NOTE } from '../src/client/viewmodels/index.ts';
import { createDefaultSettings } from '../src/settings/index.ts';
import { createRig } from './net/rig.ts';
import { newGame, run, standOn, teleport } from './support.ts';

const DEFAULT_SETTINGS = createDefaultSettings();

const liveSaves = import.meta.glob<string>('./fixtures/save-live-*.json', { eager: true, query: '?raw', import: 'default' });

/** A game with the main line and three side quests open, nobody following any side quest. */
function openSideQuests(crew = 1): GameState {
  const state = newGame(7, { crew });
  for (const questId of ['odile_windfall', 'tink_hot_work', 'wren_bell_rope'] as const) state.quests[questId].status = 'active';
  return state;
}

const card = (state: GameState, playerId = 0): string[] => state.players.find((player) => player.id === playerId)!.trackedQuestIds;

describe('the card', () => {
  it('holds three: a new game follows the main line, and up to two more go on after it', () => {
    expect(MAXIMUM_TRACKED).toBe(3);
    const state = openSideQuests();
    expect(card(state)).toEqual(['bail_out']);
    expect(dispatch(state, { type: 'track_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(dispatch(state, { type: 'track_quest', questId: 'tink_hot_work' }).ok).toBe(true);
    expect(card(state)).toEqual(['bail_out', 'odile_windfall', 'tink_hot_work']);
    // In the order picked, first in the quest views and on the HUD.
    expect(selectActiveQuests(state).slice(0, 3).map((quest) => [quest.questId, quest.tracked])).toEqual([
      ['bail_out', true], ['odile_windfall', true], ['tink_hot_work', true],
    ]);
    expect(buildHudModel(state, DEFAULT_SETTINGS, 0).trackers.map((tracker) => tracker.questId)).toEqual(['bail_out', 'odile_windfall', 'tink_hot_work']);
  });

  it('refuses a fourth, and says why', () => {
    const state = openSideQuests();
    dispatch(state, { type: 'track_quest', questId: 'odile_windfall' });
    dispatch(state, { type: 'track_quest', questId: 'tink_hot_work' });
    expect(dispatch(state, { type: 'track_quest', questId: 'wren_bell_rope' })).toMatchObject({ ok: false, reason: 'tracking_full' });
    expect(card(state)).toEqual(['bail_out', 'odile_windfall', 'tink_hot_work']);
    // Following one already on the card is no error and changes nothing.
    expect(dispatch(state, { type: 'track_quest', questId: 'tink_hot_work' }).ok).toBe(true);
    expect(card(state)).toHaveLength(3);
    // The quest log greys the Track buttons out and says the card is full; Untrack stays.
    const rows = buildQuestLogPanel(state).groups.flatMap((group) => group.quests);
    expect(rows.find((row) => row.questId === 'wren_bell_rope')!.track).toMatchObject({ label: 'Track', enabled: false, note: TRACKING_FULL_NOTE });
    expect(rows.find((row) => row.questId === 'tink_hot_work')!.track).toMatchObject({
      label: 'Untrack', enabled: true, intent: { type: 'command', command: { type: 'track_quest', questId: 'tink_hot_work', tracked: false } },
    });
  });

  it('untracks one, or all, and follows only open quests', () => {
    const state = openSideQuests();
    dispatch(state, { type: 'track_quest', questId: 'odile_windfall' });
    expect(dispatch(state, { type: 'track_quest', questId: 'bail_out', tracked: false }).ok).toBe(true);
    expect(card(state)).toEqual(['odile_windfall']);
    // Dropping one that is not on the card is no error.
    expect(dispatch(state, { type: 'track_quest', questId: 'bail_out', tracked: false }).ok).toBe(true);
    expect(dispatch(state, { type: 'track_quest', questId: null }).ok).toBe(true);
    expect(card(state)).toEqual([]);
    // Nothing followed: the card shows the first active quest, as it always did.
    expect(buildHudModel(state, DEFAULT_SETTINGS, 0).trackers.map((tracker) => tracker.questId)).toEqual(['bail_out']);
    // A quest not given yet, or one done, cannot be followed.
    expect(dispatch(state, { type: 'track_quest', questId: 'first_haul' })).toMatchObject({ ok: false, reason: 'quest_not_available' });
    expect(dispatch(state, { type: 'track_quest', questId: 'odile_something_sweet' })).toMatchObject({ ok: false, reason: 'quest_not_available' });
    expect(dispatch(state, { type: 'track_quest', questId: 'no_such_quest' as 'bail_out' })).toMatchObject({ ok: false, reason: 'unknown_id' });
  });

  it('takes a finished quest off the card, and puts the next main quest where the last one was', () => {
    const state = openSideQuests();
    dispatch(state, { type: 'track_quest', questId: 'odile_windfall' });
    dispatch(state, { type: 'track_quest', questId: 'bail_out', tracked: false });
    dispatch(state, { type: 'track_quest', questId: 'bail_out' });
    expect(card(state)).toEqual(['odile_windfall', 'bail_out']);
    // Bail out finishes by itself: the main line moves on in the same place on the card.
    state.canoe.waterLevel = 5;
    standOn(state, 'home_knoll');
    run(state, {}, 0.5);
    expect(state.quests.bail_out.status).toBe('completed');
    expect(card(state)).toEqual(['odile_windfall', 'first_haul']);
    // Odile's quest handed in: it leaves the card.
    state.players[0].backpack.push({ itemId: 'apple', count: 6 });
    const odile = spotPosition(ISLANDS_BY_ID.orchard_hill, NPCS.odile.spot);
    teleport(state, 'orchard_hill', odile.x + 1, odile.z + 1);
    run(state, {}, 0.5);
    expect(dispatch(state, { type: 'turn_in_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(card(state)).toEqual(['first_haul']);
  });

  it('a card left empty by a finished quest follows the main line again', () => {
    const state = openSideQuests();
    state.players[0].trackedQuestIds = ['odile_windfall'];
    state.players[0].backpack.push({ itemId: 'apple', count: 6 });
    const odile = spotPosition(ISLANDS_BY_ID.orchard_hill, NPCS.odile.spot);
    teleport(state, 'orchard_hill', odile.x + 1, odile.z + 1);
    expect(dispatch(state, { type: 'turn_in_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(card(state)).toEqual(['bail_out']);
  });

  it('a quest just taken from a survivor goes on the card of whoever took it, if there is room', () => {
    const state = newGame(7, { crew: 2 });
    const odile = spotPosition(ISLANDS_BY_ID.orchard_hill, NPCS.odile.spot);
    teleport(state, 'orchard_hill', odile.x + 1, odile.z + 1);
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(card(state, 0)).toEqual(['bail_out', 'odile_windfall']);
    expect(card(state, 1)).toEqual(['bail_out']);
  });
});

describe('in a crew, the card is each player\'s own', () => {
  it('one player\'s pick changes nobody else\'s card, compass or quest mark', () => {
    const state = openSideQuests(2);
    // Windfall only needs handing in: its place is Odile, on Orchard Hill, which the crew has found.
    state.quests.odile_windfall = { status: 'ready', progress: [6] };
    state.discoveredIslands.push('orchard_hill');
    expect(card(state, 1)).toEqual(['bail_out']);
    expect(dispatch(state, { type: 'track_quest', questId: 'odile_windfall' }, 1).ok).toBe(true);
    expect(dispatch(state, { type: 'track_quest', questId: 'bail_out', tracked: false }, 1).ok).toBe(true);
    expect(card(state, 1)).toEqual(['odile_windfall']);
    expect(card(state, 0)).toEqual(['bail_out']);
    expect(buildHudModel(state, DEFAULT_SETTINGS, 0, 0).tracker!.questId).toBe('bail_out');
    expect(buildHudModel(state, DEFAULT_SETTINGS, 0, 1).tracker!.questId).toBe('odile_windfall');
    expect(selectTrackedQuestTarget(state, 1)!.questId).toBe('odile_windfall');
    expect(selectTrackedQuestTarget(state, 0)!.questId).toBe('bail_out');
    // The compass points at the first quest on each one's own card.
    const questMark = (playerId: number) => buildHudModel(state, DEFAULT_SETTINGS, 0, playerId).compass.marks.filter((mark) => mark.kind === 'quest');
    expect(questMark(1).map((mark) => mark.label)).toEqual(['Windfall']);
  });

  it('a new crewmate starts out following the main quest in progress', () => {
    const state = newGame();
    state.quests.bail_out.status = 'completed';
    state.quests.first_haul.status = 'active';
    const newcomer = addPlayer(state)!;
    expect(newcomer.trackedQuestIds).toEqual(['first_haul']);
  });

  it('a guest tracks over the wire: the host runs it as theirs, and every screen holds the same cards', () => {
    const rig = createRig({ game: openSideQuests() });
    const guest = rig.join('Sam');
    expect(rig.settle()).toBe(true);
    guest.link.sendCommand({ type: 'track_quest', questId: 'tink_hot_work' });
    rig.run(0.5);
    guest.link.sendCommand({ type: 'track_quest', questId: 'bail_out', tracked: false });
    rig.run(0.5);
    expect(guest.results.map((outcome) => outcome.result.ok)).toEqual([true, true]);
    expect(card(rig.game, 1)).toEqual(['tink_hot_work']);
    expect(card(rig.game, 0)).toEqual(['bail_out']);
    expect(rig.settle()).toBe(true);
    expect(guest.link.truth!.players[1]!.trackedQuestIds).toEqual(['tink_hot_work']);
  });

  it('the wire reads `tracked` when it is true or false, and refuses anything else', () => {
    expect(PROTOCOL_VERSION).toBe(4); // 3 was this change. The jump key made it 4.
    expect(readCommand({ type: 'track_quest', questId: 'bail_out', tracked: false })).toEqual({ type: 'track_quest', questId: 'bail_out', tracked: false });
    expect(readCommand({ type: 'track_quest', questId: 'bail_out' })).toEqual({ type: 'track_quest', questId: 'bail_out' });
    expect(readCommand({ type: 'track_quest', questId: null })).toEqual({ type: 'track_quest', questId: null });
    expect(readCommand({ type: 'track_quest', questId: 'bail_out', tracked: 'no' })).toBeNull();
    expect(readCommand({ type: 'track_quest', questId: 'bail_out', tracked: true, playerId: 0 })).toBeNull();
  });
});

describe('an old save\'s tracked quest', () => {
  it.each(Object.keys(liveSaves).sort())('%s: stays tracked, on every player\'s card', (name) => {
    const old = JSON.parse(liveSaves[name]!);
    const loaded = deserialize(liveSaves[name]!);
    if (!loaded.ok) throw new Error(`${name} did not load`);
    expect(old.state.trackedQuestId).toBeTruthy();
    for (const player of loaded.state.players) expect(player.trackedQuestIds).toEqual([old.state.trackedQuestId]);
    expect('trackedQuestId' in loaded.state).toBe(false);
    expect(buildHudModel(loaded.state, DEFAULT_SETTINGS, 0).tracker!.questId).toBe(old.state.trackedQuestId);
  });

  it('a save that tracked nothing loads with an empty card, and the card shows the first active quest', () => {
    const name = Object.keys(liveSaves).sort()[0]!;
    const old = JSON.parse(liveSaves[name]!);
    old.state.trackedQuestId = null;
    const loaded = deserialize(JSON.stringify(old));
    if (!loaded.ok) throw new Error('did not load');
    expect(loaded.state.players[0]!.trackedQuestIds).toEqual([]);
    expect(buildHudModel(loaded.state, DEFAULT_SETTINGS, 0).trackers).toHaveLength(1);
  });
});
