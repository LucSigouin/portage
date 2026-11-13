import { describe, expect, it } from 'vitest';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { SettingId } from '../../src/client/intents.ts';
import {
  ToastQueue, MAXIMUM_TOASTS, applySettingChange, bindingRows, buildCanoeBuilderPanel, buildCraftingPanel,
  buildDialoguePanel, buildHowToPlayPanel, buildHudModel, buildInterfaceModel, buildInventoryPanel, buildLobbyModel,
  buildMapPanel, buildQuestLogPanel, buildSaveSlot, cardinalName, durationText, failureText, keyLabel, needsText,
  savedAgoText, settingsRows, toastForEvent, toastsFromEvents,
} from '../../src/client/viewmodels/index.ts';
import type { InterfaceModelInput } from '../../src/client/viewmodels/index.ts';
import { ISLANDS, NODES_BY_ISLAND, TUNING } from '../../src/data/index.ts';
import type { SlotSummary } from '../../src/save/index.ts';
import { INPUT_ACTIONS, createDefaultSettings } from '../../src/settings/index.ts';
import { buildSettingsPanel } from '../../src/client/viewmodels/settings.ts';
import { GAME_VERSION, versionLine } from '../../src/client/version.ts';
import { dispatch, selectInteractable } from '../../src/sim/index.ts';
import type { GameEvent, GameState, Missing } from '../../src/sim/index.ts';
import { SETTINGS_TABS } from '../../src/client/panels.ts';
import { floatCanoeAt, give, newGame, run, standOn, teleport, teleportToBed, teleportToCamp, teleportToNode } from '../support.ts';

const settings = createDefaultSettings();
/** Every source file of the game, as text. */
const sources = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const missing = (overrides: Partial<Missing>): Missing => ({
  items: [], tools: [], station: null, hullTier: null, attachments: [], flag: null, ...overrides,
});
const nodeOfType = (typeId: string): string => NODES_BY_ISLAND.home_knoll.find((node) => node.typeId === typeId)!.id;

describe('wording', () => {
  it('says what is missing the way a person would', () => {
    expect(needsText(missing({ items: [{ itemId: 'plank', count: 3 }] }))).toBe('Needs 3 more plank');
    expect(needsText(missing({ items: [{ itemId: 'plank', count: 3 }], tools: ['hammer'] }))).toBe('Needs 3 more plank, hammer');
    expect(needsText(missing({ station: 'bench', hullTier: 2, attachments: ['outrigger_port'] })))
      .toBe('Needs the bench, the ribbed canoe, the port outrigger');
    expect(needsText(missing({ flag: 'wren_taught_sailcloth' }))).toBe('Needs Wren to teach you');
    expect(needsText(missing({}))).toBe('');
    expect(needsText(null)).toBe('');
    expect(failureText('missing_requirements', missing({ tools: ['hatchet'] }))).toBe('Needs hatchet.');
    expect(failureText('canoe_not_beached', null)).toBe('Beach the canoe first.');
  });

  it('names keys, durations and bearings', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ShiftLeft')).toBe('Left Shift');
    expect(keyLabel('ArrowUp')).toBe('Up');
    expect(keyLabel('F5')).toBe('F5');
    expect(durationText(30)).toBe('under a minute');
    expect(durationText(4 * 60 + 10)).toBe('4 min');
    expect(durationText(3600 + 12 * 60)).toBe('1 h 12 min');
    expect(cardinalName(0)).toBe('N');
    expect(cardinalName(Math.PI / 2)).toBe('E');
    expect(cardinalName(-Math.PI / 2)).toBe('W');
    expect(cardinalName(Math.PI / 8, 16)).toBe('NNE');
    expect(savedAgoText(0, 30_000)).toBe('just now');
    expect(savedAgoText(0, 5 * 60_000)).toBe('5 min ago');
    expect(savedAgoText(0, 49 * 3600_000)).toBe('2 days ago');
  });
});

