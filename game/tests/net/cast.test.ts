/**
 * The pick over the wire: a guest's `join` says who they are, the host reads it like every field (one of the four,
 * or the whole join is refused) and puts it on the player in every case a join has, before anyone is sent a state.
 * And the version that carries it: 7, said to a tab of another version in words that tab can read.
 */
import { describe, expect, it } from 'vitest';
import { LEAVE_TEXT } from '../../src/client/viewmodels/crew.ts';
import { CHARACTER_IDS, characterOf } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import { GuestLink, PROTOCOL_VERSION, createLoopbackPair, readClientMessage, readHostMessage } from '../../src/net/index.ts';
import { setConnected, setPlayerCharacter } from '../../src/sim/index.ts';
import type { GameState, PlayerState } from '../../src/sim/index.ts';
import { calmGame, createRig, key } from './rig.ts';
import type { Rig } from './rig.ts';

const v = PROTOCOL_VERSION;
const KEY = 'key-sam-0123456789';

/** Who everyone is, as kept on the players: id and pick. */
const picks = (game: GameState): [number, CharacterId | undefined][] => game.players.map((player) => [player.id, player.character]);

/** A wire with no guest session on it: the test sends by hand and keeps everything that comes back. */
function rawWire(rig: Rig) {
  const pair = createLoopbackPair();
  const heard: Record<string, unknown>[] = [];
  rig.host.accept(pair.host);
  pair.guest.receive((message) => void heard.push(message as Record<string, unknown>));
  return {
    pair, heard,
    say(message: unknown): void {
      pair.guest.send(message);
      pair.advance(0);
      pair.advance(0);
    },
  };
}

describe('the join says who the guest is', () => {
  it('is read with each of the four, and with nothing else', () => {
    for (const character of CHARACTER_IDS) {
      expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY, character })).toEqual({ v, type: 'join', name: 'Sam', key: KEY, character });
    }
    // Left out, or anything but one of the four: the whole join is refused. No default, no guess.
    expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY })).toBeNull();
    for (const character of ['wizard', 'Voyageur', 'voyageur ', '', 'constructor', '__proto__', 'toString', 0, 1, null, true, ['trapper'], { id: 'trapper' }, undefined]) {
      expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY, character }), JSON.stringify(character)).toBeNull();
    }
    // And a good pick does not carry a field the join does not name.
    expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY, character: 'angler', seat: 0 })).toBeNull();
  });

  it('a guest sends its pick with every join, and the first of the cast when it was given none', () => {
    const sent = (options: { character?: CharacterId }): unknown[] => {
      const pair = createLoopbackPair();
      const heard: unknown[] = [];
      pair.host.receive((message) => void heard.push(message));
      const link = new GuestLink(pair.guest, { name: 'Sam', key: KEY, ...options });
      pair.advance(0);
      // Unanswered, it asks again a moment later, and says the same.
      link.update(1);
      pair.advance(0);
      return heard;
    };
    expect(sent({ character: 'scout' })).toEqual([
      { v, type: 'join', name: 'Sam', key: KEY, character: 'scout' }, { v, type: 'join', name: 'Sam', key: KEY, character: 'scout' },
    ]);
    expect(sent({})).toEqual([
      { v, type: 'join', name: 'Sam', key: KEY, character: 'voyageur' }, { v, type: 'join', name: 'Sam', key: KEY, character: 'voyageur' },
    ]);
    expect(CHARACTER_IDS[0]).toBe('voyageur');
  });
});

describe('a stranger can do nothing', () => {
  it('a join whose character is not one of the four seats nobody and answers nothing', () => {
    const rig = createRig();
    const wire = rawWire(rig);
    const refused = rig.host.stats.refused;
    const bad = ['wizard', '', 'constructor', 3, null, ['scout'], { id: 'scout' }];
    for (const character of bad) wire.say({ v, type: 'join', name: 'Mal', key: key('Mal'), character });
    wire.say({ v, type: 'join', name: 'Mal', key: key('Mal') });
    expect(wire.heard).toEqual([]);
    expect(rig.game.players).toHaveLength(1);
    expect(rig.host.guests).toEqual([]);
    expect(rig.host.stats.refused).toBe(refused + bad.length + 1);
    // Still nobody: the wire moves no one and asks for nothing.
    wire.say({ v, type: 'command', id: 1, at: 0, command: { type: 'board' } });
    expect(rig.host.stats.refused).toBe(refused + bad.length + 2);
    // The same wire with a real pick is welcomed: it was the pick that kept it out.
    wire.say({ v, type: 'join', name: 'Mal', key: key('Mal'), character: 'scout' });
    expect(wire.heard.map((message) => message.type)).toEqual(['welcome']);
    expect(picks(rig.game)).toEqual([[0, undefined], [1, 'scout']]);
  });

  it('a seated guest cannot become a fifth figure: a bad pick on a second join changes nothing', () => {
    const rig = createRig();
    const wire = rawWire(rig);
    wire.say({ v, type: 'join', name: 'Mal', key: key('Mal'), character: 'angler' });
    wire.say({ v, type: 'join', name: 'Mal', key: key('Mal'), character: 'ghost' });
    expect(picks(rig.game)).toEqual([[0, undefined], [1, 'angler']]);
    expect(wire.heard.map((message) => message.type)).toEqual(['welcome']);
  });
});

