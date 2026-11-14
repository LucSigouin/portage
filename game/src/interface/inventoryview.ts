/**
 * The inventory, as a grid of tiles (Luc's bugfix list, round 3), with an info panel on its right and a small menu
 * at the tile that was clicked (Luc, round 4).
 *
 * - The backpack on the left, the canoe's cargo in the middle. A stack is a square tile: the item's drawing and
 *   `x12`, and nothing else. An empty slot is an empty tile, so the room left is seen at a glance.
 * - On the right, the info panel: the item under the pointer, or the tile the keyboard is on. Its drawing, its
 *   name, what it is, how many, and what it is for. With the pointer on no item it keeps the last one; before the
 *   first it holds one quiet line. It has its own column and its own height, so the grid never moves when it fills.
 * - A tile is a button. Pressed, by click or by Enter or Space, it opens a small menu beside it: Eat or Drink,
 *   Hold or Put away, Stow or Take, Give, Drop. Nothing opens inside the grid. A line the rules would refuse is
 *   there, off, with the reason under it.
 * - At the top left, Stow all and Scoop water as drawn buttons, each with a label that stands under it while the
 *   pointer or the keyboard is on it. At the top right of the grid, the tool belt: numbered slots that answer the tool keys.
 * - Shift+click sends a tile's stack to the other side, and the drop key (Q) with the pointer on a tile drops it.
 *
 * Pure, like `views.ts`: nothing here reads the DOM, keeps state or knows a game rule. Every count, label and
 * reason comes from the model, and every control carries the intent the model gave it. Nothing moves by itself.
 * Where the menu stands on the screen is worked out after it is drawn (`inventorymenu.ts`).
 */
import './inventoryview.css';
import type { BeltSlotModel, ButtonModel, InterfaceIntent, ItemSlotModel, PanelModel } from '../client/contracts.ts';
import type { ItemId } from '../data/index.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { itemIcon, toqueIcon } from './icons.ts';
import { keyedText } from './keycaps.ts';
import { BUCKET_ICON, STOW_ICON } from './inventoryicons.ts';

type InventoryModel = Extract<PanelModel, { id: 'inventory' }>;

/** The groups of tiles: the two containers, the tool belt and the key items. */
export type TileGroup = 'backpack' | 'cargo' | 'belt' | 'key';

/** The key that drops the stack under the pointer. Luc's words: "hover+q to drop". */
export const DROP_KEY_CODE = 'KeyQ';

/** The name of one tile. Two stacks of one item are told apart by which comes first. */
export const itemDetailKey = (group: TileGroup, itemId: ItemId, occurrence = 0): string => `${group}:${itemId}:${occurrence}`;

/**
 * What the player has before them on the sheet, kept by the interface: the tile whose menu is open, and the tile
 * the info panel shows (the last one the pointer or the keyboard was on). Each is a tile's name, or null.
 */
export interface InventoryShown {
  menu: string | null;
  info: string | null;
}

export const NOTHING_SHOWN: InventoryShown = { menu: null, info: null };

/** The info panel's one line before any item was pointed at. */
export const INFO_QUIET_LINE = 'Point at an item to read about it.';

interface Tile {
  key: string;
  group: TileGroup;
  itemId: ItemId;
  /** Shift+click. */
  shift: InterfaceIntent | null;
  /** The drop key. */
  drop: InterfaceIntent | null;
  /** For a screen reader: "Birch bark, 12". */
  label: string;
  /** In the corner: a belt slot's key. */
  corner: string;
  /** Under the drawing: `x12`, or `spare`. */
  under: string;
  /** A tool in hand. */
  held: boolean;
  /** The info panel and the menu's head: name, how many, what it is. */
  name: string;
  countText: string;
  description: string;
  /** The menu's lines. */
  buttons: ButtonModel[];
}

/** An empty slot of a grid. */
interface Blank {
  blank: string;
  corner: string;
}

type Slot = Tile | Blank;

const isTile = (slot: Slot): slot is Tile => 'key' in slot;

