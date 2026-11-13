/**
 * The lobby's canoe preview, on the page. It wraps the game's interface: every frame it adds the preview's words
 * to the lobby's model (`client/preview.ts` decides them), lets the interface draw, and sees to the picture.
 *
 * The picture is a canvas, drawn once (`draw`, which is `look/canoe-sketch.ts`) and laid in the frame the lobby
 * view left for it. It is drawn again only for another canoe (back from a game, a save deleted) or another size
 * (the window, the interface scale), and never before the page's third frame: the first one times the chip.
 * Each draw is done between two frames, on a timer, so no frame carries it.
 *
 * Still and sharp: the canvas is as many pixels as the frame has on this screen, shown at one pixel a pixel, and
 * nudged so its corner sits on a whole screen pixel.
 */
import './preview.css';
import type { GameInterface, InterfaceIntent, InterfaceModel } from '../client/contracts.ts';
import { drawDue, pixelNudge, previewModel, previewSubject, sketchPixels } from '../client/preview.ts';
import type { DrawnPicture, PreviewSubject } from '../client/preview.ts';
import type { LoadResult, SlotSummary } from '../save/index.ts';
import type { GameState } from '../sim/index.ts';

export interface PreviewHostOptions {
  /** The session's save slots, as it lists them (the same array until a save changes) and the slot Continue opens. */
  slotSummaries(): readonly SlotSummary[];
  latestSlot(): number | null;
  /** Read one slot. */
  load(slot: number): LoadResult;
  /** Draw a canoe once: a see-through canvas of exactly that size, or null. */
  draw(request: { state: GameState; pixelWidth: number; pixelHeight: number; sheetHeight: number }): HTMLCanvasElement | null;
}

/** What the preview has done, for the console and for tests. */
export interface PreviewReport {
  /** What is shown: the canoe of a save, the starter canoe, or nothing. */
  shown: 'save' | 'starter' | null;
  caption: string | null;
  /** Pictures drawn since the page loaded, how long the last one took (milliseconds), and the frame it was drawn after. */
  draws: number;
  drawMilliseconds: number;
  drawnAfterFrame: number;
  /** The picture on the page, in real pixels. Null while there is none. */
  picture: DrawnPicture | null;
}

export interface PreviewedInterface extends GameInterface {
  preview: { report(): PreviewReport };
}

