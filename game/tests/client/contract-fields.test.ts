/**
 * The small fields the look and the interface are waiting for: who is
 * paddling and bailing, whether a panel covers the view, where the tracked
 * quest points, an item id on every row that names an item, a compass that
 * glides, and panel keys that stay quiet under a menu.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { FrameInfo, GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { Session } from '../../src/client/session.ts';
import type { SessionSignal } from '../../src/client/session.ts';
import {
  ToastQueue, buildCanoeBuilderPanel, buildCraftingPanel, buildHudModel, buildInventoryPanel, toastsFromEvents,
} from '../../src/client/viewmodels/index.ts';
import { ITEMS, NODES_BY_ID, NPCS, ISLANDS_BY_ID, spotPosition } from '../../src/data/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, dispatch, drainEvents, islandLanding, selectActiveQuests, selectTrackedQuestTarget, step,
  terrainHeight,
} from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, build, floatCanoeAt, give, newGame, standOn, teleportToCamp } from '../support.ts';

const settings = createDefaultSettings();

describe('who is paddling and who is bailing', () => {
  it('flags each player while they do it, and drops the flag when they stop or step out', () => {
    const state = newGame(7, { crew: 3 });
    state.canoe.hullTier = 1;
    floatCanoeAt(state, 200, 1300, 0);
    state.canoe.waterLevel = 50;
    const run = (inputs: Partial<typeof NEUTRAL_INPUT>[], steps = 30): void => {
      const full = inputs.map((input) => ({ ...NEUTRAL_INPUT, ...input }));
      for (let index = 0; index < steps; index += 1) step(state, full, FIXED_STEP);
    };
    run([{ paddle: 1 }, { bail: true }, {}]);
    expect(state.players.map((player) => player.paddling)).toEqual([true, false, false]);
    expect(state.players.map((player) => player.bailing)).toEqual([false, true, false]);
    // Back-paddling is paddling. A bailer who also presses paddle is bailing, not paddling.
    run([{ paddle: -1 }, { bail: true, paddle: 1 }, { paddle: 0.5 }]);
    expect(state.players.map((player) => player.paddling)).toEqual([true, false, true]);
    expect(state.players.map((player) => player.bailing)).toEqual([false, true, false]);
    // Hands off: both flags drop on the next step.
    run([], 1);
    expect(state.players.some((player) => player.paddling || player.bailing)).toBe(false);
    // Steering alone is not paddling.
    run([{ steer: 1 }]);
    expect(state.players[0].paddling).toBe(false);
    // Nobody paddles on foot, and stepping out mid-stroke drops the flag at once.
    const berth = { ...state.canoe.lastBeached };
    floatCanoeAt(state, berth.x, berth.z, berth.heading);
    run([{ paddle: 1 }, { paddle: 1 }], 2);
    expect(state.players[0].paddling).toBe(true);
    expect(dispatch(state, { type: 'disembark' }, 0).ok).toBe(true);
    expect(state.players[0]).toMatchObject({ mode: 'foot', paddling: false, bailing: false });
    run([{ paddle: 1, moveX: 1 }, { paddle: 1 }], 5);
    expect(state.players[0].paddling).toBe(false);
  });
});

describe('where the tracked quest points', () => {
  it('gives the landing, the node or the survivor the next step is at', () => {
    const state = newGame();
    // Quest 1: bail, then land on Home Knoll. The landing is the target.
    const landing = islandLanding('home_knoll').shore;
    expect(selectTrackedQuestTarget(state)).toMatchObject({ questId: 'bail_out', islandId: 'home_knoll', position: { x: landing.x, z: landing.z } });
    expect(selectTrackedQuestTarget(state)!.position.y).toBe(Math.max(0, terrainHeight(landing.x, landing.z)));
    // The mark follows the quest that is tracked: the first one on the HUD's tracker.
    expect(selectTrackedQuestTarget(state)!.questId).toBe(selectActiveQuests(state)[0].questId);
    // A step with no place (gather, craft) has no target.
    state.quests.bail_out.status = 'completed';
    state.quests.first_haul.status = 'active';
    state.players[0].trackedQuestIds = ['first_haul'];
    expect(selectTrackedQuestTarget(state)).toBeNull();
  });

  it('points at a node or a survivor exactly, and only once the island is charted or the radio marks it', () => {
    const state = newGame();
    for (const quest of Object.values(state.quests)) quest.status = 'completed';
    // The Beacon: its last step is the lamp, a node on an island far to the north.
    state.quests.the_beacon.status = 'active';
    state.quests.the_beacon.progress = [12, 1, 0];
    state.players[0].trackedQuestIds = ['the_beacon'];
    const lamp = Object.values(NODES_BY_ID).find((node) => node.typeId === 'beacon_lamp')!;
    expect(state.discoveredIslands).not.toContain(lamp.islandId);
    expect(selectTrackedQuestTarget(state)).toBeNull(); // not charted, no radio: no mark
    build(state, 'radio');
    expect(selectTrackedQuestTarget(state)).toMatchObject({ questId: 'the_beacon', islandId: lamp.islandId, position: { x: lamp.position.x, z: lamp.position.z } });
    state.canoe.attachments = [];
    state.discoveredIslands.push(lamp.islandId);
    expect(selectTrackedQuestTarget(state)?.islandId).toBe(lamp.islandId);
    state.quests.the_beacon.status = 'completed';
    expect(selectTrackedQuestTarget(state)).toBeNull(); // nothing active
  });

  it('points at the survivor for a talk step, and for a side quest ready to hand in', () => {
    const state = newGame();
    for (const quest of Object.values(state.quests)) quest.status = 'completed';
    const spotOf = (npcId: 'wren' | 'odile'): { x: number; z: number } => spotPosition(ISLANDS_BY_ID[NPCS[npcId].islandId], NPCS[npcId].spot);
    // The bellkeeper: landed on Steeple Rock, sailcloth sewn, Wren not met yet.
    const bellkeeper = state.quests.the_bellkeeper;
    bellkeeper.status = 'active';
    bellkeeper.progress = [1, 0, 2];
    state.players[0].trackedQuestIds = ['the_bellkeeper'];
    state.discoveredIslands.push(NPCS.wren.islandId);
    expect(selectTrackedQuestTarget(state)).toMatchObject({
      questId: 'the_bellkeeper', islandId: NPCS.wren.islandId, position: { x: spotOf('wren').x, z: spotOf('wren').z },
    });
    // Odile's windfall, all gathered: back to Odile.
    bellkeeper.status = 'completed';
    state.quests.odile_windfall.status = 'ready';
    state.quests.odile_windfall.progress = state.quests.odile_windfall.progress.map(() => 99);
    state.players[0].trackedQuestIds = ['odile_windfall'];
    state.discoveredIslands.push(NPCS.odile.islandId);
    expect(selectTrackedQuestTarget(state)).toMatchObject({
      questId: 'odile_windfall', islandId: NPCS.odile.islandId, position: { x: spotOf('odile').x, z: spotOf('odile').z },
    });
  });
});

describe('the frame the world view is given', () => {
  function appWith(): { app: App; frames: FrameInfo[]; models: InterfaceModel[] } {
    const frames: FrameInfo[] = [];
    const models: InterfaceModel[] = [];
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
      sync: (_state, frame) => void frames.push(frame),
      handleEvents: () => {}, render: () => {}, dispose: () => {},
    };
    const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
    const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
    return { app, frames, models };
  }
  const frameOf = (app: App, frames: FrameInfo[]): FrameInfo => {
    app.frame(FIXED_STEP);
    return frames.at(-1)!;
  };

  it('says panelOpen while a panel or menu covers the view, and not otherwise', () => {
    const { app, frames } = appWith();
    expect(frameOf(app, frames).panelOpen).toBe(false); // the lobby title is not a panel
    app.session.handleIntent({ type: 'open_panel', panel: 'settings' });
    expect(frameOf(app, frames).panelOpen).toBe(true);
    app.session.handleIntent({ type: 'close_panel' });
    app.session.newGame(0);
    expect(frameOf(app, frames)).toMatchObject({ panelOpen: false, paused: false });
    for (const key of ['Tab', 'KeyC', 'KeyJ', 'KeyM', 'Escape']) {
      app.session.keyDown(key);
      expect(frameOf(app, frames).panelOpen, key).toBe(true);
      app.session.keyDown(key === 'Escape' ? 'Escape' : key);
      expect(frameOf(app, frames).panelOpen, `${key} again`).toBe(false);
    }
    // A conversation leaves the world in view.
    app.session.game!.players[0].dialogue = { npcId: 'odile', nodeId: NPCS.odile.entries[0].nodeId };
    expect(frameOf(app, frames).panelOpen).toBe(false);
    expect(app.session.isOpen('dialogue')).toBe(true);
  });

  it('carries the tracked quest target, or null', () => {
    const { app, frames } = appWith();
    expect(frameOf(app, frames).trackedQuestTarget).toBeNull(); // lobby
    app.session.newGame(0);
    const landing = islandLanding('home_knoll').shore;
    expect(frameOf(app, frames).trackedQuestTarget).toMatchObject({ x: landing.x, z: landing.z });
    const game = app.session.game!;
    game.quests.bail_out.status = 'completed';
    game.quests.first_haul.status = 'active';
    game.players[0].trackedQuestIds = ['first_haul'];
    expect(frameOf(app, frames).trackedQuestTarget).toBeNull();
  });
});

describe('an item id on every row that names an item', () => {
  /** At the camp with the canoe beached, a mixed bag in hand. */
  function stocked(): GameState {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    give(state, 'driftwood', 6);
    give(state, 'berries', 3, 'cargo');
    give(state, 'stone_knife');
    give(state, 'lens');
    state.pendingRewards.push({ itemId: 'rope', count: 2 });
    return state;
  }
  const isItem = (itemId: unknown): boolean => typeof itemId === 'string' && itemId in ITEMS;

  it('names the item on inventory, cargo, tool, key item and reward rows', () => {
    const panel = buildInventoryPanel(stocked());
    expect(panel.backpack.slots[0]).toMatchObject({ itemId: 'driftwood', name: ITEMS.driftwood.name });
    expect(panel.cargo.slots[0]).toMatchObject({ itemId: 'berries' });
    expect(panel.backpack.slots.at(-1)).toMatchObject({ itemId: null }); // an empty slot names nothing
    expect(panel.tools.map((tool) => tool.itemId)).toEqual(['bailing_can', 'stone_knife']);
    expect(panel.keyItems).toEqual([{ itemId: 'lens', name: ITEMS.lens.name, count: 1 }]);
    expect(panel.pendingRewards!.items).toEqual([{ itemId: 'rope', name: ITEMS.rope.name, count: 2 }]);
  });

  it('names the output and every input and tool on recipe rows, and nothing on an untaught recipe', () => {
    const recipes = buildCraftingPanel(stocked()).stations.flatMap((station) => station.recipes);
    expect(recipes.length).toBeGreaterThan(10);
    const known = recipes.filter((recipe) => recipe.known);
    const untaught = recipes.filter((recipe) => !recipe.known);
    expect(untaught.length).toBeGreaterThan(0);
    for (const recipe of known) {
      expect(isItem(recipe.itemId), recipe.recipeId).toBe(true);
      expect(recipe.inputs.length, recipe.recipeId).toBeGreaterThan(0);
      for (const input of recipe.inputs) expect(isItem(input.itemId), `${recipe.recipeId} ${input.name}`).toBe(true);
    }
    for (const recipe of untaught) expect(recipe.itemId, recipe.recipeId).toBeNull();
    const knife = known.find((recipe) => recipe.recipeId === 'stone_knife')!;
    expect(knife.itemId).toBe('stone_knife');
    expect(knife.inputs.map((input) => input.itemId)).toEqual(['stone', 'driftwood', 'fiber']);
    const hatchet = known.find((recipe) => recipe.recipeId === 'hatchet')!;
    expect(hatchet.inputs.at(-1)).toMatchObject({ itemId: 'stone_knife', name: 'Stone knife (tool)' });
  });

  it('names the item on every cost row of the canoe builder', () => {
    const panel = buildCanoeBuilderPanel(stocked());
    const rows = [panel.hull!, ...panel.attachments];
    const costs = rows.flatMap((row) => row.costs);
    expect(costs.length).toBeGreaterThan(40);
    for (const cost of costs) expect(isItem(cost.itemId), cost.name).toBe(true);
    expect(panel.hull!.costs.map((cost) => cost.itemId)).toEqual(['pitch', 'birch_bark']);
  });

  it('names the tool on each filled hotbar slot', () => {
    const hotbar = buildHudModel(stocked(), settings, 0).hotbar;
    expect(hotbar.map((slot) => slot.itemId)).toEqual(['bailing_can', 'stone_knife', null, null, null]);
    for (const slot of hotbar) expect(slot.itemId).toBe(slot.toolId);
  });

  it('names the item on loot toasts, and leaves the other toasts without one', () => {
    const state = stocked();
    const toasts = toastsFromEvents([
      { type: 'item_gained', itemId: 'driftwood', count: 2, container: 'backpack' },
      { type: 'item_gained', itemId: 'driftwood', count: 1, container: 'cargo' },
      { type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt' },
      { type: 'item_gained', itemId: 'lens', count: 1, container: 'key_items' },
      { type: 'item_lost', itemId: 'berries', count: 1 },
      { type: 'item_left_behind', nodeId: 'home_knoll.driftwood_pile.1', itemId: 'driftwood', count: 2 },
      { type: 'crafted', recipeId: 'stone_knife', count: 1 },
      { type: 'quest_ready', questId: 'first_haul' },
      { type: 'meter_low', meter: 'hunger' },
    ], state);
    expect(toasts.map((entry) => entry.itemId ?? null)).toEqual(['driftwood', 'hatchet', 'lens', 'berries', 'driftwood', 'stone_knife', null, null]);
    expect(toasts[0].text).toBe('+3 Driftwood');
    // The queue carries it through to the model the interface draws.
    const queue = new ToastQueue();
    queue.addAll(toasts.slice(0, 3));
    queue.add({ text: 'Game saved', tone: 'info' });
    const models = queue.models();
    expect(models[0]).toMatchObject({ text: '+3 Driftwood', itemId: 'driftwood' });
    expect(models.at(-1)).toMatchObject({ text: 'Game saved', itemId: null });
    for (const model of models) expect(model.itemId === null || isItem(model.itemId)).toBe(true);
  });
});

