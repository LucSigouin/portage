/**
 * The crew's chart: the fog of war is cleared where any crewmate goes, never comes back, is the crew's (the host's
 * state, sent to guests), is saved with the game, and an old save starts with what it knew. Luc's bugfix list, line 7.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, TUNING } from '../src/data/index.ts';
import type { IslandId } from '../src/data/index.ts';
import { createBotDriver, BOT_SEED } from '../src/bot/bot.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import {
  FIXED_STEP, FOG, SEEN_CELLS, SEEN_LENGTH, cellOf, cellSeen, chartKnownWaters, createGame, emptySeen, fullSeen, revealCircle,
  seenAt, seenCount, step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { createRig } from './net/rig.ts';
import { floatCanoeAt, newGame, run, teleport } from './support.ts';

const liveSaves = import.meta.glob<string>('./fixtures/save-live-*.json', { eager: true, query: '?raw', import: 'default' });

/** True when every cell seen in `before` is still seen in `after`. */
function keepsEverything(before: string, after: string): boolean {
  for (let row = 0; row < FOG.rows; row += 1) {
    for (let column = 0; column < FOG.columns; column += 1) {
      if (cellSeen(before, column, row) && !cellSeen(after, column, row)) return false;
    }
  }
  return true;
}

/** Points of dry land on an island, a few metres apart. */
function landOf(islandId: IslandId): { x: number; z: number }[] {
  const island = ISLANDS_BY_ID[islandId];
  const reach = Math.max(island.radiusX, island.radiusZ);
  const points: { x: number; z: number }[] = [];
  for (let dz = -reach; dz <= reach; dz += 6) {
    for (let dx = -reach; dx <= reach; dx += 6) {
      const x = island.center.x + dx;
      const z = island.center.z + dz;
      if (terrainHeight(x, z) > 0) points.push({ x, z });
    }
  }
  return points;
}

describe('the record', () => {
  it('packs the valley into under a kilobyte: six cells a character', () => {
    expect(SEEN_CELLS).toBe(FOG.columns * FOG.rows);
    expect(SEEN_LENGTH).toBe(Math.ceil(SEEN_CELLS / 6));
    expect(SEEN_LENGTH).toBeLessThan(1000);
    expect(emptySeen()).toHaveLength(SEEN_LENGTH);
    expect(seenCount(emptySeen())).toBe(0);
    expect(seenCount(fullSeen())).toBe(SEEN_CELLS);
    // The grid covers the lake and a sight's width of shore round it.
    expect(FOG.minimumX).toBeLessThanOrEqual(-1100 - FOG.sightMetres);
    expect(FOG.minimumX + FOG.columns * FOG.cellMetres).toBeGreaterThanOrEqual(1100 + FOG.sightMetres);
    expect(FOG.minimumZ).toBeLessThanOrEqual(-1450 - FOG.sightMetres);
    expect(FOG.minimumZ + FOG.rows * FOG.cellMetres).toBeGreaterThanOrEqual(1400 + FOG.sightMetres);
  });

  it('marks a circle seen and nothing else, and hands back the same string when nothing new is seen', () => {
    const seen = revealCircle(emptySeen(), 0, 0, 200);
    expect(seenAt(seen, 0, 0)).toBe(true);
    expect(seenAt(seen, 150, 0)).toBe(true);
    expect(seenAt(seen, 300, 0)).toBe(false);
    expect(seenAt(seen, 0, -300)).toBe(false);
    // About the circle's area in cells.
    expect(seenCount(seen)).toBeGreaterThan(0.8 * Math.PI * (200 / FOG.cellMetres) ** 2);
    expect(seenCount(seen)).toBeLessThan(1.2 * Math.PI * (200 / FOG.cellMetres) ** 2);
    expect(revealCircle(seen, 0, 0, 200)).toBe(seen);
    expect(revealCircle(seen, 10, 10, 50)).toBe(seen);
    // Off the grid is never seen, and a point off the grid changes nothing.
    expect(cellSeen(fullSeen(), -1, 0)).toBe(false);
    expect(cellSeen(fullSeen(), FOG.columns, 0)).toBe(false);
    expect(revealCircle(emptySeen(), 5000, 5000, 100)).toBe(emptySeen());
    expect(revealCircle(emptySeen(), Number.NaN, 0, 100)).toBe(emptySeen());
  });

  it('never clears a cell: any circles, in any order, only add', () => {
    let seen = emptySeen();
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 2 ** 32;
    };
    for (let circle = 0; circle < 200; circle += 1) {
      const after = revealCircle(seen, (next() - 0.5) * 2800, (next() - 0.5) * 3400, next() * 300);
      expect(keepsEverything(seen, after)).toBe(true);
      expect(seenCount(after)).toBeGreaterThanOrEqual(seenCount(seen));
      seen = after;
    }
  });

  it('mends a record of the wrong length (a hand-edited save) to the right one', () => {
    const short = revealCircle('A', 0, 0, 100);
    expect(short).toHaveLength(SEEN_LENGTH);
    expect(seenAt(short, 0, 0)).toBe(true);
  });
});

