/**
 * The item icons: one drawing for every item and tool in the game, all in
 * one hand, none of them moving, and each shown wherever the model names its item.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { InterfaceModel } from '../../src/client/contracts.ts';
import { applyDebugParameters } from '../../src/client/debug/index.ts';
import { SHOT_NAMES, parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { ITEM_IDS, TOOL_IDS } from '../../src/data/index.ts';
import type { ItemId } from '../../src/data/index.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { itemIcon } from '../../src/interface/icons.ts';
import { hotbarView, panelView, toastsView } from '../../src/interface/views.ts';

// The project has no Node type definitions, so the file reader is loaded by name at run time.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const theme = readFileSync(new URL('../../src/interface/theme.css', import.meta.url), 'utf8');
const EVERY_ID: ItemId[] = [...new Set<ItemId>([...ITEM_IDS, ...TOOL_IDS])];

/** The pen strokes of an icon, without its washes: what makes it this drawing and no other. */
const penOf = (markup: string): string => /<g class="iw-pen">(.*)<\/g><\/svg>$/.exec(markup)?.[1] ?? '';

describe('the item icons', () => {
  it('there is a drawing for every item and every tool', () => {
    expect(EVERY_ID.length).toBeGreaterThanOrEqual(54);
    for (const id of EVERY_ID) {
      const markup = itemIcon(id);
      expect(markup, id).toMatch(/^<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true"><g class="iw-wash" fill="var\(--iw-[a-z-]+\)">.+<\/g><g class="iw-pen">.+<\/g><\/svg>$/);
      expect(penOf(markup).length, `${id} has pen strokes`).toBeGreaterThan(20);
    }
  });

  it('no two items share a drawing', () => {
    const byPen = new Map<string, ItemId[]>();
    for (const id of EVERY_ID) byPen.set(penOf(itemIcon(id)), [...(byPen.get(penOf(itemIcon(id))) ?? []), id]);
    expect([...byPen.values()].filter((ids) => ids.length > 1)).toEqual([]);
  });

  it('no icon moves: nothing animated, timed, scripted or filtered', () => {
    for (const id of EVERY_ID) {
      expect(itemIcon(id), id).not.toMatch(/<animate|<set\b|\bdur=|\bbegin=|keyframes|animation|transition|<script|<style|\bstyle=|filter|<foreignObject|\bon[a-z]+=/i);
    }
  });

  it('all are drawn in one hand: one grid, one pen weight, the theme\'s inks and washes only', () => {
    const colours = new Set([...theme.matchAll(/(--iw-[a-z-]+):\s*#[0-9a-f]{6}/g)].map((match) => match[1]));
    for (const id of EVERY_ID) {
      const markup = itemIcon(id);
      // The pen's colour and weight come from the theme (`.iw-ico .iw-pen`), never from the drawing.
      expect(markup, id).not.toMatch(/stroke-width|stroke=|stroke-opacity|opacity|#[0-9a-f]{3,8}\b|rgb/i);
      expect((markup.match(/viewBox/g) ?? []).length, id).toBe(1);
      for (const [, fill] of markup.matchAll(/fill="([^"]+)"/g)) {
        const name = /^var\((--iw-[a-z-]+)\)$/.exec(fill!)?.[1];
        expect(name && colours.has(name), `${id}: fill ${fill}`).toBe(true);
      }
      // Every stroke stays on the 24-unit grid.
      for (const [, number] of markup.replace(/transform="[^"]*"/g, '').matchAll(/(?:cx|cy)="([\d.]+)"/g)) {
        expect(Number(number), id).toBeLessThanOrEqual(24);
      }
    }
    expect(theme).toMatch(/\.iw-ico \.iw-pen,\s*\.iw-gauge \.iw-pen \{[^}]*stroke-width: 1\.5;/);
  });
});

// --- Shown wherever an item is named ---------------------------------------------------

const worldView = {
  mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {},
  handleEvents: () => {}, render: () => {}, dispose: () => {},
};

function modelOfShot(shot: string): InterfaceModel {
  const entries = new Map<string, string>();
  const app: App = createApp({
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
  applyDebugParameters(app, parseDebugParameters(`?shot=${shot}`));
  app.frame(1 / 60);
  return app.lastModel!;
}

/** Every `itemId` the model names, in the parts of it the interface shows. */
function itemIdsOf(model: InterfaceModel): ItemId[] {
  const shown = structuredClone(model) as unknown as Record<string, any>;
  // What is already bolted on does not show its bill of materials.
  if (shown.panel?.id === 'canoe_builder') for (const row of [shown.panel.hull, ...shown.panel.attachments]) if (row?.built) delete row.costs;
  const ids: ItemId[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        // An intent may carry an item id too: that is what a button does, not a row that names an item.
        // So do the two quick presses of an inventory tile (`shift`, `drop`).
        if (key === 'itemId') { if (entry !== null) ids.push(entry as ItemId); } else if (key !== 'intent' && key !== 'shift' && key !== 'drop') walk(entry);
      }
    }
  };
  walk({ hotbar: shown.hud?.hotbar, toasts: shown.toasts, panel: shown.panel });
  return ids.sort();
}

/** Every item icon the views draw, checked to be the drawing of the item it is tagged with. */
function iconsShown(nodes: ViewNode[], into: ItemId[] = []): ItemId[] {
  for (const node of nodes) {
    const itemId = node.attributes['data-item'] as ItemId | undefined;
    if (itemId !== undefined) {
      expect(node.html, `the drawing beside ${itemId}`).toBe(itemIcon(itemId));
      into.push(itemId);
    }
    iconsShown(node.children, into);
  }
  return into;
}

const viewsOf = (model: InterfaceModel): ViewNode[] => [
  ...(model.hud ? hotbarView(model.hud.hotbar) : []), ...toastsView(model.toasts), ...(model.panel ? panelView(model.panel) : []),
];

describe('an item\'s icon is shown wherever the model names the item', () => {
  it.each(SHOT_NAMES.map((shot) => ({ shot })))('shot $shot: one icon for each itemId, chosen by the id alone', ({ shot }) => {
    const model = modelOfShot(shot);
    expect(iconsShown(viewsOf(model)).sort()).toEqual(itemIdsOf(model));
  });

  it('the staged shots between them name items in every kind of row', () => {
    const count = (shot: string): number => itemIdsOf(modelOfShot(shot)).length;
    expect(count('play')).toBeGreaterThan(0); // the hotbar
    expect(count('inventory')).toBeGreaterThan(10); // stacks and the belt
    expect(count('crafting')).toBeGreaterThan(10); // outputs and inputs
    expect(count('builder')).toBeGreaterThan(10); // cost chips
  });

  it('loot notes, key items and waiting rewards show theirs too', () => {
    const model = structuredClone(modelOfShot('inventory'));
    if (model.panel?.id !== 'inventory') throw new Error('expected the inventory panel');
    model.toasts = [
      { id: 1, text: '+3 Driftwood', tone: 'info', itemId: 'driftwood', life: 1 },
      { id: 2, text: 'Saved', tone: 'good', itemId: null, life: 1 },
    ];
    const kept = model.panel.stow.intent;
    model.panel.keyItems = [
      { itemId: 'lens', name: 'Lens', count: 1, description: 'A lens.', drop: kept, buttons: [] },
      { itemId: 'bellows', name: 'Bellows', count: 1, description: 'Bellows.', drop: kept, buttons: [] },
    ];
    model.panel.pendingRewards = {
      text: 'Waiting for room: 2 x Plank, 1 x Rope',
      items: [{ itemId: 'plank', name: 'Plank', count: 2 }, { itemId: 'rope', name: 'Rope', count: 1 }],
      claim: model.panel.stow,
    };
    const shown = iconsShown(viewsOf(model)).sort();
    expect(shown).toEqual(itemIdsOf(model));
    for (const id of ['driftwood', 'lens', 'bellows', 'plank', 'rope'] as const) expect(shown).toContain(id);
  });
});
