/** The controls after Luc's calls: F is the main action key, L the lantern, and scavenging takes one press. */
import { describe, expect, it } from 'vitest';
import { Session } from '../../src/client/session.ts';
import type { SessionSignal } from '../../src/client/session.ts';
import { buildHowToPlayPanel, buildHudModel, settingsRows } from '../../src/client/viewmodels/index.ts';
import { SETTINGS_TABS } from '../../src/client/panels.ts';
import { NODES_BY_ID, NODES_BY_ISLAND, TUNING } from '../../src/data/index.ts';
import { SETTINGS_KEY } from '../../src/settings/index.ts';
import { FIXED_STEP, islandLanding } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, build, countIn, give, standOn, teleportToNode } from '../support.ts';

const oldSettings = import.meta.glob<string>('../fixtures/settings-v1-*.json', { eager: true, query: '?raw', import: 'default' });

function playing(storage = new FakeStorage()): { session: Session; game: GameState; signals: SessionSignal[]; notices: () => string[]; sounds: () => string[] } {
  const session = new Session({ storage, now: () => 1000, randomSeed: () => 7 });
  session.newGame(0);
  const signals: SessionSignal[] = [];
  session.subscribe((signal) => signals.push(signal));
  return {
    session, game: session.game!, signals,
    notices: () => signals.flatMap((signal) => (signal.type === 'notice' ? [signal.text] : [])),
    sounds: () => signals.flatMap((signal) => (signal.type === 'interface_sound' ? [signal.sound] : [])),
  };
}

const tap = (session: Session, key: string): void => {
  session.keyDown(key);
  session.keyUp(key);
};

const frames = (session: Session, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FIXED_STEP) session.advance(FIXED_STEP, 0);
};

const nodeOfType = (typeId: string, islandId: 'home_knoll' | 'birch_islet' = 'home_knoll'): string =>
  NODES_BY_ISLAND[islandId].find((node) => node.typeId === typeId)!.id;

describe('F is the main action key', () => {
  it('lands, scavenges, picks up and boards, each with one press', () => {
    const { session, game } = playing();
    const player = game.players[0];
    // Land: the canoe just off Home Knoll's beach.
    const landing = islandLanding('home_knoll');
    game.canoe.position = { x: landing.shore.x, y: 0, z: landing.shore.z - 2 };
    game.canoe.heading = landing.bearing;
    player.position = { ...game.canoe.position };
    tap(session, 'KeyF');
    expect(player.mode).toBe('foot');

    // Scavenge: one press at the driftwood, and it is in the backpack before any time passes.
    teleportToNode(game, nodeOfType('driftwood_pile'));
    const tick = game.tick;
    tap(session, 'KeyF');
    expect(game.tick).toBe(tick);
    const wood = countIn(player.backpack, 'driftwood');
    expect(wood).toBeGreaterThanOrEqual(3);
    expect(game.statistics.nodesHarvested).toBe(1);

    // Pick up: a full backpack leaves the next haul on the node; one press takes it once there is room.
    const second = NODES_BY_ISLAND.home_knoll.filter((node) => node.typeId === 'driftwood_pile')[1].id;
    teleportToNode(game, second);
    const kept = player.backpack.splice(0);
    for (let slot = 0; slot < 8; slot += 1) give(game, 'stone', 20);
    tap(session, 'KeyF');
    expect(game.nodes[second].leftover.length).toBeGreaterThan(0);
    player.backpack.splice(0);
    player.backpack.push(...kept);
    tap(session, 'KeyF');
    expect(game.nodes[second].leftover).toEqual([]);
    expect(countIn(player.backpack, 'driftwood')).toBeGreaterThan(wood);
    expect(game.statistics.nodesHarvested).toBe(2);

    // Board: back at the canoe.
    standOn(game, 'home_knoll');
    tap(session, 'KeyF');
    expect(player.mode).toBe('canoe');
  });

  it('does it on the press, not on the hold: a held key and its repeats scavenge once', () => {
    const { session, game } = playing();
    standOn(game, 'home_knoll');
    const spruce = nodeOfType('spruce');
    teleportToNode(game, spruce);
    give(game, 'hatchet');
    game.players[0].energy = 90;
    session.keyDown('KeyF'); // the gum
    expect(game.statistics.nodesHarvested).toBe(1);
    for (let repeat = 0; repeat < 30; repeat += 1) session.keyDown('KeyF', true); // the browser repeating the held key
    frames(session, 3);
    expect(game.statistics.nodesHarvested).toBe(1);
    session.keyUp('KeyF');
    // A fresh press takes the next thing the spruce offers: the logs.
    session.keyDown('KeyF');
    expect(game.statistics.nodesHarvested).toBe(2);
    expect(countIn(game.players[0].backpack, 'log')).toBe(3);
  });

  it('leaves E doing nothing, and the lantern on L', () => {
    const { session, game, notices } = playing();
    standOn(game, 'home_knoll');
    teleportToNode(game, nodeOfType('driftwood_pile'));
    tap(session, 'KeyE');
    expect(game.statistics.nodesHarvested).toBe(0);
    // Aboard with a lantern mast: L lights it, F does not.
    build(game, 'lantern_mast');
    game.players[0].mode = 'canoe';
    game.players[0].position = { x: 200, y: 0, z: 1300 };
    game.canoe.position = { x: 200, y: 0, z: 1300 };
    game.canoe.beached = false;
    expect(game.canoe.lanternLit).toBe(false);
    tap(session, 'KeyF');
    expect(game.canoe.lanternLit).toBe(false);
    tap(session, 'KeyL');
    expect(game.canoe.lanternLit).toBe(true);
    expect(notices()).toEqual([]);
  });

  it('keeps the tool and energy rules, and says why a press did nothing', () => {
    const { session, game, signals, notices, sounds } = playing();
    // No knife: the birch says what it needs, once, through its own event. No second notice.
    standOn(game, 'birch_islet');
    teleportToNode(game, nodeOfType('birch', 'birch_islet'));
    tap(session, 'KeyF');
    expect(countIn(game.players[0].backpack, 'birch_bark')).toBe(0);
    expect(game.events.filter((event) => event.type === 'harvest_blocked')).toHaveLength(1);
    expect(notices()).toEqual([]);
    expect(sounds()).toEqual([]);
    // Too tired to chop: a notice and the error sound, and nothing taken.
    standOn(game, 'home_knoll');
    const spruce = nodeOfType('spruce');
    teleportToNode(game, spruce);
    give(game, 'hatchet');
    game.players[0].selectedTool = 'hatchet';
    game.players[0].energy = TUNING.survival.minimumEnergyToExert + NODES_BY_ID[spruce].actions[1].energyCost - 1;
    signals.length = 0;
    tap(session, 'KeyF');
    expect(countIn(game.players[0].backpack, 'log')).toBe(0);
    expect(notices()).toEqual(['Too tired for that. Rest first.']);
    expect(sounds()).toEqual(['error']);
  });
});

