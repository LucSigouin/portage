/**
 * The inventory's small menu and its info panel, as the player works them (Luc, round 4).
 *
 * `inventoryview.ts` draws the sheet from the model and from two names: the tile whose menu is open, and the tile
 * the info panel is about. This module keeps those two names and changes them:
 *
 * - The pointer on a tile, or the keyboard on it, and the info panel is about that tile. It stays on it when the
 *   pointer leaves. While a menu is open the panel stays on the menu's tile.
 * - A press on a tile opens its menu beside it. A press on the same tile closes it. So does a pick, Escape, a
 *   click anywhere else, a scroll of the sheet, a resized window, and the inventory closing.
 * - Shift+click on a tile sends its stack to the other side and opens nothing, as before.
 * - The menu stands beside its tile and never on it: right of it, or left of it where the right has no room, and
 *   moved up where it would run off the bottom of the screen (`placeMenu`).
 *
 * Three parts. `placeMenu` and `TileSelection` are pure and tested without a browser. `TileMenu` is the part that
 * reads the page: it is all the interface (`interface.ts`) has to call. Nothing here moves by itself: a menu is
 * written where it belongs before the browser paints it, and stays there.
 */
import type { InterfaceIntent, PanelModel } from '../client/contracts.ts';
import { intentOf } from './dom.ts';
import { itemDetailKeys, quickIntent } from './inventoryview.ts';
import type { InventoryShown } from './inventoryview.ts';

// --- Where the menu stands ------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The top left corner of a menu of `size`, for a tile at `tile`, kept inside `bounds`. All in the same units.
 *
 * Right of the tile, `gap` away, its top level with the tile's. Where the right has no room, left of the tile.
 * Where it would end below the bounds it moves up, never sideways, so it is beside its tile the whole way.
 * With no room on either side (a very narrow window) it goes under the tile, or over it.
 */
export function placeMenu(tile: Box, size: { width: number; height: number }, bounds: Box, gap: number): { left: number; top: number } {
  const fitsRight = tile.right + gap + size.width <= bounds.right;
  const fitsLeft = tile.left - gap - size.width >= bounds.left;
  if (fitsRight || fitsLeft) {
    return {
      left: fitsRight ? tile.right + gap : tile.left - gap - size.width,
      top: Math.max(bounds.top, Math.min(tile.top, bounds.bottom - size.height)),
    };
  }
  const fitsUnder = tile.bottom + gap + size.height <= bounds.bottom;
  return {
    left: Math.max(bounds.left, Math.min(tile.left, bounds.right - size.width)),
    top: fitsUnder ? tile.bottom + gap : Math.max(bounds.top, tile.top - gap - size.height),
  };
}

// --- What is shown --------------------------------------------------------------------------

/**
 * The two names the sheet is drawn from. Every change answers whether anything changed, so the interface draws
 * again only when it did.
 */
export class TileSelection {
  private menu: string | null = null;
  private info: string | null = null;

  get shown(): InventoryShown {
    return { menu: this.menu, info: this.info };
  }

  /** The tile whose menu is open, or null. */
  get open(): string | null {
    return this.menu;
  }

  /** The tile the info panel is about, or null. */
  get read(): string | null {
    return this.info;
  }

  /** Part of the panel's signature: the sheet is drawn again when this changes. */
  get signature(): string {
    return `${this.menu ?? ''}|${this.info ?? ''}`;
  }

  /** The pointer or the keyboard is on a tile. While a menu is open the info panel stays on the menu's tile. */
  point(key: string): boolean {
    if (this.menu !== null || this.info === key) return false;
    this.info = key;
    return true;
  }

  /** A tile was pressed: its menu opens and the info panel is about it. Pressed again, the menu closes. */
  press(key: string): void {
    this.menu = this.menu === key ? null : key;
    this.info = key;
  }

  closeMenu(): boolean {
    if (this.menu === null) return false;
    this.menu = null;
    return true;
  }

