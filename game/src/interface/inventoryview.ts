/**
 * The inventory, as a grid of tiles (Luc's bugfix list, round 3).
 *
 * - The backpack on the left, the canoe's cargo on the right. A stack is a square tile: the item's drawing and
 *   `x12`, and nothing else. An empty slot is an empty tile, so the room left is seen at a glance.
 * - A tile is a button. Pressed, by click or by Enter or Space, it opens what the item is and what can be done
 *   with it on a strip of its own right under the tile's row; pressed again it closes. Several may be open.
 * - At the top left, Stow all and Scoop water as drawn buttons, each with a label that stands under it while the
 *   pointer or the keyboard is on it. At the top right, the tool belt: numbered slots that answer the tool keys.
 * - Shift+click sends a tile's stack to the other side, and the drop key (Q) with the pointer on a tile drops it.
 *
 * Pure, like `views.ts`: nothing here reads the DOM, keeps state or knows a game rule. Every count, label and
 * reason comes from the model, and every control carries the intent the model gave it. Nothing moves by itself.
 */
import './inventoryview.css';
import type { BeltSlotModel, ButtonModel, InterfaceIntent, ItemSlotModel, PanelModel } from '../client/contracts.ts';
import type { ItemId } from '../data/index.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { itemIcon } from './icons.ts';
import { BUCKET_ICON, STOW_ICON } from './inventoryicons.ts';

type InventoryModel = Extract<PanelModel, { id: 'inventory' }>;

/** The groups of tiles: the two containers, the tool belt and the key items. */
export type TileGroup = 'backpack' | 'cargo' | 'belt' | 'key';

/** The key that drops the stack under the pointer. Luc's words: "hover+q to drop". */
export const DROP_KEY_CODE = 'KeyQ';

/** The name of one tile, for the tiles the player has opened. Two stacks of one item are told apart by which comes first. */
export const itemDetailKey = (group: TileGroup, itemId: ItemId, occurrence = 0): string => `${group}:${itemId}:${occurrence}`;

interface Tile {
  key: string;
  group: TileGroup;
  itemId: ItemId;
  /** Shift+click. */
  shift: InterfaceIntent | null;
  /** The drop key. */
  drop: InterfaceIntent | null;
}

/** Every tile that holds something, in the order it is drawn. */
function tilesOf(panel: InventoryModel): Tile[] {
  const tiles: Tile[] = [];
  const stacks = (group: 'backpack' | 'cargo'): void => {
    const seen = new Map<string, number>();
    for (const slot of panel[group].slots) {
      if (slot.itemId === null) continue;
      const occurrence = seen.get(slot.itemId) ?? 0;
      seen.set(slot.itemId, occurrence + 1);
      tiles.push({ key: itemDetailKey(group, slot.itemId, occurrence), group, itemId: slot.itemId, shift: slot.shift, drop: slot.drop });
    }
  };
  for (const slot of panel.belt) {
    if (slot.itemId !== null) tiles.push({ key: itemDetailKey('belt', slot.itemId), group: 'belt', itemId: slot.itemId, shift: null, drop: slot.drop });
  }
  stacks('backpack');
  for (const item of panel.keyItems) tiles.push({ key: itemDetailKey('key', item.itemId), group: 'key', itemId: item.itemId, shift: null, drop: item.drop });
  stacks('cargo');
  return tiles;
}

/** Every tile key in an inventory panel: what `open` holds when every tile is open. For tests and the interface. */
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

/** A small paper button of a tile's strip. A drop is drawn quietly, so the eye lands on the safe ones. */
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

interface TileContent {
  key: string;
  itemId: ItemId;
  /** For a screen reader, and the browser's own hover label: "Birch bark, 12". */
  label: string;
  /** In the corner: a belt slot's key. */
  corner: string;
  /** Under the drawing: `x12`, or `spare`. */
  under: string;
  /** A tool in hand. */
  held: boolean;
  /** The strip: name, how many, what it is, and its buttons. */
  name: string;
  countText: string;
  description: string;
  buttons: ButtonModel[];
}

/** One tile, and its strip right after it when it is open. The strip lies across the whole grid, under the tile's row. */
function tileView(tile: TileContent, open: ReadonlySet<string>): ViewNode[] {
  const shown = open.has(tile.key);
  const nodes = [h('li.iw-item.iw-tile', { key: tile.key, class: `${shown ? 'iw-open' : ''}${tile.held ? ' iw-held' : ''}`.trim() },
    h('button.iw-item-pick', {
      type: 'button', 'data-detail': tile.key, 'aria-expanded': String(shown), 'aria-label': tile.label, title: tile.name,
    },
    tile.corner ? h('span.iw-n', null, tile.corner) : null,
    itemIconView(tile.itemId),
    tile.under ? h('span.iw-tile-count', null, tile.under) : null))];
  if (shown) {
    nodes.push(h('li.iw-item-detail', { key: `${tile.key}:detail` },
      h('div.iw-item-head', null, h('b', null, tile.name), tile.countText ? h('span.iw-count', null, tile.countText) : null),
      h('small.iw-item-about', null, tile.description),
      tile.buttons.length > 0 ? h('div.iw-actions', null, tile.buttons.map((button, index) => actionView(button, index))) : null));
  }
  return nodes;
}

