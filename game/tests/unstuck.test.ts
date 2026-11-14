/**
 * Luc, Round 4: more things are solid now (scavenge spots, survivors, herons, the buffer stop). So nobody may be put
 * in one, or shut in between them: not at the start of a game, not stepping ashore anywhere, not waking after a
 * fail, not after boarding and landing again. And a save made while standing on a spot (it was stood on to use it)
 * loads with the player stepped clear.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, NODES, NODES_BY_ID, TUNING, spotPosition } from '../src/data/index.ts';
import type { IslandDefinition } from '../src/data/index.ts';
import { createSaveStore, deserialize, serialize } from '../src/save/index.ts';
import {
  bodyBlocked, dispatch, drainEvents, landingBerth, nodeSolids, selectInteractable, standClear, terrainHeight,
} from '../src/sim/index.ts';
import type { GameState, PlayerState } from '../src/sim/index.ts';
import { canWalk } from '../src/sim/foot.ts';
import { clearSpot, disembarkSpot } from '../src/sim/interact.ts';
import { Session } from '../src/client/session.ts';
import { FakeStorage, build, floatCanoeAt, newGame, runUntilFail, standOn } from './support.ts';

/**
 * True when a walker standing here can get `reach` metres away over ground the rules let them walk: clear of every
 * solid, no deeper than a wade, no steeper than a walk. False is shut in: a pocket between solids, or in one.
 */
function roams(x: number, z: number, reach = 6): boolean {
  const cell = 0.25;
  const seen = new Set<string>(['0,0']);
  const stack: [number, number][] = [[0, 0]];
  while (stack.length > 0) {
    const [column, row] = stack.pop()!;
    if (Math.hypot(column, row) * cell >= reach) return true;
    for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${column + stepColumn},${row + stepRow}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const toX = x + (column + stepColumn) * cell;
      const toZ = z + (row + stepRow) * cell;
      if (bodyBlocked(toX, toZ) || !canWalk(x + column * cell, z + row * cell, toX, toZ)) continue;
      stack.push([column + stepColumn, row + stepRow]);
    }
  }
  return false;
}

function expectFree(player: PlayerState, where: string): void {
  expect(player.mode, where).toBe('foot');
  expect(bodyBlocked(player.position.x, player.position.z), `${where}: in a solid at ${player.position.x.toFixed(2)}, ${player.position.z.toFixed(2)}`).toBe(false);
  expect(roams(player.position.x, player.position.z), `${where}: shut in at ${player.position.x.toFixed(2)}, ${player.position.z.toFixed(2)}`).toBe(true);
}

/** The canoe afloat at an island's own landing, as run up its beach, everyone aboard. */
function atBerth(state: GameState, island: IslandDefinition): void {
  const berth = landingBerth(island.id, state.canoe.hullTier);
  floatCanoeAt(state, berth.x, berth.z, berth.heading);
  for (const player of state.players) Object.assign(player, { mode: 'canoe', islandId: null, position: { ...state.canoe.position } });
}