describe('the HUD', () => {
  it('shows three meters with low warnings and the starving cap', () => {
    const state = newGame();
    state.players[0].hunger = 20.4;
    state.players[0].thirst = 60;
    const hud = buildHudModel(state, settings, 0);
    expect(hud.meters.map((meter) => [meter.id, meter.value, meter.low])).toEqual([
      ['hunger', 20, true], ['thirst', 60, false], ['energy', 90, false],
    ]);
    expect(hud.meters[2].cap).toBe(100);
    state.players[0].hunger = 0;
    expect(buildHudModel(state, settings, 0).meters[2].cap).toBe(40);
    // Three different patterns, for the patterned-meters setting.
    expect(new Set(hud.meters.map((meter) => meter.pattern)).size).toBe(3);
  });

  it('shows the water gauge rising in the leaky canoe, falling while bailing, and gone on dry land', () => {
    const state = newGame();
    const afloat = buildHudModel(state, settings, 0).water;
    expect(afloat).toMatchObject({ visible: true, value: 60, warning: false, trend: 'rising', label: 'Leaking' });
    run(state, { bail: true }, 1);
    expect(buildHudModel(state, settings, 0).water).toMatchObject({ trend: 'falling', label: 'Bailing' });
    state.canoe.waterLevel = 80;
    expect(buildHudModel(state, settings, 0).water.warning).toBe(true);
    standOn(state, 'home_knoll');
    expect(buildHudModel(state, settings, 0).water.visible).toBe(false);
  });

  it('lays the tool belt on five hotbar slots with the bound keys', () => {
    const state = newGame();
    give(state, 'stone_knife');
    state.players[0].selectedTool = 'stone_knife';
    const hotbar = buildHudModel(state, settings, 0).hotbar;
    expect(hotbar).toHaveLength(5);
    expect(hotbar[0]).toMatchObject({ number: 1, keyLabel: '1', toolId: 'bailing_can', name: 'Bailing can', selected: false });
    expect(hotbar[0].intent).toEqual({ type: 'command', command: { type: 'select_tool', toolId: 'bailing_can' } });
    // Clicking the selected tool puts it away.
    expect(hotbar[1]).toMatchObject({ selected: true });
    expect(hotbar[1].intent).toEqual({ type: 'command', command: { type: 'select_tool', toolId: null } });
    expect(hotbar[2]).toMatchObject({ toolId: null, intent: null });
  });

  it('tracks the current quest with its objectives', () => {
    const state = newGame();
    const tracker = buildHudModel(state, settings, 0).tracker!;
    expect(tracker).toMatchObject({ questId: 'bail_out', name: 'Bail out', kind: 'main', ready: false });
    expect(tracker.objectives.length).toBeGreaterThanOrEqual(2);
    expect(tracker.objectives.every((objective) => !objective.done)).toBe(true);
  });

  it('points the compass at the tracked target relative to the camera', () => {
    const state = newGame();
    const facingNorth = buildHudModel(state, settings, 0).compass;
    expect(facingNorth).toMatchObject({ headingDegrees: 0, cardinal: 'N' });
    expect(facingNorth.marks.find((mark) => mark.id === 'east')).toMatchObject({ kind: 'cardinal', relativeDegrees: 90 });
    // Home Knoll (the first quest's landing) is due south of the start.
    const quest = facingNorth.marks.find((mark) => mark.kind === 'quest')!;
    expect(Math.abs(quest.relativeDegrees)).toBeGreaterThan(160);
    expect(quest.distanceText).toMatch(/^\d+ m$/);
    // Turn the camera south and the mark is dead ahead.
    const facingSouth = buildHudModel(state, settings, Math.PI).compass;
    expect(facingSouth.cardinal).toBe('S');
    expect(Math.abs(facingSouth.marks.find((mark) => mark.kind === 'quest')!.relativeDegrees)).toBeLessThan(20);
    // On foot the canoe gets a mark too.
    standOn(state, 'home_knoll');
    expect(buildHudModel(state, settings, 0).compass.marks.some((mark) => mark.kind === 'canoe')).toBe(true);
  });

  it('prompts for what the interact key would do, with the key it is bound to: press, or blocked', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    expect(buildHudModel(state, settings, 0).prompt).toEqual({ text: 'Board the canoe', keyLabel: 'F', mode: 'press' });

    // A node is one press too: no hold, no progress.
    teleportToNode(state, nodeOfType('driftwood_pile'));
    const node = buildHudModel(state, settings, 0).prompt!;
    expect(node).toEqual({ text: 'Gather: Driftwood pile', keyLabel: 'F', mode: 'press' });

    // Rebound, the prompt shows the new key. Unbound, it says so.
    const rebound = { ...settings, controls: { ...settings.controls, keyBindings: { ...settings.controls.keyBindings, interact: ['KeyG'] } } };
    expect(buildHudModel(state, rebound, 0).prompt!.keyLabel).toBe('G');
    const unbound = { ...settings, controls: { ...settings.controls, keyBindings: { ...settings.controls.keyBindings, interact: [] } } };
    expect(buildHudModel(state, unbound, 0).prompt!.keyLabel).toBe('unbound');

    // A birch needs the knife: blocked, and the prompt says why.
    teleportToNode(state, NODES_BY_ISLAND.birch_islet.find((node) => node.typeId === 'birch')!.id);
    expect(selectInteractable(state)).toMatchObject({ kind: 'node', available: false });
    const blocked = buildHudModel(state, settings, 0).prompt!;
    expect(blocked.mode).toBe('blocked');
    expect(blocked.text).toContain('needs stone knife');
  });

  it('offers a bed no key before the sleep hour, says the hour from the rules\' table, and offers the key from then on', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToBed(state, 'home_knoll');
    const hour = TUNING.time.hourSeconds;
    const from = TUNING.time.sleepFromHour;
    const clock = `${String(from).padStart(2, '0')}:00`;

    // Midday, rested: the bed tells when, and promises nothing.
    state.time = 12 * hour;
    expect(selectInteractable(state)).toMatchObject({ kind: 'bed', command: { type: 'sleep' } });
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: false, reason: 'not_tired' });
    expect(buildHudModel(state, settings, 0).prompt).toEqual({ text: `Sleep (after ${clock})`, keyLabel: '', mode: 'blocked' });
    // The refusal names the same hour, and so does How to Play.
    expect(failureText('not_tired', null)).toBe(`Not tired yet. Sleep after ${clock}, or when worn out.`);
    expect(JSON.stringify(buildHowToPlayPanel(settings))).toContain(`Sleep at a camp after ${clock} to refill it`);

    // A minute before the hour it still does; on the hour the key is back and the key works.
    state.time = from * hour - 60;
    expect(buildHudModel(state, settings, 0).prompt!.keyLabel).toBe('');
    state.time = from * hour;
    expect(buildHudModel(state, settings, 0).prompt).toEqual({ text: 'Sleep until morning', keyLabel: 'F', mode: 'press' });

    // Worn out by day, the bed takes you: so the key is offered.
    state.time = 12 * hour;
    state.players[0].energy = TUNING.time.sleepWhenEnergyAtMost;
    expect(buildHudModel(state, settings, 0).prompt).toEqual({ text: 'Sleep until morning', keyLabel: 'F', mode: 'press' });
    expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
  });

  it('types the sleep hour in nowhere: no file of the game spells it out', () => {
    const clock = `${String(TUNING.time.sleepFromHour).padStart(2, '0')}:00`;
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(Object.entries(sources).filter(([, text]) => text.includes(clock)).map(([path]) => path)).toEqual([]);
  });

  it('ashore with the bail step still open, says that bailing is done aboard, with both keys as they are bound', () => {
    const state = newGame();
    // A new game: the canoe is half full, and the first quest asks for it to be bailed.
    expect(state.canoe.waterLevel).toBeGreaterThan(10);
    expect(buildHudModel(state, settings, 0).tracker!.objectives[0]).toMatchObject({ text: 'Bail the canoe nearly dry', done: false });
    expect(buildHudModel(state, settings, 0).hint).toBe('Hold R to bail.');
    // The player lands first, as the review did. The water is still aboard and the step is still open.
    standOn(state, 'home_knoll');
    state.canoe.waterLevel = 60;
    run(state, {}, 0.1);
    expect(state.players[0].mode).toBe('foot');
    expect(buildHudModel(state, settings, 0).tracker!.objectives[0]!.done).toBe(false);
    expect(buildHudModel(state, settings, 0).hint).toBe('Board (F), then hold R to bail.');
    // Both keys are read from the bindings.
    const rebound = { ...settings, controls: { ...settings.controls, keyBindings: { ...settings.controls.keyBindings, interact: ['KeyG'], bail: ['KeyB'] } } };
    expect(buildHudModel(state, rebound, 0).hint).toBe('Board (G), then hold B to bail.');
    // And the words are true: boarded and bailing, the water goes down and the step is done.
    expect(dispatch(state, { type: 'board' }).ok).toBe(true);
    run(state, { bail: true }, 25);
    expect(state.canoe.waterLevel).toBeLessThanOrEqual(10);
    expect(buildHudModel(state, settings, 0).tracker?.objectives.find((objective) => objective.text === 'Bail the canoe nearly dry')?.done ?? true).toBe(true);
    // Ashore again with the step done, nothing more is said about bailing.
    expect(dispatch(state, { type: 'disembark' }).ok).toBe(true);
    run(state, {}, 0.1);
    expect(buildHudModel(state, settings, 0).hint ?? '').not.toContain('bail');
    // Bailed dry afloat, then ashore somewhere that is not Home Knoll: the quest is still open, its bail step is not.
    const elsewhere = newGame();
    elsewhere.canoe.waterLevel = 0;
    run(elsewhere, {}, 0.1);
    standOn(elsewhere, 'birch_islet');
    run(elsewhere, {}, 0.1);
    expect(elsewhere.quests.bail_out).toMatchObject({ status: 'active', progress: [1, 0] });
    expect(buildHudModel(elsewhere, settings, 0).hint ?? '').not.toContain('bail');
    // A thirsty player is told about the thirst first, and with hints off nobody is told anything.
    const dry = newGame();
    standOn(dry, 'home_knoll');
    dry.canoe.waterLevel = 60;
    run(dry, {}, 0.1);
    dry.players[0].thirst = 10;
    expect(buildHudModel(dry, settings, 0).hint).toContain('Thirsty.');
    dry.players[0].thirst = 100;
    expect(buildHudModel(dry, { ...settings, gameplay: { ...settings.gameplay, hints: false } }, 0).hint).toBeNull();
  });

  it('gives a hint only when the setting is on and one applies', () => {
    const state = newGame();
    expect(buildHudModel(state, settings, 0).hint).toBe('Hold R to bail.');
    const quiet = { ...settings, gameplay: { ...settings.gameplay, hints: false } };
    expect(buildHudModel(state, quiet, 0).hint).toBeNull();
    state.canoe.waterLevel = 0;
    expect(buildHudModel(state, settings, 0).hint).toBeNull();
  });

  it('warns about rough water with the two numbers that decide it', () => {
    const state = newGame();
    floatCanoeAt(state, 100, 300); // the Reach: roughness 2 against stability 1
    const lines = buildHudModel(state, settings, 0).canoeLines;
    expect(lines.find((line) => line.tone === 'danger')?.text).toBe('Rough water 2.0, stability 1');
    floatCanoeAt(state, 0, 1050);
    expect(buildHudModel(state, settings, 0).canoeLines.some((line) => line.tone === 'danger')).toBe(false);
  });
});

