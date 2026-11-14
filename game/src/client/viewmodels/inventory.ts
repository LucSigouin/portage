/**
 * The inventory panel: the backpack and the canoe's cargo as grids of tiles, the tool belt in this player's own
 * order, the key items, and the two buttons at the top (Luc's bugfix list, round 3).
 *
 * Every tile carries what a click opens (its name, what it is, its buttons) and what the two quick ways send:
 * Shift+click moves the whole stack to the other side, and the drop key with the pointer on the tile drops it.
 * Both are sent to the rules as they are. The rules move what fits, and refuse a drop of a tool, a key item or
 * what an open quest still asks for, so a guest's screen and the host's are told the same thing.
 *
 * Round 4 (Luc: "clicking on it open a small hover menu to either eat or drop"): a tile's `buttons` are the lines
 * of the small menu a click opens at the tile. Eat or Drink, Hold or Put away, Stow or Take (what Shift+click
 * does), one Give line for each crewmate in reach (`sim/give.ts`), Drop. A line the rules would refuse is still
 * there, off, with the reason under it: the same way on every tile. The one exception is Give: with nobody in
 * reach there is no Give line at all. `info` is what the panel on the right says each item is for.
 */
import { ITEMS, QUESTS, STATIONS } from '../../data/index.ts';
import {
  NUMBERED_BELT_SLOTS, beltOf, crewInGiveReach, giveRoom, playerOf, questHolding, roomFor, selectInventory,
} from '../../sim/index.ts';
import type { Command, CommandResult, Container, GameState, InventoryView, ItemStack, PlayerId, PlayerState } from '../../sim/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import { DEFAULT_KEY_BINDINGS } from '../../settings/index.ts';
import type { InputAction, KeyBindings } from '../../settings/index.ts';
import { countedName, failureText, itemName, keyLabel } from './format.ts';
import { crewTag } from './hud.ts';
import { itemInfo, questLines } from './iteminfo.ts';
import type { BeltSlotModel, ButtonModel, ItemInfoModel, ItemSlotModel, PanelModel } from './types.ts';
import type { ItemId } from '../../data/index.ts';

type InventoryBody = Omit<Extract<PanelModel, { id: 'inventory' }>, 'title' | 'close'>;

const command = (value: Command): InterfaceIntent => ({ type: 'command', command: value });

const button = (label: string, intent: InterfaceIntent, enabled = true, note: string | null = null): ButtonModel => ({
  label, intent, enabled, note,
});

const BELT_ACTIONS: readonly InputAction[] = ['tool1', 'tool2', 'tool3', 'tool4', 'tool5'];

/** What a belt slot is called: the key that picks it, or its number when the key is unbound. Empty for a spare slot. */
function slotLabel(bindings: KeyBindings, slot: number): string {
  if (slot >= NUMBERED_BELT_SLOTS) return '';
  const keys = bindings[BELT_ACTIONS[slot]];
  return keys.length > 0 ? keyLabel(keys[0]) : String(slot + 1);
}

/** Why a tool and a key item have no drop: the rules' own words for it, without the full stop. */
const KEPT_ON_BELT = failureText('tool_kept', null).replace(/\.$/, '');
const KEPT_BY_CREW = failureText('key_item_kept', null).replace(/\.$/, '');
const OUT_OF_REACH = 'The canoe is out of reach';

/** One Give line for each crewmate in reach: their name, their colour, and whether their backpack has room. */
function giveButtons(stack: ItemStack, crew: readonly PlayerState[]): ButtonModel[] {
  return crew.map((other) => {
    const tag = crewTag(other);
    const room = giveRoom(other, stack.itemId);
    let note: string | null = null;
    if (room === 0) note = 'Their backpack is full';
    else if (room < stack.count) note = `Room for ${room}`;
    return {
      ...button(`Give to ${tag.label}`, command({ type: 'give', to: other.id, itemId: stack.itemId, count: stack.count }), room > 0, note),
      color: tag.color,
    };
  });
}