describe('the start of a game', () => {
  it('the first landing on Home Knoll puts a crew of four on clear ground, each with room to walk off', () => {
    for (const seed of [3, 7, 11]) {
      const state = newGame(seed, { crew: 4 });
      expect(state.players).toHaveLength(4);
      atBerth(state, ISLANDS.find((island) => island.id === 'home_knoll')!);
      for (const player of state.players) {
        expect(dispatch(state, { type: 'disembark' }, player.id).ok, `seed ${seed}`).toBe(true);
        expectFree(player, `seed ${seed}, player ${player.id}`);
      }
      // Nobody on anybody: a crew does not pile onto one point.
      for (const one of state.players) for (const other of state.players) {
        if (one.id < other.id) expect(Math.hypot(one.position.x - other.position.x, one.position.z - other.position.z)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('stepping ashore', () => {
  it.each(ISLANDS.map((island) => island.id))('%s: at its landing, a crew of four steps onto clear ground', (islandId) => {
    const state = newGame(7, { crew: 4 });
    atBerth(state, ISLANDS.find((island) => island.id === islandId)!);
    for (const player of state.players) {
      expect(dispatch(state, { type: 'disembark' }, player.id).ok).toBe(true);
      expectFree(player, `${islandId}, player ${player.id}`);
    }
  });

  it('anywhere round every island: wherever the rules offer "Land", the step ashore is onto clear ground', () => {
    let landings = 0;
    const byIsland: Record<string, number> = {};
    for (const island of ISLANDS) {
      for (let turn = 0; turn < 48; turn += 1) {
        const angle = (turn / 48) * Math.PI * 2;
        // In from open water along this bearing, to the first place the rules let anyone step out.
        for (let reach = 1.35; reach >= 0.6; reach -= 0.004) {
          const point = spotPosition(island, { along: Math.cos(angle) * reach, across: Math.sin(angle) * reach });
          if (terrainHeight(point.x, point.z) > -0.3) break;
          const state = newGame(7);
          floatCanoeAt(state, point.x, point.z, Math.atan2(island.center.x - point.x, -(island.center.z - point.z)));
          if (!disembarkSpot(state)) continue;
          expect(dispatch(state, { type: 'disembark' }).ok).toBe(true);
          expectFree(state.players[0], `${island.id}, bearing ${turn} of 48`);
          landings += 1;
          byIsland[island.id] = (byIsland[island.id] ?? 0) + 1;
          break;
        }
      }
    }
    expect(landings).toBeGreaterThan(ISLANDS.length * 30);
    for (const island of ISLANDS) expect(byIsland[island.id] ?? 0, island.id).toBeGreaterThan(20);
  });

  it('never onto a solid spot: a step ashore or a waking aimed at the middle of one lands beside it', () => {
    // Landing and waking both ask `clearSpot` where to stand. Asked for the middle of every solid spot in turn.
    let asked = 0;
    for (const node of NODES) {
      if (node.reach !== 'foot' || nodeSolids(node).length === 0) continue;
      const state = newGame(7);
      const spot = clearSpot(state, state.players[0], node.position);
      expect(bodyBlocked(spot.x, spot.z), node.id).toBe(false);
      expect(Math.hypot(spot.x - node.position.x, spot.z - node.position.z), node.id).toBeLessThanOrEqual(4 + 1e-9);
      asked += 1;
    }
    expect(asked).toBeGreaterThan(120);
  });
});

describe('boarding, and landing again', () => {
  it.each(ISLANDS.map((island) => island.id))('%s: from the beach into the canoe and back out, onto clear ground', (islandId) => {
    const state = newGame(7);
    standOn(state, islandId);
    drainEvents(state);
    expect(dispatch(state, { type: 'board' }).ok).toBe(true);
    expect(state.players[0].mode).toBe('canoe');
    expect(dispatch(state, { type: 'disembark' }).ok).toBe(true);
    expectFree(state.players[0], islandId);
  });
});

describe('waking after a fail', () => {
  const camps = ISLANDS.filter((island) => island.camp);

  it.each(camps.map((island) => island.id))('%s: washed ashore at this camp, the player wakes on clear ground', (islandId) => {
    const state = newGame(7);
    state.respawnCampIslandId = islandId;
    floatCanoeAt(state, 200, 1300, 0);
    state.canoe.waterLevel = 99;
    runUntilFail(state, {}, 5);
    expect(state.statistics.fails).toBe(1);
    expect(state.players[0].islandId).toBe(islandId);
    expectFree(state.players[0], islandId);
  });

  it.each(camps.map((island) => island.id))('%s: one of a crew fails alone and wakes there on clear ground, beside nobody', (islandId) => {
    const state = newGame(7, { crew: 2 });
    state.respawnCampIslandId = islandId;
    standOn(state, 'home_knoll');
    Object.assign(state.players[1], { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...state.players[0].position } });
    state.players[1].position.x += 1.5;
    state.players[1].hunger = 0;
    state.players[1].energy = 1;
    drainEvents(state);
    runUntilFail(state, {}, 10);
    expect(state.statistics.fails).toBe(1);
    // The one who failed woke at the camp; the other never left Home Knoll's beach.
    expect(state.players[1].energy).toBe(TUNING.survival.failMeterValue);
    expect(state.players[1].islandId).toBe(islandId);
    expectFree(state.players[1], islandId);
  });

  it('with a canopy, where the canoe was last beached: on every island\'s landing', () => {
    for (const island of ISLANDS) {
      const state = newGame(7);
      state.canoe.hullTier = 2;
      build(state, 'canopy', 'outrigger_port');
      standOn(state, island.id);
      dispatch(state, { type: 'board' });
      floatCanoeAt(state, 150, -500); // the Narrows on one outrigger
      state.canoe.waterLevel = 99;
      runUntilFail(state, {}, 5);
      expect(state.statistics.fails, island.id).toBe(1);
      expect(state.players[0].islandId, island.id).toBe(island.id);
      expectFree(state.players[0], island.id);
    }
  });
});

describe('a save made before these things were solid', () => {
  const fixtures = import.meta.glob<string>('./fixtures/*.json', { eager: true, query: '?raw', import: 'default' });
  const saves = Object.entries(fixtures).filter(([name]) => !name.includes('settings-'));

  /** Home Knoll, on foot, standing on the rain barrel's own middle: where a player stood to use it. */
  function inTheBarrel(): GameState {
    const state = newGame(7);
    standOn(state, 'home_knoll');
    const barrel = NODES_BY_ID['home_knoll.rain_barrel.1'].position;
    Object.assign(state.players[0], { position: { x: barrel.x, y: terrainHeight(barrel.x, barrel.z), z: barrel.z } });
    drainEvents(state);
    return state;
  }

  it('every save kept from the live game loads with nobody on foot in a solid, once stepped clear', () => {
    expect(saves.length).toBeGreaterThanOrEqual(9);
    for (const [name, text] of saves) {
      const loaded = deserialize(text);
      expect(loaded.ok, name).toBe(true);
      if (!loaded.ok) continue;
      const before = loaded.state.players.map((player) => ({ ...player.position }));
      const moved = standClear(loaded.state);
      loaded.state.players.forEach((player, at) => {
        if (player.mode !== 'foot') {
          expect(player.position, `${name}: someone aboard is left alone`).toEqual(before[at]);
          return;
        }
        expect(bodyBlocked(player.position.x, player.position.z), `${name}, player ${player.id}`).toBe(false);
        // Stepped clear, not sent away: no farther than the reach of the search.
        expect(Math.hypot(player.position.x - before[at].x, player.position.z - before[at].z), name).toBeLessThanOrEqual(4 + 1e-9);
      });
      // A second look moves nobody: clear is clear.
      expect(standClear(loaded.state), name).toBe(0);
      expect(moved).toBeLessThanOrEqual(loaded.state.players.length);
    }
  });

  it('a player saved standing on the rain barrel is stepped to its side, still in reach of its water', () => {
    const state = inTheBarrel();
    const barrel = NODES_BY_ID['home_knoll.rain_barrel.1'].position;
    expect(bodyBlocked(barrel.x, barrel.z)).toBe(true);
    const loaded = deserialize(serialize(state, 5));
    if (!loaded.ok) throw new Error('the save did not load');
    expect(standClear(loaded.state)).toBe(1);
    const player = loaded.state.players[0];
    expectFree(player, 'out of the barrel');
    expect(Math.hypot(player.position.x - barrel.x, player.position.z - barrel.z)).toBeLessThan(1.5);
    expect(player.position.y).toBeCloseTo(terrainHeight(player.position.x, player.position.z), 6);
    expect(selectInteractable(loaded.state)).toMatchObject({ kind: 'node', nodeId: 'home_knoll.rain_barrel.1' });
  });

  it('leaves alone everyone who stands clear, and everyone aboard', () => {
    const state = newGame(7, { crew: 2 });
    standOn(state, 'home_knoll');
    const barrel = NODES_BY_ID['home_knoll.rain_barrel.1'].position;
    // Aboard, but with the barrel's own place written on them: a seat is not a place on the ground.
    Object.assign(state.players[1], { mode: 'canoe', position: { x: barrel.x, y: 0, z: barrel.z } });
    const before = JSON.stringify(state.players);
    expect(standClear(state)).toBe(0);
    expect(JSON.stringify(state.players)).toBe(before);
  });

  it('the game does it when it loads a slot: Continue on such a save starts beside the barrel, not in it', () => {
    const storage = new FakeStorage();
    createSaveStore(storage, () => 5).save(0, inTheBarrel());
    const session = new Session({ storage, now: () => 5, randomSeed: () => 1 });
    expect(session.loadGame(0)).toBe(true);
    const player = session.game!.players[0];
    expectFree(player, 'loaded');
    expect(selectInteractable(session.game!)).toMatchObject({ kind: 'node', nodeId: 'home_knoll.rain_barrel.1' });
  });

  it('every spot that is solid now can be stood on in an old save and stepped off: no spot traps', () => {
    let stepped = 0;
    for (const node of NODES) {
      if (node.reach !== 'foot' || !bodyBlocked(node.position.x, node.position.z)) continue;
      const state = newGame(7);
      Object.assign(state.players[0], { mode: 'foot', seat: null, islandId: node.islandId, position: { x: node.position.x, y: 0, z: node.position.z } });
      if (standClear(state) === 0) continue; // Shut in a landmark's outline farther than a step: the player walks out, as before (tests/solids.test.ts).
      expect(bodyBlocked(state.players[0].position.x, state.players[0].position.z), node.id).toBe(false);
      stepped += 1;
    }
    expect(stepped).toBeGreaterThan(100);
  });
});