describe('toasts', () => {
  const state = newGame();

  it('adds up gains of one item into a single line', () => {
    const events: GameEvent[] = [
      { type: 'item_gained', itemId: 'driftwood', count: 2, container: 'backpack' },
      { type: 'item_gained', itemId: 'driftwood', count: 1, container: 'backpack' },
      { type: 'item_gained', itemId: 'fiber', count: 3, container: 'cargo' },
      { type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt' },
    ];
    expect(toastsFromEvents(events, state).map((toast) => toast.text)).toEqual(['+3 Driftwood', '+3 Cattail fiber', 'New tool: Hatchet']);
  });

  it('tells a capsize once, with what the lake took', () => {
    const events: GameEvent[] = [
      { type: 'capsized' },
      { type: 'item_lost', itemId: 'plank', count: 2 },
      { type: 'washed_ashore', cause: 'capsized', islandId: 'home_knoll', lost: [{ itemId: 'plank', count: 2 }] },
    ];
    const toasts = toastsFromEvents(events, state);
    expect(toasts.map((toast) => toast.text)).toEqual(['Capsized.', 'Washed ashore on Home Knoll. Lost: 2 x Plank.']);
    expect(toasts.every((toast) => toast.tone === 'danger')).toBe(true);
    // Dropping something by hand still says so.
    expect(toastsFromEvents([{ type: 'item_lost', itemId: 'plank', count: 2 }], state)[0].text).toBe('-2 Plank');
  });

  it('says why a scavenge was blocked and when a quest step lands', () => {
    const birch = NODES_BY_ISLAND.birch_islet.find((node) => node.typeId === 'birch')!;
    expect(toastForEvent({ type: 'harvest_blocked', nodeId: birch.id, missing: missing({ tools: ['stone_knife'] }) }, state))
      .toEqual({ text: `${birch.name}: needs stone knife`, tone: 'warning' });
    expect(toastForEvent({ type: 'quest_advanced', questId: 'bail_out', objectiveIndex: 0, progress: 0.4, required: 1 }, state)).toBeNull();
    expect(toastForEvent({ type: 'quest_advanced', questId: 'bail_out', objectiveIndex: 0, progress: 1, required: 1 }, state)?.tone).toBe('good');
    expect(toastForEvent({ type: 'storm_warning', secondsUntilStorm: 90 }, state)).toEqual({ text: 'Storm in 90 s. Get ashore.', tone: 'danger' });
    expect(toastForEvent({ type: 'boarded' }, state)).toBeNull();
  });

  it('keeps a short queue that fades on real time and does not stack repeats', () => {
    const queue = new ToastQueue();
    queue.add({ text: 'Game saved', tone: 'info' });
    queue.add({ text: 'Game saved', tone: 'info' });
    expect(queue.models()).toHaveLength(1);
    queue.update(3);
    expect(queue.models()[0].life).toBeLessThan(0.3);
    queue.add({ text: 'Game saved', tone: 'info' }); // the same line again restarts its clock
    expect(queue.models()[0].life).toBe(1);
    queue.update(10);
    expect(queue.models()).toEqual([]);
    for (let index = 0; index < MAXIMUM_TOASTS + 3; index += 1) queue.add({ text: `line ${index}`, tone: 'info' });
    const kept = queue.models();
    expect(kept).toHaveLength(MAXIMUM_TOASTS);
    expect(kept[kept.length - 1].text).toBe(`line ${MAXIMUM_TOASTS + 2}`); // newest kept, oldest dropped
  });
});

describe('the panels', () => {
  it('lists recipes with what one more craft needs, and enables them when it is all there', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    const knife = (): ReturnType<typeof buildCraftingPanel>['stations'][number]['recipes'][number] =>
      buildCraftingPanel(state).stations.find((station) => station.name === 'Hands')!.recipes.find((recipe) => recipe.recipeId === 'stone_knife')!;
    expect(knife().craft.enabled).toBe(false);
    expect(knife().missingText).toMatch(/^Needs \d more /);
    expect(knife().inputs.every((input) => input.have === 0 && !input.enough)).toBe(true);
    for (const input of knife().inputs) expect(knife().missingText).toContain(input.name.toLowerCase());

    give(state, 'stone', 5);
    give(state, 'driftwood', 5);
    give(state, 'fiber', 5);
    expect(knife()).toMatchObject({ missingText: '', craft: { enabled: true, intent: { type: 'command', command: { type: 'craft', recipeId: 'stone_knife', count: 1 } } } });
    expect(knife().inputs.every((input) => input.enough)).toBe(true);

    // The fire is at the camp, not at the beach: at the beach its recipes are not listed at all (Luc's list, Round 3).
    expect(buildCraftingPanel(state).stations.map((station) => station.name)).toEqual(['Hands']);
    teleportToCamp(state, 'home_knoll');
    const fire = buildCraftingPanel(state).stations.find((station) => station.name === 'Fire')!;
    expect(fire.recipes.find((recipe) => recipe.recipeId === 'pitch')!.missingText).not.toContain('the fire');
  });

  it('says where dirty water comes from on the recipe that is short of it, with the inventory key as it is bound', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    const recipes = (bindings = settings.controls.keyBindings) => buildCraftingPanel(state, 0, bindings).stations.flatMap((station) => station.recipes);
    const boil = (bindings = settings.controls.keyBindings) => recipes(bindings).find((recipe) => recipe.recipeId === 'clean_water')!;
    expect(boil()).toMatchObject({ name: 'Boil water', missingText: 'Needs 1 more dirty water', sourceText: 'Scoop it at the water, from the inventory (Tab).' });
    // Nothing else is short of dirty water, so nothing else says it.
    expect(recipes().filter((recipe) => recipe.sourceText !== '').map((recipe) => recipe.recipeId)).toEqual(['clean_water']);
    // The key is read from the bindings, not typed in.
    const rebound = { ...settings.controls.keyBindings, inventory: ['KeyI'] };
    expect(boil(rebound).sourceText).toBe('Scoop it at the water, from the inventory (I).');
    // The whole interface model passes the player's own bindings through.
    const model = buildInterfaceModel({
      panels: reducePanels(createPanelState('game'), { type: 'open', panel: 'crafting' }, { canoeBeached: true }).state,
      settings: { ...settings, controls: { ...settings.controls, keyBindings: rebound } },
      game: state, paused: false, cameraYaw: 0, toasts: [], slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null,
      bindingNotice: '', progressText: '', debug: null,
    });
    if (model.panel?.id !== 'crafting') throw new Error('expected the crafting panel');
    expect(model.panel.stations.flatMap((station) => station.recipes).find((recipe) => recipe.recipeId === 'clean_water')!.sourceText)
      .toBe('Scoop it at the water, from the inventory (I).');
    // With the water in the pack the line is gone, and the words were true: it was scooped at the water.
    standOn(state, 'home_knoll');
    expect(dispatch(state, { type: 'fill_water', count: 1 }).ok).toBe(true);
    teleportToCamp(state, 'home_knoll');
    expect(boil()).toMatchObject({ missingText: '', sourceText: '', craft: { enabled: true } });
  });

  it('offers "make all" only when more than one can be made, and hides untaught recipes', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'fiber', 9);
    const rope = buildCraftingPanel(state).stations[0].recipes.find((recipe) => recipe.recipeId === 'rope')!;
    expect(rope.craftAll).toMatchObject({ label: 'Make 3', intent: { type: 'command', command: { type: 'craft', recipeId: 'rope', count: 3 } } });
    teleportToCamp(state, 'home_knoll'); // the stump bench is in the camp
    const bench = buildCraftingPanel(state).stations.find((station) => station.name === 'Bench')!;
    const sailcloth = bench.recipes.find((recipe) => recipe.recipeId === 'sailcloth')!;
    expect(sailcloth).toMatchObject({ known: false, name: 'Unknown recipe', inputs: [], craft: { enabled: false } });
    state.flags.wren_taught_sailcloth = true;
    expect(buildCraftingPanel(state).stations.find((station) => station.name === 'Bench')!.recipes
      .find((recipe) => recipe.recipeId === 'sailcloth')).toMatchObject({ known: true, name: 'Sailcloth' });
  });

  it('shows the next hull and all nineteen attachments with their missing parts', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    const panel = buildCanoeBuilderPanel(state);
    expect(panel.blockedText).toBe('');
    expect(panel.hull).toMatchObject({ id: 'hull', name: 'Hull: Patched canoe', built: false });
    expect(panel.hull!.missingText).toBe('Needs 2 more pitch, 3 more birch bark');
    expect(panel.hull!.build).toMatchObject({ enabled: false, intent: { type: 'command', command: { type: 'upgrade_hull' } } });
    expect(panel.attachments).toHaveLength(19);
    const outrigger = panel.attachments.find((row) => row.id === 'outrigger_port')!;
    expect(outrigger.missingText).toContain('the ribbed canoe');
    expect(outrigger.missingText).toContain('2 more spruce log');
    expect(outrigger.build!.enabled).toBe(false);
    // What no item chip can say is a chip of its own: the hull it needs. The items are chips already.
    expect(outrigger.needs).toEqual([{ kind: 'hull', name: 'Ribbed canoe' }]);
    expect(panel.hull!.needs).toEqual([]);

    give(state, 'pitch', 2);
    give(state, 'birch_bark', 3);
    expect(buildCanoeBuilderPanel(state).hull).toMatchObject({ missingText: '', build: { enabled: true } });
    expect(dispatch(state, { type: 'upgrade_hull' }).ok).toBe(true);
    expect(buildCanoeBuilderPanel(state).hull!.name).toBe('Hull: Ribbed canoe');
    expect(buildCanoeBuilderPanel(state).statLines[0]).toBe('Patched canoe (hull 1 of 3)');
  });

  it('says why nothing can be built away from the canoe', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'pitch', 2, 'cargo');
    give(state, 'birch_bark', 3, 'cargo');
    teleport(state, 'home_knoll', 0, 1150); // the top of the knoll, well away from the hull
    const panel = buildCanoeBuilderPanel(state);
    expect(panel.blockedText).toBe('Walk to the canoe to work on it.');
    expect(panel.hull!.build!.enabled).toBe(false);
  });

  it('lays out the backpack and the cargo as slots with the actions each stack allows', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 4);
    give(state, 'driftwood', 6, 'cargo');
    const panel = buildInventoryPanel(state);
    expect(panel.backpack.label).toBe('Backpack 1 / 8');
    expect(panel.backpack.slots).toHaveLength(8);
    expect(panel.backpack.slots[1].itemId).toBeNull();
    const berries = panel.backpack.slots[0];
    expect(berries).toMatchObject({ itemId: 'berries', name: 'Berries', count: 4 });
    expect(berries.buttons.map((button) => button.label)).toEqual(['Eat', 'To cargo', 'Drop']);
    expect(berries.buttons[1].intent).toEqual({ type: 'command', command: { type: 'transfer', from: 'backpack', itemId: 'berries', count: 4 } });
    expect(panel.cargo.slots).toHaveLength(8);
    expect(panel.cargo.slots[0].buttons.map((button) => button.label)).toEqual(['To backpack', 'Drop']);
    expect(panel.stow.enabled).toBe(true);
    expect(panel.tools.map((tool) => tool.name)).toEqual(['Bailing can']);

    // Out of reach of the canoe (paddled off, so not landed here): the cargo is shown but nothing moves.
    teleport(state, 'home_knoll', 0, 1150);
    state.canoe.beached = false;
    const away = buildInventoryPanel(state);
    expect(away.cargo.accessible).toBe(false);
    expect(away.cargo.label).toContain('out of reach');
    expect(away.backpack.slots[0].buttons.find((button) => button.label === 'To cargo')!.enabled).toBe(false);
    expect(away.stow.enabled).toBe(false);
    expect(away.cargo.slots[0].buttons.every((button) => !button.enabled)).toBe(true);
  });

  it('groups the quest log and marks the tracked quest', () => {
    const state = newGame();
    const log = buildQuestLogPanel(state);
    expect(log.groups[0].heading).toBe('Main line');
    const bailOut = log.groups[0].quests[0];
    expect(bailOut).toMatchObject({ questId: 'bail_out', statusText: 'Active', tracked: true, done: false });
    expect(bailOut.track).toMatchObject({
      label: 'Untrack', enabled: true, intent: { type: 'command', command: { type: 'track_quest', questId: 'bail_out', tracked: false } },
    });
    state.players[0].trackedQuestIds = [];
    expect(buildQuestLogPanel(state).groups[0].quests[0].track).toMatchObject({
      label: 'Track', enabled: true, intent: { type: 'command', command: { type: 'track_quest', questId: 'bail_out' } },
    });
  });

  it('charts only what has been discovered, north up, with the player on it', () => {
    const state = newGame();
    const map = buildMapPanel(state);
    expect(map.islands.map((island) => island.islandId)).toEqual(['home_knoll']);
    expect(map.summary).toMatch(new RegExp(`^1 of ${ISLANDS.length} islands charted, \\d+% of the lake seen$`));
    const home = map.islands[0];
    expect(home.left).toBeCloseTo(0.5);
    expect(home.top).toBeGreaterThan(0.8); // far south: low on the chart
    expect(home.bearingText).toBe('');
    const player = map.markers.find((marker) => marker.kind === 'player')!;
    expect(player.top).toBeLessThan(home.top); // the start is north of the knoll
    for (const marker of map.markers) {
      expect(marker.left).toBeGreaterThanOrEqual(0);
      expect(marker.left).toBeLessThanOrEqual(1);
      expect(marker.top).toBeGreaterThanOrEqual(0);
      expect(marker.top).toBeLessThanOrEqual(1);
    }
    expect(map.regions.map((region) => region.name)).toEqual(['The Shallows', 'The Reach', 'The Narrows', 'The Fog']);
    // The four bands run from the north shore to the south shore, end to end.
    expect(map.regions.reduce((sum, region) => sum + region.height, 0)).toBeCloseTo((1400 + 1450) / 3300);
    // Only the Shallows has been seen at the start: the others are not named yet.
    expect(map.regions.map((region) => region.seen)).toEqual([true, false, false, false]);

    state.canoe.attachments.push('map_table');
    const full = buildMapPanel(state);
    expect(full.fullChart).toBe(true);
    expect(full.islands).toHaveLength(ISLANDS.length);
    expect(full.islands.find((island) => island.islandId === 'the_beacon')!.bearingText).toMatch(/^N, \d\.\d km$/);
  });

  it('turns a conversation into buttons that choose an option', () => {
    const state = newGame();
    expect(buildDialoguePanel(state)).toBeNull();
    standOn(state, 'orchard_hill');
    state.players[0].dialogue = { npcId: 'odile', nodeId: 'meet' };
    const panel = buildDialoguePanel(state)!;
    expect(panel.speaker).toBe('Odile');
    expect(panel.text).toContain('A canoe');
    expect(panel.options).toHaveLength(1);
    expect(panel.options[0].intent).toEqual({ type: 'command', command: { type: 'choose_dialogue_option', optionIndex: 0 } });
  });
});

