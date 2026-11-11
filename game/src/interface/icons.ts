/**
 * Ink & Wash icons: loose pen strokes with a watercolour dab behind them.
 * Every icon is inline SVG markup on a 24-unit grid, drawn here in code.
 * Carried over from the approved B2 study; the tools the study did not have
 * (knife, pry bar, saw, wrench), the map marks and every item of the game
 * are drawn in the same hand: one pen weight, the theme's inks and washes,
 * and nothing that moves.
 */
import type { ItemId } from '../data/index.ts';

const RUST = 'var(--iw-rust)';
const WATER = 'var(--iw-water)';
const OCHRE = 'var(--iw-ochre)';
const SAGE = 'var(--iw-sage)';
/** Weathered wood and granite. */
const GREY = 'var(--iw-ink-soft)';
/** Pitch, charcoal, lodestone. */
const INK = 'var(--iw-ink)';
/** Birch bark, glass, a mushroom's stem. */
const BRIGHT = 'var(--iw-paper-bright)';
/** Flood water. */
const MUD = 'var(--iw-ochre-deep)';

/** A pen stroke, or a patch of wash in the icon's own colour. */
const line = (d: string): string => `<path d="${d}"/>`;
/** A patch of wash in another colour than the icon's own. */
const tint = (d: string, colour: string): string => `<path d="${d}" fill="${colour}"/>`;
/** A full stop of ink: an eye, a seed, a rivet. */
const dot = (x: number, y: number): string => `<circle cx="${x}" cy="${y}" r=".55" class="iw-dot"/>`;

const drawn = (pen: string, wash: string, washColour: string): string =>
  `<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true"><g class="iw-wash" fill="${washColour}">${wash}</g>`
  + `<g class="iw-pen">${pen}</g></svg>`;

export const ICON = {
  hunger: drawn(
    '<path d="M2.6 12C5.8 7.2 12.8 6.8 17.2 12 12.9 17 5.9 17 2.6 12Z"/><path d="M17 12l4.2-3.7c-.6 2.5-.5 5 .1 7.3Z"/>'
    + '<path d="M8.6 9.4c.9 1.6.9 3.4 0 5"/><circle cx="6" cy="11.3" r=".55" class="iw-dot"/>',
    '<path d="M3 12.2C6 7 13 7 17 12c-4 5.2-11 5-14 .2Z"/>', RUST,
  ),
  thirst: drawn(
    '<path d="M12 2.8C9.2 7.8 6.3 10.8 6.3 14.5a5.7 5.7 0 0 0 11.4 0c0-3.7-2.9-6.7-5.7-11.7Z"/><path d="M9.2 14.6c.1 1.5 1 2.6 2.3 3"/>',
    '<path d="M12 3.4C9.4 8 6.8 11 6.8 14.4a5.2 5.2 0 0 0 10.4 0c0-3.4-2.6-6.4-5.2-11Z"/>', WATER,
  ),
  energy: drawn(
    '<path d="M12 3c1 4 5.1 5.8 5.1 10.5a5.1 5.1 0 0 1-10.2 0c0-2.9 2-3.8 2.5-6.5 1 .9 2.2-1.3 2.6-4Z"/>'
    + '<path d="M12 12c.8 1.2 1.7 1.8 1.7 3.1a1.7 1.7 0 0 1-3.4 0c0-1 .9-1.5 1.7-3.1Z"/><path d="M4.5 20.6l15-2.3M4.5 18.2l15 2.5"/>',
    '<path d="M12 3.6c1 3.6 4.6 5.6 4.6 10a4.6 4.6 0 0 1-9.2 0c0-2.6 1.8-3.6 2.3-6 .9.7 1.9-1.4 2.3-4Z"/>', OCHRE,
  ),
  flag: drawn(
    '<path d="M6.8 3v18"/><path d="M6.8 4.3c3.7-1.6 6.3 1.9 10.4.3v7.2c-4.1 1.6-6.7-1.9-10.4-.3"/>',
    '<path d="M7 4.5c3.5-1.5 6 1.8 10 .3v7c-4 1.5-6.5-1.8-10-.3Z"/>', RUST,
  ),
  canoe: drawn(
    '<path d="M2.5 10.6c2.800 1.300 6 1.900 9.500 1.900s6.700-.6 9.500-1.900c-1.200 4.200-4.700 6.600-9.500 6.600s-8.300-2.400-9.500-6.600Z"/>'
    + '<path d="M8.300 12.300v4.300M15.700 12.300v4.300"/>',
    '<path d="M3.200 11.300c2.600 1.100 5.600 1.600 8.800 1.600s6.200-.5 8.800-1.600c-1.300 3.500-4.500 5.500-8.800 5.500s-7.500-2-8.800-5.500Z"/>', RUST,
  ),
  camp: drawn(
    '<path d="M3.400 19.600 12 5.200l8.600 14.400Z"/><path d="M12 12.600 9.400 19.600M12 12.600l2.600 7"/><path d="M10.700 3.200 12 5.200l1.300-2"/>',
    '<path d="M4.300 19.100 12 6.200l7.700 12.900Z"/>', OCHRE,
  ),
  person: drawn(
    '<circle cx="12" cy="7.600" r="3.300"/><path d="M5.400 20.600c.4-4.700 2.900-7.400 6.600-7.400s6.200 2.700 6.600 7.400"/>',
    '<circle cx="12" cy="7.600" r="2.900"/><path d="M6 20.200c.5-4.200 2.700-6.500 6-6.500s5.500 2.300 6 6.500Z"/>', SAGE,
  ),
  you: drawn(
    '<circle cx="12" cy="12" r="5.200"/><circle cx="12" cy="12" r="1.300" class="iw-dot"/><path d="M12 2.600v3M12 18.400v3M2.600 12h3M18.400 12h3"/>',
    '<circle cx="12" cy="12" r="4.700"/>', RUST,
  ),
  moon: drawn(
    '<path d="M17.600 14.900A7.400 7.400 0 1 1 9.100 4.400a6.100 6.100 0 0 0 8.500 10.500Z"/>',
    '<path d="M17 14.600A6.900 6.900 0 1 1 9.300 5a6.400 6.400 0 0 0 7.700 9.600Z"/>', WATER,
  ),
  sun: drawn(
    '<circle cx="12" cy="12" r="4.200"/><path d="M12 3v2.400M12 18.600V21M3 12h2.400M18.600 12H21M5.600 5.600l1.700 1.700M16.700 16.700l1.700 1.700M18.400 5.600l-1.700 1.700M7.300 16.700l-1.700 1.700"/>',
    '<circle cx="12" cy="12" r="3.800"/>', OCHRE,
  ),
  check: '<svg class="iw-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8c2 1.5 3.6 3.3 4.9 5.400C12 12 15.500 7.500 20.500 3.800"/></svg>',
  caret: '<svg class="iw-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.200 6 8.200l3.500-4"/></svg>',
  cross: '<svg class="iw-cross" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.600 2.800c2.200 2 4.400 4.200 6.800 6.600M9.500 2.600C7.300 4.800 5 7 2.500 9.400"/></svg>',
  rising: '<svg class="iw-trend" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10.500V2M2.600 5.200 6 1.800l3.400 3.400"/></svg>',
  falling: '<svg class="iw-trend" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.500V10M2.600 6.800 6 10.200l3.400-3.400"/></svg>',
  steady: '<svg class="iw-trend" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.100c2.600-.3 5.300-.3 8 0"/></svg>',
} as const;

