/**
 * A guest carries its own pack and meters: kept in its own browser, brought in
 * `join.carry`, read strictly by the host, and put on whatever seat the guest
 * gets. A seat taken over by someone who brings nothing starts fresh.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { CARRY_VERSION, applyCarry, carryOf, freshCarry, readCarry } from '../src/net/carry.ts';
import type { Carry } from '../src/net/carry.ts';
import { PROTOCOL_VERSION, readClientMessage } from '../src/net/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, addPlayer, drainEvents, setConnected, step } from '../src/sim/index.ts';
import { CARRY_WRITE_SECONDS, CarryStore, carrySlot } from '../src/client/carrystore.ts';
import type { CarryStorage } from '../src/client/carrystore.ts';
import { calmGame, createRig, key } from './net/rig.ts';
import type { Rig, Seat } from './net/rig.ts';

const v = PROTOCOL_VERSION;
const good = (): Carry => ({ v: CARRY_VERSION, backpack: [{ itemId: 'driftwood', count: 7 }, { itemId: 'clay', count: 2 }], hunger: 41, thirst: 52, energy: 63 });

class MemoryStorage implements CarryStorage {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(slot: string): string | null { return this.items.get(slot) ?? null; }
  setItem(slot: string, value: string): void { this.writes += 1; this.items.set(slot, value); }
}

/** A browser that keeps `carry` for `name`. */
function browserWith(name: string, carry: Carry | null): MemoryStorage {
  const storage = new MemoryStorage();
  if (carry) storage.setItem(carrySlot(name), JSON.stringify(carry));
  storage.writes = 0;
  return storage;
}

function joinWith(rig: Rig, name: string, storage: CarryStorage | null): Seat {
  return rig.join(name, key(name), undefined, { carry: new CarryStore(name, storage) });
}

describe('the host reads a carry strictly', () => {
  it('reads a good one as it is', () => {
    expect(readCarry(good())).toEqual(good());
    expect(readCarry({ ...good(), backpack: [] })).toEqual({ ...good(), backpack: [] });
  });

  it('refuses each kind of bad one, and never throws', () => {
    const stacks = (count: number) => Array.from({ length: count }, () => ({ itemId: 'stone', count: 1 }));
    const bad: unknown[] = [
      null, 'carry', 7, [], {},
      { ...good(), v: CARRY_VERSION + 1 },
      { ...good(), spot: { x: 0, z: 0 } },
      { v: CARRY_VERSION, backpack: [], hunger: 50, thirst: 50 },
      { ...good(), backpack: 'driftwood' },
      { ...good(), backpack: [{ itemId: 'gold_bar', count: 1 }] },
      { ...good(), backpack: [{ itemId: 'toString', count: 1 }] },
      { ...good(), backpack: [{ itemId: 'stone', count: 0 }] },
      { ...good(), backpack: [{ itemId: 'stone', count: 1.5 }] },
      { ...good(), backpack: [{ itemId: 'stone', count: TUNING.inventory.stackSize + 1 }] },
      { ...good(), backpack: [{ itemId: 'stone', count: 1, extra: true }] },
      { ...good(), backpack: [null] },
      { ...good(), backpack: stacks(TUNING.inventory.backpackSlots + 1) },
      { ...good(), hunger: Number.NaN },
      { ...good(), thirst: Number.POSITIVE_INFINITY },
      { ...good(), energy: '90' },
    ];
    for (const raw of bad) expect(readCarry(raw), JSON.stringify(raw)).toBeNull();
    expect(readCarry({ ...good(), backpack: stacks(TUNING.inventory.backpackSlots) })).not.toBeNull();
  });

  it('holds meters to their range, and lifts an empty one to where a fail wakes a player', () => {
    expect(readCarry({ ...good(), hunger: 150, thirst: -5, energy: 0 })).toMatchObject({
      hunger: 100, thirst: TUNING.survival.failMeterValue, energy: TUNING.survival.failMeterValue,
    });
  });

  it('lifts a meter just above 0 too, and keeps one at the floor where effort is still allowed', () => {
    const floor = TUNING.survival.minimumEnergyToExert;
    expect(readCarry({ ...good(), hunger: 0.3, thirst: floor - 0.1, energy: floor })).toMatchObject({
      hunger: TUNING.survival.failMeterValue, thirst: TUNING.survival.failMeterValue, energy: floor,
    });
  });

  it('a join with a bad carry still joins, as one who brings nothing', () => {
    const join = { v, type: 'join', name: 'Sam', key: key('Sam'), character: 'scout' };
    expect(readClientMessage({ ...join, carry: good() })).toEqual({ ...join, carry: good() });
    expect(readClientMessage({ ...join, carry: { ...good(), hunger: 'full' } })).toEqual(join);
    expect(readClientMessage(join)).toEqual(join);
    // Anything else new is still refused whole.
    expect(readClientMessage({ ...join, pack: good() })).toBeNull();
  });

  it('a fresh carry is what a new seat gets', () => {
    const game = calmGame();
    const player = addPlayer(game)!;
    expect(carryOf(player)).toEqual(freshCarry());
    applyCarry(player, good());
    expect(carryOf(player)).toEqual(good());
  });
});

