/**
 * A host and its guests, in step: the same game on every screen, on a good
 * line and on a bad one, with players joining late, dropping and returning,
 * and with messages that try to cheat. No network: loopback wires.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING } from '../../src/data/index.ts';
import { GuestLink, HostLink, PROTOCOL_VERSION, STALE_INPUT_SECONDS, createLoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, dispatch, drainEvents, hashState, setConnected, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { bedSide, countIn, newGame, standOn } from '../support.ts';
import { calmGame, createRig, key } from './rig.ts';

const v = PROTOCOL_VERSION;
const BAD_LINE = { delay: 0.12, jitter: 0.1, loss: 0.2 };

/** The canoe beached at Home Knoll, the crew in a row by the fire, fed and rested. */
function campGame(crew = 1): GameState {
  const game = newGame(7, { crew });
  standOn(game, 'home_knoll');
  seatByFire(game);
  // The first quest is behind the crew, so nobody is paid for setting foot on Home Knoll.
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  // And Home Knoll is no news: no arrival event joins the stream these tests count and time.
  game.reachedPlaces = ['island:home_knoll'];
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  return game;
}

function seatByFire(game: GameState): void {
  // In camp, by the lean-to: the bed is where the night is slept, the fire only warms.
  game.players.forEach((player, index) => {
    const { x, z } = bedSide('home_knoll', index);
    Object.assign(player, {
      mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, z), z },
      hunger: 100, thirst: 100, energy: 100,
    });
  });
}

describe('joining', () => {
  it('seats a guest as a new player, tells them who they are and hands them the whole game', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    expect(sam.link.status).toBe('joining');
    rig.run(0.2);
    expect(sam.link.status).toBe('playing');
    expect(sam.link.playerId).toBe(1);
    expect(sam.link.hostId).toBe(0);
    expect(rig.game.players.map((player) => [player.id, player.name, player.connected, player.seat])).toEqual([[0, '', true, 0], [1, 'Sam', true, 1]]);
    expect(rig.host.guests).toEqual([1]);
    expect(rig.hostEvents).toContainEqual({ type: 'crew_changed', who: 1, change: 'joined' });
    expect(rig.settle()).toBe(true);
    expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
  });

  it('lets a player join a game well under way, and lands them in it as it is', () => {
    const rig = createRig();
    rig.hostInput = { paddle: 1, steer: 0.2 };
    rig.run(90);
    expect(rig.game.statistics.distancePaddled).toBeGreaterThan(100);
    rig.game.tools.push('hatchet');
    const played = rig.game.playedSeconds;
    const late = rig.join('Late');
    rig.run(1);
    expect(late.link.playerId).toBe(1);
    expect(late.link.truth!.playedSeconds).toBeGreaterThan(played);
    expect(late.link.truth!.tools).toEqual(['bailing_can', 'hatchet']);
    expect(Math.abs(late.link.truth!.canoe.position.z - rig.game.canoe.position.z)).toBeLessThan(2);
    expect(late.link.truth!.statistics.distancePaddled).toBeGreaterThan(100);
    // Seated in the canoe where it is now, with their own meters.
    expect(rig.game.players[1]).toMatchObject({ mode: 'canoe', seat: 1, connected: true });
    expect(rig.settle()).toBe(true);
  });

  it('seats up to four, each their own player, and turns a fifth away', () => {
    const rig = createRig();
    const seats = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
    rig.run(0.5);
    expect(seats.map((seat) => seat.link.playerId)).toEqual([1, 2, 3]);
    const fifth = rig.join('Dee');
    rig.run(0.5);
    expect(fifth.link.status).toBe('refused');
    expect(fifth.link.leaveReason).toBe('full');
    expect(rig.game.players).toHaveLength(4);
    expect(rig.settle()).toBe(true);
  });

  it('gives a free stand-in to a newcomer when the canoe is full of them', () => {
    const game = calmGame(4);
    for (const id of [1, 2, 3]) setConnected(game, id, false, true);
    const rig = createRig({ game });
    const sam = rig.join('Sam');
    rig.run(0.5);
    expect(sam.link.status).toBe('playing');
    expect(game.players).toHaveLength(4);
    expect(game.players[sam.link.playerId]).toMatchObject({ name: 'Sam', connected: true });
    expect(sam.link.playerId).not.toBe(0);
  });

  it('turns away a guest that speaks another version', () => {
    const rig = createRig();
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    const heard: unknown[] = [];
    pair.guest.receive((message) => void heard.push(message));
    pair.guest.send({ v: v + 1, type: 'join', name: 'Old', key: key('Old'), character: 'voyageur' });
    pair.advance(0);
    pair.advance(0);
    // Said in the sender's own version: a tab reads nothing else (`tests/net/cast.test.ts` has the whole story).
    expect(heard).toEqual([{ v: v + 1, type: 'leave', reason: 'version' }]);
    expect(rig.game.players).toHaveLength(1);
  });
});