describe('prompts and How to Play show the key that is bound', () => {
  const interactLine = (session: Session): string =>
    buildHowToPlayPanel(session.settings).sections.flatMap((section) => section.controls).find((control) => control.label.startsWith('Interact'))!.keys;
  const lanternLine = (session: Session): string =>
    buildHowToPlayPanel(session.settings).sections.flatMap((section) => section.controls).find((control) => control.label.startsWith('Lantern'))!.keys;

  it('says F by default, for a node as for the canoe, and never asks for a hold', () => {
    const { session, game } = playing();
    standOn(game, 'home_knoll');
    expect(buildHudModel(game, session.settings, 0).prompt).toEqual({ text: 'Board the canoe', keyLabel: 'F', mode: 'press' });
    teleportToNode(game, nodeOfType('driftwood_pile'));
    expect(buildHudModel(game, session.settings, 0).prompt).toEqual({ text: 'Gather: Driftwood pile', keyLabel: 'F', mode: 'press' });
    expect(interactLine(session)).toBe('F');
    expect(lanternLine(session)).toBe('L, V');
    const page = JSON.stringify(buildHowToPlayPanel(session.settings));
    expect(page).not.toMatch(/hold to scavenge/i);
    expect(page).toMatch(/one press/i);
  });

  it('follows a rebind made in the settings: the prompt, the page and the key itself', () => {
    const { session, game } = playing();
    standOn(game, 'home_knoll');
    teleportToNode(game, nodeOfType('driftwood_pile'));
    session.handleIntent({ type: 'begin_rebind', action: 'interact', slot: 0 });
    session.keyDown('KeyG');
    session.keyUp('KeyG');
    expect(session.settings.controls.keyBindings.interact).toEqual(['KeyG']);
    expect(buildHudModel(game, session.settings, 0).prompt!.keyLabel).toBe('G');
    expect(interactLine(session)).toBe('G');
    tap(session, 'KeyF');
    expect(game.statistics.nodesHarvested).toBe(0);
    tap(session, 'KeyG');
    expect(game.statistics.nodesHarvested).toBe(1);
  });

  it('moves a player who never touched the old keys onto F and L when the game next loads', () => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, oldSettings['../fixtures/settings-v1-default.json']);
    const { session, game } = playing(storage);
    expect(session.settings.controls.keyBindings).toMatchObject({ interact: ['KeyF'], lantern: ['KeyL'] });
    standOn(game, 'home_knoll');
    expect(buildHudModel(game, session.settings, 0).prompt!.keyLabel).toBe('F');
    teleportToNode(game, nodeOfType('driftwood_pile'));
    tap(session, 'KeyF');
    expect(game.statistics.nodesHarvested).toBe(1);
  });

  it('keeps E for a player whose old settings had F on something else', () => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, oldSettings['../fixtures/settings-v1-f-taken.json']);
    const { session, game } = playing(storage);
    standOn(game, 'home_knoll');
    teleportToNode(game, nodeOfType('driftwood_pile'));
    expect(buildHudModel(game, session.settings, 0).prompt!.keyLabel).toBe('E');
    tap(session, 'KeyE');
    expect(game.statistics.nodesHarvested).toBe(1);
  });
});

describe('the hold-or-toggle setting is gone', () => {
  it('has no scavenging row on any settings tab, and drops the old value from storage', () => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, oldSettings['../fixtures/settings-v1-chosen-interact.json']);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).accessibility.scavengeMode).toBe('toggle');
    const { session } = playing(storage);
    const rows = SETTINGS_TABS.flatMap((tab) => settingsRows(session.settings, tab));
    expect(rows.some((row) => /scaveng/i.test(row.label) || /scaveng/i.test(row.setting))).toBe(false);
    expect(settingsRows(session.settings, 'accessibility').map((row) => row.setting)).toEqual([
      'accessibility.uiScale', 'accessibility.reduceCameraMotion', 'accessibility.patternedMeters',
    ]);
    session.handleIntent({ type: 'change_setting', setting: 'accessibility.patternedMeters', value: true });
    expect(storage.getItem(SETTINGS_KEY)).not.toContain('scavengeMode');
  });
});
