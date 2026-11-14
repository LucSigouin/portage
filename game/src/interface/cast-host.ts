/**
 * The pick screen's pictures, on the page. It wraps the game's interface the way `preview-host.ts` does: it lets
 * the interface draw the screen, then sees to the four pictures.
 *
 * The pictures are canvases, asked for once for all four (`draw`, which is `look/cast-sketch.ts`) and laid in the
 * frames the cards left for them. They are kept: the screen opened again shows them at once. They are asked for
 * again only when the frames change size (the window, the interface size), and never before the page's third
 * frame: the first one times the chip. Each draw is done between two frames, on a timer, so no frame carries it.
 *
 * No picture is fine. While `draw` gives null (it does until the look's half lands, and on a machine with no 3D)
 * the cards stand as they are, a letter in each frame, and nothing is asked again until the size changes.
 *
 * Still and sharp: each canvas is as many pixels as its frame has on this screen, shown at one pixel a pixel, and
 * nudged so its corner sits on a whole screen pixel.
 */
import type { GameInterface, InterfaceIntent, InterfaceModel } from '../client/contracts.ts';
import { drawDue, pixelNudge, sketchPixels } from '../client/preview.ts';
import type { CharacterId } from '../data/cast.ts';
import type { CastSketchRequest } from '../look/cast-sketch.ts';

/** Draw the cast once: one see-through canvas a character, in the order asked, or null. */
export type CastDraw = (request: CastSketchRequest) => HTMLCanvasElement[] | null;

export interface CastHostOptions {
  draw: CastDraw;
}

/** What the pictures have done, for the console and for tests. */
export interface CastPicturesReport {
  /** True while the pick screen is on the page. */
  shown: boolean;
  /** Pictures on the page right now: four, or none. */
  pictures: number;
  /** Times `draw` was asked since the page loaded, how long the last one took (milliseconds), and the frame it was asked after. */
  draws: number;
  drawMilliseconds: number;
  drawnAfterFrame: number;
  /** What was last asked for. Null before the first ask. */
  asked: CastSketchRequest | null;
  /** The size of each picture kept, in real pixels. Null while there are none. */
  size: { width: number; height: number } | null;
}

export interface CastPicturedInterface extends GameInterface {
  cast: {
    report(): CastPicturesReport;
    /** Draw with something else from now on, and draw again: for a staged shot or a test. The game never calls it. */
    drawWith(draw: CastDraw): void;
  };
}