describe('menus', () => {
  const summary = (overrides: Partial<SlotSummary>): SlotSummary => ({
    slot: 0, empty: true, corrupt: false, savedAt: 0, day: 0, playedSeconds: 0, mainQuestId: null, difficulty: '', ...overrides,
  });

  it('summarises a save slot: empty, filled or unreadable', () => {
    const empty = buildSaveSlot(summary({ slot: 2 }), 0, null);
    expect(empty).toMatchObject({ title: 'Slot 3', empty: true, summary: 'Empty' });
    expect(empty.buttons.map((button) => button.label)).toEqual(['New game here']);

    const filled = buildSaveSlot(summary({
      slot: 1, empty: false, savedAt: 1_000, day: 3, playedSeconds: 4320, mainQuestId: 'a_proper_edge', difficulty: 'standard',
    }), 1_000 + 4 * 60_000, 1);
    expect(filled).toMatchObject({
      title: 'Slot 2', summary: 'Day 3, 1 h 12 min played, Standard', questText: 'Quest 5: A proper edge',
      savedText: 'Saved 4 min ago', current: true,
    });
    expect(filled.buttons.map((button) => button.intent)).toEqual([
      { type: 'load_game', slot: 1 }, { type: 'new_game', slot: 1 }, { type: 'delete_save', slot: 1 },
    ]);

    const corrupt = buildSaveSlot(summary({ slot: 0, empty: false, corrupt: true }), 0, null);
    expect(corrupt.summary).toBe('This save cannot be read.');
    expect(corrupt.buttons.map((button) => button.label)).toEqual(['New game (overwrite)', 'Delete']);
  });

  it('enables Continue only when there is a save, and says which', () => {
    const none = buildLobbyModel([summary({ slot: 0 }), summary({ slot: 1 }), summary({ slot: 2 })], null);
    expect(none.buttons.map((button) => button.label)).toEqual(['Continue', 'New Game', 'Settings', 'How to Play', 'Credits']);
    expect(none.buttons[0]).toMatchObject({ enabled: false, note: 'No saved game yet' });
    const some = buildLobbyModel([summary({ slot: 0 }), summary({ slot: 1, empty: false, day: 2, mainQuestId: 'first_haul' })], 1);
    expect(some.buttons[0]).toMatchObject({ enabled: true, note: 'Slot 2: day 2, Quest 2: First haul', intent: { type: 'continue_game' } });
  });

  it('writes the how-to-play page with the keys as they are bound right now', () => {
    const rebound = createDefaultSettings();
    rebound.controls.keyBindings.bail = ['KeyQ'];
    rebound.controls.keyBindings.lantern = [];
    const controls = buildHowToPlayPanel(rebound).sections.flatMap((section) => section.controls);
    expect(controls.find((control) => control.label === 'Bail (hold)')!.keys).toBe('Q');
    expect(controls.find((control) => control.label === 'Paddle, back-paddle')!.keys).toBe('W / Up, S / Down');
    expect(controls.find((control) => control.label === 'Lantern, sail')!.keys).toBe('unbound, V');
  });
});

