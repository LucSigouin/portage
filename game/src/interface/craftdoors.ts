/**
 * The crafting panel's row of cards, in the Ink & Wash hand (Luc, Round 4).
 *
 * C lists hand crafts only. In a camp, a row of cards stands across the top of the panel: the hands, then one card
 * for each station of that camp (the campfire, the stump bench, Tink's hearth and forge). A click on a card shows
 * that station's own menu. Switching is a plain swap, as in the boat's menu: no slide and no fade.
 *
 * Pure, like `views.ts`: every word and every intent comes from the model.
 */
import './craftdoors.css';
import type { CraftDoorKind, CraftDoorModel } from '../client/viewmodels/handcraft.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { STATION_KIND_ICON } from './stationicons.ts';

const RUST = 'var(--iw-rust)';
const OCHRE = 'var(--iw-ochre)';

const line = (d: string): string => `<path d="${d}"/>`;
const tint = (d: string, colour: string): string => `<path d="${d}" fill="${colour}"/>`;

/** One pen weight on the 24-unit grid with a patch of wash behind, as `stationicons.ts` draws. */
const drawn = (pen: string, wash: string, washColour: string): string =>
  `<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true"><g class="iw-wash" fill="${washColour}">${wash}</g>`
  + `<g class="iw-pen">${pen}</g></svg>`;

const FLAME = 'M12 2.600c.8 2.700 3.300 3.800 3.300 6.600a3.300 3.300 0 0 1-6.600 0c0-1.800 1.200-2.500 1.600-4.100.6.600 1.400-.800 1.700-2.500Z';
const LOGS = 'M4.400 19.400 19.600 14.600M4.400 14.600l15.200 4.800';
const STUMP_TOP = 'M5.500 9.200a6.500 2.400 0 1 0 13 0a6.500 2.400 0 1 0-13 0Z';
const STUMP_SIDE = 'M5.500 9.200v8.200c0 1.300 2.900 2.400 6.500 2.400s6.500-1.100 6.500-2.400V9.200';

/** A campfire: a flame over two crossed logs, on the ground. */
const CAMPFIRE_ICON = drawn(
  line(FLAME) + line('M12 8.200c.5.800 1.100 1.200 1.100 2a1.100 1.100 0 0 1-2.200 0c0-.700.600-1 1.100-2Z') + line(LOGS) + line('M3.200 21.400h17.600'),
  tint(FLAME, OCHRE) + line('M4.400 19.400 12 17l7.600 2.400Z'), RUST,
);

/** The stump bench: a cut stump, its rings, a root each side. */
const STUMP_ICON = drawn(
  line(STUMP_TOP) + line(STUMP_SIDE) + line('M9.400 9.200a2.600.9 0 1 0 5.200 0a2.600.9 0 1 0-5.200 0Z')
  + line('M5.500 17.400 3.400 20.600M18.500 17.400l2.100 3.200') + line('M9 13.400v3.200M15.200 12.800v2.400'),
  line(`${STUMP_SIDE}Z`), OCHRE,
);

/** A card's drawing: the thing as it stands in the camp. The hearth, the smoker and the forge are the boat menu's. */
export const CRAFT_DOOR_ICON: Record<CraftDoorKind, string> = {
  hands: STATION_KIND_ICON.hands,
  campfire: CAMPFIRE_ICON,
  hearth: STATION_KIND_ICON.fire,
  bench: STUMP_ICON,
  smoker: STATION_KIND_ICON.smoker,
  forge: STATION_KIND_ICON.forge,
};

/** The line under the cards that says what their red ! means. */
export const CRAFT_DOORS_KEY = 'on a card: a quest wants something made there.';

/** The red ! on a card: the same mark the recipes carry, named by the quest. */
const questMark = (questText: string): ViewNode | null => (questText
  ? h('b.iw-quest-mark', { key: 'quest', title: questText, 'aria-label': questText }, '!')
  : null);

/**
 * The row of cards, or nothing away from a camp. The card of the menu that is open is ruled in ink and underlined.
 * `data-craft-tab` names each.
 */
export function craftDoorsView(doors: CraftDoorModel[]): ViewNode | null {
  if (doors.length === 0) return null;
  return h('nav.iw-craft-doors', { key: 'craft-doors', 'aria-label': 'What to craft with' },
    doors.map((door) => control(h('button.iw-craft-door', {
      key: door.tab, type: 'button', class: door.selected ? 'iw-on' : '', 'data-craft-tab': door.tab,
      'aria-current': door.selected ? 'page' : null, title: `${door.label}. ${door.about}`,
    },
    h('i.iw-i.iw-craft-ico', { html: CRAFT_DOOR_ICON[door.kind], 'aria-hidden': 'true' }),
    h('span.iw-label', null, door.label),
    questMark(door.questText)), door.intent)),
  // What the red ! means, while a card carries one (the master review of round 4, finding 6). It stands still.
  doors.some((door) => door.questText) ? h('small.iw-craft-doors-key', { key: 'quest-key' },
    h('b.iw-craft-key-mark', { 'aria-hidden': 'true' }, '!'), CRAFT_DOORS_KEY) : null);
}

/** The quiet line under the hand crafts: where the rest is made. */
export const craftRestView = (text: string): ViewNode | null => (text ? h('p.iw-craft-rest', { key: 'rest' }, text) : null);
