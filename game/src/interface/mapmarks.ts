/**
 * The map's marks, said on the map panel (the master review of round 3, finding 4): one line in the footer that
 * says a click marks a spot and a click on a mark takes it down, and a legend row for each mark standing, with
 * its player's name and the glint in that player's colour, as the chart paints it (`chart.ts`).
 *
 * Pure, like `views.ts`: the words and the colours come from the model. Nothing here moves.
 */
import './mapmarks.css';
import type { PanelModel } from '../client/contracts.ts';
import { h } from './dom.ts';
import type { ViewNode } from './dom.ts';

type MapModel = Extract<PanelModel, { id: 'map' }>;

/** A colour as the model gives it, or nothing: only `#rrggbb` is ever written into the drawing. */
const safeColour = (color: string): string => (/^#[0-9a-fA-F]{6}$/.test(color) ? color : 'none');

/**
 * The glint of a mark, as the chart paints it: a four-pointed star taller than it is wide, in the player's colour,
 * an ink line round it and an ink dot on the spot (`PING_MARK` in `chart.ts`: 10.5 tall, 6 wide, waist 2.1).
 */
export const glintIcon = (color: string): string =>
  `<svg class="iw-ico iw-glint" viewBox="-8 -12 16 24" aria-hidden="true">`
  + `<path d="M0 -10.5 L2.1 -2.1 L6 0 L2.1 2.1 L0 10.5 L-2.1 2.1 L-6 0 L-2.1 -2.1 Z" fill="${safeColour(color)}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`
  + `<circle r="1.1" fill="currentColor"/></svg>`;

/** The legend rows of the marks standing: the glint in its player's colour, and whose it is. */
export function markLegendRows(panel: MapModel): ViewNode[] {
  return (panel.marks ?? []).map((mark) => h('li.iw-legend-mark', { key: `mark-${mark.playerId}`, 'data-player': mark.playerId },
    h('i.iw-i', { html: glintIcon(mark.color), 'aria-hidden': 'true' }), h('span', null, mark.label)));
}

/** The line in the map's footer, beside the way out. Null when the model has none. */
export const mapHintView = (panel: MapModel): ViewNode | null =>
  (panel.markHint ? h('small.iw-map-hint', { key: 'hint' }, panel.markHint) : null);