  /**
   * Keep up with the panel. A tile that is gone (eaten, moved, dropped, given) takes its menu with it and leaves
   * the info panel its quiet line. Any panel but the inventory: both are forgotten.
   */
  follow(panel: PanelModel | null): void {
    if (this.menu === null && this.info === null) return;
    if (panel?.id !== 'inventory') {
      this.menu = null;
      this.info = null;
      return;
    }
    const present = itemDetailKeys(panel);
    if (this.menu !== null && !present.includes(this.menu)) this.menu = null;
    if (this.info !== null && !present.includes(this.info)) this.info = null;
  }
}

// --- On the page ----------------------------------------------------------------------------

const MENU = '.iw-tile-menu';
const TILE = '.iw-item-pick[data-detail]';
/** The menu's distance from its tile, and from the edge of the screen, in rem. */
export const MENU_GAP_REM = 0.4;
export const MENU_EDGE_REM = 0.5;
/**
 * After the tile the info panel was about goes, the tiles close up and another may lie under a pointer that never
 * moved. A browser does not always say so. For this many frames the sheet is asked which tile the pointer is on.
 */
const SEEK_FRAMES = 12;

/** What the menu needs of the interface it lives in. */
export interface TileMenuHost {
  emit(intent: InterfaceIntent): void;
  /** Draw the panel again now: what is shown on it changed. */
  redraw(): void;
  /** The panel last drawn. */
  panel(): PanelModel | null;
  /** The element the panel is drawn in. */
  sheet(): HTMLElement | null;
  /** True while the player steers the menus by key. */
  byKeys(): boolean;
}

export class TileMenu {
  private readonly host: TileMenuHost;
  private readonly selection = new TileSelection();
  private seek = 0;
  /** The tile or the menu line that had the keyboard before a draw. */
  private held: HTMLElement | null = null;

  constructor(host: TileMenuHost) {
    this.host = host;
  }

  get shown(): InventoryShown {
    return this.selection.shown;
  }

  get signature(): string {
    return this.selection.signature;
  }

  private tile(key: string | null): HTMLElement | null {
    if (key === null) return null;
    for (const tile of this.host.sheet()?.querySelectorAll<HTMLElement>(TILE) ?? []) if (tile.dataset.detail === key) return tile;
    return null;
  }

  /** Before the panel is drawn: forget what is gone. */
  follow(panel: PanelModel | null): void {
    const read = this.selection.read;
    this.selection.follow(panel);
    if (panel?.id !== 'inventory') {
      this.seek = 0;
      this.held = null;
      return;
    }
    if (read !== null && this.selection.read === null) {
      this.seek = SEEK_FRAMES;
    } else if (this.seek > 0) {
      this.seek = this.selection.read === null ? this.seek - 1 : 0;
      const under = this.seek > 0 ? this.host.sheet()?.querySelector<HTMLElement>(`${TILE}:hover`)?.dataset.detail : undefined;
      if (under !== undefined && itemDetailKeys(panel).includes(under) && this.selection.point(under)) this.seek = 0;
    }
    const active = document.activeElement;
    this.held = active instanceof HTMLElement && active.matches(`${TILE}, ${MENU} button`) ? active : null;
  }

  /**
   * After the panel was drawn: the menu is put beside its tile, before the browser paints it. And a player steering
   * by key whose tile just went (the last berry eaten) is handed the first tile, not left with the keyboard nowhere.
   */
  drawn(): void {
    const sheet = this.host.sheet();
    if (!sheet) return;
    this.place(sheet);
    const held = this.held;
    this.held = null;
    if (held && !held.isConnected && this.host.byKeys()) {
      (sheet.querySelector<HTMLElement>(TILE) ?? sheet.querySelector<HTMLElement>('button:not([disabled])'))?.focus({ preventScroll: true });
    }
  }

