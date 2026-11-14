/**
 * While a sheet is open, the cards at the screen's edges stand aside (the master review of round 4, finding 3).
 *
 * The inventory sheet is 77 rem wide since it seats its info panel: at 1366 and at 1920 it lies over the quest card,
 * the crew list, the health bars and the minimap, and cut them mid-word. It cannot sit clear of them and keep its
 * panel, so those cards are hidden while a sheet is open and come back when it closes. Instant: nothing fades or
 * slides. The notes in the corner stay, drawn over the sheet's edge, whole: a drop's take-back note is read there.
 * A talk keeps the screen as it is: the world shows round its slip (`iw-veil-clear`).
 */
import type { PanelModel } from '../client/contracts.ts';

/** True while an open panel covers the screen-edge cards. */
export const sheetHidesEdges = (panel: Pick<PanelModel, 'id'> | null): boolean => panel !== null && panel.id !== 'dialogue';

/** Hide or show the edge cards, by the `hidden` attribute: no transition can run on it. */
export function setEdgeCardsHidden(cards: readonly (HTMLElement | undefined)[], hidden: boolean): void {
  for (const card of cards) if (card) card.hidden = hidden;
}