/** The outline two waters share: what is in the drop tells them apart. */
const DROP = 'M12 2.8C9.3 7.6 6.2 10.7 6.2 14.6a5.8 5.8 0 0 0 11.6 0c0-3.9-3.1-7-5.8-11.8Z';
/** The canning jar, empty or full of jam. */
const JAR = 'M7.2 9.2c-1.4.9-2.2 2.2-2.2 3.9v5.5c0 1.3.9 2.2 2.2 2.2h9.6c1.3 0 2.2-.9 2.2-2.2v-5.5c0-1.7-.8-3-2.2-3.9';

/**
 * One drawing per item, chosen by its id alone. Things that are alike are
 * told apart by their outline first and their wash second: a log is round,
 * a plank is flat; raw fish swims, cooked fish is on a stick, smoked fish hangs.
 */
const ITEM_ICONS: Record<ItemId, string> = {
  // raw
  driftwood: drawn(
    line('M2.8 17.4c3.4-.6 6.2-2.2 8.8-4.2 2.9-2.2 5.9-4.4 9.6-5.2l.5 2.9c-3.2.8-5.8 2.8-8.5 4.9-2.9 2.2-6 4-9.8 4.5Z')
    + line('M12.4 12.6 11 6.2l2.4-.7 1.5 5') + line('M5.6 18.2c1.8-.5 3.3-1.2 4.8-2.2'),
    line('M2.8 17.4c3.4-.6 6.2-2.2 8.8-4.2 2.9-2.2 5.9-4.4 9.6-5.2l.5 2.9c-3.2.8-5.8 2.8-8.5 4.9-2.9 2.2-6 4-9.8 4.5Z')
    + line('M12.4 12.6 11 6.2l2.4-.7 1.5 5Z'), GREY,
  ),
  log: drawn(
    line('M6.4 7.2 17.6 5.6M7.2 18.4l11.2-1.6M6.4 7.2c-2.6 1.6-2.4 9.4.8 11.2')
    + '<ellipse cx="18" cy="11.2" rx="3.2" ry="5.7" transform="rotate(-8 18 11.2)"/>'
    + '<ellipse cx="18" cy="11.2" rx="1.2" ry="2.3" transform="rotate(-8 18 11.2)"/>'
    + line('M8.6 10.2h2.8M11 14h2.6M10.6 6.6 10 4.2l2-.3.5 2.4'),
    line('M6.4 7.2 17.6 5.6 18.4 16.8 7.2 18.4C4 16.6 3.8 8.8 6.4 7.2Z')
    + '<ellipse cx="18" cy="11.2" rx="3.2" ry="5.7" transform="rotate(-8 18 11.2)" fill="var(--iw-ochre)"/>', RUST,
  ),
  birch_bark: drawn(
    line('M4.2 7.4c2.2-1.2 4.2.6 6.4-.2 2-.8 4-.9 6.2-.2l-.2 10c-2.2-.8-4.2-.6-6.2.2s-4.2.4-6.2.2Z')
    + line('M16.8 7c2.8-1.2 4.8.2 4.8 2.4 0 1.8-1.4 2.8-2.8 2.4-1.2-.4-1.4-1.8-.4-2.4M21.6 9.4v5.4c0 1.8-2.2 2.8-5 2.2')
    + line('M6.6 10.2h3.2M12 11.8h2.6M6.8 14h2M10.6 15.4h3.4'),
    tint('M4.2 7.4c2.2-1.2 4.2.6 6.4-.2 2-.8 4-.9 6.2-.2l-.2 10c-2.2-.8-4.2-.6-6.2.2s-4.2.4-6.2.2Z', BRIGHT)
    + line('M16.8 7c2.8-1.2 4.8.2 4.8 2.4v5.4c0 1.8-2.2 2.8-5 2.2Z'), OCHRE,
  ),
  spruce_gum: drawn(
    line('M6.2 10C6 6.4 8.6 4.2 12 4.2s6 2.2 5.8 5.8c-.1 1.6-.8 2.6-.8 4 0 1.4-.5 2.4-1.5 2.4s-1.5-1-1.5-2.2c-.5 1.4-.3 3-.4 4.2-.1 1.3-.7 2-1.6 2s-1.5-.8-1.5-2.1c0-1.6.1-3-.5-4.4-.2 1-.6 1.7-1.5 1.7-1 0-1.5-.8-1.5-2.1 0-1.4-.7-2.2-.8-3.5Z')
    + line('M9 8c.7-1.1 1.8-1.7 3.2-1.7'),
    line('M6.2 10C6 6.4 8.6 4.2 12 4.2s6 2.2 5.8 5.8c-.1 1.6-.8 2.6-.8 4 0 1.4-.5 2.4-1.5 2.4s-1.5-1-1.5-2.2c-.5 1.4-.3 3-.4 4.2-.1 1.3-.7 2-1.6 2s-1.5-.8-1.5-2.1c0-1.6.1-3-.5-4.4-.2 1-.6 1.7-1.5 1.7-1 0-1.5-.8-1.5-2.1 0-1.4-.7-2.2-.8-3.5Z'), OCHRE,
  ),
  fiber: drawn(
    line('M10.2 11C9.6 8 7.8 5.4 5.2 3.6M12 11V3M13.8 11c.6-3 2.4-5.6 5-7.4')
    + line('M10.2 13.4c-.5 2.8-1.8 5.2-3.8 7.2M12 13.4V21M13.8 13.4c.5 2.8 1.8 5.2 3.8 7.2')
    + line('M9.2 11h5.6v2.4H9.2Z'),
    line('M5.2 3.6 12 3l6.8.6-5 8.6 3.8 8.4-5.6.4-5.6-.4 3.8-8.4Z'), SAGE,
  ),
  stone: drawn(
    line('M3.6 16.4 6.2 9l5.8-3.8 6.6 2.4 2.2 6.8-3.4 5H6.4Z') + line('M12 5.2l-1.2 6.6 6.4 3M10.8 11.8l-4.4 7.6'),
    line('M3.6 16.4 6.2 9l5.8-3.8 6.6 2.4 2.2 6.8-3.4 5H6.4Z'), GREY,
  ),
  clay: drawn(
    line('M3.4 10.8 13.2 6.8l7.4 3v5.8L10.8 20l-7.4-3.4Z') + line('M3.4 10.8l7.4 3.4 9.8-4.4M10.8 14.2V20')
    + '<ellipse cx="12" cy="10.4" rx="2.2" ry=".9"/>',
    line('M3.4 10.8 13.2 6.8l7.4 3v5.8L10.8 20l-7.4-3.4Z'), RUST,
  ),
  scrap_metal: drawn(
    line('M3.4 5.8h6.8c4.6 0 7.6 3 7.6 7.6v6.8M3.4 10.6h6.4c2.2 0 3.2 1 3.2 3.2v6.4M3.4 5.8v4.8M13 20.2h4.8')
    + line('M6 4.6v7.2M11.8 17.6h7.2M14.6 8l-1.7 1.9') + line('M3.4 20.6l1.8-5.2 4.2 3.8Z'),
    line('M3.4 5.8h6.8c4.6 0 7.6 3 7.6 7.6v6.8H13v-6.4c0-2.2-1-3.2-3.2-3.2H3.4Z')
    + tint('M3.4 20.6l1.8-5.2 4.2 3.8Z', WATER), RUST,
  ),
  nails: drawn(
    line('M4.1 6 7.9 3.2M5.2 5.2 16.2 18.2 6.8 4') + line('M15.8 4.6h5M17.4 4.6l.9 11.8.9-11.8')
    + line('M3.4 14.6l3 2.4M4.9 15.8 9.6 21.4'),
    line('M5.2 5.2 16.2 18.2 6.8 4Z') + line('M17.4 4.6l.9 11.8.9-11.8Z'), WATER,
  ),
  wire: drawn(
    line('M2.4 17c2.9 0 4.8-2.3 4.8-5.6 0-2-.9-3.2-2-3.2s-1.9 1.2-1.9 3.2c0 3.3 2.2 5.6 5.1 5.6s4.8-2.3 4.8-5.6c0-2-.9-3.2-2-3.2s-1.9 1.2-1.9 3.2c0 3.3 2.2 5.6 5.1 5.6s4.8-2.3 4.8-5.6c0-2-.9-3.2-2-3.2s-1.9 1.2-1.9 3.2c0 3.3 2.2 5.6 5.1 5.6h1.2'),
    '<ellipse cx="12" cy="12.6" rx="9" ry="3.6"/>', RUST,
  ),
  cloth: drawn(
    line('M3.4 10 12.2 6.4l8.4 3.4-8.8 3.8Z') + line('M3.4 10v3.2l8.4 3.8 8.8-3.8V9.8')
    + line('M3.4 13.2v3.2l8.4 3.8 8.8-3.8v-3.2') + line('M7.8 8.2l8.4 3.7'),
    line('M3.4 10 12.2 6.4l8.4 3.4v6.8l-8.8 3.8-8.4-3.8Z'), SAGE,
  ),
  rope: drawn(
    '<ellipse cx="11.4" cy="13" rx="8.4" ry="6.6"/><ellipse cx="11.4" cy="13" rx="4.4" ry="3"/>'
    + line('M5 11.8c1.2-2.6 3.6-3.8 6.4-3.8s5.2 1.2 6.4 3.8') + line('M9.2 16.2l-.6 3.2M11.4 16.3v3.3M13.6 16.2l.6 3.2')
    + line('M18.4 9.4c1.8-1 2.9-2.8 2.8-5.2'),
    '<ellipse cx="11.4" cy="13" rx="8.4" ry="6.6"/><ellipse cx="11.4" cy="13" rx="4.4" ry="3" fill="var(--iw-paper)"/>', OCHRE,
  ),
  glass_jar: drawn(
    line(JAR) + line('M7.2 4h9.6v5.2H7.2Z') + line('M7.2 6.6h9.6M8.2 13.4v4.2'),
    tint(`${JAR}Z`, BRIGHT) + line('M7.2 4h9.6v5.2H7.2Z'), WATER,
  ),
  tin_can: drawn(
    line('M6 9.6v8.6c0 1.5 2.7 2.6 6 2.6s6-1.1 6-2.6V9.6') + '<ellipse cx="12" cy="9.6" rx="6" ry="2.2"/>'
    + line('M6 12.8c1.6 1.4 10.4 1.4 12 0M6 15.8c1.6 1.4 10.4 1.4 12 0')
    + '<ellipse cx="18" cy="5.6" rx="3.6" ry="1.5" transform="rotate(-32 18 5.6)"/>',
    line('M6 9.6v8.6c0 1.5 2.7 2.6 6 2.6s6-1.1 6-2.6V9.6c0-1.2-2.7-2.2-6-2.2s-6 1-6 2.2Z'), WATER,
  ),
  seeds: drawn(
    line('M4.6 5.2 14.8 4.4l.9 15-10.2.8Z') + line('M4.8 8l10.1-.8M10.2 17.6v-4.4')
    + line('M10.2 13.4c-2.2.3-3.3-.8-3.4-2.6 2.2-.3 3.3.8 3.4 2.6ZM10.3 12.6c1.8.2 2.8-.7 2.9-2.2-1.9-.2-2.8.7-2.9 2.2Z')
    + dot(18.6, 11.6) + dot(20.4, 15.4) + dot(18, 18.8),
    line('M4.6 5.2 14.8 4.4l.9 15-10.2.8Z')
    + tint('M10.2 13.4c-2.2.3-3.3-.8-3.4-2.6 2.2-.3 3.3.8 3.4 2.6ZM10.3 12.6c1.8.2 2.8-.7 2.9-2.2-1.9-.2-2.8.7-2.9 2.2Z', SAGE), OCHRE,
  ),
  copper_coil: drawn(
    line('M5 5.4v13.2M19 5.4v13.2M5 8.2h14M5 15.8h14') + line('M8.6 8.2 7.4 15.8M11.6 8.2l-1.2 7.6M14.6 8.2l-1.2 7.6M17.6 8.2l-1.2 7.6')
    + line('M5 10.4H2.6M19 13.6h2.6'),
    line('M5 8.2h14v7.6H5Z'), RUST,
  ),
  battery: drawn(
    line('M4.2 8.8h15.6v10.8H4.2Z') + line('M6.8 8.8V6.2h3.2v2.6M14 8.8V6.2h3.2v2.6') + line('M6.9 14.6h3M8.4 13.1v3M14.1 14.6h3'),
    line('M4.2 8.8h15.6v10.8H4.2Z') + tint('M4.2 8.8h15.6v2.4H4.2Z', RUST), OCHRE,
  ),
  steel_cable: drawn(
    line('M7.6 2.6V10M10.4 2.6V10M7.6 4l2.8 1.6M7.6 6.8l2.8 1.6') + line('M6.4 10h5.2v2.6H6.4Z')
    + line('M7.6 12.6v3.2c0 3.4 2.4 5.8 5.6 5.8s5.6-2.4 5.6-5.6c0-1.4-.5-2.6-1.3-3.6l-2.2 1.6c.5.6.7 1.3.7 2 0 1.7-1.2 2.9-2.8 2.9s-2.8-1.2-2.8-3v-3.3Z'),
    line('M7.6 2.6h2.8v10H7.6Z')
    + line('M7.6 12.6v3.2c0 3.4 2.4 5.8 5.6 5.8s5.6-2.4 5.6-5.6c0-1.4-.5-2.6-1.3-3.6l-2.2 1.6c.5.6.7 1.3.7 2 0 1.7-1.2 2.9-2.8 2.9s-2.8-1.2-2.8-3v-3.3Z'), WATER,
  ),
  // unique finds
  hatchet_head: drawn(
    line('M3.8 6.6 19 5.4c1.4 4.8 1 9.6-1.4 14-1.2-3.6-3.4-5.8-6.6-6.6H3.8Z')
    + '<ellipse cx="7.2" cy="9.7" rx="1.7" ry="1.3"/>' + line('M16.4 6.4c1 3.6.8 7.2-.6 10.4'),
    line('M3.8 6.6 19 5.4c1.4 4.8 1 9.6-1.4 14-1.2-3.6-3.4-5.8-6.6-6.6H3.8Z'), RUST,
  ),
  saw_blade: drawn(
    '<g transform="rotate(-24 12 12)">'
    + line('M2.6 8.4 21.4 9.6v3l-1.6 2.6-1.5-2.6-1.6 2.6-1.5-2.6-1.6 2.6-1.5-2.6-1.6 2.6-1.5-2.6-1.6 2.6-1.5-2.6-1.6 2.6-1.5-2.6Z')
    + '<circle cx="5.2" cy="10.6" r=".6"/><circle cx="19" cy="11.2" r=".6"/></g>',
    '<path transform="rotate(-24 12 12)" d="M2.6 8.4 21.4 9.6v3H2.8Z"/>', WATER,
  ),
  lens: drawn(
    '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="6"/>' + line('M8.6 11.4c.3-1.6 1.3-2.6 2.8-3M14.4 14.4l1 1'),
    '<circle cx="12" cy="12" r="8.6" fill="var(--iw-ochre)"/><circle cx="12" cy="12" r="6"/>', WATER,
  ),
  lodestone: drawn(
    line('M3.2 15.6c-.4-3.4 1.4-6.4 4.6-7.4 3.4-1 7 .2 8.6 3 1.4 2.6.8 5.8-1.6 7.4-2.8 1.8-6.8 2-9.4.6-1.2-.8-2-2-2.2-3.6Z')
    + line('M7.8 8.2l2 4.6 6.2-1M9.8 12.8l-1.4 6.4') + line('M15.6 9.2 19.6 4.8M18.6 3.8l2 2M17.2 13.4l4.4-1.8M21 10.2l1 2.6'),
    line('M3.2 15.6c-.4-3.4 1.4-6.4 4.6-7.4 3.4-1 7 .2 8.6 3 1.4 2.6.8 5.8-1.6 7.4-2.8 1.8-6.8 2-9.4.6-1.2-.8-2-2-2.2-3.6Z'), INK,
  ),
  radio_crystal: drawn(
    line('M6 14.4h12l-1.6 6H7.6Z') + line('M8.8 14.4 10 7.6 12.6 3.4l2.8 4.4-.4 6.6') + line('M12.6 3.4 12.2 14.4M10 7.6l2.4 2.2 3-2')
    + line('M18 15c2.2-.4 3.4-2 3.2-4-.2-1.6-1.4-2.4-3-2.2'),
    line('M8.8 14.4 10 7.6 12.6 3.4l2.8 4.4-.4 6.6Z') + tint('M6 14.4h12l-1.6 6H7.6Z', OCHRE), WATER,
  ),
  // raw food and water
  berries: drawn(
    '<circle cx="7.6" cy="15.4" r="3.4"/><circle cx="15.6" cy="16" r="3.4"/><circle cx="11.8" cy="9.8" r="3.4"/>'
    + line('M11.8 6.4c.2-1.4.9-2.5 2.2-3.2') + line('M14 3.2c2.2-.8 4.4 0 5.6 1.8-2.2 1-4.4.4-5.6-1.8Z'),
    '<circle cx="7.6" cy="15.4" r="3.4"/><circle cx="15.6" cy="16" r="3.4"/><circle cx="11.8" cy="9.8" r="3.4"/>'
    + tint('M14 3.2c2.2-.8 4.4 0 5.6 1.8-2.2 1-4.4.4-5.6-1.8Z', SAGE), WATER,
  ),
  apple: drawn(
    line('M12 7.6c-2-1.4-4.6-1.4-6.2.4-2 2.2-1.8 6.2-.2 9.2 1.4 2.6 3.6 3.8 6.4 2.8 2.8 1 5-.2 6.4-2.8 1.6-3 1.8-7-.2-9.2-1.6-1.8-4.2-1.8-6.2-.4Z')
    + line('M12 7.6c0-1.8.6-3.2 1.8-4.4M7.8 11.4c.2-1 .8-1.8 1.6-2.2') + line('M13 5.4c1.8-1.8 4-2 5.8-1-1.4 2-3.8 2.4-5.8 1Z'),
    line('M12 7.6c-2-1.4-4.6-1.4-6.2.4-2 2.2-1.8 6.2-.2 9.2 1.4 2.6 3.6 3.8 6.4 2.8 2.8 1 5-.2 6.4-2.8 1.6-3 1.8-7-.2-9.2-1.6-1.8-4.2-1.8-6.2-.4Z')
    + tint('M13 5.4c1.8-1.8 4-2 5.8-1-1.4 2-3.8 2.4-5.8 1Z', SAGE), RUST,
  ),
  cattail_root: drawn(
    line('M3 11.6c2-1.8 5.2-2.2 8.4-1.4 3.6.9 6.8 2.4 9.8 4.6-3.4 1.6-7 2.2-10.6 1.6-3.2-.5-6-1.6-7.6-3.2-.5-.5-.5-1.1 0-1.6Z')
    + line('M4.8 10.6 4 5.2l2.6-.4.8 5.2') + line('M10.4 10.2c-.4 1-.4 2 0 3M14.6 11.4c-.3.8-.3 1.6 0 2.4M21 14.6l1.6-.2M20.6 15.4l1.4 1.2'),
    line('M3 11.6c2-1.8 5.2-2.2 8.4-1.4 3.6.9 6.8 2.4 9.8 4.6-3.4 1.6-7 2.2-10.6 1.6-3.2-.5-6-1.6-7.6-3.2-.5-.5-.5-1.1 0-1.6Z')
    + tint('M4.8 10.6 4 5.2l2.6-.4.8 5.2Z', SAGE), OCHRE,
  ),
  mushroom: drawn(
    line('M3.2 12.2C3.6 7.4 7.2 4 12 4s8.4 3.4 8.8 8.2c-2.8 1-5.8 1.4-8.8 1.4s-6-.4-8.8-1.4Z')
    + line('M9.8 13.6c.4 2.4.2 4.6-.7 6.6h5.8c-.9-2-1.1-4.2-.7-6.6')
    + '<circle cx="8.6" cy="9" r=".8"/><circle cx="13.8" cy="7.4" r=".8"/>',
    line('M3.2 12.2C3.6 7.4 7.2 4 12 4s8.4 3.4 8.8 8.2c-2.8 1-5.8 1.4-8.8 1.4s-6-.4-8.8-1.4Z')
    + tint('M9.8 13.6c.4 2.4.2 4.6-.7 6.6h5.8c-.9-2-1.1-4.2-.7-6.6Z', BRIGHT), RUST,
  ),
  raw_fish: drawn(
    line('M21.2 12c-3.2-4.6-9.4-5-13.6 0 4.2 4.8 10.4 4.6 13.6 0Z') + line('M7.8 12 3 8.4c.6 2.4.6 4.8 0 7.2Z')
    + line('M10.8 8.8 12.2 6l1.2 2 1.4-1.8.9 2.4M13 9.6v4.8M17 9.8c-.6 1.4-.6 2.9 0 4.3') + dot(19, 11.4),
    line('M21.2 12c-3.2-4.6-9.4-5-13.6 0 4.2 4.8 10.4 4.6 13.6 0Z') + line('M7.8 12 3 8.4c.6 2.4.6 4.8 0 7.2Z'), WATER,
  ),
  dirty_water: drawn(
    line(DROP) + dot(10.2, 14.4) + dot(13.8, 16.8) + dot(12.6, 11.6),
    line(DROP), MUD,
  ),
  // refined
  plank: drawn(
    line('M2.8 14 17 5l4.2 2.6L7 16.6Z') + line('M2.8 14v2.6l4.2 2.6 14.2-9V7.6M7 16.6v2.6') + line('M7.6 13.4 15.4 8.5M10.4 14.2l5.2-3.3'),
    line('M2.8 14 17 5l4.2 2.6v2.6L7 19.2l-4.2-2.6Z'), OCHRE,
  ),
  pitch: drawn(
    line('M5.6 10.6h12.8l-1.2 8.2c-.2 1-1 1.6-2 1.6H8.8c-1 0-1.8-.6-2-1.6Z') + line('M4.4 10.6h15.2M6.8 10.6c1.2-2.2 3.2-3 5.2-3s4 .8 5.2 3')
    + line('M8.4 10.6c0 2 .2 4.2 1.3 4.2s1.1-1.8 1.1-4.2M13.6 8 18.4 2.8'),
    line('M5.6 10.6h12.8l-1.2 8.2c-.2 1-1 1.6-2 1.6H8.8c-1 0-1.8-.6-2-1.6Z')
    + tint('M6.8 10.6c1.2-2.2 3.2-3 5.2-3s4 .8 5.2 3ZM8.4 10.6c0 2 .2 4.2 1.3 4.2s1.1-1.8 1.1-4.2Z', INK), OCHRE,
  ),
  charcoal: drawn(
    line('M3.2 15.4 5.8 10.8l9.4-1.6 5 3.2-1.8 5.8-10.4 2Z') + line('M10.2 10l1 4.6-2.8 5.4M11.2 14.6l7.2 3.4M5.8 10.8l5.4 3.8')
    + line('M13.8 7.2l3-3.4 3.8 1.6-.6 3.6-3.4 1.2Z'),
    line('M3.2 15.4 5.8 10.8l9.4-1.6 5 3.2-1.8 5.8-10.4 2Z') + line('M13.8 7.2l3-3.4 3.8 1.6-.6 3.6-3.4 1.2Z'), INK,
  ),
  sailcloth: drawn(
    line('M7.4 2.6v18.8M4.4 18h17.2') + line('M7.4 4.2c6 2.8 10.4 7.4 13.2 13.8')
    + line('M7.4 9.4c2.4.6 4.6 1.7 6.6 3.4M7.4 13.8c3.6.3 7 1.2 10.2 2.6') + line('M7.4 2.8 3.6 4.2l3.8 1.4'),
    tint('M7.4 4.2c6 2.8 10.4 7.4 13.2 13.8H7.4Z', BRIGHT) + line('M7.4 2.8 3.6 4.2l3.8 1.4Z'), RUST,
  ),
  metal_sheet: drawn(
    line('M3.8 6.6 18.6 4.8l1.6 12.4-14.8 2Z') + line('M9.6 14.2l4.4-4.6M12.6 14.6l2.4-2.6')
    + dot(6.4, 8.8) + dot(17.2, 7.4) + dot(17.9, 15.2) + dot(7.3, 16.6),
    line('M3.8 6.6 18.6 4.8l1.6 12.4-14.8 2Z'), WATER,
  ),
  hardware: drawn(
    line('M4.2 4.2h9v3.6h-9Z') + line('M6.6 7.8v12h4.2v-12M6.6 10.8h4.2M6.6 13.6h4.2M6.6 16.4h4.2')
    + line('M21.6 14.6l-1.95 3.4h-3.9l-1.95-3.4 1.95-3.4h3.9Z') + '<circle cx="17.7" cy="14.6" r="1.3"/>',
    line('M4.2 4.2h9v3.6h-2.4v12H6.6v-12H4.2Z') + tint('M21.6 14.6l-1.95 3.4h-3.9l-1.95-3.4 1.95-3.4h3.9Z', OCHRE), WATER,
  ),
  clean_water: drawn(
    line(DROP) + line('M9 14.6c.1 1.6 1 2.8 2.4 3.3M17.8 6.4l1.6-1.8M19.4 9.4l2.2-.6M15.4 4.4l.4-2'),
    line(DROP), WATER,
  ),
  cooked_fish: drawn(
    '<g transform="rotate(-40 12 12)">' + line('M.4 12h3.8M19.6 12h4') + line('M19.6 12c-2.8-4-8.4-4.4-12 0 3.6 4.2 9.2 4 12 0Z')
    + line('M7.8 12 4.2 9c.5 2 .5 4 0 6Z') + line('M10.6 10l1.2 4M13.4 9.8l1.2 4.4') + dot(17.2, 11.4) + '</g>',
    '<g transform="rotate(-40 12 12)">' + line('M19.6 12c-2.8-4-8.4-4.4-12 0 3.6 4.2 9.2 4 12 0Z') + line('M7.8 12 4.2 9c.5 2 .5 4 0 6Z') + '</g>', OCHRE,
  ),
  roast_roots: drawn(
    line('M2.8 21.2l2.8-2.8M11.2 12.8l1.6-1.6M18.4 5.6l2.8-2.8')
    + '<ellipse cx="8.4" cy="15.6" rx="3.9" ry="2.7" transform="rotate(-45 8.4 15.6)"/>'
    + '<ellipse cx="15.6" cy="8.4" rx="3.9" ry="2.7" transform="rotate(-45 15.6 8.4)"/>'
    + line('M7.2 14.4l2.4 2.4M14.4 7.2l2.4 2.4'),
    '<ellipse cx="8.4" cy="15.6" rx="3.9" ry="2.7" transform="rotate(-45 8.4 15.6)"/>'
    + '<ellipse cx="15.6" cy="8.4" rx="3.9" ry="2.7" transform="rotate(-45 15.6 8.4)"/>', RUST,
  ),
  stew: drawn(
    line('M3.2 11.6h17.6c0 5-3.6 8.4-8.8 8.4s-8.8-3.4-8.8-8.4Z') + line('M7 11.6c.4-1.7 1.7-2.3 3-1.6M12.2 11.6c.6-1.5 2-1.9 3.2-1M16.2 11.4 20.8 5')
    + line('M8.4 7.4c-1-1.4.8-2.4-.2-4M12.4 7.4c-1-1.4.8-2.4-.2-4'),
    line('M3.2 11.6h17.6c0 5-3.6 8.4-8.8 8.4s-8.8-3.4-8.8-8.4Z'), RUST,
  ),
  // stock food
  smoked_fish: drawn(
    line('M6.6 2.6h10.8M12 2.6v3.2') + line('M12 9.4 8.8 5.6c2.1.5 4.3.5 6.4 0Z') + line('M12 21.4c-4-2.8-4.4-8.2 0-12 4.2 3.6 4 9.2 0 12Z')
    + line('M10.2 13.4h3.6M9.9 16h4.2M4.4 20.6c-1.2-1.8.9-2.8-.2-4.8M19.8 20.6c1.2-1.8-.9-2.8.2-4.8') + dot(12, 18.8),
    line('M12 9.4 8.8 5.6c2.1.5 4.3.5 6.4 0Z') + line('M12 21.4c-4-2.8-4.4-8.2 0-12 4.2 3.6 4 9.2 0 12Z'), RUST,
  ),
  jam: drawn(
    line(JAR) + line('M6.2 9.2c.4-3.2 2.6-5.2 5.8-5.2s5.4 2 5.8 5.2Z') + line('M6.4 9.2 5 10.8M17.6 9.2l1.4 1.6')
    + line('M8.6 12.8h6.8v4.6H8.6Z') + dot(12, 15.1),
    line(`${JAR}Z`) + tint('M6.2 9.2c.4-3.2 2.6-5.2 5.8-5.2s5.4 2 5.8 5.2Z', OCHRE), RUST,
  ),
  dried_apple: drawn(
    line('M12 6.8c-1.9-1.5-4.6-1.4-6.2.5-1.9 2.3-1.7 6.1.1 9.1 1.4 2.4 3.6 3.5 6.1 2.5 2.5 1 4.7-.1 6.1-2.5 1.8-3 2-6.8.1-9.1-1.6-1.9-4.3-2-6.2-.5Z')
    + line('M12 9.8c-2 1.4-2.2 4.2 0 6.2 2.2-2 2-4.8 0-6.2Z'),
    line('M12 6.8c-1.9-1.5-4.6-1.4-6.2.5-1.9 2.3-1.7 6.1.1 9.1 1.4 2.4 3.6 3.5 6.1 2.5 2.5 1 4.7-.1 6.1-2.5 1.8-3 2-6.8.1-9.1-1.6-1.9-4.3-2-6.2-.5Z')
    + tint('M12 9.8c-2 1.4-2.2 4.2 0 6.2 2.2-2 2-4.8 0-6.2Z', BRIGHT), OCHRE,
  ),
  // tools
  bailing_can: drawn(
    '<path d="M6.4 9.8 7.9 19.7h8.2l1.5-9.9"/><ellipse cx="12" cy="9.7" rx="5.6" ry="1.7"/><path d="M6.4 9.6C6.6 2.6 17.4 2.6 17.6 9.6"/>'
    + '<path d="M8.3 14.2c2.4.8 5 .8 7.4 0"/><path d="M20.3 13.5v2.2M21.6 17.8v1.4M19.4 18.6v1.2"/>',
    '<path d="M6.7 10 8.1 19.5h7.8L17.3 10Z"/>', OCHRE,
  ),
  stone_knife: drawn(
    '<path d="M11 11.4C13 7.2 16.6 4.4 20.6 3.4c-.6 4.2-3.2 8-7.4 10.2Z"/><path d="M3.5 19.3 10.6 12.2l1.9 1.9-7.1 7.1Z"/>'
    + '<path d="M8.3 13.9l2.3 2.3M6.7 15.5l2.3 2.3"/><path d="M13.2 10.7c1.5-2 3.3-3.6 5.3-4.8"/>',
    '<path d="M11.6 11.3c1.8-3.6 4.9-6.1 8.3-7.1-.7 3.6-2.9 6.8-6.5 8.8Z"/>', WATER,
  ),
  hatchet: drawn(
    '<path d="M11.2 6.4 14.4 3.2c2.2 1.2 4.2 1.6 6.4 1.2.6 2.6.4 5-.6 7.2-2-1.4-3.8-1.8-6-1.2Z"/><path d="M13 8.2C10.8 12 8.2 16 5.4 20.6"/>'
    + '<path d="M4.3 19.9l2.2 1.4"/><path d="M17.6 5.6c.4 1.4.3 2.8-.2 4.1"/>',
    '<path d="M11.4 6.5 14.5 3.4c2.1 1.1 4.1 1.5 6.2 1.2.5 2.4.3 4.6-.6 6.7-1.9-1.2-3.7-1.6-5.8-1Z"/>', WATER,
  ),
  pry_bar: drawn(
    '<path d="M3.6 19.5 15.8 6.2c1.6-1.8 4-2.1 5.4-.5l-1.4 1.2c-.8-.9-1.9-.7-2.7.2L5 20.8Z"/><path d="M19.8 6.9l1.6.5"/>'
    + '<path d="M3.6 19.5l-.9 2.3 2.3-1"/>',
    '<path d="M4.3 19.6 16.2 6.7c1.3-1.4 3.2-1.7 4.4-.6l-.8.7c-.9-.7-2-.4-2.8.4L5.2 20.3Z"/>', RUST,
  ),
  saw: drawn(
    '<path d="M7.6 6.8 21.6 11.2v1.4"/><path d="M21.6 12.6l-1.1 2.1-2.4-1.4-1.1 2.1-2.4-1.4-1.1 2.1-2.4-1.4-1.1 2.1-2.4-1.4"/>'
    + '<path d="M7.6 6.4v10.8c-2.7.5-4.7-.8-5-3.4-.3-3.1 1.4-6.3 5-7.4Z"/><path d="M5.3 10.7c-.6 1.4-.4 2.8.5 3.7"/>',
    '<path d="M7.2 7v9.8c-2.3.3-3.9-.8-4.2-3-.2-2.7 1.2-5.5 4.2-6.8Z"/>', OCHRE,
  ),
  hammer: drawn(
    '<path d="M10.6 7.6 16.7 4.1 19.5 8.3 13.4 11.8Z"/><path d="M16.7 4.1c1.7-.9 3.3-.6 4 .5"/><path d="M12.5 10.2 5 20.3"/>'
    + '<path d="M3.8 19.5l2.3 1.6"/>',
    '<path d="M10.8 7.6 16.6 4.3 19.3 8.2 13.5 11.5Z"/>', RUST,
  ),
  fishing_rod: drawn(
    '<path d="M3.5 20.5C9 15.5 15 9.5 20.2 3"/><path d="M20.2 3v9.5"/><path d="M20.2 12.5c.2 3.2-3.3 3.2-3 .6"/>'
    + '<circle cx="7.6" cy="16.8" r="1.9"/><path d="M5.2 18.6l-1.7-1.3"/>',
    '<circle cx="7.6" cy="16.8" r="2.3"/>', SAGE,
  ),
  wrench: drawn(
    '<path d="M4.2 18.3 13.6 8.9a4.4 4.4 0 0 1 5.8-5.4l-2.7 2.7.5 2.6 2.6.5 2.7-2.7a4.4 4.4 0 0 1-5.4 5.8L7.7 21.8a2.470 2.470 0 0 1-3.5-3.5Z"/>'
    + '<circle cx="6" cy="20" r=".55" class="iw-dot"/>',
    '<path d="M4.8 18.7 14.2 9.3a3.9 3.9 0 0 1 4.3-5.2l-2.3 2.3.6 3.3 3.3.6 2.3-2.3a3.9 3.9 0 0 1-5.2 4.3L7.3 21.3a1.9 1.9 0 0 1-2.5-2.6Z"/>', WATER,
  ),
  // key items
  beacon_bearing: drawn(
    '<circle cx="12" cy="13.2" r="7.8"/><circle cx="12" cy="3.7" r="1.4"/>' + line('M15.6 8.6 13.8 14.6 8.4 17.8 10.2 11.8Z') + line('M10.2 11.8l3.6 2.8'),
    '<circle cx="12" cy="13.2" r="7.8"/>' + tint('M15.6 8.6 13.8 14.6 10.2 11.8Z', RUST), OCHRE,
  ),
  bellows: drawn(
    line('M20.6 12c-2.6-.6-4.6-1.8-6.4-3.6-1.8-1.8-3.8-2.8-6-2.8-3 0-5 2.8-5 6.4s2 6.4 5 6.4c2.2 0 4.2-1 6-2.8 1.8-1.8 3.8-3 6.4-3.6Z')
    + line('M16.4 12c-1.6-.6-3-1.6-4.2-2.8-1.1-1.1-2.3-1.6-3.6-1.6-1.8 0-2.9 1.8-2.9 4.4s1.1 4.4 2.9 4.4c1.3 0 2.5-.5 3.6-1.6 1.2-1.2 2.6-2.2 4.2-2.8Z')
    + '<circle cx="9" cy="12" r="1.1"/>' + line('M20.6 12h1.8M4.2 8 2.4 5.8M4.2 16l-1.8 2.2'),
    line('M20.6 12c-2.6-.6-4.6-1.8-6.4-3.6-1.8-1.8-3.8-2.8-6-2.8-3 0-5 2.8-5 6.4s2 6.4 5 6.4c2.2 0 4.2-1 6-2.8 1.8-1.8 3.8-3 6.4-3.6Z')
    + tint('M16.4 12c-1.6-.6-3-1.6-4.2-2.8-1.1-1.1-2.3-1.6-3.6-1.6-1.8 0-2.9 1.8-2.9 4.4s1.1 4.4 2.9 4.4c1.3 0 2.5-.5 3.6-1.6 1.2-1.2 2.6-2.2 4.2-2.8Z', OCHRE), RUST,
  ),
  signal_flag: drawn(
    line('M5.8 2.8v18.6') + line('M5.8 4.2 20.8 8.6 5.8 13Z') + line('M10.4 5.6v6'),
    line('M5.8 4.2 20.8 8.6 5.8 13Z'), RUST,
  ),
  carved_figurehead: drawn(
    line('M7 20.6c-.6-4.4.2-8 2.4-10.8 1.6-2 3.6-3.4 6-3.4 1.6 0 2.8.6 3.4 1.6l3 1-3.2 1.2c-.6 1-1.8 1.4-3.2 1.4-1.2 0-1.8 1-1.8 2.6 0 2.2.2 4.2.6 6.4')
    + line('M5.4 20.6h10.4M9.6 14.4h3.8M9.2 17.2h4.4') + dot(16, 8.6),
    line('M7 20.6c-.6-4.4.2-8 2.4-10.8 1.6-2 3.6-3.4 6-3.4 1.6 0 2.8.6 3.4 1.6l3 1-3.2 1.2c-.6 1-1.8 1.4-3.2 1.4-1.2 0-1.8 1-1.8 2.6 0 2.2.2 4.2.6 6.4Z'), OCHRE,
  ),
};