describe('in step', () => {
  it('on a perfect line the guest holds the host\'s game, fingerprint for fingerprint', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.hostInput = { paddle: 1 };
    sam.input = { paddle: 1, steer: -0.3 };
    rig.run(20);
    expect(sam.link.mismatches).toBe(0);
    // A beat behind while the game runs, and never ahead.
    expect(sam.link.truthStep).toBeLessThanOrEqual(rig.game.tick);
    expect(rig.game.tick - sam.link.truthStep).toBeLessThan(8);
    expect(rig.settle()).toBe(true);
    expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
    expect(JSON.stringify(sam.link.truth)).toBe(JSON.stringify({ ...rig.game, events: [] }));
  });

  it('on a bad line (delay, jitter, one message in five lost) three guests still end on the host\'s fingerprint', () => {
    const rig = createRig({ conditions: BAD_LINE });
    const seats = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
    rig.run(2);
    expect(seats.map((seat) => seat.link.status)).toEqual(['playing', 'playing', 'playing']);
    for (const player of rig.game.players) player.backpack.push({ itemId: 'berries', count: 12 });
    // A minute of everyone doing something different, changing every few seconds, with commands thrown in.
    for (let second = 0; second < 60; second += 1) {
      rig.hostInput = { paddle: second % 7 < 5 ? 1 : 0, steer: Math.sin(second) };
      seats.forEach((seat, index) => {
        seat.input = { paddle: (second + index) % 4 === 0 ? -1 : 1, steer: Math.cos(second * (index + 1)), bail: second % 11 === index };
        if (second % 9 === index * 2) seat.link.sendCommand({ type: 'eat', itemId: 'berries' });
        if (second % 13 === index) seat.link.sendCommand({ type: 'select_tool', toolId: second % 2 ? 'bailing_can' : null });
      });
      rig.run(1);
    }
    expect(seats.map((seat) => seat.link.mismatches)).toEqual([0, 0, 0]);
    for (const seat of seats) {
      expect(seat.pair.stats.host.lost).toBeGreaterThan(100);
      expect(seat.pair.stats.guest.lost).toBeGreaterThan(100);
    }
    expect(rig.settle()).toBe(true);
    for (const seat of seats) expect(hashState(seat.link.truth!)).toBe(rig.hostHash());
  });

  it('a lost state does not stall a guest: the next one is against what the guest said it holds', () => {
    const rig = createRig({ conditions: { delay: 0.05, loss: 0.3 } });
    const sam = rig.join('Sam');
    rig.hostInput = { paddle: 1 };
    rig.run(3);
    let longest = 0;
    let since = 0;
    let last = sam.link.truthStep;
    for (let frame = 0; frame < 60 * 30; frame += 1) {
      rig.run(FIXED_STEP);
      since = sam.link.truthStep === last ? since + 1 : 0;
      last = sam.link.truthStep;
      longest = Math.max(longest, since);
    }
    // 30% loss: three or four states in a row go missing now and then. Never a second without one.
    expect(longest).toBeLessThan(60);
    expect(rig.host.stats.fullStatesSent).toBeLessThan(rig.host.stats.statesSent / 10);
    expect(sam.link.mismatches).toBe(0);
  });

  it('sends changes, not the whole game: about 15 state messages a second, each a fraction of a whole one', () => {
    const game = calmGame(3);
    // A game well under way: touched nodes and quests are the bulk of a whole state.
    for (let index = 0; index < 60; index += 1) game.nodes[`node_${index}`] = { readyAt: [index * 10, null], leftover: [] };
    const rig = createRig({ game });
    const sam = rig.join('Sam');
    rig.run(1);
    const whole = JSON.stringify({ ...game, events: [] }).length;
    const before = { ...sam.pair.stats.host.byType.state! };
    rig.hostInput = { paddle: 1 };
    rig.run(20);
    const after = sam.pair.stats.host.byType.state!;
    const perSecond = (after.count - before.count) / 20;
    const each = (after.bytes - before.bytes) / (after.count - before.count);
    expect(perSecond).toBeGreaterThan(14);
    expect(perSecond).toBeLessThan(16);
    expect(each).toBeLessThan(whole * 0.5);
    expect(rig.host.stats.fullStatesSent).toBeLessThanOrEqual(2);
  });
});