const emptyTileView = (key: string, corner = ''): ViewNode =>
  h('li.iw-item.iw-tile.iw-blank', { key, 'aria-label': 'Empty slot' }, corner ? h('span.iw-n', null, corner) : null);

function stackTiles(slots: ItemSlotModel[], group: 'backpack' | 'cargo', open: ReadonlySet<string>): ViewNode[] {
  const seen = new Map<string, number>();
  return slots.flatMap((slot, index) => {
    if (slot.itemId === null) return [emptyTileView(`empty-${index}`)];
    const occurrence = seen.get(slot.itemId) ?? 0;
    seen.set(slot.itemId, occurrence + 1);
    return tileView({
      key: itemDetailKey(group, slot.itemId, occurrence), itemId: slot.itemId, label: `${slot.name}, ${slot.count}`, corner: '',
      under: `x${slot.count}`, held: false, name: slot.name, countText: `x${slot.count}`, description: slot.description, buttons: slot.buttons,
    }, open);
  });
}

function beltTiles(belt: BeltSlotModel[], open: ReadonlySet<string>): ViewNode[] {
  return belt.flatMap((slot) => {
    if (slot.itemId === null) return [emptyTileView(`empty-${slot.slot}`, slot.keyLabel)];
    const where = slot.keyLabel ? `Slot ${slot.keyLabel}` : 'Spare slot';
    return tileView({
      key: itemDetailKey('belt', slot.itemId), itemId: slot.itemId, label: `${where}: ${slot.name}${slot.selected ? ', in hand' : ''}`,
      corner: slot.keyLabel, under: slot.keyLabel ? '' : 'spare', held: slot.selected, name: slot.name,
      countText: slot.selected ? 'in hand' : '', description: slot.description, buttons: slot.buttons,
    }, open);
  });
}

/** The body of the inventory panel. `open`: the tiles the player has opened (`itemDetailKey`). */
export function inventoryBodyView(panel: InventoryModel, open: ReadonlySet<string>): ViewNode {
  return h('div.iw-body.iw-inv', { key: 'body' },
    panel.pendingRewards ? h('div.iw-reward', { key: 'reward' },
      h('div.iw-reward-text', null,
        h('span', null, panel.pendingRewards.text),
        h('div.iw-costs', null, panel.pendingRewards.items.map((item, index) =>
          h('span.iw-cost', { key: index }, itemIconView(item.itemId), item.name, ' ', h('b', null, `× ${item.count}`))))),
      actionView(panel.pendingRewards.claim, 0, 'button.iw-btn.iw-go')) : null,
    // Two columns, two rows: the buttons and the belt on top, the backpack and the cargo under them.
    h('div.iw-columns', { key: 'columns' },
      h('div.iw-pack-actions', { key: 'actions' },
        iconButtonView(panel.stow, STOW_ICON, 'stow'), iconButtonView(panel.fillWater, BUCKET_ICON, 'scoop')),
      h('section.iw-inv-belt', { key: 'belt' },
        h('h3', null, 'Tool belt'),
        h('ul.iw-items.iw-tiles.iw-belt-tiles', null, beltTiles(panel.belt, open))),
      h('section.iw-inv-pack', { key: 'pack' },
        h('h3', { key: 'pack-heading' }, panel.backpack.label),
        h('ul.iw-items.iw-tiles', { key: 'pack' }, stackTiles(panel.backpack.slots, 'backpack', open)),
        panel.keyItems.length > 0 ? [
          h('h3.iw-next', { key: 'key-heading' }, 'Key items'),
          h('ul.iw-items.iw-tiles.iw-key-tiles', { key: 'key-items' }, panel.keyItems.flatMap((item) => tileView({
            key: itemDetailKey('key', item.itemId), itemId: item.itemId, label: `${item.name}, ${item.count}`, corner: '',
            under: `x${item.count}`, held: false, name: item.name, countText: `x${item.count}`, description: item.description, buttons: [],
          }, open))),
        ] : null),
      h('section.iw-inv-boat', { key: 'boat' },
        h('h3', null, panel.cargo.label),
        h('ul.iw-items.iw-tiles', { class: panel.cargo.accessible ? '' : 'iw-out-of-reach' },
          stackTiles(panel.cargo.slots, 'cargo', open)))));
}