/** The drawn icon for an item: a material, a meal, a tool or a key item. */
export const itemIcon = (itemId: ItemId): string => ITEM_ICONS[itemId];

/** Canoe-in-section gauge: how much water is in the boat. `level` is 0 to 1. */
export function waterGauge(level: number, patterned: boolean): string {
  const surface = (19 - Math.max(0, Math.min(1, level)) * 9.5).toFixed(2);
  const pattern = patterned
    ? [3, 6].map((drop) => `<path d="M0 ${(Number(surface) + drop).toFixed(2)}c5-1.6 8 1.6 13 0s8-1.6 13 0 8 1.6 13 0 8-1.6 13 0 8 1.6 14 0" `
      + 'fill="none" stroke="var(--iw-ink)" stroke-width=".8" opacity=".55"/>').join('')
    : '';
  return '<svg class="iw-gauge" viewBox="0 0 66 24" aria-hidden="true">'
    + '<defs><clipPath id="iw-hull-clip"><path d="M4 9.5c1.7 5.7 6.2 9.5 12 9.5h34c5.8 0 10.3-3.8 12-9.5Z"/></clipPath></defs>'
    + `<g clip-path="url(#iw-hull-clip)"><rect x="0" y="${surface}" width="66" height="24" fill="var(--iw-water)" opacity=".85"/>`
    + `<path d="M0 ${surface}c5-1.6 8 1.6 13 0s8-1.6 13 0 8 1.6 13 0 8-1.6 13 0 8 1.6 14 0" fill="none" stroke="var(--iw-paper)" stroke-width="1.2"/>`
    + `${pattern}</g>`
    + '<g class="iw-pen"><path d="M2.5 8.2c1.7.9 3.6 1.3 5.7 1.3h49.600c2.100 0 4-.4 5.700-1.300C61.900 14.700 57 19.200 50 19.200H16C9 19.200 4.100 14.700 2.500 8.200Z"/>'
    + '<path d="M22 9.5v9.500M33 9.500v9.700M44 9.500v9.500" opacity=".35"/><path d="M36.500 21.200v1.600M30 21.300v1"/></g></svg>';
}