  private place(sheet: HTMLElement): void {
    const menu = sheet.querySelector<HTMLElement>(MENU);
    const tile = this.tile(this.selection.open);
    const paper = menu?.parentElement;
    if (!menu || !tile || !paper) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const origin = paper.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    // The info panel keeps what the menu's lines would do in view: the menu stays off it where it can.
    const info = paper.querySelector('.iw-inv-info')?.getBoundingClientRect();
    const edge = MENU_EDGE_REM * rem;
    const bounds = { left: edge, top: edge, right: (info && info.width > 0 ? info.left : window.innerWidth) - edge, bottom: window.innerHeight - edge };
    const at = placeMenu(tile.getBoundingClientRect(), size, bounds, MENU_GAP_REM * rem);
    const left = `${Math.round(at.left - origin.left - paper.clientLeft)}px`;
    const top = `${Math.round(at.top - origin.top - paper.clientTop)}px`;
    if (menu.style.left !== left) menu.style.left = left;
    if (menu.style.top !== top) menu.style.top = top;
  }

  /**
   * A click anywhere on the interface. True: it was a tile's or the menu's, and is done. False: it goes on to
   * whatever it was on, with the menu closed.
   */
  click(event: MouseEvent, button: HTMLButtonElement | null): boolean {
    const panel = this.host.panel();
    if (panel?.id !== 'inventory') return false;
    const target = event.target instanceof Element ? event.target : null;
    const pressed = button !== null && !button.disabled ? button : null;
    const byKey = event.detail === 0;
    const key = pressed?.dataset.detail;
    if (pressed && key !== undefined) {
      if (event.shiftKey) {
        // Shift+click on a tile: its whole stack goes to the other side. No menu opens, and an open one closes.
        const quick = quickIntent(panel, key, 'shift');
        if (quick) this.host.emit(quick);
        this.selection.closeMenu();
      } else {
        this.selection.press(key);
      }
      this.host.redraw();
      // A click by pointer hands the keyboard back to the game. A press by key goes to the menu's first line.
      if (!byKey) pressed.blur();
      else if (this.selection.open !== null) this.host.sheet()?.querySelector<HTMLElement>(`${MENU} button:not([disabled])`)?.focus({ preventScroll: true });
      return true;
    }
    if (target?.closest(MENU)) {
      // A line of the menu: it is sent, and the menu closes. A line that is off does nothing, and the menu stays.
      const intent = pressed ? intentOf(pressed) : null;
      if (!intent) return true;
      this.host.emit(intent);
      if (byKey) this.tile(this.selection.open)?.focus({ preventScroll: true });
      this.selection.closeMenu();
      this.host.redraw();
      return true;
    }
    this.dismiss();
    return false;
  }

  /** The pointer came onto something, or the keyboard did: if it is a tile, the info panel is about it. */
  point(target: EventTarget | null): void {
    if (this.host.panel()?.id !== 'inventory' || !(target instanceof Element)) return;
    const key = target.closest<HTMLElement>(TILE)?.dataset.detail;
    if (key !== undefined && this.selection.point(key)) this.host.redraw();
  }

  /** Escape. True: a menu was open and is closed, and the key is spent. The inventory itself stays open. */
  escape(): boolean {
    const open = this.selection.open;
    if (open === null) return false;
    if (this.host.byKeys()) this.tile(open)?.focus({ preventScroll: true });
    this.dismiss();
    return true;
  }

  /** Close the menu, if one is open: the sheet was scrolled, the window changed size, or a click fell elsewhere. */
  dismiss(): void {
    if (this.selection.closeMenu()) this.host.redraw();
  }

  /** Where the keyboard walks: the open menu while it has a line to press, the whole surface the rest of the time. */
  scope(surface: HTMLElement | null): HTMLElement | null {
    if (this.selection.open === null) return surface;
    const menu = surface?.querySelector<HTMLElement>(MENU) ?? null;
    return menu?.querySelector('button:not([disabled])') ? menu : surface;
  }
}
