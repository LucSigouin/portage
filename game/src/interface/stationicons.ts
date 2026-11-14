/**
 * The icons of the boat's menu, drawn in the Ink & Wash hand of `icons.ts`: one pen weight on a 24-unit grid, a
 * patch of wash behind, the theme's inks, and nothing that moves. One for the canoe builder and one for each
 * crafting attachment: each is the thing itself as it stands on the canoe, so it reads at a glance.
 */
import type { AttachmentId } from '../data/index.ts';

const RUST = 'var(--iw-rust)';
const OCHRE = 'var(--iw-ochre)';
const GREY = 'var(--iw-ink-soft)';

const line = (d: string): string => `<path d="${d}"/>`;
const tint = (d: string, colour: string): string => `<path d="${d}" fill="${colour}"/>`;
const dot = (x: number, y: number): string => `<circle cx="${x}" cy="${y}" r=".55" class="iw-dot"/>`;

const drawn = (pen: string, wash: string, washColour: string): string =>
  `<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true"><g class="iw-wash" fill="${washColour}">${wash}</g>`
  + `<g class="iw-pen">${pen}</g></svg>`;

const FLAME = 'M12 2.6c.8 2.7 3.3 3.8 3.3 6.6a3.300 3.300 0 0 1-6.600 0c0-1.800 1.200-2.500 1.600-4.100.6.600 1.400-.800 1.700-2.500Z';
const HEARTH = 'M5 12.600h14l-1.200 6.800H6.200Z';
const BENCH_TOP = 'M2.600 10.400h18.800v2.600H2.600Z';
const SMOKE_BOX = 'M6 20.800V11.400l6-3.400 6 3.400v9.400Z';
const ANVIL = 'M3.400 9.200h13.200c.300 1.700 1.500 2.700 3.800 2.900v1.300h-6.500c-.6 1.600-.5 3.100.5 4.500h2.200v2.500H6.800v-2.500H9c1-1.400 1.100-2.900.5-4.500-3.100-.3-5.400-1.700-6.100-4.200Z';
const HULL = 'M2.500 13.800c2.800 1.300 6 1.900 9.500 1.900s6.700-.6 9.500-1.900c-1.200 4.200-4.700 6.600-9.500 6.600s-8.300-2.400-9.500-6.600Z';
const HAMMER_HEAD = 'M8.600 5.300 13 3l1.500 2.700-4.400 2.300Z';

/** The canoe builder: the hull, and a hammer over it. */
export const BUILDER_ICON = drawn(
  line(HULL) + line('M8.300 15.500v4.300M15.700 15.500v4.300') + line(HAMMER_HEAD) + line('M11.800 6.700l3.600 5.700') + line('M14.600 12.900l1.700-1'),
  line(HULL) + tint(HAMMER_HEAD, GREY), RUST,
);

/** One per crafting attachment. A part with no drawing here falls back to the builder's (`stationIcon`). */
const STATION_ICONS: Partial<Record<AttachmentId, string>> = {
  // A clay hearth on its stone slab, and the fire in it.
  firebox: drawn(
    line(FLAME) + line('M12 8.200c.5.800 1.100 1.200 1.100 2a1.100 1.100 0 0 1-2.200 0c0-.700.600-1 1.100-2Z')
    + line(HEARTH) + line('M3.200 21.400h17.600') + line('M8.600 15.800h2.600M13 17.400h2.800M7.600 19.400h3'),
    tint(FLAME, OCHRE) + line(HEARTH), RUST,
  ),
  // A bench on splayed legs, a vice on its end, a board on top.
  workbench: drawn(
    line(BENCH_TOP) + line('M5.600 13 4.400 21M18.400 13l1.200 8M5 17.800h14')
    + line('M14.800 10.400V6.800h3.600v3.600M12.400 8.400h2.400M12.400 7.200v2.400') + line('M4.200 10.400 5 8.200h6.200'),
    line(BENCH_TOP) + line('M4.200 10.400 5 8.200h6.200v2.200Z'), OCHRE,
  ),
  // A clay smoke box with a peaked lid, a fish on its hook in the door, smoke curling off the top.
  smoker: drawn(
    line(SMOKE_BOX) + line('M9.400 20.800v-6.200h5.200v6.200') + line('M12 14.600v1.200M12 20c-1.400-1-1.400-2.800 0-4.200 1.400 1.400 1.400 3.200 0 4.200Z')
    + line('M10.400 5.600c-1.300-1 .9-1.800-.3-3.200M14.200 6.200c-1.100-.9.800-1.600-.2-2.900'),
    line(SMOKE_BOX), RUST,
  ),
  // An anvil, and sparks flying off it.
  forge: drawn(
    line(ANVIL) + line('M9.600 6.400 8.400 4.200M12.600 5.800V3M15.400 6.400l1.400-2.200') + dot(6.400, 5.600) + dot(18.600, 6.400),
    line(ANVIL) + tint('M8 6.800 12.600 2.600l4.600 4.200Z', OCHRE), GREY,
  ),
};

/** The attachments that have a drawing of their own, for the tests. */
export const STATION_ICON_IDS = Object.keys(STATION_ICONS) as AttachmentId[];

/** The icon of a tab of the boat's menu: the canoe builder, or a crafting attachment. */
export const stationIcon = (tab: 'builder' | AttachmentId): string => (tab === 'builder' ? BUILDER_ICON : STATION_ICONS[tab] ?? BUILDER_ICON);

/** An open hand, for what is made with no station at all (the crafting panel, Round 4). */
const HAND = 'M9.500 21v-3.600L6.600 13.800c-.800-1.100.700-2.300 1.600-1.400l1.500 1.500V6c0-1.300 1.900-1.300 1.900 0v5.200V4.300c0-1.300 1.900-1.300 1.900 0v6.900V4.900'
  + 'c0-1.300 1.900-1.300 1.900 0v6.500V7.200c0-1.300 1.900-1.300 1.900 0v7.600c0 2.500-.500 4.400-1.300 6.200Z';
const HAND_ICON = drawn(line(HAND), line(HAND), OCHRE);

/** The same marks for the crafting panel's lines about a station that is not here: a fire, a bench, a smoker, a forge. */
export const STATION_KIND_ICON: Record<'hands' | 'fire' | 'bench' | 'smoker' | 'forge', string> = {
  hands: HAND_ICON,
  fire: STATION_ICONS.firebox!,
  bench: STATION_ICONS.workbench!,
  smoker: STATION_ICONS.smoker!,
  forge: STATION_ICONS.forge!,
};
