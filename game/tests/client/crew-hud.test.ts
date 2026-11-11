/**
 * The HUD with a crew: the crew list, the crewmates' marks on the compass and the map, the notes
 * that belong to everyone, and the reward items on the quest rows. And that none of it shows when
 * playing alone.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { WorldView } from '../../src/client/contracts.ts';
import {
  CREW_WITH_YOU_METRES, MAP_BOUNDS, buildHudModel, buildMapPanel, buildQuestLogPanel, crewElsewhere, toastForEvent,
  toastsForPlayer, toastsFromEvents,
} from '../../src/client/viewmodels/index.ts';
import type { CrewRowModel } from '../../src/client/viewmodels/index.ts';
import { CREW_MARKS, ISLANDS_BY_ID, QUESTS, QUEST_IDS, TUNING } from '../../src/data/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { bearingBetween, dispatch, eventsFor, terrainHeight } from '../../src/sim/index.ts';
import type { GameEvent, GameState, PlayerState } from '../../src/sim/index.ts';
import { FakeStorage, newGame, standOn } from '../support.ts';

const settings = createDefaultSettings();
const hud = (state: GameState, playerId = 0) => buildHudModel(state, settings, 0, playerId);
const crewMarks = (state: GameState, playerId = 0) => hud(state, playerId).compass.marks.filter((mark) => mark.kind === 'crew');

/** Put one player on an island, `offset` metres east of its middle. */
function putAshore(player: PlayerState, islandId: IslandId, offset = 0): void {
  const centre = ISLANDS_BY_ID[islandId].center;
  player.mode = 'foot';
  player.seat = null;
  player.islandId = islandId;
  player.position = { x: centre.x + offset, y: terrainHeight(centre.x + offset, centre.z), z: centre.z };
}

describe('the crew list', () => {
  it('is not drawn for one player, and has a row a player for two, three and four', () => {
    expect(hud(newGame(7)).crew).toEqual([]);
    expect(hud(newGame(7, { crew: 1 })).crew).toEqual([]);
    for (const size of [2, 3, 4]) {
      const state = newGame(7, { crew: size });
      const rows = hud(state).crew;
      expect(rows.map((row) => row.playerId)).toEqual(state.players.map((player) => player.id));
      expect(rows).toHaveLength(size);
    }
  });

  it('names and colours each row from CREW_MARKS, with the toque colour the look uses', () => {
    const rows = hud(newGame(7, { crew: 4 })).crew;
    expect(rows.map((row) => row.label)).toEqual(CREW_MARKS.map((mark) => mark.label));
    expect(rows.map((row) => row.color)).toEqual(CREW_MARKS.map((mark) => mark.toque));
    expect(new Set(rows.map((row) => row.color)).size).toBe(4);
  });

  it('marks the row of the player the screen belongs to, and only that one', () => {
    const state = newGame(7, { crew: 4 });
    for (const player of state.players) {
      expect(hud(state, player.id).crew.map((row) => row.you)).toEqual(state.players.map((other) => other.id === player.id));
    }
  });

  it('builds every row from that player\'s own meters', () => {
    const state = newGame(7, { crew: 4 });
    state.players.forEach((player, index) => {
      player.hunger = 90 - index * 20;
      player.thirst = 80 - index * 20;
      player.energy = 70 - index * 20;
    });
    const rows = hud(state).crew;
    state.players.forEach((player, index) => {
      expect(rows[index]!.meters.map((meter) => [meter.id, meter.value])).toEqual([
        ['hunger', player.hunger], ['thirst', player.thirst], ['energy', player.energy],
      ]);
      // The same numbers that player reads on their own HUD.
      expect(rows[index]!.meters).toEqual(hud(state, player.id).meters);
    });
  });

  it('flags a low meter on the row of the player who has it, in words, and on nobody else', () => {
    const state = newGame(7, { crew: 3 });
    for (const player of state.players) Object.assign(player, { hunger: 80, thirst: 80, energy: 80 });
    expect(hud(state).crew.map((row) => row.lowText)).toEqual(['', '', '']);

    state.players[2]!.energy = TUNING.survival.lowMeterWarning - 1;
    let rows = hud(state).crew;
    expect(rows.map((row) => row.lowText)).toEqual(['', '', 'low energy']);
    expect(rows[2]!.meters.map((meter) => meter.low)).toEqual([false, false, true]);

    state.players[1]!.hunger = 5;
    state.players[1]!.thirst = 5;
    rows = hud(state).crew;
    expect(rows.map((row) => row.lowText)).toEqual(['', 'low hunger, thirst', 'low energy']);
  });

  it('says where each player is: aboard, ashore and on which island, asleep', () => {
    const state = newGame(7, { crew: 4 });
    const where = (rows: CrewRowModel[]) => rows.map((row) => [row.where, row.placeText]);
    expect(where(hud(state).crew)).toEqual(Array.from({ length: 4 }, () => ['aboard', 'Aboard']));

    putAshore(state.players[1]!, 'home_knoll');
    putAshore(state.players[2]!, 'cabin_roofs');
    putAshore(state.players[3]!, 'cabin_roofs', 3);
    state.players[3]!.asleep = true;
    expect(where(hud(state).crew)).toEqual([
      ['aboard', 'Aboard'],
      ['ashore', `Ashore · ${ISLANDS_BY_ID.home_knoll.name}`],
      ['ashore', `Ashore · ${ISLANDS_BY_ID.cabin_roofs.name}`],
      ['asleep', `Asleep · ${ISLANDS_BY_ID.cabin_roofs.name}`],
    ]);
  });

  it('gives the distance to a crewmate who is somewhere else, and none to you or to anyone beside you', () => {
    const state = newGame(7, { crew: 3 });
    standOn(state, 'home_knoll');
    const [first, second, third] = state.players as [PlayerState, PlayerState, PlayerState];
    putAshore(first, 'home_knoll');
    putAshore(second, 'home_knoll', CREW_WITH_YOU_METRES - 2);
    putAshore(third, 'home_knoll', 240);
    expect(hud(state).crew.map((row) => row.distanceText)).toEqual(['', '', '240 m']);
    // From the third player's screen it is the other two who are far off.
    expect(hud(state, third.id).crew.map((row) => row.distanceText)).toEqual(['240 m', '230 m', '']);
  });
});