describe('a compass that glides', () => {
  it('gives the heading and the relative bearings as fractions of a degree', () => {
    const state = newGame();
    const yaw = (37.26 * Math.PI) / 180;
    const compass = buildHudModel(state, settings, yaw).compass;
    expect(compass.headingDegrees).toBeCloseTo(37.26, 2);
    expect(Number.isInteger(compass.headingDegrees)).toBe(false);
    expect(compass.marks.find((mark) => mark.id === 'north')!.relativeDegrees).toBeCloseTo(-37.26, 2);
    expect(compass.marks.find((mark) => mark.id === 'east')!.relativeDegrees).toBeCloseTo(52.74, 2);
    // A slow turn moves it a little at a time, not a whole degree at a go.
    const next = buildHudModel(state, settings, yaw + (0.3 * Math.PI) / 180).compass;
    expect(next.headingDegrees - compass.headingDegrees).toBeCloseTo(0.3, 2);
    // It stays inside 0 to 360 and -180 to 180 all the way round.
    for (let degrees = -720; degrees <= 720; degrees += 7.3) {
      const model = buildHudModel(state, settings, (degrees * Math.PI) / 180).compass;
      expect(model.headingDegrees).toBeGreaterThanOrEqual(0);
      expect(model.headingDegrees).toBeLessThan(360);
      for (const mark of model.marks) {
        expect(mark.relativeDegrees).toBeGreaterThanOrEqual(-180);
        expect(mark.relativeDegrees).toBeLessThanOrEqual(180);
      }
    }
    // Still whole where it is whole.
    expect(buildHudModel(state, settings, 0).compass.headingDegrees).toBe(0);
    expect(buildHudModel(state, settings, Math.PI / 2).compass.marks.find((mark) => mark.id === 'east')!.relativeDegrees).toBe(0);
  });
});

