/**
 * The Ink & Wash views against real interface models, without a DOM.
 *
 * The views are pure: a model in, a description of markup out. So every
 * staged shot and every menu can be checked here for the two things that make
 * an interface true to its model: each control sends exactly the intent the
 * model gave it, and each word the model holds is on the page.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { InterfaceIntent, InterfaceModel, SettingsTabId, WorldView } from '../../src/client/contracts.ts';
import { applyDebugParameters } from '../../src/client/debug/index.ts';
import { SHOT_NAMES, parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { collectIntents, collectText, h } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { inventoryBodyView, tileMenuView } from '../../src/interface/inventoryview.ts';
import { itemIcon } from '../../src/interface/icons.ts';
import {
  confirmView, debugView, hintView, hotbarView, itemDetailKey, itemDetailKeys, lineNoteView, lobbyView, notesView, panelView, promptView,
  toastsView, vitalsView,
} from '../../src/interface/views.ts';

const worldView: WorldView = {
  mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {},
  handleEvents: () => {}, render: () => {}, dispose: () => {},
};

function newApp(): App {
  const entries = new Map<string, string>();
  return createApp({
    worldView,
    gameInterface: { mount: () => {}, update: () => {}, dispose: () => {} },
    audio: createSilentAudio(),
    storage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => void entries.set(key, value),
      removeItem: (key) => void entries.delete(key),
    },
    now: () => 5_000,
    randomSeed: () => 42,
  });
}

function modelOf(app: App): InterfaceModel {
  app.frame(1 / 60);
  return app.lastModel!;
}

/** One model per staged shot, plus the menus and dialogs the shots do not reach. */
function everyModel(): { name: string; model: InterfaceModel }[] {
  const models = SHOT_NAMES.map((shot) => {
    const app = newApp();
    applyDebugParameters(app, parseDebugParameters(`?shot=${shot}`));
    return { name: `shot ${shot}`, model: modelOf(app) };
  });
  for (const panel of ['how_to_play', 'credits', 'save_slots'] as const) {
    const app = newApp();
    app.session.handleIntent({ type: 'open_panel', panel });
    models.push({ name: `lobby ${panel}`, model: modelOf(app) });
  }
  for (const tab of ['audio', 'graphics', 'controls', 'gameplay', 'accessibility'] satisfies SettingsTabId[]) {
    const app = newApp();
    app.session.handleIntent({ type: 'open_panel', panel: 'settings' });
    app.session.handleIntent({ type: 'select_settings_tab', tab });
    models.push({ name: `settings ${tab}`, model: modelOf(app) });
  }
  const rebinding = newApp();
  rebinding.session.handleIntent({ type: 'open_panel', panel: 'settings' });
  rebinding.session.handleIntent({ type: 'select_settings_tab', tab: 'controls' });
  rebinding.session.handleIntent({ type: 'begin_rebind', action: 'paddle', slot: 0 });
  models.push({ name: 'settings capturing a key', model: modelOf(rebinding) });
  const confirming = newApp();
  confirming.session.handleIntent({ type: 'open_panel', panel: 'settings' });
  confirming.session.handleIntent({ type: 'reset_key_bindings' });
  models.push({ name: 'confirm dialog', model: modelOf(confirming) });
  const playing = newApp();
  playing.session.newGame(0);
  playing.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } }); // refused afloat: leaves a toast
  models.push({ name: 'new game with a toast', model: modelOf(playing) });
  return models;
}

/**
 * A panel as views. The inventory shows one tile's menu and one tile's details at a time, so it is drawn as the
 * player can have it tile by tile: the sheet with its first tile's menu open and the info panel about it, then
 * every other tile's menu and info panel. Between them they hold every control and every word of the model, once.
 */