describe('events and commands over a bad line', () => {
  it('hands every guest every event, once, in the host\'s order', () => {
    const rig = createRig({ game: campGame(), conditions: BAD_LINE });
    const seats = ['Ann', 'Bo'].map((name) => rig.join(name));
    rig.run(3);
    seatByFire(rig.game);
    for (const player of rig.game.players) player.backpack.push({ itemId: 'berries', count: 20 });
    for (let round = 0; round < 40; round += 1) {
      // Each of these makes events on the host: an `ate` each, with the player who ate.
      dispatch(rig.game, { type: 'eat', itemId: 'berries' }, round % 3);
      if (round % 5 === 0) dispatch(rig.game, { type: 'toggle_lantern' }, 0);
      rig.run(0.5);
    }
    expect(rig.settle()).toBe(true);
    rig.run(1);
    for (const seat of seats) {
      expect(seat.events.filter((event) => event.type === 'ate')).toHaveLength(40);
      // Everything since they joined, nothing twice, nothing out of place.
      expect(seat.events).toEqual(rig.hostEvents.slice(-seat.events.length));
    }
  });

  it('runs every command a guest sends exactly once, in the order sent, and answers each', () => {
    const rig = createRig({ game: campGame(), conditions: BAD_LINE });
    const sam = rig.join('Sam');
    rig.run(3);
    seatByFire(rig.game);
    const player = rig.game.players[1];
    player.backpack.push({ itemId: 'berries', count: 20 });
    const sent: number[] = [];
    for (let round = 0; round < 12; round += 1) {
      sent.push(sam.link.sendCommand({ type: 'eat', itemId: 'berries' }));
      // Two in the same frame now and then: the second must not overtake the first.
      if (round % 4 === 0) sent.push(sam.link.sendCommand({ type: 'eat', itemId: 'berries' }));
      rig.run(0.4);
    }
    expect(rig.settle()).toBe(true);
    expect(sent).toHaveLength(15);
    expect(countIn(player.backpack, 'berries')).toBe(5);
    expect(sam.results.map((outcome) => outcome.id)).toEqual(sent);
    expect(sam.results.every((outcome) => outcome.result.ok)).toBe(true);
    expect(rig.host.stats.commandsRun).toBe(15);
    expect(sam.link.commandsWaiting).toBe(0);
  });

  /** A wire with no guest session on it: the test sends each message by hand and reads what comes back. */
  function rawWire(rig: ReturnType<typeof createRig>, name: string) {
    const pair = createLoopbackPair();
    const heard: { type: string; id?: number; playerId?: number }[] = [];
    rig.host.accept(pair.host);
    pair.guest.receive((message) => void heard.push(message as { type: string }));
    pair.guest.send({ v, type: 'join', name, key: key(name), character: 'voyageur' });
    pair.advance(0);
    pair.advance(0);
    const playerId = heard.find((message) => message.type === 'welcome')!.playerId!;
    const send = (id: number, toolId: 'bailing_can' | null): void => {
      pair.guest.send({ v, type: 'command', id, command: { type: 'select_tool', toolId }, at: 0 });
      pair.advance(0);
      pair.advance(0);
    };
    return { heard, playerId, send, results: () => heard.filter((message) => message.type === 'result').map((message) => message.id) };
  }

  it('runs commands in the order they were numbered, whatever order they arrive in', () => {
    const rig = createRig();
    const wire = rawWire(rig, 'Sam');
    const player = rig.game.players[wire.playerId]!;
    // The second arrives first: it waits. The first runs. The second runs when it is sent again.
    wire.send(2, null);
    expect(rig.host.stats.commandsRun).toBe(0);
    wire.send(1, 'bailing_can');
    expect(player.selectedTool).toBe('bailing_can');
    expect(rig.host.stats.commandsRun).toBe(1);
    wire.send(2, null);
    expect(player.selectedTool).toBeNull();
    expect(wire.results()).toEqual([1, 2]);
  });

  it('runs a command that arrives twice once, and answers it both times', () => {
    const rig = createRig();
    const wire = rawWire(rig, 'Sam');
    const player = rig.game.players[wire.playerId]!;
    wire.send(1, 'bailing_can');
    wire.send(2, null);
    // The first again, late: were it run again the paddle hand would hold the can.
    wire.send(1, 'bailing_can');
    expect(player.selectedTool).toBeNull();
    expect(rig.host.stats.commandsRun).toBe(2);
    expect(wire.results()).toEqual([1, 2, 1]);
  });

  it('answers a refusal with the reason, as the rules give it', () => {
    const rig = createRig({ game: campGame() });
    const sam = rig.join('Sam');
    rig.run(0.5);
    seatByFire(rig.game);
    sam.link.sendCommand({ type: 'eat', itemId: 'berries' });
    sam.link.sendCommand({ type: 'craft', recipeId: 'stone_knife' }, true);
    rig.run(0.5);
    expect(sam.results.map((outcome) => [outcome.result.ok, !outcome.result.ok && outcome.result.reason, outcome.quiet])).toEqual([
      [false, 'item_not_held', false], [false, 'missing_requirements', true],
    ]);
  });
});

