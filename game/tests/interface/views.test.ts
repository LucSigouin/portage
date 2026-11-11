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
import { itemIcon } from '../../src/interface/icons.ts';
import {
  confirmView, debugView, hintView, hotbarView, lobbyView, notesView, panelView, promptView, toastsView, vitalsView,
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
  playing.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' }); // refused afloat: leaves a toast
  models.push({ name: 'new game with a toast', model: modelOf(playing) });
  return models;
}

/** The whole interface as views, the way `InkInterface.update` draws it. */
function viewsOf(model: InterfaceModel): ViewNode[] {
  const { lobby, hud, panel, confirm, debug } = model;
  return [
    ...(lobby ? lobbyView(lobby) : []),
    ...(hud ? [...vitalsView(hud, model.patternedMeters), ...notesView(hud), ...hotbarView(hud.hotbar)] : []),
    ...(hud?.hint ? hintView(hud.hint) : []),
    ...(hud?.prompt ? promptView(hud.prompt) : []),
    ...toastsView(model.toasts),
    ...(panel ? panelView(panel) : []),
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
    // On foot with a dry canoe there is no water gauge to label.
    if (!pruned.hud.water.visible) delete pruned.hud.water;
    // The trend draws as an arrow as well as its word; the mode word shows only while holding.
    if (pruned.hud.prompt && pruned.hud.prompt.mode !== 'hold') delete pruned.hud.prompt.mode;
  }
  const panel = pruned.panel;
  if (panel?.id === 'quest_log') {
    // A finished quest keeps its name and story; its ticked-off steps are not listed again.
    for (const group of panel.groups) for (const quest of group.quests) if (quest.done) delete quest.objectives;
  }
  if (panel?.id === 'canoe_builder') {
    // What is already bolted on does not show its bill of materials.
    for (const row of [panel.hull, ...panel.attachments]) if (row?.built) delete row.costs;
  }
  const words: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (value.trim() !== '' && !IDENTIFIER_KEYS.has(key)) words.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) walk(entry, key);
    } else if (value !== null && typeof value === 'object') {
      for (const [childKey, entry] of Object.entries(value)) {
        if (!INTENT_KEYS.has(childKey) && childKey !== 'debug') walk(entry, childKey);
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
    for (const slot of inventory.panel.backpack.slots) if (slot.itemId) expect(text).toContain(`× ${slot.count}`);
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