export function withCanoePreview(inner: GameInterface, options: PreviewHostOptions): PreviewedInterface {
  let root: HTMLElement | null = null;
  let frame = 0;
  let summaries: readonly SlotSummary[] | null = null;
  let subject: PreviewSubject | null = null;
  let failedKey: string | null = null;
  let picture: (DrawnPicture & { canvas: HTMLCanvasElement }) | null = null;
  let slot: HTMLElement | null = null;
  let size: { width: number; height: number } | null = null;
  let sizeDue = true;
  let sizeChangedAt = 0;
  let scale = 0;
  let waiting = false;
  let draws = 0;
  let drawMilliseconds = 0;
  let drawnAfterFrame = 0;
  const abort = new AbortController();

  const ratio = (): number => window.devicePixelRatio || 1;

  /**
   * Lay the picture in the frame, its corner on a whole screen pixel.
   *
   * A browser already puts a picture on whole pixels inside whatever space it is laid out in. What it does not
   * round is a transform above it, and the lobby's column is moved up by a share of its own height: a fraction of a
   * pixel, which would smear every line of the picture over two rows. So the picture is moved back by exactly
   * that fraction. (Measuring where the picture ends up, `getBoundingClientRect`, gives the wrong answer here:
   * it adds the unrounded layout to the transform, and the browser paints the rounded one.)
   */
  const place = (): void => {
    if (!picture || !slot) return;
    const canvas = picture.canvas;
    if (canvas.parentElement !== slot) slot.replaceChildren(canvas);
    let [across, down] = [0, 0];
    for (let above: HTMLElement | null = slot; above; above = above.parentElement) {
      const transform = getComputedStyle(above).transform;
      if (!transform || transform === 'none') continue;
      const matrix = new DOMMatrixReadOnly(transform);
      // Turned or scaled: there is no whole pixel to sit on.
      if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) {
        [across, down] = [0, 0];
        break;
      }
      across += matrix.e;
      down += matrix.f;
    }
    const [nudgeAcross, nudgeDown] = [pixelNudge(across, ratio()), pixelNudge(down, ratio())];
    canvas.style.transform = nudgeAcross !== 0 || nudgeDown !== 0 ? `translate(${nudgeAcross}px, ${nudgeDown}px)` : '';
  };

  const drop = (): void => {
    picture?.canvas.remove();
    picture = null;
  };

  const drawNow = (): void => {
    waiting = false;
    const wanted = subject;
    if (!wanted || !size || !slot?.isConnected) return;
    const from = performance.now();
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = options.draw({ state: wanted.state, pixelWidth: size.width, pixelHeight: size.height, sheetHeight: Math.round(window.innerHeight * ratio()) });
    } catch {
      canvas = null;
    }
    draws += 1;
    drawMilliseconds = performance.now() - from;
    drawnAfterFrame = frame;
    drop();
    if (!canvas) {
      // No picture, and no line under an empty frame: the lobby is as it was before there was a preview.
      failedKey = wanted.key;
      return;
    }
    canvas.className = 'pv-pic';
    canvas.style.width = `${size.width / ratio()}px`;
    canvas.style.height = `${size.height / ratio()}px`;
    picture = { canvas, key: wanted.key, width: size.width, height: size.height };
    place();
  };

  /** After the interface has drawn the lobby: find the frame, keep the picture in it, draw when one is due. */
  const follow = (): void => {
    if (!root || !subject) return;
    if (!slot?.isConnected) {
      slot = root.querySelector<HTMLElement>('.pv-sketch');
      sizeDue = true;
    }
    if (!slot) return;
    // Another canoe: the old picture goes at once, not when the new one is ready.
    if (picture && picture.key !== subject.key) drop();
    if (sizeDue) {
      sizeDue = false;
      // Its true size, fractions of a pixel and all (`clientWidth` rounds, and could round up past the frame).
      const frame = slot.getBoundingClientRect();
      const measured = sketchPixels(frame.width, frame.height, ratio());
      if (measured?.width !== size?.width || measured?.height !== size?.height) sizeChangedAt = performance.now();
      size = measured;
      place();
    } else if (picture && picture.canvas.parentElement !== slot) {
      place();
    }
    if (waiting || !drawDue({ frame, wantedKey: subject.key, size, drawn: picture, failedKey, sizeChangedAt, now: performance.now() })) return;
    waiting = true;
    setTimeout(drawNow, 0);
  };

  return {
    mount(element: HTMLElement, emit: (intent: InterfaceIntent) => void): void {
      root = element;
      inner.mount(element, emit);
      window.addEventListener('resize', () => { sizeDue = true; }, { signal: abort.signal });
      // The lobby's words arriving in their own faces change the column's height, and with it where the picture sits.
      void document.fonts?.ready.then(() => { sizeDue = true; });
    },
    update(model: InterfaceModel): void {
      frame += 1;
      const lobby = model.lobby;
      if (lobby) {
        const listed = options.slotSummaries();
        if (listed !== summaries) {
          summaries = listed;
          subject = previewSubject(listed, options.latestSlot(), options.load);
        }
        if (subject && subject.key !== failedKey) lobby.preview = previewModel(subject);
      }
      if (model.uiScale !== scale) {
        scale = model.uiScale;
        sizeDue = true;
      }
      inner.update(model);
      if (lobby?.preview) follow();
    },
    dispose(): void {
      abort.abort();
      drop();
      slot = null;
      root = null;
      inner.dispose();
    },
    preview: {
      report: () => ({
        shown: subject && subject.key !== failedKey ? subject.kind : null,
        caption: subject && subject.key !== failedKey ? subject.caption : null,
        draws,
        drawMilliseconds,
        drawnAfterFrame,
        picture: picture && { key: picture.key, width: picture.width, height: picture.height },
      }),
    },
  };
}