describe('the host is the truth', () => {
  /** Host and two guests ashore, in step. */
  function ashoreRig() {
    const rig = createRig({ game: campGame() });
    const ann = rig.join('Ann');
    const bo = rig.join('Bo');
    rig.run(0.5);
    seatByFire(rig.game);
    rig.run(0.5);
    return { rig, ann, bo };
  }
  const frozen = (game: GameState): string => JSON.stringify({ ...game, events: [] });

  it('moves a guest\'s own player on that guest\'s input, and nobody else', () => {
    const { rig, bo } = ashoreRig();
    const before = rig.game.players.map((player) => ({ ...player.position }));
    bo.input = { moveX: 1 };
    rig.run(2);
    expect(rig.game.players[2].position.x).toBeGreaterThan(before[2]!.x + 2);
    expect(rig.game.players[0].position).toEqual(before[0]);
    expect(rig.game.players[1].position).toEqual(before[1]);
  });

  it('runs a guest\'s command as that guest, whatever the message claims', () => {
    const { rig, bo } = ashoreRig();
    rig.game.players[0].backpack.push({ itemId: 'berries', count: 3 });
    rig.game.players[1].backpack.push({ itemId: 'berries', count: 3 });
    const refused = rig.host.stats.refused;
    const before = frozen(rig.game);
    // Bo tries to eat Ann's berries, and the host's, by naming them every way a message could.
    bo.pair.guest.send({ v, type: 'command', id: 1, command: { type: 'eat', itemId: 'berries' }, at: 0, playerId: 1 });
    bo.pair.guest.send({ v, type: 'command', id: 1, command: { type: 'eat', itemId: 'berries', playerId: 0 }, at: 0 });
    bo.pair.guest.send({ v, type: 'command', id: 1, at: 0, playerId: 0, command: { type: 'discard', from: 'backpack', itemId: 'berries', count: 3 } });
    bo.pair.guest.send({ v, type: 'input', seq: 9999, have: 0, events: 0, playerId: 0, input: { ...NEUTRAL_INPUT, moveX: 1 }, step: 600, walk: [[0, 1, 0, 0, 0]] });
    bo.pair.advance(0);
    expect(rig.host.stats.refused).toBe(refused + 4);
    expect(frozen(rig.game)).toBe(before);
    // The honest form of the same command is Bo's own: Bo has no berries, so nothing is eaten.
    bo.link.sendCommand({ type: 'eat', itemId: 'berries' });
    rig.run(0.5);
    expect(bo.results.at(-1)!.result).toMatchObject({ ok: false, reason: 'item_not_held' });
    expect(rig.game.players.slice(0, 2).map((player) => countIn(player.backpack, 'berries'))).toEqual([3, 3]);
  });

  it('refuses a guest that sends the host\'s own messages: state, events, results, a welcome', () => {
    const { rig, bo } = ashoreRig();
    const refused = rig.host.stats.refused;
    const before = frozen(rig.game);
    const forged = { ...rig.game, time: 0, tools: ['hatchet', 'saw'], players: [] };
    bo.pair.guest.send({ v, type: 'state', id: 99999, step: 99999, hash: 'feedface', ack: 0, walked: 0, base: null, changed: forged });
    bo.pair.guest.send({ v, type: 'welcome', session: 42, playerId: 0, hostId: 2, id: 1, step: 1, hash: 'x', state: forged, events: 0, walked: 0 });
    bo.pair.guest.send({ v, type: 'events', first: 0, step: 1, events: [{ type: 'game_completed' }] });
    bo.pair.guest.send({ v, type: 'result', id: 1, result: { ok: true, gained: [{ itemId: 'hatchet', count: 1 }], spent: [] } });
    bo.pair.advance(0);
    expect(rig.host.stats.refused).toBe(refused + 4);
    expect(frozen(rig.game)).toBe(before);
    expect(rig.hostEvents.some((event) => event.type === 'game_completed')).toBe(false);
  });

  it('gives a wire that never joined no player: it moves no one and asks for nothing', () => {
    const { rig } = ashoreRig();
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    const refused = rig.host.stats.refused;
    const before = frozen(rig.game);
    pair.guest.send({ v, type: 'input', seq: 1, have: -1, events: 0, input: { ...NEUTRAL_INPUT, moveX: 1 }, step: 600, walk: [[0, 1, 0, 0, 0]] });
    pair.guest.send({ v, type: 'command', id: 1, command: { type: 'toggle_lantern' }, at: 0 });
    pair.guest.send({ v, type: 'ping', time: 0, have: -1, events: 0 });
    pair.advance(0);
    rig.run(1);
    expect(rig.host.stats.refused).toBe(refused + 3);
    expect(rig.game.canoe.lanternLit).toBe(false);
    expect(rig.game.players).toHaveLength(3);
    expect(rig.game.players.map((player) => player.position.x)).toEqual((JSON.parse(before) as GameState).players.map((player) => player.position.x));
  });

  it('gives one wire one seat: joining again under other keys takes no more, and a friend still gets in', () => {
    const rig = createRig();
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    const welcomed: number[] = [];
    pair.guest.receive((message) => {
      const heard = message as { type: string; playerId: number };
      if (heard.type === 'welcome') welcomed.push(heard.playerId);
    });
    const say = (message: object): void => {
      pair.guest.send(message);
      pair.advance(0);
      pair.advance(0);
    };
    const refused = rig.host.stats.refused;
    // One wire asks three times, each time as somebody new.
    for (const name of ['first', 'second', 'third']) say({ v, type: 'join', name: 'x', key: key(name), character: 'voyageur' });
    expect(rig.game.players.map((player) => [player.id, player.connected])).toEqual([[0, true], [1, true]]);
    expect(welcomed).toEqual([1]);
    expect(rig.host.guests).toEqual([1]);
    expect(rig.host.stats.refused).toBe(refused + 2);
    // Leaving first does not open the door either: the wire still has the one key it came with.
    say({ v, type: 'leave' });
    say({ v, type: 'join', name: 'y', key: key('fourth'), character: 'voyageur' });
    expect(rig.game.players.map((player) => [player.id, player.connected])).toEqual([[0, true], [1, false]]);
    expect(rig.host.stats.refused).toBe(refused + 3);
    // The same key on the same wire is still the same guest coming back.
    say({ v, type: 'join', name: 'x', key: key('first'), character: 'voyageur' });
    expect(welcomed).toEqual([1, 1]);
    expect(rig.game.players[1].connected).toBe(true);
    // Two seats are left, and two friends get them.
    const friends = ['Ann', 'Bo'].map((name) => rig.join(name));
    rig.run(0.5);
    expect(friends.map((friend) => [friend.link.status, friend.link.playerId])).toEqual([['playing', 2], ['playing', 3]]);
    // The wire goes quiet: its one player is marked away, and nobody else is left counted as here.
    rig.run(11);
    expect(rig.game.players.map((player) => player.connected)).toEqual([true, false, true, true]);
  });

  it('keeps the difficulty the host\'s: a guest cannot set it', () => {
    const { rig, ann } = ashoreRig();
    const refused = rig.host.stats.refused;
    ann.link.sendCommand({ type: 'set_difficulty', difficulty: 'relaxed' });
    rig.run(0.5);
    expect(rig.game.difficulty).toBe('standard');
    expect(ann.results.at(-1)!.result.ok).toBe(false);
    expect(rig.host.stats.refused).toBe(refused + 1);
  });

  it('never sends one guest\'s key to another: nothing a guest receives could let them be someone else', () => {
    const rig = createRig({ game: campGame() });
    const heard: string[] = [];
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    // Bo listens to everything the host sends on Bo's wire.
    pair.guest.receive((message) => void heard.push(JSON.stringify(message)));
    pair.guest.send({ v, type: 'join', name: 'Bo', key: key('Bo'), character: 'voyageur' });
    rig.join('Ann');
    for (let frame = 0; frame < 120; frame += 1) {
      pair.advance(FIXED_STEP);
      rig.run(FIXED_STEP);
    }
    expect(heard.length).toBeGreaterThan(10);
    const everything = heard.join('\n');
    expect(everything).toContain('"name":"Ann"');
    expect(everything).not.toContain(key('Ann'));
    expect(everything).not.toContain(key('Bo'));
    expect(JSON.stringify(rig.game)).not.toContain(key('Ann'));
  });

  it('a stranger using a player\'s name does not get that player: only the key does', () => {
    const { rig, ann } = ashoreRig();
    rig.game.players[1].backpack.push({ itemId: 'driftwood', count: 9 });
    ann.link.close();
    rig.run(0.5);
    expect(rig.game.players[1].connected).toBe(false);
    const impostor = rig.join('Ann', key('not-ann'));
    rig.run(0.5);
    expect(impostor.link.playerId).toBe(3);
    expect(rig.game.players[1]).toMatchObject({ connected: false, backpack: [{ itemId: 'driftwood', count: 9 }] });
    // The same key on a new wire is the same person, and the old wire is let go.
    const again = rig.join('Ann');
    rig.run(0.5);
    expect(again.link.playerId).toBe(1);
  });

  it('a guest that changes its own copy changes nothing on the host, and is put right', () => {
    const { rig, ann } = ashoreRig();
    const before = frozen(rig.game);
    const copy = ann.link.truth!;
    copy.tools.push('hatchet', 'saw');
    copy.flags.beacon_lit = true;
    copy.quests.bail_out!.status = 'completed';
    for (let frame = 0; frame < 30; frame += 1) ann.pair.advance(FIXED_STEP);
    expect(frozen(rig.game)).toBe(before);
    rig.run(1);
    // The next changes did not add up against the doctored copy: the guest asked for the whole state and has it.
    expect(ann.link.mismatches).toBeGreaterThan(0);
    expect(rig.settle()).toBe(true);
    expect(ann.link.truth!.tools).toEqual(rig.game.tools);
    expect(hashState(ann.link.truth!)).toBe(rig.hostHash());
  });

  it('keeps the newest input when an older one arrives late', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    sam.pair.guest.send({ v, type: 'input', seq: 9000, have: -1, events: 0, input: { ...NEUTRAL_INPUT, paddle: 1 }, step: 0, walk: [] });
    sam.pair.guest.send({ v, type: 'input', seq: 8000, have: -1, events: 0, input: { ...NEUTRAL_INPUT, paddle: -1 }, step: 0, walk: [] });
    sam.pair.advance(0);
    expect(rig.host.crewInput({ ...NEUTRAL_INPUT }, 0)[1]).toMatchObject({ paddle: 1 });
  });

  it('lets go of a guest\'s input when the guest goes quiet: nobody paddles on with a frozen screen', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    sam.input = { paddle: 1 };
    rig.run(1);
    expect(rig.host.crewInput({ ...NEUTRAL_INPUT }, 0)[1]).toMatchObject({ paddle: 1 });
    sam.pair.conditions.loss = 1;
    rig.run(STALE_INPUT_SECONDS + 0.1);
    expect(rig.host.crewInput({ ...NEUTRAL_INPUT }, 0)[1]).toBeUndefined();
    expect(rig.game.players[1].paddling).toBe(false);
  });
});