/** The seal: a red chop, as on an ink painting. A canoe under a rising sun, cut in reverse. */
export const SEAL = '<svg class="iw-seal" viewBox="0 0 40 40" aria-hidden="true">'
  + '<path d="M3.5 4.2c10.5-1.5 22.5-1.2 33 .2 1 10.2 1.2 21.5-.2 32.2-10.8 1.3-22.2 1.3-32.800-.3C2.300 25.800 2.200 14.500 3.500 4.200Z" fill="var(--iw-rust)"/>'
  + '<g fill="none" stroke="var(--iw-paper)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M8.5 23.5c3.800 1.200 7.500 1.700 11.500 1.700s7.700-.5 11.500-1.700c-1.500 4.200-5.500 6.700-11.500 6.700s-10-2.500-11.500-6.700Z"/>'
  + '<path d="M20 19.500a5 5 0 0 1 0-10 5 5 0 0 1 0 10Z" stroke-width="1.9"/><path d="M26.500 10 15 30.500" stroke-width="1.700"/></g></svg>';

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The logotype: the title in a Fell italic, roughened like ink on cold-press paper, underlined by a paddle laid flat. */
export function logotype(title: string): string {
  return `<svg class="iw-logo" viewBox="0 0 560 216" role="img" aria-label="${escapeText(title)}"><g filter="url(#iw-inkbleed)">`
    + `<text x="2" y="124" class="iw-logo-word">${escapeText(title)}</text>`
    + '<path class="iw-logo-paddle" d="M6 181c-1.500-6 2-11.500 7.500-11.500 3 0 5.500 1.500 7 4 92-2.500 196-4 288-3.500 26-13 76-18.500 134-12.500 9 1 14.500 6 14.300 12-.3 6-6.300 10.500-15.300 10.800-58 2-106-4.500-133-15.800-92 .5-196 3-288 6.500-1.500 4-4.500 6.500-8 6.500-3.500 0-6-1.500-6.500-6.500Z"/>'
    + '<path class="iw-logo-ripple" d="M330 203c14-3 26 3 40 0s26-3 40 0M70 204c12-2.500 22 2.500 34 0s22-2.500 34 0M452 200c9-2 16 2 25 0"/>'
    + '</g></svg>';
}

/**
 * The pen-wobble filters. They are fixed: one seed, no animation, so a line
 * drawn through them never moves once it is on the screen.
 */
export const FILTER_DEFINITIONS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
  + '<filter id="iw-rough" x="-4%" y="-8%" width="108%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="n"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/></filter>'
  + '<filter id="iw-rough-small" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G"/></filter>'
  + '<filter id="iw-inkbleed" x="-3%" y="-10%" width="106%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="n"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="n" scale="4.2" xChannelSelector="R" yChannelSelector="G" result="d"/>'
  + '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="g"/>'
  + '<feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.55" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>'
  + '</defs></svg>';
