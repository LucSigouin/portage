/**
 * Full screen (Luc's feedback note #7: "add full screen capability"). A line in the lobby menu and on the pause card
 * toggles the whole page with the browser's Fullscreen API. No key of its own: F11 already does it in every desktop
 * browser.
 *
 * The line's words are read from the page each frame, so they stay true when the player leaves by the browser's own
 * Esc or F11. Where the browser has no Fullscreen API (iPhone Safari), `view` is null and the line is not shown.
 */

/** The parts of `document` this uses: a fake stands in for it in tests. */
export interface FullscreenPage {
  readonly fullscreenEnabled: boolean;
  readonly fullscreenElement: Element | null;
  readonly documentElement: { requestFullscreen(): Promise<void> };
  exitFullscreen(): Promise<void>;
}

export interface FullscreenView {
  /** True while the page fills the screen. */
  active: boolean;
}

export class FullscreenSwitch {
  private readonly page: FullscreenPage;

  constructor(page: FullscreenPage) {
    this.page = page;
  }

  /** Null where the browser cannot go full screen: then the menus have no line for it. */
  get view(): FullscreenView | null {
    if (!this.page.fullscreenEnabled) return null;
    return { active: this.page.fullscreenElement !== null };
  }

  /** In or out. A refusal (no click behind it, a frame that forbids it) leaves the page as it was, and says nothing. */
  toggle(): void {
    if (!this.page.fullscreenEnabled) return;
    const asked = this.page.fullscreenElement !== null ? this.page.exitFullscreen() : this.page.documentElement.requestFullscreen();
    void asked.catch(() => undefined);
  }
}
