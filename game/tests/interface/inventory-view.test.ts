/**
 * The inventory drawn as a grid of tiles (Luc's bugfix list, round 3): the two drawn buttons and the tool belt on
 * top, the bag on the left and the boat on the right, a tile a stack, an empty tile an empty slot.
 */
import { describe, expect, it } from 'vitest';
import type { PanelModel } from '../../src/client/contracts.ts';
import { buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { BUCKET_ICON, STOW_ICON } from '../../src/interface/inventoryicons.ts';
import { DROP_KEY_CODE, QUICK_PRESS_HINT, inventoryBodyView, itemDetailKey, itemDetailKeys, quickIntent } from '../../src/interface/inventoryview.ts';
import { panelView } from '../../src/interface/views.ts';
import { ITEM_IDS, isStackable } from '../../src/data/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { give, newGame, standOn } from '../support.ts';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };
const styles = readFileSync(new URL('../../src/interface/inventoryview.css', import.meta.url), 'utf8');

type Inventory = Extract<PanelModel, { id: 'inventory' }>;

const NONE: ReadonlySet<string> = new Set();

const panelOf = (state: GameState): Inventory => ({
  title: 'Inventory', close: { label: 'Close', intent: { type: 'close_panel' }, enabled: true, note: null }, ...buildInventoryPanel(state),
});

const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
  nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
const has = (node: ViewNode, className: string): boolean => node.classes.split(' ').includes(className);
const withClass = (nodes: ViewNode[], className: string): ViewNode[] => find(nodes, (node) => has(node, className));

/** A boat with the long hull's shelves and three chests' worth of room: 40 slots, every one a different-sized stack. */
function fullBoat(stacks = 40): GameState {
  const state = newGame();
  standOn(state, 'home_knoll');
  const stackable = ITEM_IDS.filter(isStackable);
  for (let index = 0; index < stacks; index += 1) state.canoe.cargo.push({ itemId: stackable[index % stackable.length]!, count: (index % 20) + 1 });
  return state;
}

describe('the inventory as a grid', () => {
  it('lays the top row and the two grids out in order: buttons, belt, bag, boat', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    const body = inventoryBodyView(panelOf(state), NONE);
    const [columns] = withClass([body], 'iw-columns');
    // Two columns by two rows, filled in this order: top left, top right, bottom left, bottom right.
    expect(columns!.children.map((child) => child.classes)).toEqual(['iw-pack-actions', 'iw-inv-belt', 'iw-inv-pack', 'iw-inv-boat']);
    expect(collectText(withClass([body], 'iw-inv-belt'))).toContain('Tool belt');
    expect(collectText(withClass([body], 'iw-inv-pack'))).toContain('Backpack 1 / 8');
    expect(collectText(withClass([body], 'iw-inv-boat'))).toContain('Canoe cargo 0 / 8');
  });

  it('draws a stack as a tile with its drawing and x12, and nothing else: no name, no description', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    give(state, 'berries', 3, 'cargo');
    const panel = panelOf(state);
    const body = inventoryBodyView(panel, NONE);
    const [pack] = withClass([body], 'iw-inv-pack');
    const tiles = withClass([pack!], 'iw-tile');
    // Eight slots, eight tiles: one filled, seven empty, so the room left is seen.
    expect(tiles).toHaveLength(8);
    expect(tiles.filter((tile) => has(tile, 'iw-blank'))).toHaveLength(7);
    const [filled] = tiles.filter((tile) => !has(tile, 'iw-blank'));
    expect(collectText([filled!])).toBe('x12');
    expect(find([filled!], (node) => node.attributes['data-item'] === 'driftwood')).toHaveLength(1);
    const [pick] = find([filled!], (node) => node.tag === 'button');
    expect(pick!.attributes).toMatchObject({ 'aria-label': 'Driftwood, 12', 'aria-expanded': 'false', 'data-detail': 'backpack:driftwood:0' });
    // The words of the whole panel, closed: counts and headings, not one item's name or description.
    const text = collectText([body]);
    for (const slot of [...panel.backpack.slots, ...panel.cargo.slots, ...panel.belt]) {
      if (slot.itemId === null) continue;
      expect(text).not.toContain(slot.name);
      expect(text).not.toContain(slot.description);
    }
    expect(text).toContain('x3');
    // An empty tile is not a control, and says what it is to a screen reader.
    for (const blank of tiles.filter((tile) => has(tile, 'iw-blank'))) {
      expect(find([blank], (node) => node.tag === 'button')).toEqual([]);
      expect(blank.attributes['aria-label']).toBe('Empty slot');
    }
  });

  it('holds a boat of 40 stacks as 40 tiles in one grid, and more than that too', () => {
    for (const stacks of [40, 46]) {
      const state = fullBoat(stacks);
      // Room for them all: the long hull, the shelves and chests to come.
      const panel = panelOf(state);
      panel.cargo.slots = panel.cargo.slots.filter((slot) => slot.itemId !== null);
      expect(panel.cargo.slots).toHaveLength(stacks);
      const [boat] = withClass([inventoryBodyView(panel, NONE)], 'iw-inv-boat');
      const lists = find([boat!], (node) => node.tag === 'ul');
      expect(lists).toHaveLength(1);
      expect(lists[0]!.children).toHaveLength(stacks);
      expect(lists[0]!.children.every((tile) => has(tile, 'iw-tile'))).toBe(true);
      // Every tile is its own control with its own key, two stacks of one item too.
      const keys = find([boat!], (node) => node.tag === 'button').map((button) => button.attributes['data-detail']);
      expect(new Set(keys).size).toBe(stacks);
    }
  });

  it('opens a tile\'s strip right after the tile, for as many tiles as are pressed', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    give(state, 'berries', 3);
    give(state, 'lens');
    const panel = panelOf(state);
    const open = new Set([itemDetailKey('backpack', 'berries'), itemDetailKey('belt', 'bailing_can'), itemDetailKey('key', 'lens')]);
    const body = inventoryBodyView(panel, open);
    const strips = withClass([body], 'iw-item-detail');
    expect(strips).toHaveLength(3);
    const berries = collectText(withClass(withClass([body], 'iw-inv-pack'), 'iw-item-detail').slice(0, 1));
    expect(berries).toContain('Berries');
    expect(berries).toContain('x3');
    expect(berries).toContain(panel.backpack.slots[1]!.description);
    expect(berries).toContain('Eat');
    expect(berries).toContain('To cargo');
    expect(berries).toContain('Drop');
    // The berries' strip is the next thing after the berries' tile, before the tiles that follow.
    const list = find([body], (node) => node.tag === 'ul' && collectText([node]).includes('Berries'))[0]!;
    expect(list.children.map((child) => (has(child, 'iw-item-detail') ? 'strip' : has(child, 'iw-blank') ? '-' : 'tile')).slice(0, 4))
      .toEqual(['tile', 'tile', 'strip', '-']);
    // A key item's strip names it and has no button: there is nothing to do with it.
    const [lens] = withClass(withClass([body], 'iw-key-tiles'), 'iw-item-detail');
    expect(collectText([lens!])).toContain('Lens');
    expect(collectIntents([lens!])).toEqual([]);
    // Every key the interface may hold open is a tile on the sheet.
    expect(itemDetailKeys(panel).sort()).toEqual(['backpack:berries:0', 'backpack:driftwood:0', 'belt:bailing_can:0', 'key:lens:0']);
  });
});