describe('dropping and returning', () => {
  it('marks a guest who leaves as away, keeps everything of theirs, and gives it all back to the same key', () => {
    const rig = createRig({ game: campGame() });
    const ann = rig.join('Ann');
    const bo = rig.join('Bo');
    rig.run(0.5);
    seatByFire(rig.game);
    const player = rig.game.players[1];
    player.backpack.push({ itemId: 'driftwood', count: 7 });
    Object.assign(player, { hunger: 41, thirst: 52, energy: 63 });
    const spot = { ...player.position };
    ann.link.close();
    rig.run(0.5);
    expect(ann.link.status).toBe('closed');
    expect(player.connected).toBe(false);
    expect(rig.host.guests).toEqual([2]);
    expect(rig.hostEvents).toContainEqual({ type: 'crew_changed', who: 1, change: 'away' });
    // Ten minutes go by. Bo plays on; Ann's player stands where she left it.
    rig.run(600);
    expect(player).toMatchObject({ id: 1, name: 'Ann', hunger: 41, thirst: 52, energy: 63, backpack: [{ itemId: 'driftwood', count: 7 }], position: spot });
    expect(rig.game.players).toHaveLength(3);
    expect(bo.link.truth!.players[1]!.connected).toBe(false);

    const back = rig.join('Ann');
    rig.run(0.5);
    expect(back.link.status).toBe('playing');
    expect(back.link.playerId).toBe(1);
    expect(player).toMatchObject({ connected: true, backpack: [{ itemId: 'driftwood', count: 7 }] });
    // Her meters run again from where they stood.
    expect(player.hunger).toBeLessThan(41);
    expect(player.hunger).toBeGreaterThan(40.9);
    expect(rig.hostEvents).toContainEqual({ type: 'crew_changed', who: 1, change: 'back' });
    expect(rig.game.players).toHaveLength(3);
    expect(rig.settle()).toBe(true);
    expect(hashState(back.link.truth!)).toBe(rig.hostHash());
    expect(bo.link.truth!.players[1]!.connected).toBe(true);
  });

  it('marks away a guest whose wire closes without a word', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    sam.pair.guest.close();
    rig.run(0.2);
    expect(rig.game.players[1].connected).toBe(false);
    expect(rig.host.guests).toEqual([]);
  });

  it('marks away a guest gone silent, and takes them back on the same wire when it clears', () => {
    const rig = createRig({ host: { silenceSeconds: 4 } });
    const sam = rig.join('Sam');
    rig.run(1);
    sam.pair.conditions.loss = 1;
    rig.run(3.5);
    expect(rig.game.players[1].connected).toBe(true);
    rig.run(1);
    expect(rig.game.players[1].connected).toBe(false);
    expect(sam.link.hostHeard).toBe(false);
    // The line clears. The guest has been asking to join again all along.
    sam.pair.conditions.loss = 0;
    rig.run(1.5);
    expect(rig.game.players[1].connected).toBe(true);
    expect(sam.link.status).toBe('playing');
    expect(sam.link.playerId).toBe(1);
    expect(rig.game.players).toHaveLength(2);
    sam.link.sendCommand({ type: 'toggle_lantern' });
    expect(rig.settle()).toBe(true);
    expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
  });

  it('holds nobody up: the night skips for the ones still here when a guest drops, and the leaver wakes nothing', () => {
    const rig = createRig({ game: campGame() });
    const ann = rig.join('Ann');
    const bo = rig.join('Bo');
    rig.run(0.5);
    seatByFire(rig.game);
    rig.game.time = 21 * TUNING.time.hourSeconds;
    for (const player of rig.game.players) player.energy = 30;
    dispatch(rig.game, { type: 'sleep' }, 0);
    bo.link.sendCommand({ type: 'sleep' });
    rig.run(0.5);
    expect(rig.game.players.map((player) => player.asleep)).toEqual([true, false, true]);
    ann.link.close();
    rig.run(0.5);
    expect(rig.game.time).toBeGreaterThan(TUNING.time.daySeconds + 6 * TUNING.time.hourSeconds - 1);
    expect(rig.game.players.map((player) => player.energy > 99)).toEqual([true, false, true]);
  });

  it('after the host starts over on the same game, a returning name gets its player back; the host\'s player is never given away', () => {
    const game = campGame(3);
    game.players[1].name = 'Ann';
    game.players[1].backpack.push({ itemId: 'driftwood', count: 4 });
    game.players[2].name = 'Bo';
    setConnected(game, 1, false, true);
    setConnected(game, 2, false, true);
    game.players[0].name = 'Luc';
    // A fresh link: it remembers no keys.
    const rig = createRig({ game });
    const impostor = rig.join('Luc');
    const ann = rig.join('Ann', key('ann-new-browser'));
    rig.run(0.5);
    expect(ann.link.playerId).toBe(1);
    expect(game.players[1]).toMatchObject({ connected: true, backpack: [{ itemId: 'driftwood', count: 4 }] });
    // "Luc" is the host and connected: the name buys nothing. A new seat instead.
    expect(impostor.link.playerId).toBe(3);
    expect(game.players[0].connected).toBe(true);
  });

  it('when the host stops sharing, every guest is told and every guest\'s player stays, away', () => {
    const rig = createRig();
    const seats = ['Ann', 'Bo'].map((name) => rig.join(name));
    rig.run(0.5);
    rig.host.close();
    for (const seat of seats) seat.pair.advance(0.1);
    for (const seat of seats) {
      seat.link.update(0.1);
      expect(seat.link.status).toBe('closed');
      expect(seat.link.leaveReason).toBe('closed');
    }
    expect(rig.game.players.map((player) => player.connected)).toEqual([true, false, false]);
    expect(rig.game.players).toHaveLength(3);
  });

  it('a guest whose host comes back as a new session starts over cleanly on the new game', () => {
    const first = new HostLink({ game: calmGame(), hostPlayerId: 0, session: 1 });
    const pair = createLoopbackPair();
    first.accept(pair.host);
    const guest = new GuestLink(pair.guest, { name: 'Sam', key: key('Sam') });
    const tick = (host: HostLink, seconds: number): void => {
      for (let frame = 0; frame < seconds * 60; frame += 1) {
        pair.advance(FIXED_STEP);
        host.afterFrame([], FIXED_STEP);
        guest.update(FIXED_STEP);
      }
    };
    tick(first, 3);
    expect(guest.status).toBe('playing');
    const oldSeed = guest.truth!.seed;
    // The host's page reloads: a new game, a new link, the same wire to the guest (as a relay would keep it).
    const fresh = newGame(99);
    const second = new HostLink({ game: fresh, hostPlayerId: 0, session: 2 });
    let route: ((message: unknown) => void) | null = null;
    pair.host.receive((message) => route?.(message));
    second.accept({ send: (message) => pair.host.send(message), receive: (message) => { route = message; }, close: () => {} });
    // The guest hears nothing for three seconds, asks again, and is welcomed by the new session.
    tick(second, 3.7);
    expect(guest.status).toBe('playing');
    expect(guest.truth!.seed).toBe(99);
    expect(guest.truth!.seed).not.toBe(oldSeed);
    expect(hashState(guest.truth!)).toBe(hashState({ ...fresh, events: [] }));
  });
});