describe('in play', () => {
  it('starts a new game with the sight round the canoe seen, and the rest in the fog', () => {
    const state = newGame();
    expect(state.seen).toHaveLength(SEEN_LENGTH);
    expect(seenAt(state.seen, state.canoe.position.x, state.canoe.position.z)).toBe(true);
    expect(seenAt(state.seen, state.canoe.position.x + FOG.sightMetres - FOG.cellMetres, state.canoe.position.z)).toBe(true);
    expect(seenAt(state.seen, ISLANDS_BY_ID.steeple_rock.center.x, ISLANDS_BY_ID.steeple_rock.center.z)).toBe(false);
    expect(seenAt(state.seen, 0, -1200)).toBe(false);
  });

  it('clears round the canoe as it travels, by the sight radius, and keeps what was seen behind', () => {
    const state = newGame();
    // North up a clear lane east of Home Knoll and west of Birch Islet.
    floatCanoeAt(state, 160, 1300, 0);
    state.canoe.hullTier = 1;
    state.weather.secondsRemaining = 99999;
    const start = state.seen;
    const ahead = { x: 160, z: 700 };
    expect(seenAt(state.seen, ahead.x, ahead.z)).toBe(false);
    let before = state.seen;
    for (let second = 0; second < 300; second += 1) {
      run(state, { paddle: 1 }, 1);
      expect(keepsEverything(before, state.seen)).toBe(true);
      before = state.seen;
    }
    expect(state.canoe.position.z).toBeLessThan(ahead.z);
    expect(seenAt(state.seen, ahead.x, ahead.z)).toBe(true);
    expect(keepsEverything(start, state.seen)).toBe(true);
    // Beside the way, within sight: seen. Further out: still fog.
    expect(seenAt(state.seen, 160 + 150, 800)).toBe(true);
    expect(seenAt(state.seen, 160 + 400, 800)).toBe(false);
  });

  it('clears round every crewmate, wherever each one is', () => {
    const state = newGame(7, { crew: 2 });
    const far = ISLANDS_BY_ID.steeple_rock.center;
    expect(seenAt(state.seen, far.x, far.z)).toBe(false);
    // Player 1 alone goes ashore far to the north. Player 0 stays in the canoe.
    const mate = state.players[1]!;
    mate.mode = 'foot';
    mate.seat = null;
    mate.islandId = 'steeple_rock';
    mate.position = { x: far.x, y: terrainHeight(far.x, far.z), z: far.z };
    run(state, {}, 0.5);
    expect(seenAt(state.seen, far.x, far.z)).toBe(true);
    expect(seenAt(state.seen, far.x + 150, far.z)).toBe(true);
    expect(seenAt(state.seen, state.canoe.position.x, state.canoe.position.z)).toBe(true);
  });

  it('never opens over a piece of an island before the island is found: the bot plays a whole game', () => {
    const state = createGame(BOT_SEED);
    const driver = createBotDriver(state);
    const land = new Map(ISLANDS.map((island) => [island.id, landOf(island.id)]));
    const lastStep = 4 * 3600 * 60;
    let checks = 0;
    let previous = state.seen;
    for (let input = driver.next(); input !== null && state.tick < lastStep; input = driver.next()) {
      step(state, input, FIXED_STEP);
      state.events = [];
      if (state.tick % 600 !== 0) continue;
      checks += 1;
      expect(keepsEverything(previous, state.seen)).toBe(true);
      previous = state.seen;
      for (const island of ISLANDS) {
        if (state.discoveredIslands.includes(island.id)) continue;
        const shown = land.get(island.id)!.filter((point) => seenAt(state.seen, point.x, point.z));
        expect(shown, `${island.id} shows before it is found, at ${Math.round(state.playedSeconds)} s`).toEqual([]);
      }
    }
    expect(driver.finished).toBe(true);
    expect(checks).toBeGreaterThan(300);
    // By the Beacon every island the crew found is charted whole, however far off it was found from.
    for (const islandId of state.discoveredIslands) {
      expect(land.get(islandId)!.filter((point) => !seenAt(state.seen, point.x, point.z)), islandId).toEqual([]);
    }
  });

  it('keeps the sight under the range at which an island is found', () => {
    // A cell's far corner is never further than the island discovery range.
    expect(FOG.sightMetres + (FOG.cellMetres * Math.SQRT2) / 2).toBeLessThan(TUNING.world.discoverRange);
  });
});