function panelViews(panel: NonNullable<InterfaceModel['panel']>): ViewNode[] {
  if (panel.id !== 'inventory') return panelView(panel);
  const [first, ...rest] = itemDetailKeys(panel);
  if (first === undefined) return panelView(panel);
  const infoOf = (node: ViewNode): ViewNode[] => (node.classes.split(' ').includes('iw-inv-info') ? [node] : node.children.flatMap(infoOf));
  return [
    ...panelView(panel, { menu: first, info: first }),
    ...rest.flatMap((key) => [tileMenuView(panel, key)!, ...infoOf(inventoryBodyView(panel, { menu: null, info: key }))]),
  ];
}

/** The whole interface as views, the way `InkInterface.update` draws it, with every menu and every info panel of the inventory. */
function viewsOf(model: InterfaceModel): ViewNode[] {
  const { lobby, hud, panel, confirm, debug } = model;
  return [
    ...(lobby ? lobbyView(lobby) : []),
    ...(hud ? [...vitalsView(hud, model.patternedMeters), ...notesView(hud), ...hotbarView(hud.hotbar)] : []),
    // One standing slip: the line's trouble when there is any, the tip otherwise (`InkInterface.update`).
    ...(hud?.lineNote ? lineNoteView(hud.lineNote) : hud?.hint ? hintView(hud.hint) : []),
    ...(hud?.prompt ? promptView(hud.prompt) : []),
    ...toastsView(model.toasts),
    ...(panel ? panelViews(panel) : []),
    ...(confirm ? confirmView(confirm) : []),
    ...(debug ? debugView(debug) : []),
  ];
}

const INTENT_KEYS = new Set(['intent', 'rebind', 'clear']);

/** Every intent the model attaches to a control, wherever it sits. */
function intentsOf(value: unknown, into: InterfaceIntent[] = []): InterfaceIntent[] {
  if (Array.isArray(value)) {
    for (const entry of value) intentsOf(entry, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (INTENT_KEYS.has(key)) {
        if (entry !== null) into.push(entry as InterfaceIntent);
      } else intentsOf(entry, into);
    }
  }
  return into;
}

/** Keys whose strings are identifiers, not words for the player. */
const IDENTIFIER_KEYS = new Set([
  'id', 'kind', 'tone', 'type', 'setting', 'action', 'tab', 'panel', 'pattern', 'screen', 'questId', 'toolId', 'itemId',
  'recipeId', 'islandId', 'openPanels', 'value', 'cardinal',
]);

/** Every word the model holds for the player, with the parts the interface leaves out on purpose removed first. */
function wordsOf(model: InterfaceModel): string[] {
  const pruned = structuredClone(model) as unknown as Record<string, any>;
  if (pruned.hud) {
    // The compass is drawn straight to the page (`CompassStrip`), not by a view: the browser spec covers it.
    delete pruned.hud.compass;
    // So is the minimap (`MinimapCard`, a canvas): its marks are drawn, not written.
    delete pruned.hud.minimap;
    // The second and third quests on the card list only the steps still to do.
    for (const tracker of pruned.hud.trackers.slice(1)) tracker.objectives = tracker.objectives.filter((objective: { done: boolean }) => !objective.done);
    // On foot with a dry canoe there is no water gauge to label.
    if (!pruned.hud.water.visible) delete pruned.hud.water;
    // The trend draws as an arrow as well as its word; the mode word shows only while holding.
    if (pruned.hud.prompt && pruned.hud.prompt.mode !== 'hold') delete pruned.hud.prompt.mode;
  }
  const panel = pruned.panel;
  if (panel?.id === 'map') {
    // A water nobody in the crew has been on is not named: it is still in the fog.
    panel.regions = panel.regions.filter((region: { seen: boolean }) => region.seen);
  }
  if (panel?.id === 'quest_log') {
    // A finished quest keeps its name and story; its ticked-off steps are not listed again.
    for (const group of panel.groups) for (const quest of group.quests) if (quest.done) delete quest.objectives;
  }
  if (panel?.id === 'canoe_builder') {
    // What is already bolted on does not show its bill of materials.
    for (const row of [panel.hull, ...panel.attachments]) if (row?.built) delete row.costs;
    // What is missing is said by the chips, not by a line of words (Luc's bugfix list, line 15).
    // The Build button's note is those words too, and it is not drawn.
    for (const row of [panel.hull, ...panel.attachments]) {
      if (!row) continue;
      if (row.build?.note === row.missingText) delete row.build.note;
      delete row.missingText;
    }
  }
  if (panel?.id === 'crafting') {
    for (const station of panel.stations) {
      for (const recipe of station.recipes) {
        if (recipe.craft.note === recipe.missingText) delete recipe.craft.note;
        delete recipe.missingText;
      }
    }
  }
  const words: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (value.trim() !== '' && !IDENTIFIER_KEYS.has(key)) words.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) walk(entry, key);
    } else if (value !== null && typeof value === 'object') {
      for (const [childKey, entry] of Object.entries(value)) {
        // An inventory tile's two quick presses (`shift`, `drop`) are what a key sends, not words: the round-3 sheet
        // only seemed to show them because a button read "To backpack".
        if (!INTENT_KEYS.has(childKey) && childKey !== 'debug' && childKey !== 'shift' && childKey !== 'drop') walk(entry, childKey);
      }
    }
  };
  walk(pruned, '');
  return words;
}