describe('the top row', () => {
  it('has Stow all and Scoop water as drawn buttons, each with a label to hover and a label for a screen reader', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    const panel = panelOf(state);
    const [actions] = withClass([inventoryBodyView(panel, NONE)], 'iw-pack-actions');
    const buttons = find([actions!], (node) => node.tag === 'button');
    expect(buttons.map((button) => button.attributes['data-action'])).toEqual(['stow', 'scoop']);
    const [stow, scoop] = buttons;
    expect(stow!.attributes).toMatchObject({ 'aria-label': 'Stow all in the canoe', 'data-tip': 'Stow all in the canoe', 'data-note': '', disabled: false });
    expect(stow!.intent).toEqual({ type: 'command', command: { type: 'stow_backpack' } });
    expect(scoop!.attributes).toMatchObject({
      'aria-label': 'Scoop water. Dirty water. Boil it at a fire before drinking.', 'data-tip': 'Scoop water',
      'data-note': 'Dirty water. Boil it at a fire before drinking.',
    });
    expect(scoop!.intent).toEqual({ type: 'command', command: { type: 'fill_water', count: 1 } });
    // A drawing each and no word on the button: the label hangs under it from the stylesheet.
    expect(collectText(buttons)).toBe('');
    expect(find([stow!], (node) => node.html === STOW_ICON)).toHaveLength(1);
    expect(find([scoop!], (node) => node.html === BUCKET_ICON)).toHaveLength(1);
    expect(styles).toMatch(/\.iw-icon-btn::after\s*\{[^}]*content: attr\(data-tip\) '\\A' attr\(data-note\)/);
    expect(styles).toMatch(/\.iw-icon-btn:hover::after,\s*\.iw-icon-btn:focus-visible::after,\s*\.iw\.iw-by-keys \.iw-icon-btn:focus::after\s*\{\s*display: block;/);
  });

  it('switches a button off with its reason when the model does', () => {
    const state = newGame();
    standOn(state, 'home_knoll'); // an empty backpack: nothing to stow
    const panel = panelOf(state);
    panel.stow = { ...panel.stow, enabled: false, note: 'The canoe is out of reach' };
    const [stow] = find(withClass([inventoryBodyView(panel, NONE)], 'iw-pack-actions'), (node) => node.tag === 'button');
    expect(stow!.attributes).toMatchObject({ disabled: true, 'data-note': 'The canoe is out of reach', 'aria-label': 'Stow all in the canoe. The canoe is out of reach' });
  });

  it('draws both buttons in the game\'s hand: one pen, a wash behind it, nothing that moves', () => {
    for (const drawing of [STOW_ICON, BUCKET_ICON]) {
      expect(drawing.startsWith('<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true">')).toBe(true);
      expect(drawing).toContain('<g class="iw-wash" fill="var(--iw-');
      expect(drawing).toContain('<g class="iw-pen">');
      expect(drawing).not.toMatch(/<animate|<set |<image|<text|stroke-width|style=/);
    }
    expect(STOW_ICON).not.toBe(BUCKET_ICON);
  });

  it('numbers the belt\'s slots, marks the tool in hand, and labels a spare one', () => {
    const state = newGame();
    for (const toolId of ['stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer'] as const) give(state, toolId);
    state.players[0].selectedTool = 'hatchet';
    const [belt] = withClass([inventoryBodyView(panelOf(state), NONE)], 'iw-belt-tiles');
    const tiles = belt!.children;
    expect(tiles).toHaveLength(6);
    expect(tiles.map((tile) => collectText([tile]))).toEqual(['1', '2', '3', '4', '5', 'spare']);
    expect(tiles.map((tile) => has(tile, 'iw-held'))).toEqual([false, false, true, false, false, false]);
    const labels = tiles.map((tile) => find([tile], (node) => node.tag === 'button')[0]!.attributes['aria-label']);
    expect(labels[2]).toBe('Slot 3: Hatchet, in hand');
    expect(labels[5]).toBe('Spare slot: Hammer');
    // With two tools the other three numbers stand empty, each with its number.
    const few = newGame();
    give(few, 'hatchet');
    const [short] = withClass([inventoryBodyView(panelOf(few), NONE)], 'iw-belt-tiles');
    expect(short!.children.map((tile) => [collectText([tile]), has(tile, 'iw-blank')])).toEqual([['1', false], ['2', false], ['3', true], ['4', true], ['5', true]]);
  });
});