describe('settings', () => {
  const ALL_SETTINGS: SettingId[] = [
    'audio.master', 'audio.music', 'audio.effects', 'audio.ambience',
    'graphics.qualityPreset', 'graphics.renderScale', 'graphics.shadows', 'graphics.waterDetail',
    'graphics.fieldOfView', 'graphics.fpsCap', 'graphics.showFps',
    'controls.mouseSensitivity', 'controls.invertY', 'controls.cameraAutoCentre',
    'gameplay.difficulty', 'gameplay.autosaveIntervalSeconds', 'gameplay.hints',
    'accessibility.uiScale', 'accessibility.reduceCameraMotion', 'accessibility.patternedMeters', 'accessibility.arrivalCards',
  ];

  it('has a row for every setting across the five tabs, each under its own tab', () => {
    const rows = SETTINGS_TABS.flatMap((tab) => settingsRows(settings, tab).map((row) => ({ tab, row })));
    expect(rows.map((entry) => entry.row.setting).sort()).toEqual([...ALL_SETTINGS].sort());
    for (const { tab, row } of rows) expect(row.setting.startsWith(`${tab}.`), row.setting).toBe(true);
    // A choice row always offers the value it currently has.
    for (const { row } of rows) {
      if (row.kind === 'choice') expect(row.options.map((option) => option.value), row.setting).toContain(row.value);
      if (row.kind === 'slider') expect(row.value).toBeGreaterThanOrEqual(row.minimum);
    }
    expect(settingsRows(settings, 'graphics').find((row) => row.setting === 'graphics.fpsCap')!.valueText).toBe('60 fps');
    expect(settingsRows(settings, 'audio')[0].valueText).toBe('80%');
  });

  it('applies a changed row, clamps it, and ignores a value of the wrong type', () => {
    expect(applySettingChange(settings, 'audio.master', 0.25).audio.master).toBe(0.25);
    expect(applySettingChange(settings, 'audio.master', 7).audio.master).toBe(1);
    expect(applySettingChange(settings, 'graphics.fieldOfView', 20).graphics.fieldOfView).toBe(45);
    expect(applySettingChange(settings, 'controls.invertY', true).controls.invertY).toBe(true);
    expect(applySettingChange(settings, 'accessibility.patternedMeters', true).accessibility.patternedMeters).toBe(true);
    expect(applySettingChange(settings, 'gameplay.autosaveIntervalSeconds', 60).gameplay.autosaveIntervalSeconds).toBe(60);
    // Wrong type: left exactly as it was rather than reset to a default.
    const louder = applySettingChange(settings, 'audio.music', 0.9);
    expect(applySettingChange(louder, 'audio.music', 'loud')).toBe(louder);
    expect(applySettingChange(settings, 'graphics.qualityPreset', 'cinematic')).toBe(settings);
    // The original is never touched.
    expect(settings.audio.master).toBe(0.8);
  });

  it('lets a quality preset set the detailed options it stands for', () => {
    const low = applySettingChange(settings, 'graphics.qualityPreset', 'low');
    expect(low.graphics).toMatchObject({ qualityPreset: 'low', renderScale: 0.75, shadows: 'off', waterDetail: 'low' });
    expect(low.graphics.fieldOfView).toBe(settings.graphics.fieldOfView);
  });

  it('gives every action a row of two key slots, and flags the one waiting for a key', () => {
    const rows = bindingRows(settings, { action: 'bail', slot: 1 });
    expect(rows.map((row) => row.action)).toEqual(INPUT_ACTIONS);
    const paddle = rows.find((row) => row.action === 'paddle')!;
    expect(paddle).toMatchObject({ label: 'Paddle', contextLabel: 'Canoe', unbound: false });
    expect(paddle.slots.map((slot) => slot.keyLabel)).toEqual(['W', 'Up']);
    expect(paddle.slots[0].rebind).toEqual({ type: 'begin_rebind', action: 'paddle', slot: 0 });
    const bail = rows.find((row) => row.action === 'bail')!;
    expect(bail.slots.map((slot) => [slot.keyLabel, slot.capturing, slot.clear !== null])).toEqual([['R', false, true], [null, true, false]]);
    const cleared = createDefaultSettings();
    cleared.controls.keyBindings.map = [];
    expect(bindingRows(cleared, null).find((row) => row.action === 'map')!.unbound).toBe(true);
  });
});