/** Text plus the attributes a reader or a pointer can reach (labels, titles), and markup drawn as fixed SVG. */
function everythingShown(nodes: ViewNode[], into: string[] = []): string {
  for (const node of nodes) {
    if (node.tag === '#text') into.push(node.text);
    for (const name of ['aria-label', 'title', 'aria-valuetext']) {
      const value = node.attributes[name];
      if (typeof value === 'string') into.push(value);
    }
    if (node.html) into.push(node.html.replace(/&amp;/g, '&'));
    everythingShown(node.children, into);
  }
  return into.join(' ␟ ');
}

const sorted = (intents: InterfaceIntent[]): string[] => intents.map((intent) => JSON.stringify(intent)).sort();

describe('the Ink & Wash views', () => {
  const models = everyModel();

  it('cover every staged shot, menu and dialog', () => {
    expect(models.length).toBe(SHOT_NAMES.length + 3 + 5 + 3);
    const panels = new Set(models.map(({ model }) => model.panel?.id).filter(Boolean));
    expect([...panels].sort()).toEqual([
      'canoe_builder', 'crafting', 'credits', 'dialogue', 'how_to_play', 'inventory', 'map', 'pause', 'quest_log',
      'save_slots', 'settings',
    ]);
    expect(models.some(({ model }) => model.confirm !== null)).toBe(true);
    expect(models.some(({ model }) => model.toasts.length > 0)).toBe(true);
    expect(models.some(({ model }) => model.lobby !== null)).toBe(true);
  });

  it.each(models)('$name: every control sends the intent the model gave it, and nothing else', ({ model }) => {
    const fromModel = sorted(intentsOf(model));
    const fromViews = sorted(collectIntents(viewsOf(model)));
    expect(fromModel.length).toBeGreaterThan(0);
    expect(fromViews).toEqual(fromModel);
  });

  it.each(models)('$name: every word in the model is on the page', ({ model }) => {
    const shown = everythingShown(viewsOf(model));
    const missing = wordsOf(model).filter((word) => !shown.includes(word));
    expect(missing).toEqual([]);
  });

  it('shows the numbers too: meter values, stack counts, costs', () => {
    const inventory = models.find(({ name }) => name === 'shot inventory')!.model;
    const text = collectText(viewsOf(inventory));
    for (const meter of inventory.hud!.meters) expect(text).toContain(String(meter.value));
    if (inventory.panel?.id !== 'inventory') throw new Error('expected the inventory panel');
    for (const slot of inventory.panel.backpack.slots) if (slot.itemId) expect(text).toContain(`x${slot.count}`);
    const crafting = models.find(({ name }) => name === 'shot crafting')!.model;
    if (crafting.panel?.id !== 'crafting') throw new Error('expected the crafting panel');
    const craftingText = collectText(panelView(crafting.panel));
    for (const station of crafting.panel.stations) {
      for (const recipe of station.recipes) for (const cost of recipe.inputs) expect(craftingText).toContain(`${cost.have}/${cost.need}`);
    }
  });

  it('marks a disabled button as disabled and says why', () => {
    const lobby = models.find(({ name }) => name === 'shot lobby')!.model.lobby!;
    const disabled = lobby.buttons.find((button) => !button.enabled)!;
    const [column] = lobbyView(lobby);
    const find = (nodes: ViewNode[]): ViewNode | null => {
      for (const node of nodes) {
        if (node.tag === 'button' && collectText([node]).includes(disabled.label)) return node;
        const inner = find(node.children);
        if (inner) return inner;
      }
      return null;
    };
    const button = find([column!])!;
    expect(button.attributes.disabled).toBe(true);
    expect(collectText([button])).toContain(disabled.note!);
  });

  it('draws a prompt with its key cap, and a prompt that names no key with none', () => {
    const find = (nodes: ViewNode[], className: string): ViewNode[] =>
      nodes.flatMap((node) => [...(node.classes.split(' ').includes(className) ? [node] : []), ...find(node.children, className)]);
    const pressed = promptView({ text: 'Sleep until morning', keyLabel: 'F', mode: 'press' });
    expect(find(pressed, 'iw-key').map((node) => collectText([node]))).toEqual(['F']);
    expect(pressed[0]!.classes).not.toContain('iw-prompt-keyless');
    const told = promptView({ text: 'Sleep (after 19:00)', keyLabel: '', mode: 'blocked' });
    expect(find(told, 'iw-key')).toEqual([]);
    expect(told[0]!.classes).toContain('iw-prompt-keyless');
    expect(collectText(told)).toBe('Sleep (after 19:00)');
  });

  it('draws the line\'s trouble as a standing slip in the warning ink, where the tip stands', () => {
    const [slip] = lineNoteView('No word from the host. Waiting…');
    expect(collectText([slip!])).toBe('No word from the host. Waiting…');
    expect(slip!.classes.split(' ')).toEqual(expect.arrayContaining(['iw-hint', 'iw-line-note']));
    expect(slip!.attributes.role).toBe('status');
    // The tip is not in the warning ink.
    expect(hintView('Hold R to bail.')[0]!.classes).not.toContain('iw-line-note');
  });

  it('writes where a missing ingredient comes from under what is missing, and nothing when there is nothing to say', () => {
    const crafting = structuredClone(models.find(({ name }) => name === 'shot crafting')!.model);
    if (crafting.panel?.id !== 'crafting') throw new Error('expected the crafting panel');
    const recipes = crafting.panel.stations.flatMap((station) => station.recipes);
    for (const recipe of recipes) recipe.sourceText = '';
    expect(collectText(panelView(crafting.panel))).not.toContain('Scoop it');
    recipes.find((recipe) => recipe.recipeId === 'clean_water')!.sourceText = 'Scoop it at the water, from the inventory (Tab).';
    expect(collectText(panelView(crafting.panel))).toContain('Scoop it at the water, from the inventory (Tab).');
  });

  it('draws the inventory as tiles, a drawing and a count each: what an item is shows in the info panel, what it does in the menu at its tile', () => {
    const model = models.find(({ name }) => name === 'shot inventory')!.model;
    if (model.panel?.id !== 'inventory') throw new Error('expected the inventory panel');
    const panel = model.panel;
    const filled = [...panel.backpack.slots, ...panel.cargo.slots].filter((slot) => slot.itemId !== null);
    const tools = panel.belt.filter((slot) => slot.itemId !== null);
    expect(filled.length).toBeGreaterThan(2);
    const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
      nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
    const tilesOf = (nodes: ViewNode[]): ViewNode[] => find(nodes, (node) => node.classes.split(' ').includes('iw-tile') && !node.classes.includes('iw-blank'));

    // Nothing pointed at: each tile is one button with the drawing and the count. No name, no description, no action.
    const closed = panelView(panel);
    const closedText = collectText(closed);
    for (const slot of filled) {
      expect(closedText).toContain(`x${slot.count}`);
      expect(closedText, `${slot.name}: its name is not on the tile`).not.toContain(slot.name);
      expect(closedText, `${slot.name}: its description is shut away`).not.toContain(slot.description);
    }
    const tiles = tilesOf(closed);
    expect(tiles.length).toBe(filled.length + tools.length + panel.keyItems.length);
    for (const tile of tiles) {
      const picks = find([tile], (node) => node.tag === 'button');
      expect(picks.length).toBe(1);
      expect(picks[0]!.attributes['aria-expanded']).toBe('false');
      expect(picks[0]!.intent, 'opening a tile tells the game nothing').toBeNull();
      expect(String(picks[0]!.attributes['aria-label']).length, 'a tile says what it is to a screen reader').toBeGreaterThan(2);
      expect(find([tile], (node) => node.attributes['data-item'] !== undefined).length).toBe(1);
    }
    const itemIntents = filled.flatMap((slot) => slot.buttons.map((button) => JSON.stringify(button.intent)));
    const closedIntents = collectIntents(closed).map((intent) => JSON.stringify(intent));
    for (const intent of itemIntents) expect(closedIntents).not.toContain(intent);

    // One tile pointed at: its name and its description in the info panel, and nobody else's. Still no action.
    const first = filled[0]!;
    const second = filled.find((slot) => slot.description !== first.description)!;
    const key = itemDetailKey('backpack', first.itemId!, 0);
    const pointed = panelView(panel, { menu: null, info: key });
    const pointedText = collectText(pointed);
    expect(pointedText).toContain(first.name);
    expect(pointedText).toContain(first.description);
    expect(pointedText).not.toContain(second.description);
    expect(collectIntents(pointed).map((intent) => JSON.stringify(intent))).toEqual(closedIntents);
    expect(tilesOf(pointed).length, 'the grid holds the same tiles').toBe(tiles.length);

    // That tile pressed: its actions in the menu, outside the grid, and the grid as it was.
    const opened = panelView(panel, { menu: key, info: key });
    const openTiles = tilesOf(opened).filter((tile) => tile.classes.includes('iw-open'));
    expect(openTiles.length).toBe(1);
    expect(find(openTiles, (node) => node.tag === 'button' && node.attributes['data-detail'] !== undefined)[0]!.attributes['aria-expanded']).toBe('true');
    expect(find(opened, (node) => node.classes.split(' ').includes('iw-item-detail')), 'no strip opens inside the grid').toEqual([]);
    const menus = find(opened, (node) => node.classes.split(' ').includes('iw-tile-menu'));
    expect(menus.length).toBe(1);
    const lists = find(opened, (node) => node.tag === 'ul' && node.classes.split(' ').includes('iw-tiles'));
    for (const list of lists) expect(find([list], (node) => node === menus[0]), 'the menu is not inside a grid').toEqual([]);
    expect(lists.map((list) => list.children.length)).toEqual(find(closed, (node) => node.tag === 'ul' && node.classes.split(' ').includes('iw-tiles')).map((list) => list.children.length));
    expect(collectIntents(menus).map((intent) => JSON.stringify(intent)).sort())
      .toEqual(first.buttons.map((button) => JSON.stringify(button.intent)).sort());
  });

  it('both crafting menus say what is missing by their chips: no line of words, a tick or a cross on every chip', () => {
    const find = (nodes: ViewNode[], className: string): ViewNode[] =>
      nodes.flatMap((node) => [...(node.classes.split(' ').includes(className) ? [node] : []), ...find(node.children, className)]);
    for (const name of ['shot crafting', 'shot builder']) {
      const panel = models.find((entry) => entry.name === name)!.model.panel!;
      if (panel.id !== 'crafting' && panel.id !== 'canoe_builder') throw new Error(`${name}: expected a crafting menu`);
      const views = panelView(panel);
      const text = collectText(views);
      expect(text, `${name}: a line of what is missing`).not.toMatch(/Needs \d+ more|\bNeeds\b/);
      expect(find(views, 'iw-missing')).toEqual([]);
      const rows = panel.id === 'crafting'
        ? panel.stations.flatMap((station) => station.recipes).map((recipe) => ({ costs: recipe.inputs, needs: recipe.needs }))
        : [panel.hull, ...panel.attachments].filter((row) => row !== null && !row.built).map((row) => ({ costs: row!.costs, needs: row!.needs }));
      const costs = rows.flatMap((row) => row.costs);
      const short = find(views, 'iw-short');
      const enough = find(views, 'iw-enough');
      expect(enough.length, `${name}: chips with enough`).toBe(costs.filter((cost) => cost.enough).length);
      expect(short.length, `${name}: short chips`).toBe(costs.filter((cost) => !cost.enough).length + rows.flatMap((row) => row.needs).length);
      expect(short.length).toBeGreaterThan(0);
      // Not by colour alone: every short chip is crossed, every chip with enough is ticked.
      for (const chip of short) expect(find([chip], 'iw-mark-have')[0]!.html).toContain('iw-cross');
      for (const chip of enough) expect(find([chip], 'iw-mark-have')[0]!.html).toContain('iw-tick');
    }
    // The builder at quest 7 asks for the ribbed canoe on the parts that need it, as a chip with the canoe's name.
    const builder = models.find((entry) => entry.name === 'shot builder')!.model.panel!;
    if (builder.id !== 'canoe_builder') throw new Error('expected the builder');
    expect(builder.attachments.some((row) => row.needs.length > 0) || builder.hull?.needs.length).toBeTruthy();
  });

  it('draws the same model the same way: no clock, no randomness', () => {
    for (const { model } of models) {
      expect(JSON.stringify(viewsOf(model))).toBe(JSON.stringify(viewsOf(structuredClone(model))));
    }
  });

  it('has an icon for every tool on the belt', () => {
    for (const toolId of ['bailing_can', 'stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer', 'fishing_rod', 'wrench'] as const) {
      expect(itemIcon(toolId)).toContain('<svg');
    }
  });
});

describe('the view description helper', () => {
  it('splits a selector, merges classes and drops empty children', () => {
    const node = h('button.a.b', { class: 'c', key: 7, disabled: false, title: 'T' }, 'one', null, false, [h('i'), 2]);
    expect(node).toMatchObject({ tag: 'button', classes: 'a b c', key: '7', attributes: { disabled: false, title: 'T' } });
    expect(node.children.map((child) => child.tag)).toEqual(['#text', 'i', '#text']);
    expect(collectText([node])).toBe('one 2');
  });
});

describe('the version in Settings', () => {
  it('stands beside the title on every tab', () => {
    for (const tab of ['audio', 'graphics', 'controls', 'gameplay', 'accessibility'] satisfies SettingsTabId[]) {
      const app = newApp();
      app.session.handleIntent({ type: 'open_panel', panel: 'settings' });
      app.session.handleIntent({ type: 'select_settings_tab', tab });
      const panel = modelOf(app).panel;
      if (panel?.id !== 'settings') throw new Error('expected the settings panel');
      expect(panel.version).toMatch(/^Version \S/);
      const header = panelView(panel)[0].children.find((child) => child.tag === 'header')!;
      expect(collectText([header])).toBe(`${panel.title} ${panel.version}`);
    }
  });
});