describe('the view a guest draws', () => {
  it('moves the canoe every frame, evenly, between states that arrive 15 times a second', () => {
    const rig = createRig({ conditions: { delay: 0.04, jitter: 0.02 } });
    const sam = rig.join('Sam');
    rig.hostInput = { paddle: 1 };
    rig.run(12); // up to speed
    const viewSteps: number[] = [];
    const truthSteps: number[] = [];
    let viewZ = sam.link.view()!.canoe.position.z;
    let truthZ = sam.link.truth!.canoe.position.z;
    for (let frame = 0; frame < 600; frame += 1) {
      rig.run(FIXED_STEP);
      const view = sam.link.view()!;
      viewSteps.push(viewZ - view.canoe.position.z);
      truthSteps.push(truthZ - sam.link.truth!.canoe.position.z);
      viewZ = view.canoe.position.z;
      truthZ = sam.link.truth!.canoe.position.z;
    }
    const mean = viewSteps.reduce((sum, value) => sum + value, 0) / viewSteps.length;
    // The truth jumps: most frames nothing, then four steps at once. The view never stands and never leaps.
    expect(truthSteps.filter((value) => value === 0).length).toBeGreaterThan(300);
    expect(mean).toBeGreaterThan(0.02);
    expect(Math.min(...viewSteps)).toBeGreaterThan(mean * 0.5);
    expect(Math.max(...viewSteps)).toBeLessThan(mean * 1.5);
  });

  it('never runs ahead of the truth and never goes back in time', () => {
    const rig = createRig({ conditions: BAD_LINE });
    const sam = rig.join('Sam');
    rig.hostInput = { paddle: 1, steer: 0.4 };
    rig.run(2);
    let last = sam.link.view()!.playedSeconds;
    for (let frame = 0; frame < 900; frame += 1) {
      rig.run(FIXED_STEP);
      const view = sam.link.view()!;
      expect(view.playedSeconds).toBeGreaterThanOrEqual(last - 1e-9);
      expect(view.playedSeconds).toBeLessThanOrEqual(sam.link.truth!.playedSeconds + 1e-9);
      last = view.playedSeconds;
    }
  });

  it('puts a player who was moved a long way where they landed, without sliding them across the lake', () => {
    const rig = createRig({ game: campGame() });
    const sam = rig.join('Sam');
    rig.run(1);
    seatByFire(rig.game);
    rig.run(1);
    const far = ISLANDS_BY_ID.cabin_roofs.center;
    const home = { ...rig.game.players[1].position };
    Object.assign(rig.game.players[1], { islandId: 'cabin_roofs', position: { x: far.x, y: terrainHeight(far.x, far.z), z: far.z } });
    for (let frame = 0; frame < 60; frame += 1) {
      rig.run(FIXED_STEP);
      const position = sam.link.view()!.players[1]!.position;
      const fromHome = Math.hypot(position.x - home.x, position.z - home.z);
      const fromFar = Math.hypot(position.x - far.x, position.z - far.z);
      // Either still by the fire or already there: never in between.
      expect(Math.min(fromHome, fromFar)).toBeLessThan(0.01);
    }
    expect(sam.link.view()!.players[1]!.islandId).toBe('cabin_roofs');
  });

  it('is never the host\'s own object: a guest cannot reach the game through what it draws', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(1);
    expect(sam.link.truth).not.toBe(rig.game);
    expect(sam.link.truth!.players[0]).not.toBe(rig.game.players[0]);
    expect(sam.link.view()!.canoe).not.toBe(rig.game.canoe);
  });
});