describe('a quick press on a tile', () => {
  it('is named in the sheet\'s footer, the drop key by its name', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    const footers = find(panelView(panelOf(state)), (node) => node.tag === 'footer');
    expect(footers).toHaveLength(1);
    expect(collectText(footers)).toContain(QUICK_PRESS_HINT);
    expect(QUICK_PRESS_HINT).toContain('Shift+click');
    expect(QUICK_PRESS_HINT).toContain(`${DROP_KEY_CODE.replace('Key', '')} with the pointer on a tile`);
  });

  it('finds what Shift+click and the drop key send, by the tile\'s key', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'stone', 30); // two stacks of one item: 20 and 10
    give(state, 'clay', 4, 'cargo');
    give(state, 'lens');
    const panel = panelOf(state);
    expect(quickIntent(panel, 'backpack:stone:0', 'shift')).toEqual({ type: 'command', command: { type: 'transfer', from: 'backpack', itemId: 'stone', count: 20 } });
    expect(quickIntent(panel, 'backpack:stone:1', 'shift')).toEqual({ type: 'command', command: { type: 'transfer', from: 'backpack', itemId: 'stone', count: 10 } });
    expect(quickIntent(panel, 'backpack:stone:1', 'drop')).toEqual({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'stone', count: 10 } });
    expect(quickIntent(panel, 'cargo:clay:0', 'shift')).toEqual({ type: 'command', command: { type: 'transfer', from: 'cargo', itemId: 'clay', count: 4 } });
    expect(quickIntent(panel, 'cargo:clay:0', 'drop')).toEqual({ type: 'command', command: { type: 'discard', from: 'cargo', itemId: 'clay', count: 4 } });
    // A tool and a key item: the drop key sends a drop the rules refuse. Shift+click has nothing to send.
    expect(quickIntent(panel, 'belt:bailing_can:0', 'drop')).toEqual({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'bailing_can', count: 1 } });
    expect(quickIntent(panel, 'key:lens:0', 'drop')).toEqual({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'lens', count: 1 } });
    expect(quickIntent(panel, 'belt:bailing_can:0', 'shift')).toBeNull();
    expect(quickIntent(panel, 'key:lens:0', 'shift')).toBeNull();
    // A tile that is gone, and any other panel: nothing.
    expect(quickIntent(panel, 'backpack:stone:2', 'drop')).toBeNull();
    expect(quickIntent(panel, 'cargo:stone:0', 'shift')).toBeNull();
    expect(quickIntent(null, 'backpack:stone:0', 'drop')).toBeNull();
    expect(quickIntent({ ...panel, id: 'credits', lines: [], completed: false } as PanelModel, 'backpack:stone:0', 'drop')).toBeNull();
  });

  it('is not a control of the sheet: no tile carries an intent until its strip is open', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'stone', 9);
    const panel = panelOf(state);
    const sent = collectIntents(panelView(panel)).map((intent) => JSON.stringify(intent));
    expect(sent).not.toContain(JSON.stringify(panel.backpack.slots[0]!.shift));
    expect(sent).not.toContain(JSON.stringify(panel.backpack.slots[0]!.drop));
  });
});