/** The host and three guests, all here, then Ann leaves: the canoe is full and her seat is the one to take. */
function fullWithAnnAway(): Rig {
  const rig = createRig();
  const [ann] = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
  rig.run(0.5);
  const seat = rig.game.players[1]!;
  seat.backpack.push({ itemId: 'stone', count: 9 });
  Object.assign(seat, { hunger: 20, thirst: 30 });
  rig.run(0.2);
  ann!.link.close();
  rig.run(0.5);
  return rig;
}

describe('the seat gets the carry, in each case of join', () => {
  it('a new seat: the carry, or the starting kit', () => {
    const rig = createRig();
    const sam = joinWith(rig, 'Sam', browserWith('Sam', good()));
    const kim = joinWith(rig, 'Kim', browserWith('Kim', null));
    rig.run(0.5);
    expect(carryOf(rig.game.players[sam.link.playerId]!)).toMatchObject({ backpack: good().backpack });
    expect(rig.game.players[sam.link.playerId]!.hunger).toBeCloseTo(41, 0);
    expect(rig.game.players[kim.link.playerId]!.backpack).toEqual([]);
    expect(rig.game.players[kim.link.playerId]!.hunger).toBeCloseTo(80, 0);
    expect(rig.settle()).toBe(true);
  });

  it('their own seat back: the carry, or what the seat holds', () => {
    const rig = createRig();
    const storage = browserWith('Sam', null);
    const sam = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    rig.game.players[1]!.backpack.push({ itemId: 'stone', count: 3 });
    rig.run(0.5);
    sam.link.close();
    rig.run(0.5);
    // Without a carry (another browser's storage is empty, same key): the seat as it holds.
    const bare = rig.join('Sam', key('Sam'));
    rig.run(0.5);
    expect(bare.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([{ itemId: 'stone', count: 3 }]);
    bare.link.close();
    rig.run(0.5);
    // With one another host sent (they played elsewhere in between): what the guest brings, even if the host's copy says otherwise.
    rig.game.players[1]!.backpack = [];
    storage.setItem(carrySlot('Sam'), JSON.stringify({ ...JSON.parse(storage.getItem(carrySlot('Sam'))!), confirmedBy: 7 }));
    const back = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([{ itemId: 'stone', count: 3 }]);
  });

  it('a seat taken over: the carry, never the old holder\'s pack', () => {
    const rig = fullWithAnnAway();
    const dee = joinWith(rig, 'Dee', browserWith('Dee', good()));
    rig.run(0.5);
    expect(dee.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual(good().backpack);
    expect(rig.game.players[1]!.hunger).toBeCloseTo(41, 0);
  });

  it('a seat taken over by one who brings nothing: the starting kit and fresh meters', () => {
    const rig = fullWithAnnAway();
    const eve = joinWith(rig, 'Eve', null);
    rig.run(0.5);
    expect(eve.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([]);
    expect(rig.game.players[1]!.hunger).toBeCloseTo(80, 0);
    expect(rig.game.players[1]!.thirst).toBeCloseTo(75, 0);
    expect(rig.settle()).toBe(true);
  });

  it('a stand-in nobody named, had by one who brings nothing: the starting kit, never what the seat holds', () => {
    // A staged crew (`?crew=4`): the three extra seats are away, unnamed, bound to no key. One holds a pack.
    const game = calmGame(4);
    for (const player of game.players.slice(1)) setConnected(game, player.id, false, true);
    game.players[1]!.backpack.push({ itemId: 'stone', count: 9 });
    Object.assign(game.players[1]!, { hunger: 20 });
    const rig = createRig({ game });
    const eve = joinWith(rig, 'Eve', null);
    rig.run(0.5);
    expect(eve.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([]);
    expect(rig.game.players[1]!.hunger).toBeCloseTo(80, 0);
    expect(rig.settle()).toBe(true);
  });
});

describe('the same host\'s seat is newer', () => {
  it('their own seat back by key at the same host: a thing added after the last confirmed state stays', () => {
    const rig = createRig();
    const storage = browserWith('Sam', null);
    const sam = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    rig.game.players[1]!.backpack.push({ itemId: 'stone', count: 3 });
    rig.run(0.5);
    // A pickup the guest never hears of: the window closes first.
    rig.game.players[1]!.backpack.push({ itemId: 'driftwood', count: 2 });
    sam.link.close();
    expect(readCarry(JSON.parse(storage.getItem(carrySlot('Sam'))!))).toMatchObject({ backpack: [{ itemId: 'stone', count: 3 }], confirmedBy: 42 });
    rig.run(0.5);
    const back = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([{ itemId: 'stone', count: 3 }, { itemId: 'driftwood', count: 2 }]);
  });

  it('back at host A after playing at host B: the seat gets what B sent', () => {
    const storage = browserWith('Sam', null);
    const hostA = createRig();
    const atA = joinWith(hostA, 'Sam', storage);
    hostA.run(0.5);
    hostA.game.players[1]!.backpack.push({ itemId: 'stone', count: 3 });
    hostA.run(0.5);
    atA.link.close();
    hostA.run(0.5);
    const hostB = createRig({ host: { session: 77 } });
    const atB = joinWith(hostB, 'Sam', storage);
    hostB.run(0.5);
    hostB.game.players[atB.link.playerId]!.backpack.push({ itemId: 'clay', count: 4 });
    hostB.run(0.5);
    atB.link.close();
    expect(readCarry(JSON.parse(storage.getItem(carrySlot('Sam'))!))).toMatchObject({ confirmedBy: 77 });
    // Host A never stopped: Sam's key still holds seat 1 there.
    const back = joinWith(hostA, 'Sam', storage);
    hostA.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(hostA.game.players[1]!.backpack).toEqual([{ itemId: 'stone', count: 3 }, { itemId: 'clay', count: 4 }]);
  });

  it('a carry with a bad confirmedBy is refused whole, and the join still goes through', () => {
    for (const confirmedBy of [-1, 1.5, '42', null, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
      expect(readCarry({ ...good(), confirmedBy }), String(confirmedBy)).toBeNull();
    }
    expect(readCarry({ ...good(), confirmedBy: 42 })).toEqual({ ...good(), confirmedBy: 42 });
    const join = { v, type: 'join', name: 'Sam', key: key('Sam'), character: 'scout' };
    expect(readClientMessage({ ...join, carry: { ...good(), confirmedBy: -1 } })).toEqual(join);
    const rig = createRig();
    const sam = joinWith(rig, 'Sam', browserWith('Sam', { ...good(), confirmedBy: 'host' } as unknown as Carry));
    rig.run(0.5);
    expect(sam.link.playerId).toBe(1);
    expect(rig.game.players[1]!.backpack).toEqual([]);
  });
});

describe('the guest keeps its carry', () => {
  it('round trip: what the host confirmed is kept, and brought to the next crew', () => {
    const storage = browserWith('Sam', null);
    const first = createRig();
    const sam = joinWith(first, 'Sam', storage);
    first.run(0.5);
    first.game.players[1]!.backpack.push({ itemId: 'driftwood', count: 5 });
    first.run(0.5);
    sam.link.close();
    expect(readCarry(JSON.parse(storage.getItem(carrySlot('Sam'))!))).toMatchObject({ backpack: [{ itemId: 'driftwood', count: 5 }] });
    // Another host, another world: the pack goes with Sam.
    const second = createRig();
    const again = joinWith(second, 'Sam', storage);
    second.run(0.5);
    expect(second.game.players[again.link.playerId]!.backpack).toEqual([{ itemId: 'driftwood', count: 5 }]);
  });

  it('writes when it changed, at most every few seconds, and once more on leaving', () => {
    const storage = new MemoryStorage();
    const store = new CarryStore('Sam', storage);
    store.note(good(), 0);
    expect(storage.writes).toBe(1);
    store.note(good(), 1);
    expect(storage.writes).toBe(1);
    store.note({ ...good(), hunger: 40 }, 2);
    expect(storage.writes).toBe(1);
    store.note({ ...good(), hunger: 39 }, CARRY_WRITE_SECONDS);
    expect(storage.writes).toBe(2);
    store.note({ ...good(), hunger: 38 }, CARRY_WRITE_SECONDS + 1);
    expect(storage.writes).toBe(2);
    store.flush();
    expect(storage.writes).toBe(3);
    expect(store.read()).toMatchObject({ hunger: 38 });
    // Nothing new: leaving writes nothing.
    store.flush();
    expect(storage.writes).toBe(3);
  });

  it('with no storage, or storage that throws, nothing is kept and nothing breaks', () => {
    const throwing: CarryStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    for (const storage of [null, throwing]) {
      const store = new CarryStore('Sam', storage);
      expect(store.read()).toBeNull();
      expect(() => { store.note(good(), 0); store.flush(); }).not.toThrow();
      const rig = createRig();
      const sam = joinWith(rig, 'Sam', storage);
      rig.run(0.5);
      expect(sam.link.status).toBe('playing');
      expect(rig.game.players[1]!.backpack).toEqual([]);
      sam.link.close();
    }
    // Kept text that is not a carry reads as none.
    const storage = new MemoryStorage();
    storage.setItem(carrySlot('Sam'), '{not json');
    expect(new CarryStore('Sam', storage).read()).toBeNull();
  });

  it('asking again while seated brings nothing: the host\'s seat is newer than what the guest kept', () => {
    const rig = createRig();
    const sam = joinWith(rig, 'Sam', browserWith('Sam', good()));
    rig.run(0.5);
    // A pickup the guest has not heard of yet, then a knock.
    rig.game.players[1]!.backpack.push({ itemId: 'stone', count: 4 });
    sam.link.knock();
    rig.run(0.5);
    expect(rig.game.players[1]!.backpack).toContainEqual({ itemId: 'stone', count: 4 });
  });

  it('two tabs under one name: the tab that was replaced writes nothing more', () => {
    const storage = browserWith('Sam', null);
    const rig = createRig();
    const older = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    const newer = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    expect(older.link.leaveReason).toBe('replaced');
    rig.game.players[1]!.backpack.push({ itemId: 'clay', count: 6 });
    rig.run(0.5);
    newer.link.close();
    older.link.close();
    expect(readCarry(JSON.parse(storage.getItem(carrySlot('Sam'))!))).toMatchObject({ backpack: [{ itemId: 'clay', count: 6 }] });
  });
});

/** The host plays on while a guest's tab is hidden: the wire still carries messages, the guest runs no frame. */
function hostAlone(rig: Rig, seat: Seat, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
    seat.pair.advance(FIXED_STEP);
    step(rig.game, rig.host.crewInput({ ...NEUTRAL_INPUT }, 0), FIXED_STEP);
    rig.host.afterFrame(drainEvents(rig.game), FIXED_STEP);
  }
}

const seatOf = (rig: Rig, seat: Seat) => rig.game.players.find((player) => player.id === seat.link.playerId)!;

describe('the carry where the host takes a crewmate out, and where a tab is hidden', () => {
  it('a removed guest keeps their carry in their own browser, and comes back as new with it', () => {
    const storage = browserWith('Sam', null);
    const rig = createRig();
    const sam = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    seatOf(rig, sam).backpack = [{ itemId: 'stone', count: 5 }];
    rig.run(0.5);
    const samId = sam.link.playerId;
    expect(rig.host.remove(samId)).toBe(0);
    rig.run(0.5);
    expect(sam.link.leaveReason).toBe('removed');
    // The leave wrote the carry: the removal did not skip it.
    expect(readCarry(JSON.parse(storage.getItem(carrySlot('Sam'))!))).toMatchObject({ backpack: [{ itemId: 'stone', count: 5 }] });
    // Back on the link: their key was forgotten, so a new seat, with what their own browser kept.
    const back = joinWith(rig, 'Sam', storage);
    rig.run(0.5);
    expect(back.link.status).toBe('playing');
    expect(seatOf(rig, back).backpack).toEqual([{ itemId: 'stone', count: 5 }]);
    expect(rig.settle()).toBe(true);
  });

  it('a newcomer on a removed guest\'s seat starts fresh, or with their own carry, never with the removed one\'s pack', () => {
    const rig = createRig();
    const sam = joinWith(rig, 'Sam', browserWith('Sam', good()));
    rig.run(0.5);
    const samId = sam.link.playerId;
    Object.assign(seatOf(rig, sam), { hunger: 20 });
    rig.host.remove(samId);
    rig.run(0.5);
    const kim = joinWith(rig, 'Kim', browserWith('Kim', null));
    rig.run(0.5);
    expect(kim.link.playerId).toBe(samId);
    expect(seatOf(rig, kim).backpack).toEqual([]);
    expect(seatOf(rig, kim).hunger).toBeCloseTo(80, 0);
    rig.host.remove(kim.link.playerId);
    rig.run(0.5);
    const dee = joinWith(rig, 'Dee', browserWith('Dee', { ...good(), backpack: [{ itemId: 'clay', count: 3 }] }));
    rig.run(0.5);
    expect(dee.link.playerId).toBe(samId);
    expect(seatOf(rig, dee).backpack).toEqual([{ itemId: 'clay', count: 3 }]);
    expect(rig.settle()).toBe(true);
  });

  it('hidden long enough to be marked away, then back: the carry was written on hiding, the seat and its newer pack stand', () => {
    const storage = browserWith('Sam', good());
    const rig = createRig({ host: { silenceSeconds: 2 } });
    const sam = joinWith(rig, 'Sam', storage);
    rig.run(1);
    const samId = sam.link.playerId;
    seatOf(rig, sam).backpack.push({ itemId: 'stone', count: 4 });
    rig.run(1);
    // The page goes hidden: the carry is written now, and the line stays open.
    storage.writes = 0;
    sam.link.keepCarry();
    expect(storage.writes).toBe(1);
    expect(sam.link.status).toBe('playing');
    // While hidden the host gives the seat one more thing the guest's kept carry does not have.
    hostAlone(rig, sam, 4);
    expect(rig.game.players.find((player) => player.id === samId)!.connected).toBe(false);
    seatOf(rig, sam).backpack.push({ itemId: 'clay', count: 2 });
    // Meanwhile another tab of this browser played at another host and kept its carry: older than this seat, and not this host's.
    storage.setItem(carrySlot('Sam'), JSON.stringify({ ...good(), confirmedBy: 7 }));
    // Back on the tab: a knock, which brings no carry, so nothing old is laid over the seat.
    sam.link.knock();
    rig.run(1);
    expect(sam.link.playerId).toBe(samId);
    expect(rig.game.players.find((player) => player.id === samId)!.connected).toBe(true);
    expect(seatOf(rig, sam).backpack).toContainEqual({ itemId: 'stone', count: 4 });
    expect(seatOf(rig, sam).backpack).toContainEqual({ itemId: 'clay', count: 2 });
    expect(rig.settle()).toBe(true);
  });
});
