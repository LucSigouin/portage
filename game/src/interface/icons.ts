/**
 * Ink & Wash icons: loose pen strokes with a watercolour dab behind them.
 * Every icon is inline SVG markup on a 24-unit grid, drawn here in code.
 * Carried over from the approved B2 study; the tools the study did not have
 * (knife, pry bar, saw, wrench) and the map marks are drawn in the same hand.
 */
import type { ToolId } from '../data/index.ts';

const RUST = 'var(--iw-rust)';
const WATER = 'var(--iw-water)';
const OCHRE = 'var(--iw-ochre)';
const SAGE = 'var(--iw-sage)';

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

const TOOL_ICONS: Record<ToolId, string> = {
  bailing_can: drawn(
    '<path d="M6.4 9.8 7.9 19.7h8.2l1.5-9.9"/><ellipse cx="12" cy="9.7" rx="5.6" ry="1.7"/><path d="M6.4 9.6C6.6 2.6 17.4 2.6 17.6 9.6"/>'
    + '<path d="M8.3 14.2c2.4.8 5 .8 7.4 0"/><path d="M20.3 13.5v2.2M21.6 17.8v1.4M19.4 18.6v1.2"/>',
    '<path d="M6.7 10 8.1 19.5h7.8L17.3 10Z"/>', OCHRE,
  ),
  stone_knife: drawn(
    '<path d="M11 11.400C13 7.200 16.600 4.400 20.600 3.400c-.6 4.200-3.200 8-7.400 10.200Z"/><path d="M3.500 19.300 10.600 12.200l1.900 1.900-7.100 7.100Z"/>'
    + '<path d="M8.300 13.900l2.300 2.300M6.700 15.500l2.300 2.300"/><path d="M13.200 10.700c1.500-2 3.300-3.600 5.300-4.800"/>',
    '<path d="M11.600 11.300c1.800-3.600 4.900-6.100 8.300-7.100-.7 3.600-2.900 6.800-6.500 8.800Z"/>', WATER,
  ),
  hatchet: drawn(
    '<path d="M11.2 6.4 14.4 3.2c2.2 1.2 4.2 1.6 6.4 1.2.6 2.6.4 5-.6 7.2-2-1.400-3.800-1.800-6-1.200Z"/><path d="M13 8.200C10.800 12 8.200 16 5.400 20.600"/>'
    + '<path d="M4.300 19.900l2.200 1.400"/><path d="M17.600 5.600c.4 1.400.3 2.800-.2 4.100"/>',
    '<path d="M11.4 6.500 14.500 3.400c2.100 1.100 4.100 1.500 6.200 1.200.5 2.400.3 4.600-.6 6.700-1.900-1.200-3.700-1.600-5.800-1Z"/>', WATER,
  ),
  pry_bar: drawn(
    '<path d="M3.600 19.500 15.800 6.200c1.600-1.800 4-2.100 5.400-.5l-1.400 1.200c-.8-.9-1.900-.7-2.700.2L5 20.800Z"/><path d="M19.800 6.900l1.600.5"/>'
    + '<path d="M3.600 19.500l-.9 2.300 2.300-1"/>',
    '<path d="M4.300 19.600 16.200 6.700c1.300-1.400 3.200-1.700 4.400-.6l-.8.7c-.9-.7-2-.4-2.800.4L5.200 20.300Z"/>', RUST,
  ),
  saw: drawn(
    '<path d="M7.6 6.800 21.600 11.200v1.400"/><path d="M21.600 12.600l-1.100 2.100-2.400-1.400-1.100 2.100-2.400-1.400-1.100 2.100-2.400-1.400-1.100 2.100-2.400-1.400"/>'
    + '<path d="M7.600 6.400v10.800c-2.700.5-4.700-.8-5-3.400-.300-3.100 1.400-6.300 5-7.400Z"/><path d="M5.300 10.700c-.6 1.400-.4 2.800.5 3.700"/>',
    '<path d="M7.200 7v9.800c-2.300.3-3.900-.8-4.200-3-.2-2.700 1.200-5.500 4.200-6.800Z"/>', OCHRE,
  ),
  hammer: drawn(
    '<path d="M10.6 7.6 16.7 4.100 19.500 8.300 13.400 11.800Z"/><path d="M16.700 4.100c1.700-.9 3.300-.6 4 .5"/><path d="M12.500 10.200 5 20.300"/>'
    + '<path d="M3.800 19.500l2.300 1.600"/>',
    '<path d="M10.800 7.600 16.600 4.300 19.300 8.200 13.500 11.500Z"/>', RUST,
  ),
  fishing_rod: drawn(
    '<path d="M3.500 20.500C9 15.500 15 9.500 20.200 3"/><path d="M20.200 3v9.500"/><path d="M20.200 12.500c.2 3.200-3.300 3.200-3 .6"/>'
    + '<circle cx="7.600" cy="16.800" r="1.900"/><path d="M5.200 18.600l-1.700-1.300"/>',
    '<circle cx="7.600" cy="16.800" r="2.300"/>', SAGE,
  ),
  wrench: drawn(
    '<path d="M4.200 18.300 13.600 8.900a4.400 4.400 0 0 1 5.800-5.400l-2.700 2.700.5 2.600 2.600.5 2.700-2.700a4.400 4.400 0 0 1-5.400 5.800L7.700 21.800a2.470 2.470 0 0 1-3.500-3.500Z"/>'
    + '<circle cx="6" cy="20" r=".55" class="iw-dot"/>',
    '<path d="M4.800 18.700 14.200 9.300a3.900 3.900 0 0 1 4.300-5.200l-2.300 2.300.6 3.300 3.300.6 2.300-2.300a3.900 3.900 0 0 1-5.200 4.300L7.300 21.300a1.900 1.900 0 0 1-2.500-2.600Z"/>', WATER,
  ),
};

/** The drawn icon for a tool. */
export const toolIcon = (toolId: ToolId): string => TOOL_ICONS[toolId];

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