describe('the whole interface model', () => {
  const input = (game: GameState | null, overrides: Partial<InterfaceModelInput> = {}): InterfaceModelInput => ({
    panels: createPanelState(game ? 'game' : 'lobby'), settings, game, paused: false, cameraYaw: 0, toasts: [],
    slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
    ...overrides,
  });

  it('shows the lobby without a HUD, and the HUD without a lobby', () => {
    const lobby = buildInterfaceModel(input(null));
    expect(lobby).toMatchObject({ screen: 'lobby', hud: null, panel: null, confirm: null });
    expect(lobby.lobby!.title).toBe('Portage');
    const playing = buildInterfaceModel(input(newGame()));
    expect(playing).toMatchObject({ screen: 'game', lobby: null, panel: null });
    expect(playing.hud!.meters).toHaveLength(3);
  });

  it('builds only the top panel, and keeps it under a confirm dialog', () => {
    let panels = createPanelState('lobby');
    panels = reducePanels(panels, { type: 'open', panel: 'save_slots' }, { canoeBeached: false }).state;
    const slots = buildInterfaceModel(input(null, { panels }));
    expect(slots.panel).toMatchObject({ id: 'save_slots', title: 'Save slots', close: { intent: { type: 'close_panel' } } });
    panels = reducePanels(panels, { type: 'ask_confirm', action: { type: 'delete_save', slot: 2 } }, { canoeBeached: false }).state;
    const asking = buildInterfaceModel(input(null, { panels }));
    expect(asking.panel!.id).toBe('save_slots');
    expect(asking.openPanels).toEqual(['save_slots', 'confirm']);
    expect(asking.confirm).toMatchObject({
      title: 'Delete this save?', message: 'Slot 3 will be gone for good.',
      accept: { label: 'Delete', intent: { type: 'answer_confirm', accepted: true } },
      cancel: { intent: { type: 'answer_confirm', accepted: false } },
    });
  });

  it('carries the accessibility settings and the pause flag through', () => {
    const big = { ...settings, accessibility: { ...settings.accessibility, uiScale: 1.25, patternedMeters: true } };
    expect(buildInterfaceModel(input(newGame(), { settings: big, paused: true }))).toMatchObject({
      uiScale: 1.25, patternedMeters: true, paused: true,
    });
  });
});

describe('the version in Settings', () => {
  it('stands on every tab, as it was handed in', () => {
    for (const tab of SETTINGS_TABS) {
      expect(buildSettingsPanel(settings, tab, null, '', versionLine('1.0.7 · abc1234')).version).toBe('Version 1.0.7 · abc1234');
    }
  });

  it("is the build's own when none is handed in", () => {
    // The build writes "1.0.<commits> · <commit>". A game made without git says so instead of showing nothing.
    expect(GAME_VERSION).toMatch(/^(1\.0\.\d+ · [0-9a-f]{7,12}|unknown)$/);
    expect(buildSettingsPanel(settings, 'audio', null, '').version).toBe(`Version ${GAME_VERSION}`);
  });
});

describe('the staged play picture', () => {
  it('always carries a hint, whatever the bot\'s road there left in the canoe', async () => {
    // The browser checks read the hint card from this picture. When the canoe was made faster the bot arrived
    // with less water aboard, the hint went, and a check waited for it for ever.
    const { stageShot } = await import('../../src/client/debug/staging.ts');
    const hud = buildHudModel(stageShot('play').state!, createDefaultSettings(), 0);
    expect(hud.hint).toBe('Hold R to bail.');
  });
});