describe('the host puts the pick on the player', () => {
  it('a new seat: on the player before the welcome, and in the state the welcome carries', () => {
    const rig = createRig();
    const wire = rawWire(rig);
    wire.say({ v, type: 'join', name: 'Sam', key: KEY, character: 'trapper' });
    expect(picks(rig.game)).toEqual([[0, undefined], [1, 'trapper']]);
    const welcome = wire.heard[0] as { type: string; playerId: number; state: GameState };
    expect(welcome.type).toBe('welcome');
    expect(welcome.state.players[welcome.playerId]).toMatchObject({ id: 1, name: 'Sam', character: 'trapper' });
  });

  it('every guest and the host see who everyone is, and nobody is ever sent a player without their pick', () => {
    const rig = createRig();
    setPlayerCharacter(rig.game, 0, 'scout');
    const ann = rig.join('Ann', undefined, undefined, { character: 'angler' });
    rig.run(0.5);
    // Ann's own wire is listened to from here on: every state it is sent, whole or as changes.
    const seen: (CharacterId | undefined)[][] = [];
    const watch = createLoopbackPair();
    rig.host.accept(watch.host);
    watch.guest.receive((message) => {
      const heard = message as { type: string; state?: GameState; changed?: Partial<GameState> };
      const players = heard.type === 'welcome' ? heard.state!.players : heard.type === 'state' ? heard.changed!.players : undefined;
      if (players) seen.push(players.map((player: PlayerState) => player.character));
    });
    watch.guest.send({ v, type: 'join', name: 'Watcher', key: key('Watcher'), character: 'voyageur' });
    const bo = rig.join('Bo', undefined, undefined, { character: 'trapper' });
    for (let frame = 0; frame < 60; frame += 1) {
      watch.advance(1 / 60);
      rig.run(1 / 60);
    }
    expect(picks(rig.game)).toEqual([[0, 'scout'], [1, 'angler'], [2, 'voyageur'], [3, 'trapper']]);
    for (const seat of [ann, bo]) {
      expect(seat.link.status).toBe('playing');
      expect(picks(seat.link.truth!)).toEqual(picks(rig.game));
      expect(seat.link.view()!.players.map((player) => characterOf(player))).toEqual(['scout', 'angler', 'voyageur', 'trapper']);
    }
    // The watcher was told of the players several times. Bo was never in one of those without the pick.
    expect(seen.length).toBeGreaterThan(1);
    for (const players of seen) expect(players).toEqual(['scout', 'angler', 'voyageur', 'trapper'].slice(0, players.length));
    expect(seen.at(-1)).toHaveLength(4);
  });

  it('a returning player may come back as someone else: the same key, another pick', () => {
    const rig = createRig();
    const sam = rig.join('Sam', undefined, undefined, { character: 'trapper' });
    rig.run(0.5);
    expect(picks(rig.game)).toEqual([[0, undefined], [1, 'trapper']]);
    sam.link.close();
    rig.run(0.5);
    expect(rig.game.players[1]).toMatchObject({ connected: false, character: 'trapper' });
    const back = rig.join('Sam', undefined, undefined, { character: 'scout' });
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(rig.game.players).toHaveLength(2);
    expect(rig.game.players[1]).toMatchObject({ name: 'Sam', connected: true, character: 'scout' });
    expect(picks(back.link.truth!)).toEqual([[0, undefined], [1, 'scout']]);
  });

  it('a player had back by name after the host started again gets the pick they come with', () => {
    // A saved game the host loads: Ann was the angler in it and is away. This host link remembers no key.
    const game = calmGame(2);
    game.players[1]!.name = 'Ann';
    setPlayerCharacter(game, 1, 'angler');
    setConnected(game, 1, false, true);
    const rig = createRig({ game });
    const ann = rig.join('Ann', undefined, undefined, { character: 'voyageur' });
    rig.run(0.5);
    expect(ann.link.playerId).toBe(1);
    expect(rig.game.players).toHaveLength(2);
    expect(rig.game.players[1]).toMatchObject({ name: 'Ann', connected: true, character: 'voyageur' });
  });

  it('a seat taken over is drawn as whoever took it, not as whoever left it', () => {
    const rig = createRig();
    const [ann] = (['angler', 'trapper', 'scout'] as const).map((character, index) => rig.join(['Ann', 'Bo', 'Cy'][index]!, undefined, undefined, { character }));
    rig.run(0.5);
    expect(picks(rig.game)).toEqual([[0, undefined], [1, 'angler'], [2, 'trapper'], [3, 'scout']]);
    ann!.link.close();
    rig.run(0.5);
    // The canoe is full and Ann is away: Dee takes her seat as it stands, and is the voyageur in it.
    const dee = rig.join('Dee', undefined, undefined, { character: 'voyageur' });
    rig.run(0.5);
    expect(dee.link.playerId).toBe(1);
    expect(rig.game.players[1]).toMatchObject({ name: 'Dee', connected: true, character: 'voyageur' });
    expect(picks(dee.link.truth!)).toEqual([[0, undefined], [1, 'voyageur'], [2, 'trapper'], [3, 'scout']]);
  });

  it('the fingerprints still meet: the pick is part of the state both ends hold', () => {
    const rig = createRig();
    const sam = rig.join('Sam', undefined, undefined, { character: 'angler' });
    rig.hostInput = { paddle: 1 };
    rig.run(3);
    expect(sam.link.mismatches).toBe(0);
    expect(rig.settle()).toBe(true);
  });
});