function stackSlots(slots: ItemSlotModel[], group: 'backpack' | 'cargo'): Slot[] {
  const seen = new Map<string, number>();
  return slots.map((slot, index): Slot => {
    if (slot.itemId === null) return { blank: `empty-${index}`, corner: '' };
    const occurrence = seen.get(slot.itemId) ?? 0;
    seen.set(slot.itemId, occurrence + 1);
    return {
      key: itemDetailKey(group, slot.itemId, occurrence), group, itemId: slot.itemId, shift: slot.shift, drop: slot.drop,
      label: `${slot.name}, ${slot.count}`, corner: '', under: `x${slot.count}`, held: false,
      name: slot.name, countText: `x${slot.count}`, description: slot.description, buttons: slot.buttons,
    };
  });
}

function beltSlots(belt: BeltSlotModel[]): Slot[] {
  return belt.map((slot): Slot => {
    if (slot.itemId === null) return { blank: `empty-${slot.slot}`, corner: slot.keyLabel };
    const where = slot.keyLabel ? `Slot ${slot.keyLabel}` : 'Spare slot';
    return {
      key: itemDetailKey('belt', slot.itemId), group: 'belt', itemId: slot.itemId, shift: null, drop: slot.drop,
      label: `${where}: ${slot.name}${slot.selected ? ', in hand' : ''}`, corner: slot.keyLabel, under: slot.keyLabel ? '' : 'spare',
      held: slot.selected, name: slot.name, countText: slot.selected ? 'in hand' : '', description: slot.description, buttons: slot.buttons,
    };
  });
}

function keySlots(panel: InventoryModel): Tile[] {
  return panel.keyItems.map((item) => ({
    key: itemDetailKey('key', item.itemId), group: 'key', itemId: item.itemId, shift: null, drop: item.drop,
    label: `${item.name}, ${item.count}`, corner: '', under: `x${item.count}`, held: false,
    name: item.name, countText: `x${item.count}`, description: item.description, buttons: item.buttons,
  }));
}

/** Every tile that holds something, in the order the keyboard walks them: the belt, the backpack, the key items, the cargo. */
function tilesOf(panel: InventoryModel): Tile[] {
  return [...beltSlots(panel.belt), ...stackSlots(panel.backpack.slots, 'backpack'), ...keySlots(panel), ...stackSlots(panel.cargo.slots, 'cargo')].filter(isTile);
}

/** Every tile key in an inventory panel. For tests and the interface. */
export const itemDetailKeys = (panel: InventoryModel): string[] => tilesOf(panel).map((tile) => tile.key);

/**
 * What a quick press on a tile sends: `shift` for Shift+click (the whole stack to the other side), `drop` for the
 * drop key with the pointer on the tile. Null when the tile has no such thing (an empty slot, Shift+click on a
 * tool or a key item), or is no longer in the panel. The intent goes out even where the rules will refuse it:
 * the refusal is the line that tells the player why.
 */
export function quickIntent(panel: PanelModel | null, key: string, press: 'shift' | 'drop'): InterfaceIntent | null {
  if (panel?.id !== 'inventory') return null;
  return tilesOf(panel).find((tile) => tile.key === key)?.[press] ?? null;
}

// --- Drawing ---------------------------------------------------------------------------

const itemIconView = (itemId: ItemId): ViewNode =>
  h('i.iw-i.iw-item-ico', { html: itemIcon(itemId), 'aria-hidden': 'true', 'data-item': itemId });

/** A small paper button. A drop is drawn quietly, so the eye lands on the safe ones. */
function actionView(button: ButtonModel, index: number, selector = 'button.iw-btn.iw-small'): ViewNode {
  const quiet = button.intent.type === 'command' && button.intent.command.type === 'discard';
  return control(h(selector, { key: index, type: 'button', disabled: !button.enabled, class: quiet ? 'iw-quiet' : '' },
    h('span.iw-label', null, button.label),
    button.note ? h('small.iw-note', null, button.note) : null), button.intent);
}

/**
 * A drawn button of the top row: the drawing alone. Its words are its label for a screen reader, and stand under
 * it, written at once and whole, while the pointer or the keyboard is on it (`data-tip`, and `data-note` for the
 * second line: why it is off, or what it gives).
 */