describe('crewmates on the compass', () => {
  it('has no crew mark alone, or with the whole crew in the canoe', () => {
    expect(crewMarks(newGame(7))).toEqual([]);
    expect(crewMarks(newGame(7, { crew: 4 }))).toEqual([]);
  });

  it('marks each crewmate who is somewhere else at their own bearing and distance, in their colour', () => {
    const state = newGame(7, { crew: 4 });
    const [you, second, third, fourth] = state.players as [PlayerState, PlayerState, PlayerState, PlayerState];
    putAshore(second, 'cabin_roofs');
    putAshore(third, 'birch_islet');
    const marks = crewMarks(state);
    expect(marks.map((mark) => mark.id)).toEqual(['crew-1', 'crew-2']); // the fourth is aboard with you
    expect(fourth.mode).toBe('canoe');
    for (const [mark, mate] of [[marks[0]!, second], [marks[1]!, third]] as const) {
      const bearing = bearingBetween(you.position.x, you.position.z, mate.position.x, mate.position.z);
      const degrees = ((Math.round((bearing * 180) / Math.PI) % 360) + 360) % 360;
      expect(mark.bearingDegrees).toBe(degrees);
      expect(mark.color).toBe(CREW_MARKS[mate.id]!.toque);
      expect(mark.label).toBe(CREW_MARKS[mate.id]!.label);
      expect(mark.crewIndex).toBe(mate.id);
      const metres = Math.hypot(mate.position.x - you.position.x, mate.position.z - you.position.z);
      expect(mark.distanceText).toBe(metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`);
    }
    // Two crewmates on two islands do not share a bearing.
    expect(marks[0]!.bearingDegrees).not.toBe(marks[1]!.bearingDegrees);
  });

  it('follows the crewmate when they move, and turns with the camera', () => {
    const state = newGame(7, { crew: 2 });
    const [you, mate] = state.players as [PlayerState, PlayerState];
    mate.mode = 'foot';
    mate.seat = null;
    mate.position = { x: you.position.x, y: 0, z: you.position.z - 100 }; // due north
    expect(crewMarks(state)[0]!.bearingDegrees).toBe(0);
    mate.position = { x: you.position.x + 100, y: 0, z: you.position.z }; // due east
    expect(crewMarks(state)[0]!.bearingDegrees).toBe(90);
    expect(crewMarks(state)[0]!.relativeDegrees).toBe(90);
    const lookingEast = buildHudModel(state, settings, Math.PI / 2).compass.marks.find((mark) => mark.kind === 'crew')!;
    expect(lookingEast.relativeDegrees).toBe(0);
  });

  it('leaves out a crewmate standing beside you on foot, and marks the one in the canoe you stepped out of', () => {
    const state = newGame(7, { crew: 3 });
    const [you, beside, aboard] = state.players as [PlayerState, PlayerState, PlayerState];
    putAshore(you, 'home_knoll');
    putAshore(beside, 'home_knoll', 2);
    expect(aboard.mode).toBe('canoe');
    expect(crewElsewhere(state, you.id).map((entry) => entry.player.id)).toEqual([aboard.id]);
    expect(crewMarks(state).map((mark) => mark.id)).toEqual(['crew-2']);
  });
});

describe('crewmates on the map', () => {
  const left = (x: number): number => (x - MAP_BOUNDS.minimumX) / (MAP_BOUNDS.maximumX - MAP_BOUNDS.minimumX);
  const top = (z: number): number => (z - MAP_BOUNDS.minimumZ) / (MAP_BOUNDS.maximumZ - MAP_BOUNDS.minimumZ);
  const crewMarkers = (state: GameState, playerId = 0) => buildMapPanel(state, playerId).markers.filter((marker) => marker.kind === 'crew');

  it('has no crew marker alone, or with the whole crew in the canoe', () => {
    expect(crewMarkers(newGame(7))).toEqual([]);
    expect(crewMarkers(newGame(7, { crew: 4 }))).toEqual([]);
  });

  it('puts each crewmate who is somewhere else at their own place, in their colour', () => {
    const state = newGame(7, { crew: 4 });
    const [, second, third] = state.players as [PlayerState, PlayerState, PlayerState];
    putAshore(second, 'cabin_roofs');
    putAshore(third, 'birch_islet');
    const markers = crewMarkers(state);
    expect(markers).toEqual([second, third].map((mate) => ({
      kind: 'crew', label: CREW_MARKS[mate.id]!.label, color: CREW_MARKS[mate.id]!.toque, crewIndex: mate.id,
      left: left(mate.position.x), top: top(mate.position.z),
    })));
    // The two islands are two places on the chart.
    expect(markers[0]!.left).not.toBe(markers[1]!.left);
    // And the markers that were there before are still there, unchanged.
    const before = buildMapPanel(newGame(7), 0).markers;
    expect(buildMapPanel(state, 0).markers.filter((marker) => marker.kind !== 'crew')).toEqual(before);
  });
});

describe('notes for the whole crew', () => {
  /** Player `finderId` of a crew makes a stone knife, with the makings in their own pack. Returns the frame's events. */
  function knifeMadeBy(state: GameState, finderId: number): GameEvent[] {
    state.events = [];
    state.players[finderId]!.backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
    expect(dispatch(state, { type: 'craft', recipeId: 'stone_knife' }, finderId).ok).toBe(true);
    return state.events.splice(0);
  }

  it('a new tool is told to every player, and says who made it', () => {
    const state = newGame(7, { crew: 4 });
    const events = knifeMadeBy(state, 1);
    expect(state.tools).toContain('stone_knife');
    const told = state.players.map((player) => toastsForPlayer(events, state, player.id).map((toast) => toast.text));
    expect(told[0]).toEqual(['Player 2 made a new tool: Stone knife']);
    expect(told[2]).toEqual(told[0]);
    expect(told[3]).toEqual(told[0]);
    // The maker reads it as theirs, beside their own bench note.
    expect(told[1]).toContain('You made a new tool: Stone knife');
    expect(told[1]).toContain('Made 1 x Stone knife');
    // The note keeps the tool's icon.
    expect(toastsForPlayer(events, state, 0)[0]!.itemId).toBe('stone_knife');
  });

  it('a tool or a key item that was found says "found", with the finder\'s label', () => {
    const state = newGame(7, { crew: 3 });
    const tool: GameEvent = { type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt', playerId: 2 };
    const keyItem: GameEvent = { type: 'item_gained', itemId: 'lens', count: 1, container: 'key_items', playerId: 2 };
    expect(toastsForPlayer([tool, keyItem], state, 0).map((toast) => toast.text)).toEqual(['Player 3 found a new tool: Hatchet', 'Player 3 found: Lens']);
    expect(toastsForPlayer([tool, keyItem], state, 2).map((toast) => toast.text)).toEqual(['You found a new tool: Hatchet', 'You found: Lens']);
  });

  it('what is one player\'s own stays theirs: a pack gain, a low meter, a bench note', () => {
    const state = newGame(7, { crew: 3 });
    const own: GameEvent[] = [
      { type: 'item_gained', itemId: 'driftwood', count: 2, container: 'backpack', playerId: 1 },
      { type: 'meter_low', meter: 'hunger', playerId: 1 },
      { type: 'crafted', recipeId: 'stone_knife', count: 1, playerId: 1 },
    ];
    expect(toastsForPlayer(own, state, 0)).toEqual([]);
    expect(toastsForPlayer(own, state, 2)).toEqual([]);
    expect(toastsForPlayer(own, state, 1)).toHaveLength(3);
    // And what nobody in particular caused still reaches everyone.
    const weather: GameEvent[] = [{ type: 'weather_changed', kind: 'rain' }];
    for (const player of state.players) expect(toastsForPlayer(weather, state, player.id)).toHaveLength(1);
  });

  /** A whole app on fakes, playing player 0 of a crew. */
  function appWith(crew: number): App {
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {},
      handleEvents: () => {}, render: () => {}, dispose: () => {},
    };
    const app = createApp({
      worldView, gameInterface: { mount: () => {}, update: () => {}, dispose: () => {} }, audio: createSilentAudio(),
      storage: new FakeStorage(), now: () => 5_000, randomSeed: () => 7,
    });
    app.session.adoptGame(newGame(7, { crew }));
    app.frame(1 / 60);
    app.toasts.clear();
    return app;
  }

  it('the app shows a crewmate\'s new tool on the local player\'s screen', () => {
    const app = appWith(3);
    const state = app.session.game!;
    state.players[2]!.backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
    expect(dispatch(state, { type: 'craft', recipeId: 'stone_knife' }, 2).ok).toBe(true);
    // Nothing in this frame is the local player's own: the old routing showed them nothing.
    expect(eventsFor(state.events, 0).filter((event) => event.type === 'item_gained')).toEqual([]);
    app.frame(1 / 60);
    expect(app.lastModel!.toasts.map((toast) => [toast.text, toast.itemId])).toContainEqual(['Player 3 made a new tool: Stone knife', 'stone_knife']);
    // The crewmate's own bench note is not the local player's to read.
    expect(app.lastModel!.toasts.map((toast) => toast.text)).not.toContain('Made 1 x Stone knife');
  });
});

describe('playing alone, nothing changes', () => {
  it('the HUD model has no crew rows and no crew marks, whatever the player does', () => {
    const state = newGame(7);
    const model = hud(state);
    expect(model.crew).toEqual([]);
    expect(model.compass.marks.every((mark) => mark.kind !== 'crew')).toBe(true);
    expect(model.compass.marks.every((mark) => !('color' in mark) && !('crewIndex' in mark))).toBe(true);
    expect(buildMapPanel(state).markers.every((marker) => marker.kind !== 'crew' && !('color' in marker))).toBe(true);
  });

  it('the notes read as they always did', () => {
    const state = newGame(7);
    const tool: GameEvent = { type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt', playerId: 0 };
    const keyItem: GameEvent = { type: 'item_gained', itemId: 'lens', count: 1, container: 'key_items', playerId: 0 };
    expect(toastForEvent(tool, state)).toEqual({ text: 'New tool: Hatchet', tone: 'good', itemId: 'hatchet' });
    expect(toastForEvent(keyItem, state)).toEqual({ text: 'Found: Lens', tone: 'good', itemId: 'lens' });
    // The same list from the old call and the new one.
    const events: GameEvent[] = [
      tool, keyItem,
      { type: 'item_gained', itemId: 'driftwood', count: 2, container: 'backpack', playerId: 0 },
      { type: 'crafted', recipeId: 'stone_knife', count: 1, playerId: 0 },
      { type: 'weather_changed', kind: 'rain' },
    ];
    expect(toastsForPlayer(events, state, 0)).toEqual(toastsFromEvents(eventsFor(events, 0), state));
    expect(toastsForPlayer(events, state, 0).map((toast) => toast.text)).toEqual([
      'New tool: Hatchet', 'Found: Lens', '+2 Driftwood', 'Made 1 x Stone knife', 'Weather: rain',
    ]);
  });
});

describe('quest rewards', () => {
  it('every open quest row lists the items its quest gives, with their names and counts', () => {
    const state = newGame(7);
    const rows = buildQuestLogPanel(state).groups.flatMap((group) => group.quests);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.rewards.map((item) => [item.itemId, item.count])).toEqual(
        row.done ? [] : QUESTS[row.questId].rewards.items.map((item) => [item.itemId, item.count]),
      );
      for (const item of row.rewards) expect(item.name).not.toBe('');
    }
  });

  it('some quest in the game gives items, and a finished one lists none', () => {
    expect(QUEST_IDS.some((questId) => QUESTS[questId].rewards.items.length > 0)).toBe(true);
    const state = newGame(7);
    for (const questId of QUEST_IDS) state.quests[questId].status = 'active';
    const rowsOf = () => buildQuestLogPanel(state).groups.flatMap((group) => group.quests);
    const open = rowsOf().find((row) => row.rewards.length > 0)!;
    expect(open.rewards.map((item) => item.itemId)).toEqual(QUESTS[open.questId].rewards.items.map((item) => item.itemId));
    state.quests[open.questId].status = 'completed';
    const done = rowsOf().find((row) => row.questId === open.questId)!;
    expect(done.done).toBe(true);
    expect(done.rewards).toEqual([]);
  });
});