describe('version 8, and a tab of another version', () => {
  it('is version 8', () => {
    expect(PROTOCOL_VERSION).toBe(8);
  });

  it('an old tab that joins is answered in its own version, the only one it reads: it is told to reload', () => {
    const rig = createRig();
    const wire = rawWire(rig);
    // What the live build (wire version 7) sends: no carry, and a 7.
    wire.say({ v: 7, type: 'join', name: 'Old', key: key('Old'), character: 'scout' });
    expect(wire.heard).toEqual([{ v: 7, type: 'leave', reason: 'version' }]);
    expect(rig.game.players).toHaveLength(1);
    // The old tab shows these words for it (they were the same in versions 6 and 7), and they fit: its own reload is the cure.
    expect(LEAVE_TEXT.version).toMatch(/^The host runs another version of the game\. Reload the page/);
    // A tab from the future is answered the same way, and a version that is no number in this build's own.
    const next = rawWire(rig);
    next.say({ v: 9, type: 'join', name: 'New', key: key('New'), character: 'scout' });
    expect(next.heard).toEqual([{ v: 9, type: 'leave', reason: 'version' }]);
    const odd = rawWire(rig);
    odd.say({ v: 1e99, type: 'leave' });
    expect(odd.heard).toEqual([{ v, type: 'leave', reason: 'version' }]);
  });

  it('this build joining an older or a newer host is told so, whatever version the host says it in', () => {
    for (const hostVersion of [7, 9, v]) {
      const pair = createLoopbackPair();
      // A host of another version: it answers the join the one way it can.
      pair.host.receive(() => pair.host.send({ v: hostVersion, type: 'leave', reason: 'version' }));
      const link = new GuestLink(pair.guest, { name: 'Sam', key: KEY, character: 'scout' });
      pair.advance(0);
      pair.advance(0);
      expect(link.status, `host version ${hostVersion}`).toBe('refused');
      expect(link.leaveReason, `host version ${hostVersion}`).toBe('version');
    }
    // Only that one sentence crosses versions: anything else of another version is still dropped.
    expect(readHostMessage({ v: 6, type: 'leave', reason: 'version' })).toEqual({ v, type: 'leave', reason: 'version' });
    for (const other of [{ v: 6, type: 'leave', reason: 'full' }, { v: 6, type: 'leave', reason: 'closed' }, { v: 6, type: 'ping', time: 1 },
      { v: '6', type: 'leave', reason: 'version' }, { type: 'leave', reason: 'version' }]) {
      expect(readHostMessage(other), JSON.stringify(other)).toBeNull();
    }
  });
});