function iconButtonView(button: ButtonModel, drawing: string, name: string): ViewNode {
  return control(h('button.iw-icon-btn', {
    key: name, type: 'button', disabled: !button.enabled, 'data-action': name,
    'aria-label': button.note ? `${button.label}. ${button.note}` : button.label, 'data-tip': button.label, 'data-note': button.note ?? '',
  }, h('i.iw-i', { html: drawing, 'aria-hidden': 'true' })), button.intent);
}

/** One tile: a button that opens its menu. `shown` marks the tile whose menu is open and the one the info panel is about. */
function tileView(tile: Tile, shown: InventoryShown): ViewNode {
  const open = shown.menu === tile.key;
  const read = shown.info === tile.key;
  return h('li.iw-item.iw-tile', { key: tile.key, class: `${open ? 'iw-open' : ''}${read ? ' iw-read' : ''}${tile.held ? ' iw-held' : ''}`.trim() },
    h('button.iw-item-pick', {
      type: 'button', 'data-detail': tile.key, 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-label': tile.label,
    },
    tile.corner ? h('span.iw-n', null, tile.corner) : null,
    itemIconView(tile.itemId),
    tile.under ? h('span.iw-tile-count', null, tile.under) : null));
}

const slotView = (slot: Slot, shown: InventoryShown): ViewNode => (isTile(slot)
  ? tileView(slot, shown)
  : h('li.iw-item.iw-tile.iw-blank', { key: slot.blank, 'aria-label': 'Empty slot' }, slot.corner ? h('span.iw-n', null, slot.corner) : null));

// --- The info panel ----------------------------------------------------------------------

/**
 * The panel on the right: what the tile `shown.info` holds. Its picture, its name, its kind and how many, what it
 * is, and what it is for. With no such tile, one quiet line. Its place and its size are the stylesheet's and do
 * not follow what is written in it.
 */
function infoView(panel: InventoryModel, tile: Tile | null): ViewNode {
  const info = tile ? panel.info[tile.itemId] : undefined;
  return h('aside.iw-inv-info', { key: 'info', 'aria-label': 'About the item' },
    h('h3', null, 'About'),
    h('div.iw-info-card', { 'data-about': tile?.key ?? '', 'aria-live': 'polite' }, tile ? [
      h('div.iw-info-head', { key: 'head' },
        itemIconView(tile.itemId),
        h('div.iw-info-title', null,
          h('b.iw-info-name', null, tile.name),
          h('span.iw-info-kind', null, [info?.kind ?? '', tile.countText].filter((part) => part !== '').join(' · ')))),
      h('p.iw-info-about', { key: 'about' }, tile.description),
      info && info.uses.length > 0 ? h('ul.iw-info-uses', { key: 'uses' },
        info.uses.map((line, index) => h('li', { key: index }, h('b', null, `${line.lead}:`), ' ', line.text))) : null,
    ] : h('p.iw-info-quiet', { key: 'quiet' }, INFO_QUIET_LINE)));
}

// --- The menu at a tile ------------------------------------------------------------------

const isSlotMove = (button: ButtonModel): boolean => button.intent.type === 'command' && button.intent.command.type === 'move_tool';

/** One line of the menu. A crewmate's line begins with their toque in their colour. Off: the reason stands under it. */
function menuLineView(button: ButtonModel, index: number): ViewNode {
  const quiet = button.intent.type === 'command' && button.intent.command.type === 'discard';
  return control(h('button.iw-menu-line', {
    key: `line-${index}`, type: 'button', role: 'menuitem', disabled: !button.enabled, class: `${quiet ? 'iw-quiet' : ''}${button.color ? ' iw-give' : ''}`.trim(),
  },
    button.color ? h('i.iw-i.iw-menu-toque', { html: toqueIcon(button.color), 'aria-hidden': 'true' }) : null,
    h('span.iw-label', null, button.label),
    button.note ? h('small.iw-note', null, button.note) : null), button.intent);
}

/**
 * The small menu of the tile `key`: its name, then one line an action. A tool's moves to another slot stand
 * together on one row. Null when no menu is open or its tile is gone. It is drawn outside the grid's own box, as
 * the sheet's last child, and `inventorymenu.ts` puts it beside its tile.
 */
