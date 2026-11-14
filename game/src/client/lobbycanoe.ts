/**
 * The lobby's canoe as the look drew it, for the lobby's camera (`lobbyCameraPose` in `camera.ts`): how the
 * camera frames it (`lobbyframe.ts`).
 *
 * Measuring walks every mesh of the canoe, so it is done once for each canoe: when the hull, what is bolted on or
 * the sail is another than the one measured. The framing is worked out again only for another canoe, another
 * window shape or another lens. On every other frame this costs three comparisons.
 */
import type { CanoeState } from '../sim/index.ts';
import type { CanoeBounds } from './builtview.ts';
import type { WorldView } from './contracts.ts';
import { LOBBY_UNFRAMED, lobbyFraming } from './lobbyframe.ts';
import type { LobbyFraming } from './lobbyframe.ts';

type Look = Pick<WorldView, 'canoeBounds' | 'viewAspect'>;

export class LobbyCanoe {
  /** How often the look has been asked to measure the canoe, and how often a framing was worked out. */
  measures = 0;
  framings = 0;

  private hullTier = -1;
  private attachments: readonly string[] | null = null;
  private sailRaised = false;
  private bounds: CanoeBounds | null = null;
  private framed: { bounds: CanoeBounds; aspect: number; fieldOfView: number; framing: LobbyFraming } | null = null;

  /**
   * After the look's `sync`: true when the canoe it just drew is another than the one measured, and measures it.
   * The backdrop wears the same list of attachments until the saves change (`backdrop.ts`), so the list itself is compared.
   */
  changed(canoe: CanoeState, look: Look): boolean {
    if (canoe.attachments === this.attachments && canoe.hullTier === this.hullTier && canoe.sailRaised === this.sailRaised) return false;
    this.hullTier = canoe.hullTier;
    this.attachments = canoe.attachments;
    this.sailRaised = canoe.sailRaised;
    this.bounds = look.canoeBounds?.() ?? null;
    this.measures += 1;
    return true;
  }

  /**
   * How the lobby's camera frames the canoe as measured, in the window as it is now, with this lens. Before the
   * look has drawn a canoe, or with a look that cannot measure: the lobby as it always was.
   */
  framing(look: Look, fieldOfView: number): LobbyFraming {
    if (!this.bounds) return LOBBY_UNFRAMED;
    const aspect = look.viewAspect?.() ?? this.bounds.aspect;
    const framed = this.framed;
    if (framed && framed.bounds === this.bounds && framed.aspect === aspect && framed.fieldOfView === fieldOfView) return framed.framing;
    this.framings += 1;
    const framing = lobbyFraming(aspect > 0 ? { ...this.bounds, aspect } : this.bounds, fieldOfView);
    this.framed = { bounds: this.bounds, aspect, fieldOfView, framing };
    return framing;
  }
}