function itemSlots(
  stacks: ItemStack[], capacity: number, container: Container, inventory: InventoryView, state: GameState, crew: readonly PlayerState[],
): ItemSlotModel[] {
  const toCargo = container === 'backpack';
  const usable = container === 'backpack' || inventory.cargoAccessible;
  const slots: ItemSlotModel[] = stacks.map((stack) => {
    const definition = ITEMS[stack.itemId];
    const buttons: ButtonModel[] = [];
    if (definition.edible) {
      buttons.push(button(
        definition.isDrink ? 'Drink' : 'Eat',
        command(definition.isDrink ? { type: 'drink', itemId: stack.itemId } : { type: 'eat', itemId: stack.itemId }),
        usable, usable ? null : OUT_OF_REACH,
      ));
    }
    const move = command({ type: 'transfer', from: container, itemId: stack.itemId, count: stack.count });
    const room = toCargo
      ? roomFor(inventory.cargo, inventory.cargoSlots, stack.itemId)
      : roomFor(inventory.backpack, inventory.backpackSlots, stack.itemId);
    let moveNote: string | null = null;
    if (!inventory.cargoAccessible) moveNote = OUT_OF_REACH;
    else if (room === 0) moveNote = toCargo ? 'The canoe is full' : 'The backpack is full';
    else if (room < stack.count) moveNote = `Room for ${room}`;
    // Stow: into the canoe. Take: out of it. The same move as Shift+click on the tile.
    buttons.push(button(toCargo ? 'Stow' : 'Take', move, inventory.cargoAccessible && room > 0, moveNote));
    // A give is from a backpack only.
    if (toCargo) buttons.push(...giveButtons(stack, crew));
    const drop = command({ type: 'discard', from: container, itemId: stack.itemId, count: stack.count });
    const holding = questHolding(state, stack.itemId, stack.count);
    let dropNote: string | null = null;
    if (holding) dropNote = `Kept for ${QUESTS[holding].name}`;
    else if (!usable) dropNote = OUT_OF_REACH;
    buttons.push(button('Drop', drop, usable && holding === null, dropNote));
    return {
      itemId: stack.itemId, name: definition.name, count: stack.count, description: definition.description, buttons,
      shift: move, drop,
    };
  });
  while (slots.length < capacity) slots.push({ itemId: null, name: '', count: 0, description: '', buttons: [], shift: null, drop: null });
  return slots;
}

/**
 * The belt as this player has laid it out: the numbered slots always, a spare slot only while a tool is on it.
 * A tool's buttons: take it in hand or put it away, then one button a numbered slot it is not on.
 */
function beltSlots(state: GameState, playerId: PlayerId, bindings: KeyBindings): BeltSlotModel[] {
  const player = playerOf(state, playerId);
  const belt = beltOf(state, player);
  const slots: BeltSlotModel[] = [];
  belt.forEach((toolId, slot) => {
    if (toolId === null) {
      if (slot < NUMBERED_BELT_SLOTS) {
        slots.push({ slot, keyLabel: slotLabel(bindings, slot), toolId: null, itemId: null, name: '', description: '', selected: false, buttons: [], drop: null });
      }
      return;
    }
    const selected = toolId === player.selectedTool;
    const buttons: ButtonModel[] = [
      button(selected ? 'Put away' : 'Hold', command({ type: 'select_tool', toolId: selected ? null : toolId })),
    ];
    for (let target = 0; target < NUMBERED_BELT_SLOTS; target += 1) {
      if (target !== slot) buttons.push(button(`To ${slotLabel(bindings, target)}`, command({ type: 'move_tool', toolId, slot: target })));
    }
    // The rules refuse it and say why: a tool is never dropped. The menu's Drop line is there, off, saying so.
    const drop = command({ type: 'discard', from: 'backpack', itemId: toolId, count: 1 });
    buttons.push(button('Drop', drop, false, KEPT_ON_BELT));
    slots.push({
      slot, keyLabel: slotLabel(bindings, slot), toolId, itemId: toolId, name: ITEMS[toolId].name,
      description: ITEMS[toolId].description, selected, buttons, drop,
    });
  });
  return slots;
}

