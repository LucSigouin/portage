/**
 * The inventory drawn as a grid of tiles (Luc's bugfix list, round 3): the two drawn buttons and the tool belt on
 * top, the bag on the left and the boat beside it, a tile a stack, an empty tile an empty slot.
 *
 * Round 4 (Luc: "it should have a info screen on the right", "clicking on it open a small hover menu"): the info
 * panel down the right of the sheet, and the small menu at a tile. Nothing opens inside the grid any more.
 */
import { describe, expect, it } from 'vitest';
import type { PanelModel } from '../../src/client/contracts.ts';
import { buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { BUCKET_ICON, STOW_ICON } from '../../src/interface/inventoryicons.ts';
import { TAKE_BACK_KEY_CODE } from '../../src/client/viewmodels/takeback.ts';
import {
  DROP_KEY_CODE, INFO_QUIET_LINE, NOTHING_SHOWN, QUICK_PRESS_HINT, inventoryBodyView, itemDetailKey, itemDetailKeys, quickIntent, tileMenuView,
} from '../../src/interface/inventoryview.ts';
import { toqueIcon } from '../../src/interface/icons.ts';
import { panelView } from '../../src/interface/views.ts';
import { ITEM_IDS, isStackable } from '../../src/data/index.ts';
import { setPlayerName } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { give, newGame, standOn, teleport } from '../support.ts';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };
const styles = readFileSync(new URL('../../src/interface/inventoryview.css', import.meta.url), 'utf8');

type Inventory = Extract<PanelModel, { id: 'inventory' }>;

const NONE = NOTHING_SHOWN;

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
    // The buttons and the belt on top, the bag and the boat under them, and the info panel last: down the right.
    expect(columns!.children.map((child) => child.classes)).toEqual(['iw-pack-actions', 'iw-inv-belt', 'iw-inv-pack', 'iw-inv-boat', 'iw-inv-info']);
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
    expect(pick!.attributes).toMatchObject({ 'aria-label': 'Driftwood, 12', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-detail': 'backpack:driftwood:0' });
    // No tooltip of the browser's on a tile: the info panel says what it is.
    expect(pick!.attributes.title).toBeUndefined();
    // The words of the whole panel, nothing pointed at: counts and headings, not one item's name or description.
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

  it('opens nothing inside the grid: with a menu open and the info panel full, each grid holds its tiles and nothing else', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    give(state, 'berries', 3);
    give(state, 'lens');
    const panel = panelOf(state);
    const berries = itemDetailKey('backpack', 'berries');
    for (const shown of [NONE, { menu: berries, info: berries }, { menu: itemDetailKey('belt', 'bailing_can'), info: itemDetailKey('key', 'lens') }]) {
      const body = inventoryBodyView(panel, shown);
      for (const list of find([body], (node) => node.tag === 'ul' && has(node, 'iw-tiles'))) {
        expect(list.children.every((child) => child.tag === 'li' && has(child, 'iw-tile')), JSON.stringify(shown)).toBe(true);
      }
      // The round-3 strip is gone, and the menu is not in the body at all: the body scrolls and would cut it.
      expect(withClass([body], 'iw-item-detail')).toEqual([]);
      expect(withClass([body], 'iw-tile-menu')).toEqual([]);
      // The same tiles, in the same order, whatever is shown.
      expect(withClass([body], 'iw-tile').map((tile) => tile.key)).toEqual(withClass([inventoryBodyView(panel, NONE)], 'iw-tile').map((tile) => tile.key));
    }
    // Every key the interface may hold is a tile on the sheet.
    expect(itemDetailKeys(panel).sort()).toEqual(['backpack:berries:0', 'backpack:driftwood:0', 'belt:bailing_can:0', 'key:lens:0']);
  });

  it('marks the tile whose menu is open and the tile the info panel is about', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 12);
    give(state, 'berries', 3);
    const body = inventoryBodyView(panelOf(state), { menu: 'backpack:berries:0', info: 'backpack:driftwood:0' });
    const tiles = withClass([body], 'iw-tile').filter((tile) => !has(tile, 'iw-blank'));
    const marks = Object.fromEntries(tiles.map((tile) => [tile.key, [has(tile, 'iw-open'), has(tile, 'iw-read'), find([tile], (node) => node.tag === 'button')[0]!.attributes['aria-expanded']]]));
    expect(marks).toEqual({
      'belt:bailing_can:0': [false, false, 'false'], 'backpack:driftwood:0': [false, true, 'false'], 'backpack:berries:0': [true, false, 'true'],
    });
  });
});