describe('the crew shares it', () => {
  it('a guest receives what the crew has seen, as the host sees more', () => {
    const rig = createRig();
    const guest = rig.join('Sam');
    expect(rig.settle()).toBe(true);
    const first = rig.game.seen;
    expect(guest.link.truth!.seen).toBe(first);
    const fullStates = rig.host.stats.fullStatesSent;
    rig.hostInput = { paddle: 1, steer: 0.1 };
    rig.run(60);
    rig.hostInput = {};
    expect(rig.game.seen).not.toBe(first);
    expect(rig.settle()).toBe(true);
    expect(guest.link.truth!.seen).toBe(rig.game.seen);
    // It came in the host's small changes, not by sending the whole game again.
    expect(rig.host.stats.fullStatesSent).toBe(fullStates);
    expect(keepsEverything(first, guest.link.truth!.seen)).toBe(true);
  });

  it('a guest who joins late sees everything the crew saw before they came', () => {
    const rig = createRig();
    rig.hostInput = { paddle: 1, steer: -0.15 };
    rig.run(90);
    rig.hostInput = {};
    const seen = rig.game.seen;
    const late = rig.join('Late');
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    expect(late.link.truth!.seen).toBe(rig.game.seen);
    expect(keepsEverything(seen, late.link.truth!.seen)).toBe(true);
  });

  it('a guest who walks somewhere new clears it for the whole crew, through the host', () => {
    const rig = createRig();
    const guest = rig.join('Bo');
    expect(rig.settle()).toBe(true);
    // The host's game puts the guest's player far off; the host's own step clears round them.
    const far = ISLANDS_BY_ID.silo_twins.center;
    expect(seenAt(rig.game.seen, far.x, far.z)).toBe(false);
    const mate = rig.game.players[1]!;
    Object.assign(mate, { mode: 'foot', seat: null, islandId: 'silo_twins', position: { x: far.x, y: terrainHeight(far.x, far.z), z: far.z } });
    rig.run(0.5);
    expect(seenAt(rig.game.seen, far.x, far.z)).toBe(true);
    expect(rig.settle()).toBe(true);
    expect(seenAt(guest.link.truth!.seen, far.x, far.z)).toBe(true);
  });
});