export function withCastPictures<Inner extends GameInterface>(inner: Inner, options: CastHostOptions): Inner & CastPicturedInterface {
  let root: HTMLElement | null = null;
  let draw = options.draw;
  let frame = 0;
  let shown = false;
  /** Who is asked for, and in whose colour: changes when the pictures would. */
  let wanted: { key: string; characters: CharacterId[]; seat: number } | null = null;
  let slots: HTMLElement[] = [];
  let size: { width: number; height: number } | null = null;
  let sizeDue = true;
  let sizeChangedAt = 0;
  let scale = 0;
  let waiting = false;
  /** The pictures kept: what they show, their size, and one canvas a character. */
  let kept: { key: string; width: number; height: number; canvases: HTMLCanvasElement[] } | null = null;
  /** The ask that gave no pictures, as `key@width x height`: not asked again until one of those changes. */
  let failed: string | null = null;
  let draws = 0;
  let drawMilliseconds = 0;
  let drawnAfterFrame = 0;
  let asked: CastSketchRequest | null = null;
  const abort = new AbortController();

  const ratio = (): number => window.devicePixelRatio || 1;
  const askKey = (): string | null => (wanted && size ? `${wanted.key}@${size.width}x${size.height}` : null);

  /** How far a canvas in `slot` is from a whole screen pixel because of a transform above it (see `preview-host.ts`). */
  const nudgeOf = (slot: HTMLElement): [number, number] => {
    let [across, down] = [0, 0];
    for (let above: HTMLElement | null = slot; above; above = above.parentElement) {
      const transform = getComputedStyle(above).transform;
      if (!transform || transform === 'none') continue;
      const matrix = new DOMMatrixReadOnly(transform);
      // Turned or scaled: there is no whole pixel to sit on.
      if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) return [0, 0];
      across += matrix.e;
      down += matrix.f;
    }
    return [pixelNudge(across, ratio()), pixelNudge(down, ratio())];
  };

  /** Lay the kept pictures in the frames, or take them out when they are not this ask's. */
  const place = (): void => {
    const fits = kept !== null && wanted !== null && kept.key === wanted.key && kept.canvases.length === slots.length;
    slots.forEach((slot, index) => {
      const canvas = fits ? kept!.canvases[index]! : null;
      const holder = slot.parentElement;
      if (!canvas) {
        if (slot.firstChild) slot.replaceChildren();
        holder?.removeAttribute('data-pictured');
        return;
      }
      if (canvas.parentElement !== slot) slot.replaceChildren(canvas);
      const [across, down] = nudgeOf(slot);
      canvas.style.transform = across !== 0 || down !== 0 ? `translate(${across}px, ${down}px)` : '';
      holder?.setAttribute('data-pictured', '');
    });
  };

  const drawNow = (): void => {
    waiting = false;
    const who = wanted;
    const at = size;
    if (!who || !at || !shown || slots.length === 0 || !slots[0]!.isConnected) return;
    const request: CastSketchRequest = {
      characters: who.characters, seat: who.seat, pixelWidth: at.width, pixelHeight: at.height, sheetHeight: Math.round(window.innerHeight * ratio()),
    };
    const from = performance.now();
    let canvases: HTMLCanvasElement[] | null = null;
    try {
      canvases = draw(request);
    } catch {
      canvases = null;
    }
    draws += 1;
    drawMilliseconds = performance.now() - from;
    drawnAfterFrame = frame;
    asked = request;
    // One picture a character, each of the size asked, or none at all: never three and a hole.
    if (!canvases || canvases.length !== who.characters.length || canvases.some((canvas) => !(canvas instanceof HTMLCanvasElement))) {
      kept = null;
      failed = `${who.key}@${at.width}x${at.height}`;
      place();
      return;
    }
    for (const canvas of canvases) {
      canvas.classList.add('cs-pic');
      canvas.style.width = `${at.width / ratio()}px`;
      canvas.style.height = `${at.height / ratio()}px`;
    }
    kept = { key: who.key, width: at.width, height: at.height, canvases };
    failed = null;
    place();
  };

  /** After the interface has drawn the screen: find the frames, keep the pictures in them, ask when a draw is due. */
  const follow = (): void => {
    if (!root || !wanted) return;
    if (slots.length === 0 || !slots[0]!.isConnected) {
      slots = Array.from(root.querySelectorAll<HTMLElement>('.cs-slot'));
      sizeDue = true;
    }
    if (slots.length === 0) return;
    if (sizeDue) {
      sizeDue = false;
      // The frames are all one size. Its true size, fractions of a pixel and all (`clientWidth` rounds).
      const box = slots[0]!.getBoundingClientRect();
      const measured = sketchPixels(box.width, box.height, ratio());
      if (measured?.width !== size?.width || measured?.height !== size?.height) sizeChangedAt = performance.now();
      size = measured;
      place();
    } else if (kept && kept.canvases[0]!.parentElement !== slots[0]) {
      place();
    }
    const key = askKey();
    if (waiting || !drawDue({
      frame, wantedKey: wanted.key, size, drawn: kept && { key: kept.key, width: kept.width, height: kept.height },
      failedKey: key !== null && failed === key ? wanted.key : null, sizeChangedAt, now: performance.now(),
    })) return;
    waiting = true;
    setTimeout(drawNow, 0);
  };

  const hosted = inner as Inner & CastPicturedInterface;
  const mount = inner.mount.bind(inner);
  const update = inner.update.bind(inner);
  const dispose = inner.dispose.bind(inner);

  hosted.mount = (element: HTMLElement, emit: (intent: InterfaceIntent) => void): void => {
    root = element;
    mount(element, emit);
    window.addEventListener('resize', () => { sizeDue = true; }, { signal: abort.signal });
    // The words arriving in their own faces can change a card's width, and with it the frame's.
    void document.fonts?.ready.then(() => { sizeDue = true; });
  };
  hosted.update = (model: InterfaceModel): void => {
    frame += 1;
    const panel = model.panel?.id === 'character_select' && model.confirm === null ? model.panel : null;
    if (model.uiScale !== scale) {
      scale = model.uiScale;
      sizeDue = true;
    }
    update(model);
    shown = panel !== null;
    if (!panel) {
      slots = [];
      return;
    }
    const characters = panel.cards.map((card) => card.character);
    const key = `${panel.seat}|${characters.join(',')}`;
    if (wanted?.key !== key) wanted = { key, characters, seat: panel.seat };
    follow();
  };
  hosted.dispose = (): void => {
    abort.abort();
    for (const canvas of kept?.canvases ?? []) canvas.remove();
    kept = null;
    slots = [];
    root = null;
    dispose();
  };
  hosted.cast = {
    report: () => ({
      shown,
      pictures: kept && slots.length > 0 && kept.canvases[0]!.parentElement === slots[0] ? kept.canvases.length : 0,
      draws, drawMilliseconds, drawnAfterFrame, asked,
      size: kept && { width: kept.width, height: kept.height },
    }),
    drawWith: (other: CastDraw): void => {
      draw = other;
      kept = null;
      failed = null;
      place();
    },
  };
  return hosted;
}