describe('the info panel', () => {
  const infoOf = (body: ViewNode): ViewNode => withClass([body], 'iw-inv-info')[0]!;

  it('holds one quiet line until an item is pointed at, and again when that tile is gone', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    const panel = panelOf(state);
    for (const shown of [NONE, { menu: null, info: 'backpack:stone:0' }, { menu: null, info: 'cargo:berries:0' }]) {
      const info = infoOf(inventoryBodyView(panel, shown));
      expect(collectText([info])).toBe(`About ${INFO_QUIET_LINE}`);
      expect(find([info], (node) => node.attributes['data-item'] !== undefined)).toEqual([]);
    }
    expect(INFO_QUIET_LINE).toBe('Point at an item to read about it.');
  });

  it('shows the pointed tile: its drawing, its name, what it is and how many, its words, and what it is for', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    give(state, 'driftwood', 12);
    const panel = panelOf(state);
    const info = infoOf(inventoryBodyView(panel, { menu: null, info: 'backpack:berries:0' }));
    const [card] = withClass([info], 'iw-info-card');
    expect(card!.attributes['data-about']).toBe('backpack:berries:0');
    expect(find([card!], (node) => node.attributes['data-item'] === 'berries')).toHaveLength(1);
    expect(collectText(withClass([card!], 'iw-info-name'))).toBe('Berries');
    expect(collectText(withClass([card!], 'iw-info-kind'))).toBe('Food · x3');
    expect(collectText(withClass([card!], 'iw-info-about'))).toBe(panel.backpack.slots[0]!.description);
    // What it is for: the model's lines, each a lead and its words, in the model's order.
    const uses = withClass([card!], 'iw-info-uses')[0]!.children.map((line) => collectText([line]));
    expect(uses).toEqual(panel.info.berries!.uses.map((line) => `${line.lead}:   ${line.text}`));
    expect(uses.some((line) => line.startsWith('Eat it:'))).toBe(true);
    // The other item is not in the panel: one item at a time.
    expect(collectText([info])).not.toContain('Driftwood');
    // No control in it: the panel is for reading.
    expect(find([info], (node) => node.tag === 'button')).toEqual([]);
    expect(collectIntents([info])).toEqual([]);
  });

  it('shows a tool and a key item the same way, with where the tool is', () => {
    const state = newGame();
    give(state, 'hatchet');
    give(state, 'lens');
    state.players[0].selectedTool = 'hatchet';
    const panel = panelOf(state);
    const tool = infoOf(inventoryBodyView(panel, { menu: null, info: 'belt:hatchet:0' }));
    expect(collectText(withClass([tool], 'iw-info-name'))).toBe('Hatchet');
    expect(collectText(withClass([tool], 'iw-info-kind'))).toBe('Tool · in hand');
    const keyItem = infoOf(inventoryBodyView(panel, { menu: null, info: 'key:lens:0' }));
    expect(collectText(withClass([keyItem], 'iw-info-name'))).toBe('Lens');
    expect(collectText(withClass([keyItem], 'iw-info-kind'))).toBe('Key item · x1');
  });

  it('is the same element whatever it shows: its place never follows its words', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    const panel = panelOf(state);
    const shapes = [NONE, { menu: null, info: 'backpack:berries:0' }, { menu: null, info: 'belt:bailing_can:0' }].map((shown) => {
      const info = infoOf(inventoryBodyView(panel, shown));
      return [info.tag, info.key, info.classes, info.children.map((child) => `${child.tag}.${child.classes}`).join(' ')];
    });
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
    expect(shapes[0]).toEqual(['aside', 'info', 'iw-inv-info', 'h3. div.iw-info-card']);
  });
});

