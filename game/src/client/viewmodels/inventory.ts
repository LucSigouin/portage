/**
 * The inventory panel: the backpack and the canoe's cargo as grids of tiles, the tool belt in this player's own
 * order, the key items, and the two buttons at the top (Luc's bugfix list, round 3).
 *
 * Every tile carries what a click opens (its name, what it is, its buttons) and what the two quick ways send:
 * Shift+click moves the whole stack to the other side, and the drop key with the pointer on the tile drops it.
 * Both are sent to the rules as they are. The rules move what fits, and refuse a drop of a tool, a key item or
 * what an open quest still asks for, so a guest's screen and the host's are told the same thing.
 */
import { ITEMS, QUESTS, STATIONS } from '../../data/index.ts';
import {
  NUMBERED_BELT_SLOTS, beltOf, playerOf, questHolding, roomFor, selectInventory,
} from '../../sim/index.ts';
import type { Command, CommandResult, Container, GameState, InventoryView, ItemStack, PlayerId } from '../../sim/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import { DEFAULT_KEY_BINDINGS } from '../../settings/index.ts';
import type { InputAction, KeyBindings } from '../../settings/index.ts';
import { countedName, itemName, keyLabel } from './format.ts';
import type { BeltSlotModel, ButtonModel, ItemSlotModel, PanelModel } from './types.ts';

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

function itemSlots(
  stacks: ItemStack[], capacity: number, container: Container, inventory: InventoryView, state: GameState,
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
        usable,
      ));
    }
    const move = command({ type: 'transfer', from: container, itemId: stack.itemId, count: stack.count });
    const room = toCargo
      ? roomFor(inventory.cargo, inventory.cargoSlots, stack.itemId)
      : roomFor(inventory.backpack, inventory.backpackSlots, stack.itemId);
    let moveNote: string | null = null;
    if (!inventory.cargoAccessible) moveNote = 'The canoe is out of reach';
    else if (room === 0) moveNote = toCargo ? 'The canoe is full' : 'The backpack is full';
    else if (room < stack.count) moveNote = `Room for ${room}`;
    buttons.push(button(toCargo ? 'To cargo' : 'To backpack', move, inventory.cargoAccessible && room > 0, moveNote));
    const drop = command({ type: 'discard', from: container, itemId: stack.itemId, count: stack.count });
    const holding = questHolding(state, stack.itemId, stack.count);
    buttons.push(button('Drop', drop, usable && holding === null, holding ? `Kept for ${QUESTS[holding].name}` : null));
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
    slots.push({
      slot, keyLabel: slotLabel(bindings, slot), toolId, itemId: toolId, name: ITEMS[toolId].name,
      description: ITEMS[toolId].description, selected, buttons,
      // The rules refuse it and say why: a tool is never dropped.
      drop: command({ type: 'discard', from: 'backpack', itemId: toolId, count: 1 }),
    });
  });
  return slots;
}

/** `bindings` are the keys as they are bound now, for the numbers on the belt. */
export function buildInventoryPanel(state: GameState, playerId: PlayerId = 0, bindings: KeyBindings = DEFAULT_KEY_BINDINGS): InventoryBody {
  const inventory = selectInventory(state, playerId);
  const rewards = inventory.pendingRewards;
  return {
    id: 'inventory',
    backpack: {
      label: `Backpack ${inventory.backpack.length} / ${inventory.backpackSlots}`,
      slots: itemSlots(inventory.backpack, inventory.backpackSlots, 'backpack', inventory, state),
    },
    cargo: {
      label: `Canoe cargo ${inventory.cargo.length} / ${inventory.cargoSlots}${inventory.cargoAccessible ? '' : ' (out of reach)'}`,
      slots: itemSlots(inventory.cargo, inventory.cargoSlots, 'cargo', inventory, state),
      accessible: inventory.cargoAccessible,
    },
    belt: beltSlots(state, playerId, bindings),
    keyItems: inventory.keyItems.map(({ itemId, count }) => ({
      itemId, name: itemName(itemId), count, description: ITEMS[itemId].description,
      // The rules refuse it and say why: a key item is never dropped.
      drop: command({ type: 'discard', from: 'backpack', itemId, count }),
    })),
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
  if (sent.type !== 'transfer' || !result.ok) return null;
  const moved = result.gained.find((entry) => entry.itemId === sent.itemId)?.count ?? 0;
  if (moved <= 0 || moved >= sent.count) return null;
  const full = sent.from === 'backpack' ? 'The canoe is full' : 'The backpack is full';
  return `${full}: ${moved} of ${sent.count} ${itemName(sent.itemId)} moved, ${sent.count - moved} stayed.`;
}