/** `bindings` are the keys as they are bound now, for the numbers on the belt. */
export function buildInventoryPanel(state: GameState, playerId: PlayerId = 0, bindings: KeyBindings = DEFAULT_KEY_BINDINGS): InventoryBody {
  const inventory = selectInventory(state, playerId);
  const rewards = inventory.pendingRewards;
  const crew = crewInGiveReach(state, playerOf(state, playerId));
  const backpack = itemSlots(inventory.backpack, inventory.backpackSlots, 'backpack', inventory, state, crew);
  const cargo = itemSlots(inventory.cargo, inventory.cargoSlots, 'cargo', inventory, state, crew);
  const belt = beltSlots(state, playerId, bindings);
  // What the info panel says of each item on the sheet: once an item, however many stacks of it there are.
  const info: Partial<Record<ItemId, ItemInfoModel>> = {};
  const describe = (itemId: ItemId | null): void => {
    if (itemId === null || info[itemId]) return;
    const fixed = itemInfo(itemId);
    const asked = questLines(state, itemId);
    info[itemId] = asked.length > 0 ? { kind: fixed.kind, uses: [...asked, ...fixed.uses] } : fixed;
  };
  for (const slot of belt) describe(slot.itemId);
  for (const slot of backpack) describe(slot.itemId);
  for (const item of inventory.keyItems) describe(item.itemId);
  for (const slot of cargo) describe(slot.itemId);
  return {
    id: 'inventory',
    backpack: {
      label: `Backpack ${inventory.backpack.length} / ${inventory.backpackSlots}`,
      slots: backpack,
    },
    cargo: {
      label: `Canoe cargo ${inventory.cargo.length} / ${inventory.cargoSlots}${inventory.cargoAccessible ? '' : ' (out of reach)'}`,
      slots: cargo,
      accessible: inventory.cargoAccessible,
    },
    belt,
    keyItems: inventory.keyItems.map(({ itemId, count }) => {
      // The rules refuse it and say why: a key item is never dropped. The menu's one line says so.
      const drop = command({ type: 'discard', from: 'backpack', itemId, count });
      return { itemId, name: itemName(itemId), count, description: ITEMS[itemId].description, drop, buttons: [button('Drop', drop, false, KEPT_BY_CREW)] };
    }),
    info,
    stow: button(
      'Stow all in the canoe', command({ type: 'stow_backpack' }),
      inventory.cargoAccessible && inventory.backpack.length > 0,
      inventory.cargoAccessible ? null : 'The canoe is out of reach',
    ),
    fillWater: button(
      'Scoop water', command({ type: 'fill_water', count: 1 }), inventory.tools.includes('bailing_can'),
      'Dirty water. Boil it at a fire before drinking.',
    ),
    pendingRewards: rewards.length === 0 ? null : {
      text: `Waiting for room: ${rewards.map((stack) => countedName(stack.itemId, stack.count)).join(', ')}`,
      items: rewards.map((stack) => ({ itemId: stack.itemId, name: itemName(stack.itemId), count: stack.count })),
      claim: button('Claim', command({ type: 'claim_rewards' })),
    },
    stationsText: `In reach: ${inventory.stations.map((station) => STATIONS[station].name.toLowerCase()).join(', ')}`,
  };
}

// --- Said once ---------------------------------------------------------------------------

/**
 * The line for a stack that only went over in part: the other side was full. Null for anything else. Said once,
 * by whoever sent the move: the rules' answer carries how many went.
 */
export function partMovedText(sent: Command, result: CommandResult): string | null {
  if (sent.type === 'give' && result.ok) {
    // A give that only fitted in part: the note from the rules says how many went, this one says why not all.
    const given = result.spent.find((entry) => entry.itemId === sent.itemId)?.count ?? 0;
    if (given <= 0 || given >= sent.count) return null;
    return `Their backpack is full: ${given} of ${sent.count} ${itemName(sent.itemId)} given, ${sent.count - given} stayed.`;
  }
  if (sent.type !== 'transfer' || !result.ok) return null;
  const moved = result.gained.find((entry) => entry.itemId === sent.itemId)?.count ?? 0;
  if (moved <= 0 || moved >= sent.count) return null;
  const full = sent.from === 'backpack' ? 'The canoe is full' : 'The backpack is full';
  return `${full}: ${moved} of ${sent.count} ${itemName(sent.itemId)} moved, ${sent.count - moved} stayed.`;
}
