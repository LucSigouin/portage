/**
 * The two drawings on the inventory's top buttons, in the same hand as `icons.ts`: one pen weight, the theme's
 * inks and washes, a 24-unit grid, and nothing that moves.
 */
const drawn = (pen: string, wash: string, washColour: string): string =>
  `<svg class="iw-ico" viewBox="0 0 24 24" aria-hidden="true"><g class="iw-wash" fill="${washColour}">${wash}</g>`
  + `<g class="iw-pen">${pen}</g></svg>`;

/**
 * Stow all: the pack, with an arrow down into the canoe's hull under it.
 * The pack is a sack with a flap and a strap; the hull is the canoe of the HUD, seen from the side.
 */
export const STOW_ICON = drawn(
  // the pack: body, flap, buckle strap
  '<path d="M4.200 4.600c.2-1.300 1.200-2 2.700-2h2.400c1.500 0 2.500.7 2.700 2l.5 5.800c.1 1.300-.7 2.100-2 2.100H5.700c-1.300 0-2.100-.8-2-2.100Z"/>'
  + '<path d="M4.100 6.300c2.600.9 5.400.9 8 0"/><path d="M8.100 6.900v2.300"/>'
  // the arrow, from the pack down to the hull
  + '<path d="M17.300 3.200c1.900 2.300 2.300 5.400 1.200 8.900"/><path d="M16.100 9.800l2.300 2.600 2.700-2.100"/>'
  // the hull
  + '<path d="M2.400 15.800c2.900 1.200 6.100 1.700 9.600 1.700s6.700-.5 9.600-1.700c-1.300 3.700-4.700 5.700-9.600 5.700s-8.300-2-9.600-5.700Z"/>',
  '<path d="M3.200 16.500c2.700 1 5.600 1.500 8.800 1.500s6.100-.5 8.800-1.500c-1.400 3-4.500 4.600-8.800 4.600s-7.400-1.600-8.800-4.600Z"/>',
  'var(--iw-rust)',
);

/**
 * Scoop water: a bucket tipped into the lake, its bail handle up, water in it and a wave under it.
 * (The bailing can of the tool belt is a straight can with drops beside it: this is the bucket, at the water.)
 */
export const BUCKET_ICON = drawn(
  // the bucket, leaning: rim, sides, bottom
  '<path d="M6.300 8.200 8.300 17.200c2.500 1 5 1 7.500 0l2-9"/><ellipse cx="12.050" cy="8.100" rx="5.800" ry="1.800"/>'
  // the bail handle, swung up
  + '<path d="M6.300 8C6.600 1.800 17.500 1.800 17.800 8"/>'
  // the water in it
  + '<path d="M7.400 12.300c1.500.7 2.900-.6 4.500 0s3 .7 4.700-.1"/>'
  // the lake under it
  + '<path d="M2.300 20.600c1.600-1.300 3.200-1.300 4.800 0s3.300 1.300 4.900 0 3.300-1.300 4.900 0 3.200 1.300 4.800 0"/>',
  '<path d="M7.500 12.500c1.500.6 2.900-.6 4.400 0s3 .7 4.600-.1l-1 4.600c-2.300.8-4.600.8-7 0Z"/>',
  'var(--iw-water)',
);