describe('saved with the game', () => {
  it('a save keeps it exactly, and the loaded game goes on clearing from there', () => {
    const state = newGame();
    teleport(state, 'home_knoll', ISLANDS_BY_ID.home_knoll.center.x, ISLANDS_BY_ID.home_knoll.center.z);
    state.seen = revealCircle(state.seen, 300, 400, 250);
    const loaded = deserialize(serialize(state, 1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBeNull();
    expect(loaded.state.seen).toBe(state.seen);
    expect(seenAt(loaded.state.seen, 300, 400)).toBe(true);
    floatCanoeAt(loaded.state, -600, 300, 0);
    run(loaded.state, {}, 0.5);
    expect(seenAt(loaded.state.seen, -600, 300)).toBe(true);
    expect(keepsEverything(state.seen, loaded.state.seen)).toBe(true);
  });

  it('is under a kilobyte in the save, whatever has been seen', () => {
    const state = newGame();
    const blank = JSON.stringify({ ...state, seen: '' }).length;
    for (const seen of [emptySeen(), state.seen, fullSeen()]) {
      const bytes = JSON.stringify({ ...state, seen }).length - blank;
      expect(bytes).toBe(SEEN_LENGTH);
      expect(bytes).toBeLessThan(1024);
    }
  });
});

describe('an old save (version 3) starts with what it knew', () => {
  const names = Object.keys(liveSaves).sort();

  it('has the live saves to try', () => {
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it.each(names)('%s: its islands and the waters round its route are charted, not a blank map', (name) => {
    const old = JSON.parse(liveSaves[name]!);
    expect(old.version).toBe(3);
    expect('seen' in old.state).toBe(false);
    const loaded = deserialize(liveSaves[name]!);
    if (!loaded.ok) throw new Error(`${name} did not load`);
    const state: GameState = loaded.state;
    expect(loaded.migratedFrom).toBe(3);
    expect(state.seen).toHaveLength(SEEN_LENGTH);
    // Every island it knew, its middle seen.
    for (const islandId of old.state.discoveredIslands as IslandId[]) {
      const center = ISLANDS_BY_ID[islandId].center;
      expect(seenAt(state.seen, center.x, center.z), `${name}: ${islandId}`).toBe(true);
    }
    // Where everyone stands, and the canoe.
    for (const player of state.players) expect(seenAt(state.seen, player.position.x, player.position.z)).toBe(true);
    expect(seenAt(state.seen, state.canoe.position.x, state.canoe.position.z)).toBe(true);
    // The way between two islands found one after the other.
    const route = old.state.discoveredIslands as IslandId[];
    for (let index = 1; index < route.length; index += 1) {
      const from = ISLANDS_BY_ID[route[index - 1]!].center;
      const to = ISLANDS_BY_ID[route[index]!].center;
      const middle = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
      const nearUnknown = ISLANDS.some((island) => !route.includes(island.id)
        && Math.hypot(island.center.x - middle.x, island.center.z - middle.z) < Math.max(island.radiusX, island.radiusZ) + 2 * FOG.cellMetres);
      if (!nearUnknown) expect(seenAt(state.seen, middle.x, middle.z), `${name}: ${route[index - 1]} to ${route[index]}`).toBe(true);
    }
    // Never a piece of an island it had not found.
    for (const island of ISLANDS) {
      if (route.includes(island.id)) continue;
      expect(landOf(island.id).filter((point) => seenAt(state.seen, point.x, point.z)), `${name}: ${island.id}`).toEqual([]);
    }
    // More than the sight round the canoe: the map has its history on it.
    expect(seenCount(state.seen)).toBeGreaterThan(seenCount(revealCircle(emptySeen(), state.canoe.position.x, state.canoe.position.z, FOG.sightMetres)));
  });

  it('charts the route even from islands alone, and leaves an unknown island in the fog', () => {
    const seen = chartKnownWaters(['home_knoll', 'steeple_rock'], []);
    const home = ISLANDS_BY_ID.home_knoll.center;
    const steeple = ISLANDS_BY_ID.steeple_rock.center;
    expect(seenAt(seen, home.x, home.z)).toBe(true);
    expect(seenAt(seen, steeple.x, steeple.z)).toBe(true);
    // Half way between, on open water.
    expect(seenAt(seen, (home.x + steeple.x) / 2 + 60, (home.z + steeple.z) / 2)).toBe(true);
    // The Boathouse is not on the list: its island stays in the fog, however near the route runs.
    for (const point of landOf('the_boathouse')) expect(seenAt(seen, point.x, point.z)).toBe(false);
    // Far off the route: fog.
    expect(seenAt(seen, -900, -800)).toBe(false);
    const { column, row } = cellOf(home.x, home.z);
    expect(cellSeen(seen, column, row)).toBe(true);
  });
});
