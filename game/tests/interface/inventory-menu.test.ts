/**
 * The inventory's small menu and its info panel, as the player works them (Luc, round 4): where the menu stands
 * beside its tile, and which tile the menu and the info panel belong to after each press, hover and change.
 *
 * The part that reads the page (`TileMenu`) is driven by the browser specs. Here: the two pure parts.
 */
import { describe, expect, it } from 'vitest';
import type { PanelModel } from '../../src/client/contracts.ts';
import { buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { MENU_EDGE_REM, MENU_GAP_REM, TileSelection, placeMenu } from '../../src/interface/inventorymenu.ts';
import type { Box } from '../../src/interface/inventorymenu.ts';
import { NOTHING_SHOWN } from '../../src/interface/inventoryview.ts';
import type { GameState } from '../../src/sim/index.ts';
import { give, newGame, standOn } from '../support.ts';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });
const overlaps = (first: Box, second: Box): boolean =>
  !(first.right <= second.left || first.left >= second.right || first.bottom <= second.top || first.top >= second.bottom);
const within = (inner: Box, outer: Box): boolean =>
  inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;

describe('where the menu stands', () => {
  const bounds = box(0, 0, 100, 60);
  const size = { width: 14, height: 12 };
  const placed = (tile: Box, menu = size, inside = bounds, gap = 0.4): Box => {
    const at = placeMenu(tile, menu, inside, gap);
    return box(at.left, at.top, menu.width, menu.height);
  };

  it('is right of its tile, a gap away, its top level with the tile\'s', () => {
    expect(placeMenu(box(20, 10, 4, 4), size, bounds, 1)).toEqual({ left: 25, top: 10 });
  });

  it('goes left of the tile where the right has no room', () => {
    // The tile ends at 86: 86 + 1 + 14 is past 100. Left of it: 82 - 1 - 14.
    expect(placeMenu(box(82, 10, 4, 4), size, bounds, 1)).toEqual({ left: 67, top: 10 });
    // Exactly enough room on the right (85 + 1 + 14 is 100): it stays on the right.
    expect(placeMenu(box(81, 10, 4, 4), size, bounds, 1)).toEqual({ left: 86, top: 10 });
  });

  it('moves up, never sideways, where it would run off the bottom', () => {
    const tile = box(20, 55, 4, 4);
    // 12 tall in bounds that end at 60: its top is 48, and it is still right of the tile.
    expect(placeMenu(tile, size, bounds, 1)).toEqual({ left: 25, top: 48 });
    // And never above the top edge, however tall it is.
    expect(placeMenu(tile, { width: 14, height: 70 }, bounds, 1)).toEqual({ left: 25, top: 0 });
  });

  it('never covers its tile and never leaves the screen, wherever the tile is on the sheet', () => {
    // The sheet's own numbers, in rem: a screen of 94 by 53, tiles of 3.7 every 4.2, the menu as wide as it may be.
    const screen = box(MENU_EDGE_REM, MENU_EDGE_REM, 94 - 2 * MENU_EDGE_REM, 53 - 2 * MENU_EDGE_REM);
    let checked = 0;
    for (const menu of [{ width: 10.5, height: 6 }, { width: 17, height: 9 }, { width: 17, height: 22 }]) {
      for (let left = 1; left + 3.7 <= 93; left += 4.2) {
        for (let top = 1; top + 3.7 <= 52; top += 4.2) {
          const tile = box(left, top, 3.7, 3.7);
          const at = placed(tile, menu, screen, MENU_GAP_REM);
          expect(overlaps(at, tile), `tile at ${left}, ${top}`).toBe(false);
          expect(within(at, screen), `tile at ${left}, ${top}`).toBe(true);
          // Beside it: the gap away on one side or the other.
          expect(Math.min(Math.abs(at.left - tile.right), Math.abs(tile.left - at.right))).toBeCloseTo(MENU_GAP_REM);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(700);
  });

  it('keeps off whatever its bounds leave out: with the info panel beyond the right bound it goes left of the last column', () => {
    // The boat's eighth column ends at 55.4, the info panel starts at 57.6: the bounds end there.
    const short = box(0.5, 0.5, 57.1 - 0.5, 52);
    const tile = box(51.7, 20, 3.7, 3.7);
    const at = placed(tile, size, short);
    expect(at.right).toBeCloseTo(51.3);
    expect(at.right).toBeLessThanOrEqual(short.right);
    // The first column of the same grid has room on its right.
    expect(placed(box(22.3, 20, 3.7, 3.7), size, short).left).toBeCloseTo(26.4);
  });

  it('with no room on either side goes under the tile, or over it, and stays inside sideways', () => {
    const narrow = box(0, 0, 20, 60);
    const wide = { width: 16, height: 8 };
    const under = placed(box(8, 10, 3.7, 3.7), wide, narrow);
    expect(under.top).toBeCloseTo(14.1);
    expect(within(under, narrow)).toBe(true);
    const over = placed(box(8, 54, 3.7, 3.7), wide, narrow);
    expect(over.bottom).toBeCloseTo(53.6);
    expect(within(over, narrow)).toBe(true);
    for (const at of [under, over]) expect(overlaps(at, box(8, at === under ? 10 : 54, 3.7, 3.7))).toBe(false);
  });
});

describe('which tile the menu and the info panel belong to', () => {
  type Inventory = Extract<PanelModel, { id: 'inventory' }>;
  const panelOf = (state: GameState): Inventory => ({
    title: 'Inventory', close: { label: 'Close', intent: { type: 'close_panel' }, enabled: true, note: null }, ...buildInventoryPanel(state),
  });
  function stocked(): GameState {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    give(state, 'stone', 30); // two stacks: 20 and 10
    return state;
  }

  it('starts with nothing shown', () => {
    const selection = new TileSelection();
    expect(selection.shown).toEqual(NOTHING_SHOWN);
    expect(selection.shown).toEqual({ menu: null, info: null });
    expect(selection.signature).toBe('|');
  });

  it('the pointer on a tile: the info panel is about it, and stays on it', () => {
    const selection = new TileSelection();
    expect(selection.point('backpack:berries:0')).toBe(true);
    expect(selection.shown).toEqual({ menu: null, info: 'backpack:berries:0' });
    // The same tile again changes nothing: the sheet is not drawn again.
    expect(selection.point('backpack:berries:0')).toBe(false);
    expect(selection.point('backpack:stone:0')).toBe(true);
    expect(selection.shown).toEqual({ menu: null, info: 'backpack:stone:0' });
    // There is no "the pointer left": the last tile stays.
    expect(selection.read).toBe('backpack:stone:0');
  });

  it('a press opens the tile\'s menu and turns the info panel to it. The same tile pressed again closes the menu', () => {
    const selection = new TileSelection();
    selection.point('backpack:stone:0');
    selection.press('backpack:berries:0');
    expect(selection.shown).toEqual({ menu: 'backpack:berries:0', info: 'backpack:berries:0' });
    expect(selection.open).toBe('backpack:berries:0');
    selection.press('backpack:berries:0');
    expect(selection.shown).toEqual({ menu: null, info: 'backpack:berries:0' });
    // Another tile pressed while one is open: the menu goes to it. One menu at a time.
    selection.press('backpack:berries:0');
    selection.press('backpack:stone:1');
    expect(selection.shown).toEqual({ menu: 'backpack:stone:1', info: 'backpack:stone:1' });
  });

  it('while a menu is open the info panel stays on its tile, whatever the pointer crosses', () => {
    const selection = new TileSelection();
    selection.press('backpack:berries:0');
    expect(selection.point('backpack:stone:0')).toBe(false);
    expect(selection.shown).toEqual({ menu: 'backpack:berries:0', info: 'backpack:berries:0' });
    expect(selection.closeMenu()).toBe(true);
    expect(selection.closeMenu()).toBe(false);
    expect(selection.point('backpack:stone:0')).toBe(true);
    expect(selection.shown).toEqual({ menu: null, info: 'backpack:stone:0' });
  });

  it('changes its signature with every change, so the sheet is drawn again', () => {
    const selection = new TileSelection();
    const seen = new Set([selection.signature]);
    selection.point('backpack:berries:0');
    seen.add(selection.signature);
    selection.press('backpack:berries:0');
    seen.add(selection.signature);
    selection.press('backpack:stone:0');
    seen.add(selection.signature);
    selection.closeMenu();
    seen.add(selection.signature);
    expect(seen.size).toBe(5);
  });

  it('a tile that is gone takes its menu with it and leaves the info panel its quiet line', () => {
    const state = stocked();
    const selection = new TileSelection();
    selection.press('backpack:stone:1');
    selection.follow(panelOf(state));
    expect(selection.shown).toEqual({ menu: 'backpack:stone:1', info: 'backpack:stone:1' });
    // The second stack of stone is dropped: there is no second tile of stone any more.
    state.players[0].backpack.pop();
    selection.follow(panelOf(state));
    expect(selection.shown).toEqual({ menu: null, info: null });
    // A tile that is still there keeps both.
    selection.press('backpack:berries:0');
    state.players[0].backpack[0]!.count = 2;
    selection.follow(panelOf(state));
    expect(selection.shown).toEqual({ menu: 'backpack:berries:0', info: 'backpack:berries:0' });
  });

  it('forgets both when the inventory closes, or another panel is up', () => {
    const state = stocked();
    for (const other of [null, { ...panelOf(state), id: 'credits', lines: [], completed: false } as unknown as PanelModel]) {
      const selection = new TileSelection();
      selection.press('backpack:berries:0');
      selection.follow(other);
      expect(selection.shown).toEqual({ menu: null, info: null });
    }
  });
});