describe('the small menu at a tile', () => {
  /** Luc ashore at Home Knoll by the landed canoe, Sam a step away. */
  function withSam(): GameState {
    const state = newGame(7, { crew: 2 });
    standOn(state, 'home_knoll');
    setPlayerName(state, 0, 'Luc');
    setPlayerName(state, 1, 'Sam');
    const [luc, sam] = state.players;
    Object.assign(sam, { mode: 'foot', seat: null, islandId: luc.islandId, position: { ...luc.position, x: luc.position.x + 1 } });
    return state;
  }
  const linesOf = (menu: ViewNode): string[] => find([menu], (node) => node.tag === 'button').map((button) =>
    `${collectText(withClass([button], 'iw-label'))}${button.attributes.disabled ? ' (off)' : ''}${withClass([button], 'iw-note').length > 0 ? ` [${collectText(withClass([button], 'iw-note'))}]` : ''}`);

  it('is not drawn until a tile is pressed, nor for a tile that is gone', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    const panel = panelOf(state);
    expect(tileMenuView(panel, null)).toBeNull();
    expect(tileMenuView(panel, 'backpack:stone:0')).toBeNull();
    expect(tileMenuView(panel, 'backpack:berries:1')).toBeNull();
    expect(tileMenuView(panel, 'backpack:berries:0')).not.toBeNull();
  });

  it('is the sheet\'s own child, after the body and outside it', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    const panel = panelOf(state);
    const [sheet] = panelView(panel, { menu: 'backpack:berries:0', info: 'backpack:berries:0' });
    const kinds = sheet!.children.map((child) => (has(child, 'iw-body') ? 'body' : has(child, 'iw-tile-menu') ? 'menu' : child.tag));
    expect(kinds.slice(kinds.indexOf('body'), kinds.indexOf('body') + 2)).toEqual(['body', 'menu']);
    expect(withClass(withClass([sheet!], 'iw-body'), 'iw-tile-menu')).toEqual([]);
    // Closed: the sheet has no menu at all.
    expect(withClass(panelView(panel), 'iw-tile-menu')).toEqual([]);
    expect(withClass(panelView(panel, { menu: null, info: 'backpack:berries:0' }), 'iw-tile-menu')).toEqual([]);
  });

  it('names its tile and carries the model\'s lines, each with the intent the model gave it', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    const panel = panelOf(state);
    const menu = tileMenuView(panel, 'backpack:berries:0')!;
    expect(menu.attributes).toMatchObject({ role: 'menu', 'data-for': 'backpack:berries:0', 'aria-label': 'Berries: what to do' });
    expect(collectText(withClass([menu], 'iw-menu-head'))).toBe('Berries x3');
    expect(linesOf(menu)).toEqual(['Eat', 'Stow', 'Drop']);
    expect(collectIntents([menu])).toEqual(panel.backpack.slots[0]!.buttons.map((button) => button.intent));
    for (const line of find([menu], (node) => node.tag === 'button')) expect(line.attributes).toMatchObject({ type: 'button', role: 'menuitem' });
    // A drop is drawn quietly, as everywhere.
    expect(find([menu], (node) => node.tag === 'button').map((line) => has(line, 'iw-quiet'))).toEqual([false, false, true]);
  });

  it('gives each kind of item its own lines: a drink, a stack in the boat, a tool in hand and one put away, a key item', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'clean_water', 2);
    give(state, 'clay', 4, 'cargo');
    give(state, 'hatchet');
    give(state, 'lens');
    state.players[0].selectedTool = 'hatchet';
    const panel = panelOf(state);
    expect(linesOf(tileMenuView(panel, 'backpack:clean_water:0')!)).toEqual(['Drink', 'Stow', 'Drop']);
    expect(linesOf(tileMenuView(panel, 'cargo:clay:0')!)).toEqual(['Take', 'Drop']);
    expect(linesOf(tileMenuView(panel, 'belt:hatchet:0')!)).toEqual(['Put away', 'To 1', 'To 3', 'To 4', 'To 5', 'Drop (off) [Tools stay on the belt. They are never dropped]']);
    expect(linesOf(tileMenuView(panel, 'belt:bailing_can:0')!)).toEqual(['Hold', 'To 2', 'To 3', 'To 4', 'To 5', 'Drop (off) [Tools stay on the belt. They are never dropped]']);
    expect(linesOf(tileMenuView(panel, 'key:lens:0')!)).toEqual(['Drop (off) [A key item stays with the crew. It is never dropped]']);
    // A tool's moves to another slot stand together on one row, between Hold and Drop.
    const tool = tileMenuView(panel, 'belt:hatchet:0')!;
    const [row] = withClass([tool], 'iw-menu-row');
    expect(find([row!], (node) => node.tag === 'button').map((button) => collectText([button]))).toEqual(['To 1', 'To 3', 'To 4', 'To 5']);
    expect(tool.children.map((child) => (has(child, 'iw-menu-row') ? 'row' : has(child, 'iw-menu-line') ? 'line' : 'head'))).toEqual(['head', 'line', 'row', 'line']);
  });

  it('shows a line the rules would refuse as off, with the reason under it', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    give(state, 'clay', 4, 'cargo');
    // Ashore, and the canoe paddled off: it is out of reach.
    teleport(state, 'home_knoll', 0, 1150);
    state.canoe.beached = false;
    const panel = panelOf(state);
    expect(panel.cargo.accessible).toBe(false);
    expect(linesOf(tileMenuView(panel, 'backpack:berries:0')!)).toEqual(['Eat', 'Stow (off) [The canoe is out of reach]', 'Drop']);
    expect(linesOf(tileMenuView(panel, 'cargo:clay:0')!)).toEqual(['Take (off) [The canoe is out of reach]', 'Drop (off) [The canoe is out of reach]']);
    // Off is the button's own `disabled`: it cannot be pressed, and the keyboard steps over it.
    const [stow] = find([tileMenuView(panel, 'backpack:berries:0')!], (node) => node.tag === 'button' && collectText([node]).startsWith('Stow'));
    expect(stow!.attributes.disabled).toBe(true);
  });

  it('has one Give line for a crewmate in reach, with their name and their toque in their colour', () => {
    const state = withSam();
    give(state, 'plank', 5);
    const panel = panelOf(state);
    const menu = tileMenuView(panel, 'backpack:plank:0')!;
    expect(linesOf(menu)).toEqual(['Stow', 'Give to Sam', 'Drop']);
    const [line] = find([menu], (node) => node.tag === 'button' && has(node, 'iw-give'));
    expect(line!.intent).toEqual({ type: 'command', command: { type: 'give', to: 1, itemId: 'plank', count: 5 } });
    const colour = panel.backpack.slots[0]!.buttons.find((button) => button.label === 'Give to Sam')!.color!;
    expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(find([line!], (node) => node.html === toqueIcon(colour))).toHaveLength(1);
    // No other line has a toque, and no style is written on anything: the live site's policy forbids it.
    expect(find([menu], (node) => has(node, 'iw-menu-toque'))).toHaveLength(1);
    expect(find([menu], (node) => node.attributes.style !== undefined)).toEqual([]);
  });

  it('has no Give line alone', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'plank', 5);
    expect(linesOf(tileMenuView(panelOf(state), 'backpack:plank:0')!)).toEqual(['Stow', 'Drop']);
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
    // The Z in the line is a drawn letter (`keycaps.ts`), a piece of its own: the words are the same, read with single spaces.
    expect(collectText(footers).replace(/\s+/g, ' ')).toContain(QUICK_PRESS_HINT);
    expect(QUICK_PRESS_HINT).toContain('Shift+click');
    expect(QUICK_PRESS_HINT).toContain(`${DROP_KEY_CODE.replace('Key', '')} with the pointer on a tile`);
    // The way back from a drop is said beside the drop key (the master review, finding 2).
    expect(QUICK_PRESS_HINT).toContain(`${TAKE_BACK_KEY_CODE.replace('Key', '')} takes a drop back`);
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

  it('is not a control of the sheet: no tile carries an intent until its menu is open', () => {
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

  it('sizes the grids so 40 stacks fit the sheet: tiles of 3.7rem, the bag four across, the boat eight, the info panel the rest', () => {
    expect(styles).toMatch(/\.iw-inv \.iw-columns \{[^}]*grid-template-columns: 16\.3rem minmax\(0, 33\.1rem\) minmax\(13rem, 1fr\);[^}]*grid-template-rows: auto 1fr;/);
    expect(styles).toMatch(/\.iw-inv \.iw-tiles \{[^}]*grid-template-columns: repeat\(auto-fill, 3\.7rem\);[^}]*gap: 0\.5rem;/);
    // The bag's column holds exactly four tiles and three gaps, the boat's eight and seven.
    expect(4 * 3.7 + 3 * 0.5).toBeCloseTo(16.3);
    expect(8 * 3.7 + 7 * 0.5).toBeCloseTo(33.1);
    // The sheet is wide enough for the three columns and stays on a screen of about 94rem.
    expect(styles).toMatch(/\.iw-panel\.iw-panel-inventory \{\s*width: min\(77rem, 96vw\);/);
    expect(16.3 + 33.1 + 13 + 2 * 2.2 + 4 + 0.8).toBeLessThanOrEqual(77);
  });

  it('gives the info panel a column and a height of its own, and lays its card over them: its words move nothing', () => {
    // Each part has its own cell, so the info panel cannot push a grid along.
    for (const [part, column, row] of [['iw-pack-actions', '1', '1'], ['iw-inv-belt', '2', '1'], ['iw-inv-pack', '1', '2'], ['iw-inv-boat', '2', '2']] as const) {
      expect(styles).toMatch(new RegExp(`\\.iw-inv \\.${part} \\{\\s*grid-column: ${column};\\s*grid-row: ${row};`));
    }
    expect(styles).toMatch(/\.iw-inv \.iw-inv-info \{[^}]*grid-column: 3;[^}]*grid-row: 1 \/ span 2;[^}]*position: relative;[^}]*min-height: 27rem;/);
    // The card is out of the flow (it cannot make the column taller) and scrolls inside itself if it must.
    expect(styles).toMatch(/\.iw-info-card \{[^}]*position: absolute;[^}]*inset: 2rem 0 0\.2rem 0;[^}]*overflow: hidden auto;/);
  });

  it('lays the menu over the sheet, out of the flow, so it moves no tile', () => {
    expect(styles).toMatch(/\.iw-tile-menu \{[^}]*position: absolute;[^}]*z-index: 6;[^}]*max-width: 17rem;/);
    // The round-3 strip's rules are gone with the strip.
    expect(styles).not.toContain('iw-item-detail');
    // And from the game's own sheet (the master review of round 4, finding 9).
    expect(readFileSync(new URL('../../src/interface/theme.css', import.meta.url), 'utf8')).not.toContain('iw-item-detail');
  });
});