describe('panel keys under a menu', () => {
  function playing(): { session: Session; signals: SessionSignal[] } {
    const session = new Session({ storage: new FakeStorage(), now: () => 1000, randomSeed: () => 7 });
    session.newGame(0);
    const signals: SessionSignal[] = [];
    session.subscribe((signal) => signals.push(signal));
    return { session, signals };
  }
  const PANEL_KEYS = ['Tab', 'KeyC', 'KeyB', 'KeyJ', 'KeyM'];

  it('do nothing while the pause menu or the settings are open: no toast, no error sound', () => {
    const { session, signals } = playing();
    session.keyDown('Escape');
    expect(session.isOpen('pause')).toBe(true);
    signals.length = 0;
    for (const key of PANEL_KEYS) {
      session.keyDown(key);
      session.keyUp(key);
    }
    expect(session.panels.stack).toEqual(['pause']);
    expect(signals).toEqual([]); // not a notice, not a sound, nothing
    session.handleIntent({ type: 'open_panel', panel: 'settings' });
    signals.length = 0;
    for (const key of PANEL_KEYS) session.keyDown(key);
    expect(session.panels.stack).toEqual(['pause', 'settings']);
    expect(signals).toEqual([]);
    // Esc still backs out, with its sound.
    session.keyDown('Escape');
    expect(session.panels.stack).toEqual(['pause']);
    expect(signals).toContainEqual({ type: 'interface_sound', sound: 'close' });
  });

  it('still work in play, and still say why when the canoe builder cannot open', () => {
    const { session, signals } = playing();
    session.keyDown('Tab');
    expect(session.isOpen('inventory')).toBe(true);
    session.keyDown('Tab');
    expect(session.panels.stack).toEqual([]);
    signals.length = 0;
    session.keyDown('KeyB'); // afloat: the builder needs the canoe beached
    expect(signals.some((signal) => signal.type === 'notice')).toBe(true);
    expect(signals).toContainEqual({ type: 'interface_sound', sound: 'error' });
    drainEvents(session.game!);
  });
});
