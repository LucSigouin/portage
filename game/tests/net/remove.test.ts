/**
 * Luc: "the host needs to be able to kick inactive players". The host takes a crewmate out of the game for good:
 * the figure and the seat go, what they carried stays with the crew, their window is told, and the same friend back
 * on the link is a new guest.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/data/index.ts';
import { deserialize, serialize } from '../../src/save/index.ts';
import { cargoSlots, countInStacks } from '../../src/sim/inventory.ts';
import { removePlayer } from '../../src/sim/index.ts';
import { calmGame, createRig, key } from './rig.ts';

describe('the host takes a crewmate out', () => {
  it('the player is gone on every screen, their window is told why, and their things are in the canoe', () => {
    const rig = createRig({ game: calmGame() });
    const sam = rig.join('Sam');
    const ann = rig.join('Ann');
    rig.run(2);
    const samId = sam.link.playerId;
    rig.game.players.find((player) => player.id === samId)!.backpack = [{ itemId: 'driftwood', count: 7 }];
    const cargoBefore = countInStacks(rig.game.canoe.cargo, 'driftwood');

    expect(rig.host.remove(samId)).toBe(0);
    rig.run(1);

    expect(rig.game.players.map((player) => player.id)).not.toContain(samId);
    expect(countInStacks(rig.game.canoe.cargo, 'driftwood')).toBe(cargoBefore + 7);
    expect(sam.link.status).toBe('closed');
    expect(sam.link.leaveReason).toBe('removed');
    // The one who stays sees them gone and plays on.
    expect(ann.link.status).toBe('playing');
    expect(rig.settle()).toBe(true);
    expect(ann.link.view()!.players.map((player) => player.id)).not.toContain(samId);
  });

  it('an away player goes the same way, and the same friend back on the link is a new guest with a new kit', () => {
    const rig = createRig({ game: calmGame(), host: { silenceSeconds: 2 } });
    const sam = rig.join('Sam');
    rig.run(1);
    const samId = sam.link.playerId;
    sam.link.close();
    rig.run(1);
    expect(rig.game.players.find((player) => player.id === samId)!.connected).toBe(false);

    expect(rig.host.remove(samId)).toBe(0);
    expect(rig.game.players).toHaveLength(1);

    const back = rig.join('Sam', key('Sam'));
    rig.run(1);
    expect(back.link.status).toBe('playing');
    expect(rig.game.players).toHaveLength(2);
    expect(rig.game.players[1]!.backpack).toEqual([]);
  });

  it('never the host itself, never somebody who is not there, never the last player', () => {
    const rig = createRig({ game: calmGame() });
    rig.join('Sam');
    rig.run(1);
    expect(rig.host.remove(0)).toBeNull();
    expect(rig.host.remove(3)).toBeNull();
    expect(rig.game.players).toHaveLength(2);
    const alone = calmGame();
    expect(removePlayer(alone, 0)).toBeNull();
    expect(alone.players).toHaveLength(1);
  });

  it('what finds no room in the cargo goes to a crewmate\'s backpack, and only what fits nowhere is lost and counted', () => {
    const game = calmGame(2);
    const stack = TUNING.inventory.stackSize;
    game.canoe.cargo = Array.from({ length: cargoSlots(game) }, () => ({ itemId: 'nails' as const, count: stack }));
    game.players[0]!.backpack = [];
    game.players[1]!.backpack = [{ itemId: 'driftwood', count: 5 }];
    expect(removePlayer(game, 1)).toBe(0);
    expect(countInStacks(game.players[0]!.backpack, 'driftwood')).toBe(5);

    const full = calmGame(2);
    full.canoe.cargo = Array.from({ length: cargoSlots(full) }, () => ({ itemId: 'nails' as const, count: stack }));
    full.players[0]!.backpack = Array.from({ length: TUNING.inventory.backpackSlots }, () => ({ itemId: 'nails' as const, count: stack }));
    full.players[1]!.backpack = [{ itemId: 'driftwood', count: 5 }];
    expect(removePlayer(full, 1)).toBe(5);
  });

  it('a game with a seat taken out of the middle saves, loads and seats the next friend in it', () => {
    const rig = createRig({ game: calmGame() });
    const sam = rig.join('Sam');
    rig.join('Ann');
    rig.run(1);
    rig.host.remove(sam.link.playerId);
    rig.run(1);
    const loaded = deserialize(serialize(rig.game, 5));
    expect(loaded.ok).toBe(true);
    const bo = rig.join('Bo');
    rig.run(1);
    expect(bo.link.status).toBe('playing');
    expect(bo.link.playerId).toBe(sam.link.playerId);
    expect(rig.game.players).toHaveLength(3);
  });
});