export function tileMenuView(panel: InventoryModel, key: string | null): ViewNode | null {
  const tile = key === null ? undefined : tilesOf(panel).find((candidate) => candidate.key === key);
  if (!tile) return null;
  const moves = tile.buttons.filter(isSlotMove);
  const lines: ViewNode[] = [];
  tile.buttons.forEach((button, index) => {
    if (!isSlotMove(button)) lines.push(menuLineView(button, index));
    else if (button === moves[0]) {
      lines.push(h('div.iw-menu-row', { key: 'moves', role: 'group', 'aria-label': 'Move to another slot' },
        moves.map((move, at) => actionView(move, at, 'button.iw-menu-slot'))));
    }
  });
  return h('div.iw-tile-menu', { key: `menu:${tile.key}`, role: 'menu', 'aria-label': `${tile.name}: what to do`, 'data-for': tile.key },
    h('div.iw-menu-head', null, h('b', null, tile.name), tile.countText ? h('span.iw-count', null, tile.countText) : null),
    lines);
}

/** The quick presses, said in the sheet's footer, and the way back from a drop (`takeback.ts`). It stands still. */
export const QUICK_PRESS_HINT = 'Shift+click a tile: to the other side. Q with the pointer on a tile: drop it. Z takes a drop back while its note stands.';

export const inventoryHintView = (): ViewNode => h('small.iw-inv-hint', { key: 'hint' }, keyedText(QUICK_PRESS_HINT));

/** The body of the inventory panel. `shown`: the tile whose menu is open, and the tile the info panel is about. */
export function inventoryBodyView(panel: InventoryModel, shown: InventoryShown = NOTHING_SHOWN): ViewNode {
  const tiles = (slots: Slot[]): ViewNode[] => slots.map((slot) => slotView(slot, shown));
  const keyTiles = keySlots(panel);
  const read = shown.info === null ? null : tilesOf(panel).find((tile) => tile.key === shown.info) ?? null;
  return h('div.iw-body.iw-inv', { key: 'body' },
    panel.pendingRewards ? h('div.iw-reward', { key: 'reward' },
      h('div.iw-reward-text', null,
        h('span', null, panel.pendingRewards.text),
        h('div.iw-costs', null, panel.pendingRewards.items.map((item, index) =>
          h('span.iw-cost', { key: index }, itemIconView(item.itemId), item.name, ' ', h('b', null, `× ${item.count}`))))),
      actionView(panel.pendingRewards.claim, 0, 'button.iw-btn.iw-go')) : null,
    // Three columns: the buttons over the backpack, the belt over the cargo, and the info panel down the right.
    h('div.iw-columns', { key: 'columns' },
      h('div.iw-pack-actions', { key: 'actions' },
        iconButtonView(panel.stow, STOW_ICON, 'stow'), iconButtonView(panel.fillWater, BUCKET_ICON, 'scoop')),
      h('section.iw-inv-belt', { key: 'belt' },
        h('h3', null, 'Tool belt'),
        h('ul.iw-items.iw-tiles.iw-belt-tiles', null, tiles(beltSlots(panel.belt)))),
      h('section.iw-inv-pack', { key: 'pack' },
        h('h3', { key: 'pack-heading' }, panel.backpack.label),
        h('ul.iw-items.iw-tiles', { key: 'pack' }, tiles(stackSlots(panel.backpack.slots, 'backpack'))),
        keyTiles.length > 0 ? [
          h('h3.iw-next', { key: 'key-heading' }, 'Key items'),
          h('ul.iw-items.iw-tiles.iw-key-tiles', { key: 'key-items' }, tiles(keyTiles)),
        ] : null),
      h('section.iw-inv-boat', { key: 'boat' },
        h('h3', null, panel.cargo.label),
        h('ul.iw-items.iw-tiles', { class: panel.cargo.accessible ? '' : 'iw-out-of-reach' },
          tiles(stackSlots(panel.cargo.slots, 'cargo')))),
      infoView(panel, read)));
}
