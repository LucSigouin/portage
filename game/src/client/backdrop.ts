/**
 * The canoe in the scene behind the main menu (Luc, Round 4: "the video portion where its floating around can you
 * put it there?"). It is the canoe of the save played last (`preview.ts` says which).
 *
 * The scene is a real game nobody plays, and its rules go on stepping the plain canoe they always stepped. The
 * saved canoe is only its dress: the hull that is drawn, what is bolted on, the sail, the lantern, the pail. The
 * dress comes off before every step and goes back on after it. So the drift is the same for every canoe, to the
 * last digit: a raised sail catches no wind, a leaky hull takes no water, a long hull grounds nowhere new.
 *
 * No save, a broken save, a hull this build cannot draw: no dress, and the scene is as it always was.
 *
 * Reading only: nothing in here writes to a save. No DOM and no drawing.
 */
import type { LoadResult, SlotSummary } from '../save/index.ts';
import { NEUTRAL_INPUT, drainEvents, step } from '../sim/index.ts';
import type { CanoeState, GameState } from '../sim/index.ts';
import { lastPlayedDress } from './preview.ts';
import type { CanoeDress } from './preview.ts';

/** Where the session lists its saves: the same array until a save changes, and the slot Continue opens. */
export interface BackdropSlots {
  slotSummaries(): readonly SlotSummary[];
  latestSlot(): number | null;
}

/** Put a dress on a canoe. Where it is and how it sits do not change. */
function wear(canoe: CanoeState, dress: CanoeDress): void {
  canoe.hullTier = dress.hullTier;
  canoe.attachments = dress.attachments;
  canoe.sailRaised = dress.sailRaised;
  canoe.lanternLit = dress.lanternLit;
  canoe.rainProgress = dress.rainProgress;
}

/** The backdrop's canoe: which one it wears, and the one frame of drift. */
export class BackdropCanoe {
  /** The saved canoe the scene shows. Null: the scene's own. */
  dress: CanoeDress | null = null;
  /** How often the saves have been read for it: once for each change to them. */
  reads = 0;

  /** The slot list the dress was read from. */
  private listed: readonly SlotSummary[] | null = null;
  /** The state that has the dress on, and what its canoe is under it: the rules' own, to the letter. */
  private dressed: GameState | null = null;
  private readonly plain: CanoeDress = { hullTier: 0, attachments: [], sailRaised: false, lanternLit: false, rainProgress: 0 };

  /**
   * One frame of the scene. The rules step the plain canoe (`still`: not at all, the tab is hidden), then the
   * state is handed back wearing the saved one, for the look. `backdrop` may be a state just staged afresh.
   * The saves are read again only when the session's slot list is a new one: after a save, a delete.
   */
  drift(backdrop: GameState, slots: BackdropSlots, store: { load(slot: number): LoadResult }, frameSeconds: number, still: boolean): void {
    const listed = slots.slotSummaries();
    if (listed !== this.listed) {
      this.listed = listed;
      this.reads += 1;
      try {
        this.dress = lastPlayedDress(slots.latestSlot(), (slot) => store.load(slot));
      } catch {
        // A save list that throws is a broken save.
        this.dress = null;
      }
    }
    const canoe = backdrop.canoe;
    if (this.dressed === backdrop) wear(canoe, this.plain);
    this.dressed = null;
    if (!still) step(backdrop, NEUTRAL_INPUT, frameSeconds);
    drainEvents(backdrop);
    if (!this.dress) return;
    // What the rules left is kept for their next step.
    this.plain.hullTier = canoe.hullTier;
    this.plain.attachments = canoe.attachments;
    this.plain.sailRaised = canoe.sailRaised;
    this.plain.lanternLit = canoe.lanternLit;
    this.plain.rainProgress = canoe.rainProgress;
    wear(canoe, this.dress);
    this.dressed = backdrop;
  }

  /** The state as the rules know it: a copy with the dress off. For tests and for measuring the drift. */
  undressed(backdrop: GameState): GameState {
    const copy = structuredClone(backdrop);
    if (this.dressed === backdrop) wear(copy.canoe, { ...this.plain, attachments: [...this.plain.attachments] });
    return copy;
  }
}
