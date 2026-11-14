/**
 * While a sheet is open, the cards at the screen's edges stand aside (the master review of round 4, finding 3).
 *
 * The inventory sheet is 77 rem wide since it seats its info panel: at 1366 and at 1920 it lies over the quest card,
 * the crew list, the health bars and the minimap, and cut them mid-word. It cannot sit clear of them and keep its
 * panel, so those cards are hidden while a sheet is open and come back when it closes. Instant: nothing fades or
 * slides. The notes in the corner stay, drawn over the sheet's edge, whole: a drop's take-back note is read there.
 * A talk keeps the screen as it is: the world shows round its slip (`iw-veil-clear`).
 *
 * In a crew the game runs on behind a sheet, so a player eating from the inventory must still see the hunger bar
 * (the second review of round 4, new finding 1). There the health card is not hidden but drawn small, in one row at
 * the bottom left, beside the tool belt: the three bars with their numbers and the water in the hull, no words, no
 * crew list. That band is clear of every sheet at 1366x768 and 1920x1080, and the sheet keeps its full size. Alone
 * the game pauses behind a sheet, and the card hides as before.
 */
import type { PanelModel } from '../client/contracts.ts';

/** True while an open panel covers the screen-edge cards. */
export const sheetHidesEdges = (panel: Pick<PanelModel, 'id'> | null): boolean => panel !== null && panel.id !== 'dialogue';

/** How the edge cards stand for this panel: all shown, all hidden, or hidden but the health card drawn small (a crew). */
export type EdgeCards = 'shown' | 'hidden' | 'small';

export function edgeCardsFor(panel: Pick<PanelModel, 'id'> | null, inCrew: boolean): EdgeCards {
  if (!sheetHidesEdges(panel)) return 'shown';
  return inCrew ? 'small' : 'hidden';
}

/** Hide or show the edge cards, by the `hidden` attribute: no transition can run on it. */
export function setEdgeCardsHidden(cards: readonly (HTMLElement | undefined)[], hidden: boolean): void {
  for (const card of cards) if (card) card.hidden = hidden;
}