describe('the inventory\'s own stylesheet', () => {
  it('moves nothing: no transition, no animation, no keyframes, no transform', () => {
    const rules = styles.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/transition|animation|@keyframes|transform/);
  });

  it('never dims words: the only opacity is on a drawing', () => {
    const rules = styles.replace(/\/\*[\s\S]*?\*\//g, '');
    const dimmed = [...rules.matchAll(/([^{}]+)\{[^}]*opacity:[^}]*\}/g)].map((match) => match[1]!.trim());
    expect(dimmed.length).toBeGreaterThan(0);
    for (const selector of dimmed) expect(selector.endsWith('.iw-ico'), selector).toBe(true);
  });

  it('sizes the grids so 40 stacks fit the sheet: tiles of 3.7rem, the bag four across, the boat as many as fit', () => {
    expect(styles).toMatch(/\.iw-inv \.iw-columns \{[^}]*grid-template-columns: 16\.3rem minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.iw-inv \.iw-tiles \{[^}]*grid-template-columns: repeat\(auto-fill, 3\.7rem\);[^}]*grid-auto-flow: row dense;[^}]*gap: 0\.5rem;/);
    // The bag's column holds exactly four tiles and three gaps.
    expect(4 * 3.7 + 3 * 0.5).toBeCloseTo(16.3);
  });
});
