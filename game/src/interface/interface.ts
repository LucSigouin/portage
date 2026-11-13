/**
 * The Ink & Wash interface: the game's menus and HUD in the hand Luc approved
 * (art study B2). Paper cards held by tape, handwriting, a field-notes card,
 * a compass strip and a hotbar of inked tool cards.
 *
 * It draws the interface model and nothing else. Each part of the screen is
 * described by a pure view (`views.ts`) and reconciled into the page only
 * when its piece of the model changed (`dom.ts`), so an idle panel costs a
 * string compare and nothing on screen is ever rebuilt.
 *
 * The only state kept here is what a browser needs: which control has the
 * keyboard, whether the player is steering the menus by key, and which rows
 * of the inventory the player has opened to read.
 */
import './fonts.css';
import './theme.css';
import type { CompassModel, GameInterface, InterfaceIntent, InterfaceModel, PanelModel, SettingId } from '../client/contracts.ts';
import { arrivalView } from './arrival.ts';
import { intentOf, reconcile } from './dom.ts';
import { DROP_KEY_CODE, quickIntent } from './inventoryview.ts';
import type { ViewNode } from './dom.ts';
import { MapChart, MinimapCard } from './chart.ts';
import { feedbackInputIntent, focusFeedbackNote } from './feedback.ts';
import { FILTER_DEFINITIONS, ICON, toqueIcon } from './icons.ts';
import { paperTexture, tornPageOutline } from './paper.ts';
import {
  builtView, confirmView, debugView, hintView, hotbarView, itemDetailKeys, lineNoteView, lobbyView, notesView, panelView, promptView, toastsView,
  vitalsView,
} from './views.ts';

type PartName = 'lobby' | 'vitals' | 'notes' | 'hint' | 'prompt' | 'hotbar' | 'toasts' | 'arrival' | 'panel' | 'confirm' | 'built' | 'debug';

interface Part {
  element: HTMLElement;
  /** What the part was last drawn from. Unchanged means nothing to do. */
  signature: string;
  nodes: ViewNode[];
}

/** The strip shows 90 degrees either side of dead ahead. Marks further round than this are pinned to its end with an arrow. */
const COMPASS_PIN = 84;

const MARK_ICON: Record<string, string> = { quest: ICON.flag, canoe: ICON.canoe, respawn: ICON.camp };

/** The four faces of the notebook. */
const FACES = ['1em "IM Fell English"', 'italic 1em "IM Fell English"', '1em "Kalam"', '700 1em "Kalam"'];
/** The longest the lobby waits for them, the same three seconds a browser holds text back for a face. */
const FACE_WAIT_MILLISECONDS = 3000;

function element(className: string, parent: HTMLElement, tag = 'div'): HTMLElement {
  const created = document.createElement(tag);
  created.className = className;
  parent.appendChild(created);
  return created;
}

/**
 * The compass strip. The ticks are drawn once and the whole track slides by
 * one transform, so turning costs a single style write per frame.
 */
class CompassStrip {
  readonly element: HTMLElement;
  private readonly track: HTMLElement;
  private readonly letters: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly markElements = new Map<string, { root: HTMLElement; text: HTMLElement | null; position: string; label: string }>();
  private heading = Number.NaN;
  private lettersSignature = '';

  constructor(parent: HTMLElement) {
    this.element = element('iw-compass', parent);
    const strip = element('iw-strip', this.element);
    strip.dataset.clips = '';
    this.track = element('iw-track', strip);
    // Ticks every 15 degrees over three turns, so the strip never runs out however far it slides.
    let ticks = '';
    for (let degrees = -360; degrees <= 720; degrees += 15) {
      ticks += `<i class="iw-tk${degrees % 45 === 0 ? ' iw-big' : ''}" style="--at:${degrees}"></i>`;
    }
    this.track.innerHTML = ticks;
    this.letters = element('iw-letters', this.track);
    this.marks = element('iw-marks', this.element);
    element('iw-needle', this.element, 'i');
  }

  update(compass: CompassModel): void {
    // The strip moves in whole degrees. The model carries fractions, for a strip that slides on a
    // transform; this one restyles every tick and letter when `--heading` changes, and a change every
    // frame cost frames (the look's 55 fps test went red). Round here until the compass is drawn that way.
    const heading = Math.round(compass.headingDegrees) % 360;
    if (heading !== this.heading) {
      this.heading = heading;
      this.track.style.setProperty('--heading', String(heading));
    }

    // The cardinal points ride on the track: they only need drawing when the model's set changes.
    let lettersSignature = '';
    for (const mark of compass.marks) if (mark.kind === 'cardinal') lettersSignature += `${mark.label}@${mark.bearingDegrees};`;
    if (lettersSignature !== this.lettersSignature) {
      this.lettersSignature = lettersSignature;
      this.letters.textContent = '';
      for (const mark of compass.marks) {
        if (mark.kind !== 'cardinal') continue;
        for (const turn of [-360, 0, 360]) {
          const letter = element('iw-lb', this.letters, 'span');
          letter.textContent = mark.label;
          letter.style.setProperty('--at', String(mark.bearingDegrees + turn));
        }
      }
    }

    // Quest, canoe and camp marks move against the strip, so each is placed by its own bearing.
    const wanted = new Set<string>();
    for (const mark of compass.marks) {
      if (mark.kind === 'cardinal') continue;
      wanted.add(mark.id);
      let entry = this.markElements.get(mark.id);
      if (!entry) {
        const root = element(`iw-mark iw-mark-${mark.kind}`, this.marks);
        const holder = element('iw-i', root, 'i');
        if (mark.kind === 'crew') {
          // A crewmate: their toque in their colour, and no chip. The crew list says who and how far.
          holder.innerHTML = toqueIcon(mark.color ?? '');
          root.dataset.player = mark.id;
          root.style.setProperty('--n', String(mark.crewIndex ?? 0));
          entry = { root, text: null, position: '', label: '' };
        } else {
          holder.innerHTML = MARK_ICON[mark.kind] ?? ICON.flag;
          entry = { root, text: element('iw-mark-chip', root, 'span'), position: '', label: '' };
        }
        this.markElements.set(mark.id, entry);
      }
      // Whole degrees here too, for the same reason.
      const relative = Math.round(mark.relativeDegrees);
      const beyond = Math.abs(relative) > COMPASS_PIN;
      const side = !beyond ? '' : relative < 0 ? 'left' : 'right';
      const position = `${Math.max(-COMPASS_PIN, Math.min(COMPASS_PIN, relative))}|${side}`;
      if (position !== entry.position) {
        entry.position = position;
        entry.root.style.setProperty('--at', String(Math.max(-COMPASS_PIN, Math.min(COMPASS_PIN, relative))));
        entry.root.classList.toggle('iw-off-left', side === 'left');
        entry.root.classList.toggle('iw-off-right', side === 'right');
      }
      const label = mark.distanceText ? `${mark.label} · ${mark.distanceText}` : mark.label;
      if (label !== entry.label) {
        entry.label = label;
        if (entry.text) entry.text.textContent = label;
        else entry.root.title = label;
      }
    }
    for (const [id, entry] of this.markElements) {
      if (wanted.has(id)) continue;
      entry.root.remove();
      this.markElements.delete(id);
    }
  }
}

export class InkInterface implements GameInterface {
  private root: HTMLElement | null = null;
  private emit: (intent: InterfaceIntent) => void = () => {};
  private readonly parts = new Map<PartName, Part>();
  private readonly abort = new AbortController();
  private hud: HTMLElement | null = null;
  private compass: CompassStrip | null = null;
  /** The minimap, top right, and the map panel's chart. Each paints only when its picture would change. */
  private minimap: MinimapCard | null = null;
  private readonly mapChart = new MapChart();
  private hovered: Element | null = null;
  private faceTimer: ReturnType<typeof setTimeout> | null = null;

  // What was last applied, so a frame that changes nothing writes nothing.
  private scale = 0;
  private paused: boolean | null = null;
  private covered: boolean | null = null;
  private confirming: boolean | null = null;
  private hudShown: boolean | null = null;
  private dialogue: boolean | null = null;
  /** The built view holds the screen: what a click anywhere sends, or null the rest of the time. */
  private builtDismiss: InterfaceIntent | null = null;
  /** The control that had the keyboard when the built view began: it gets it back. */
  private heldBeforeBuilt: HTMLElement | null = null;
  /** The inventory rows the player has opened to read (`itemDetailKey`). Emptied when the inventory closes. */
  private readonly openItems = new Set<string>();
  /** The panel last drawn, so a row opened by a press is drawn at once, not a frame later. */
  private lastPanel: PanelModel | null = null;

  // The keyboard.
  /** The top thing with controls on it: `confirm`, `panel:<id>`, `lobby`, or nothing. */
  private surface = '';
  /** Screen and open panels, to tell whether the game acted on a key. */
  private stack = '';
  /** True while a key-binding slot waits for its key: every key is the game's then. */
  private capturing = false;
  /** True once the player steers the menus by key, until the pointer is used again. */
  private keyboardNavigation = false;
  /** A Tab press the game has not answered yet. If the game ignores it, it moves the focus. */
  private pendingTab: { backwards: boolean; stack: string } | null = null;

  mount(root: HTMLElement, emit: (intent: InterfaceIntent) => void): void {
    this.root = root;
    this.emit = emit;
    // Sizes are in rem, so the scale of the whole interface is the root font size.
    document.documentElement.classList.add('iw-document');
    root.classList.add('iw');
    root.style.setProperty('--iw-tex', `url(${paperTexture()})`);
    root.style.setProperty('--iw-page-edge', tornPageOutline());
    root.insertAdjacentHTML('beforeend', FILTER_DEFINITIONS);

    const part = (name: PartName, className: string, parent: HTMLElement): void => {
      this.parts.set(name, { element: element(className, parent), signature: '', nodes: [] });
    };
    part('lobby', 'iw-lobby', root);
    this.hud = element('iw-hud', root);
    part('vitals', 'iw-part', this.hud);
    this.compass = new CompassStrip(this.hud);
    this.minimap = new MinimapCard(this.hud);
    this.mapChart.listen(emit);
    part('notes', 'iw-part', this.hud);
    part('hint', 'iw-part', this.hud);
    part('prompt', 'iw-part', this.hud);
    part('hotbar', 'iw-part', this.hud);
    part('toasts', 'iw-toasts', root);
    part('arrival', 'iw-arrival', root);
    part('panel', 'iw-veil', root);
    part('confirm', 'iw-confirm', root);
    part('built', 'iw-shown', root);
    part('debug', 'iw-debug', root);
    for (const name of ['lobby', 'panel', 'confirm', 'built', 'debug'] as const) this.parts.get(name)!.element.hidden = true;
    this.hud.hidden = true;

    const options = { signal: this.abort.signal };
    root.addEventListener('click', (event) => this.onClick(event), options);
    root.addEventListener('change', (event) => this.onChange(event), options);
    root.addEventListener('input', (event) => this.onInput(event), options);
    root.addEventListener('pointerover', (event) => this.onPointerOver(event), options);
    root.addEventListener('pointerdown', () => this.setKeyboardNavigation(false), options);
    // The built view covers the screen, and a press anywhere on it gives the screen back.
    this.parts.get('built')!.element.addEventListener('pointerdown', () => {
      if (this.builtDismiss) this.emit(this.builtDismiss);
    }, options);
    // A panel's body was scrolled (scroll does not bubble: it is caught on the way down), or the window changed size:
    // the cut mark under it may be due, or done.
    root.addEventListener('scroll', () => this.markCut(), { capture: true, passive: true, signal: this.abort.signal });
    window.addEventListener('resize', () => this.markCut(), options);
    // Before the game's own key handler, to decide which keys work the menus.
    window.addEventListener('keydown', (event) => this.onKeyDown(event), { capture: true, signal: this.abort.signal });

    // Fetch the two faces now, not when the first panel that needs the italic opens.
    // Until they are in, the lobby's words are not written at all. A stand-in face is cut wider, so
    // a menu written in it and then in its own face moved as the fonts arrived. Written once, it never moves.
    root.classList.add('iw-faces-pending');
    const written = (): void => {
      this.root?.classList.remove('iw-faces-pending');
      // Words in their own face are another height than in a stand-in.
      this.markCut();
      if (this.faceTimer !== null) clearTimeout(this.faceTimer);
      this.faceTimer = null;
    };
    this.faceTimer = setTimeout(written, FACE_WAIT_MILLISECONDS);
    void Promise.allSettled(FACES.map((face) => document.fonts?.load(face))).then(written);
  }

  // --- Pointer and form controls ---------------------------------------------------

  private onClick(event: MouseEvent): void {
    // A field that only shows something (the invite link) is selected whole, ready to copy by hand.
    if (event.target instanceof HTMLInputElement && event.target.readOnly) event.target.select();
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || button.disabled) return;
    // An inventory row: it opens or closes what the item is and what can be done with it. Nothing goes to the game.
    const detail = button.dataset.detail;
    if (detail !== undefined && event.shiftKey) {
      // Shift+click on a tile: its whole stack goes to the other side. The tile does not open.
      const quick = quickIntent(this.lastPanel, detail, 'shift');
      if (quick) this.emit(quick);
      if (event.detail > 0) button.blur();
      return;
    }
    if (detail !== undefined) {
      if (!this.openItems.delete(detail)) this.openItems.add(detail);
      this.drawPanel(this.lastPanel, true);
      if (event.detail > 0) button.blur();
      return;
    }
    const intent = intentOf(button);
    if (!intent) return;
    const copy = button.dataset.copy;
    if (copy !== undefined) {
      // The intent says "copied": it goes out only once the words are on the clipboard.
      void this.copyText(copy, button).then((copied) => {
        if (copied) this.emit(intent);
      });
      return;
    }
    this.emit(intent);
    // A click by pointer hands the keyboard back to the game. A press by key keeps its place.
    if (event.detail > 0) button.blur();
  }

  /**
   * Put text on the clipboard. Where the browser will not let a script do it
   * (a page not served over https), the field beside the button is selected
   * and copied the old way; failing that it stays selected, to copy by hand.
   */
  private async copyText(text: string, from: HTMLElement): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const field = from.closest('.iw-panel')?.querySelector<HTMLInputElement>('input[data-copy-source]');
      if (!field) return false;
      field.focus();
      field.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }

  private onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const setting = target.dataset.setting;
    if (!setting) return;
    let value: number | boolean | string;
    if (target instanceof HTMLSelectElement) value = JSON.parse(target.value) as number | string;
    else if (target.type === 'checkbox') value = target.checked;
    else value = Number(target.value);
    this.emit({ type: 'change_setting', setting: setting as SettingId, value });
    // The model has the last word on every control: draw the panel again from it.
    const panel = this.parts.get('panel');
    if (panel) panel.signature = '';
  }

  /** A slider's wash follows the bead while it is dragged. The value is sent when it is let go. */
  private onInput(event: Event): void {
    const target = event.target;
    // The Feedback card's box and its name line (feedback.ts).
    const feedback = feedbackInputIntent(target);
    if (feedback) return void this.emit(feedback);
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type === 'range') this.fillSlider(target);
    // What is typed on a line goes to the model at once, and the model's wording of it comes back next frame.
    const field = target.dataset.field;
    if (field === 'name' || field === 'code') this.emit({ type: 'crew_field', field, value: target.value });
  }

  private fillSlider(slider: HTMLInputElement): void {
    const minimum = Number(slider.min);
    const maximum = Number(slider.max);
    const share = maximum > minimum ? (Number(slider.value) - minimum) / (maximum - minimum) : 0;
    slider.style.setProperty('--v', share.toFixed(4));
  }

  private onPointerOver(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('button:not([disabled])') : null;
    if (target === this.hovered) return;
    this.hovered = target;
    if (target) this.emit({ type: 'hover' });
  }

  // --- Keyboard ---------------------------------------------------------------------

  private setKeyboardNavigation(active: boolean): void {
    if (this.keyboardNavigation === active) return;
    this.keyboardNavigation = active;
    this.root?.classList.toggle('iw-by-keys', active);
  }

  /** The element holding the controls the keyboard may reach right now. */
  private topSurface(): HTMLElement | null {
    const name: PartName | null = this.surface === 'confirm' ? 'confirm' : this.surface.startsWith('panel') ? 'panel'
      : this.surface === 'lobby' ? 'lobby' : null;
    return name ? this.parts.get(name)!.element : null;
  }

  private focusableControls(): HTMLElement[] {
    const surface = this.topSurface();
    if (!surface) return [];
    return Array.from(surface.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      .filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
  }

  private focusEmptyField(): void {
    const fields = Array.from(this.topSurface()?.querySelectorAll<HTMLInputElement>('input[data-field]:not([disabled])') ?? []);
    (fields.find((field) => field.value === '') ?? (this.keyboardNavigation ? this.focusableControls()[0] : undefined))?.focus();
  }

  private moveFocus(backwards: boolean): void {
    const controls = this.focusableControls();
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = current < 0 ? (backwards ? controls.length - 1 : 0) : (current + (backwards ? -1 : 1) + controls.length) % controls.length;
    controls[next]!.focus();
  }

  /**
   * Keys that work the menus. Esc is never touched: backing out belongs to the session.
   *
   * The rule is the one the game already has for sliders: a key pressed on a
   * focused control belongs to the control, and otherwise to the game.
   *
   * - Arrow keys step through the controls of the open menu.
   * - Tab and Shift+Tab do the same once a control has the focus. Before that the
   *   game gets Tab first (it is the inventory key in play), and only a Tab the
   *   game did nothing with moves the focus.
   * - Enter and Space press the focused button, and nothing else.
   * - Page Up and Page Down scroll a long panel.
   */
  private onKeyDown(event: KeyboardEvent): void {
    // While the built view holds the screen every key is the game's: any one of them ends it.
    if (event.ctrlKey || event.metaKey || event.altKey || this.capturing || this.builtDismiss) return;
    const surface = this.topSurface();
    if (!surface) return;
    const target = event.target instanceof Element ? event.target : null;
    // A box of several lines (the Feedback card's) keeps its arrows, its Enter and its Space, as a line does.
    const inField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const onControl = target !== null && surface.contains(target) && (inField || target instanceof HTMLButtonElement);
    switch (event.code) {
      case DROP_KEY_CODE: {
        // The drop key with the pointer on an inventory tile drops that stack, and the game never sees the key.
        // Not while a line is being typed on, and not while the key is held down.
        const tile = inField ? null : surface.querySelector<HTMLElement>('.iw-item-pick:hover');
        const drop = tile && tile.dataset.detail !== undefined ? quickIntent(this.lastPanel, tile.dataset.detail, 'drop') : null;
        if (!drop) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.emit(drop);
        return;
      }
      case 'Tab':
        event.preventDefault();
        if (onControl) {
          event.stopImmediatePropagation();
          this.setKeyboardNavigation(true);
          this.moveFocus(event.shiftKey);
        } else {
          this.pendingTab = { backwards: event.shiftKey, stack: this.stack };
        }
        return;
      case 'ArrowDown':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowLeft':
        if (inField) return; // a slider and a picker use the arrows themselves
        event.preventDefault();
        this.setKeyboardNavigation(true);
        this.moveFocus(event.code === 'ArrowUp' || event.code === 'ArrowLeft');
        return;
      case 'PageDown':
      case 'PageUp': {
        const body = surface.querySelector<HTMLElement>('.iw-body');
        if (!body) return;
        event.preventDefault();
        body.scrollTop += (event.code === 'PageDown' ? 0.8 : -0.8) * body.clientHeight;
        return;
      }
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        // Enter on a line that is typed on presses the card's main button.
        if (event.code !== 'Space' && target instanceof HTMLInputElement && target.dataset.field) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.setKeyboardNavigation(true);
          surface.querySelector<HTMLButtonElement>('button[data-primary]:not([disabled])')?.click();
          return;
        }
        // The focused button takes the press. The game must not also act on the key.
        if (onControl && !inField) {
          this.setKeyboardNavigation(true);
          event.stopImmediatePropagation();
        }
        return;
      default:
    }
  }

  // --- The cut mark -----------------------------------------------------------------

  /**
   * Show the pen mark under the open panel's body while the body goes on below its bottom edge, and hide it when
   * it does not: a panel that fits, or one scrolled to its end. Only ever a flag on a still mark: nothing moves.
   */
  private markCut(): void {
    const veil = this.parts.get('panel')?.element;
    const mark = veil?.querySelector<HTMLElement>('.iw-cut');
    if (!veil || !mark) return;
    const body = veil.querySelector<HTMLElement>('.iw-body');
    // A pixel or two of rounding is not a cut.
    const more = body !== null && !veil.hidden && body.scrollHeight - body.clientHeight - body.scrollTop > 2;
    if (mark.hidden === more) mark.hidden = !more;
  }

  // --- Drawing ----------------------------------------------------------------------

  private draw(name: PartName, signature: string, build: () => ViewNode[]): boolean {
    const part = this.parts.get(name);
    if (!part || part.signature === signature) return false;
    part.signature = signature;
    const next = signature === '' ? [] : build();
    reconcile(part.element, part.nodes, next);
    part.nodes = next;
    return true;
  }

  /**
   * Draw the panel, if it or the rows opened in it changed. `force` draws it even when they did not (a press that
   * opened a row). Rows that are gone (eaten, moved, dropped) are forgotten, and every row closes with the inventory.
   */
  private drawPanel(panel: PanelModel | null, force = false): boolean {
    this.lastPanel = panel;
    if (panel?.id === 'inventory') {
      const present = new Set(itemDetailKeys(panel));
      for (const key of this.openItems) if (!present.has(key)) this.openItems.delete(key);
    } else {
      this.openItems.clear();
    }
    const part = this.parts.get('panel');
    if (force && part) part.signature = '';
    const signature = panel ? `${JSON.stringify(panel)}|${[...this.openItems].sort().join(',')}` : '';
    if (!this.draw('panel', signature, () => panelView(panel!, this.openItems))) return false;
    const veil = this.parts.get('panel')!.element;
    veil.hidden = !panel;
    for (const slider of veil.querySelectorAll<HTMLInputElement>('input[type="range"]')) this.fillSlider(slider);
    this.capturing = panel?.id === 'settings' && panel.bindings.some((binding) => binding.slots.some((slot) => slot.capturing));
    // What the panel holds changed, so how far it runs may have.
    this.markCut();
    return true;
  }

  update(model: InterfaceModel): void {
    const root = this.root;
    if (!root || !this.hud || !this.compass) return;
    const rescaled = model.uiScale !== this.scale;
    if (rescaled) {
      this.scale = model.uiScale;
      document.documentElement.style.setProperty('--iw-scale', String(model.uiScale));
    }
    if (model.paused !== this.paused) {
      this.paused = model.paused;
      root.classList.toggle('iw-paused', model.paused);
    }

    const { lobby, hud, panel, confirm, debug } = model;
    const part = (name: PartName): HTMLElement => this.parts.get(name)!.element;

    if (this.draw('lobby', lobby ? JSON.stringify(lobby) : '', () => lobbyView(lobby!))) part('lobby').hidden = !lobby;

    if ((hud !== null) !== this.hudShown) {
      this.hudShown = hud !== null;
      this.hud.hidden = !hud;
    }
    this.draw('vitals', hud ? JSON.stringify([hud.meters, hud.water, hud.canoeLines, model.patternedMeters, hud.crew]) : '',
      () => vitalsView(hud!, model.patternedMeters));
    this.draw('notes', hud ? JSON.stringify([hud.clockText, hud.night, hud.weatherText, hud.stormWarning, hud.placeText, hud.trackers]) : '',
      () => notesView(hud!));
    // One standing slip under the prompt: the line's trouble when there is any, the tip otherwise.
    const lineNote = hud?.lineNote ?? null;
    this.draw('hint', lineNote !== null ? `line|${lineNote}` : hud?.hint ?? '', () => (lineNote !== null ? lineNoteView(lineNote) : hintView(hud!.hint!)));
    this.draw('prompt', hud?.prompt ? JSON.stringify(hud.prompt) : '', () => promptView(hud!.prompt!));
    this.draw('hotbar', hud ? JSON.stringify(hud.hotbar) : '', () => hotbarView(hud!.hotbar));
    if (hud) this.compass.update(hud.compass);
    if (hud && model.chart) this.minimap?.update(hud.minimap, model.chart);

    let toastSignature = '';
    for (const toast of model.toasts) toastSignature += `${toast.id}|${toast.tone}|${toast.text}\n`;
    this.draw('toasts', toastSignature, () => toastsView(model.toasts));
    // The arrival card (arrival.ts): its words are written once, and only its ink's styles change from frame to frame.
    this.draw('arrival', model.arrival ? JSON.stringify(model.arrival) : '', () => arrivalView(model.arrival!));

    if (!this.drawPanel(panel) && rescaled) this.markCut();
    this.mapChart.follow(panel?.id === 'map' ? part('panel') : null, model.chart);
    if ((panel?.id === 'dialogue') !== this.dialogue) {
      this.dialogue = panel?.id === 'dialogue';
      part('panel').classList.toggle('iw-veil-clear', this.dialogue);
    }
    if (this.draw('confirm', confirm ? JSON.stringify(confirm) : '', () => confirmView(confirm!))) part('confirm').hidden = !confirm;
    this.followBuilt(model, root);
    if (this.draw('debug', debug ? JSON.stringify(debug) : '', () => debugView(debug!))) {
      part('debug').hidden = this.parts.get('debug')!.nodes.length === 0;
    }

    // A control that was switched off while it held the keyboard (a name line once the room is open, a
    // button whose turn is over) would swallow every key after it. Let go of it, and hand a player who
    // steers by key the card's main button, or failing that its last control: the way out, never a
    // button that undoes something.
    const held = document.activeElement;
    if (held instanceof HTMLElement && root.contains(held) && (held as HTMLButtonElement | HTMLInputElement).disabled === true) {
      held.blur();
      if (this.keyboardNavigation) {
        (this.topSurface()?.querySelector<HTMLElement>('button[data-primary]:not([disabled])') ?? this.focusableControls().at(-1))?.focus();
      }
    }

    // What lies under a panel or a dialog can be seen but not used.
    const covered = panel !== null || confirm !== null;
    if (covered !== this.covered) {
      this.covered = covered;
      part('lobby').inert = covered;
      part('lobby').classList.toggle('iw-dim', covered);
      this.hud.inert = covered;
    }
    if ((confirm !== null) !== this.confirming) {
      this.confirming = confirm !== null;
      part('panel').inert = this.confirming;
    }

    const surface = confirm ? 'confirm' : panel ? `panel:${panel.id}` : lobby ? 'lobby' : '';
    const stack = `${model.screen}|${model.openPanels.join(',')}|${confirm ? 1 : 0}`;
    if (surface !== this.surface) {
      this.surface = surface;
      // A player steering by key lands on the first control of whatever just opened.
      // Back in play with nothing open, the keyboard is the game's again.
      if (!surface) this.setKeyboardNavigation(false);
      // A card with a line to type on opens with the caret on the first empty one.
      else if (surface.startsWith('panel:crew_')) this.focusEmptyField();
      else if (surface === 'panel:feedback') focusFeedbackNote(this.topSurface());
      else if (this.keyboardNavigation) this.focusableControls()[0]?.focus();
    } else if (this.pendingTab && this.pendingTab.stack === stack) {
      this.setKeyboardNavigation(true);
      this.moveFocus(this.pendingTab.backwards);
    }
    this.pendingTab = null;
    this.stack = stack;
  }

  /**
   * The built view: while the model carries it, the panel, the HUD and the notes are put away (hidden, not taken
   * down: a long panel keeps its place) and the slip that names the piece is written. All at once, both ways.
   */
  private followBuilt(model: InterfaceModel, root: HTMLElement): void {
    const built = model.built;
    this.draw('built', built ? JSON.stringify([built.kicker, built.title, built.text, built.hint]) : '', () => builtView(built!));
    const holding = built !== null;
    if (holding === (this.builtDismiss !== null)) return;
    this.builtDismiss = built ? built.dismiss : null;
    if (holding) {
      const held = document.activeElement;
      this.heldBeforeBuilt = held instanceof HTMLElement && root.contains(held) ? held : null;
      // Before the controls are hidden: a hidden control that kept the keyboard would press itself on Enter.
      this.heldBeforeBuilt?.blur();
    }
    root.classList.toggle('iw-holding', holding);
    this.parts.get('built')!.element.hidden = !holding;
    if (!holding) {
      // A player steering by key is back on the button they pressed, if it can still be pressed.
      const back = this.heldBeforeBuilt;
      this.heldBeforeBuilt = null;
      if (this.keyboardNavigation && back && back.isConnected && (back as HTMLButtonElement).disabled !== true) back.focus();
    }
  }

  dispose(): void {
    this.abort.abort();
    if (this.faceTimer !== null) clearTimeout(this.faceTimer);
    this.faceTimer = null;
    document.documentElement.classList.remove('iw-document');
    document.documentElement.style.removeProperty('--iw-scale');
    if (this.root) {
      this.root.classList.remove('iw', 'iw-by-keys', 'iw-paused', 'iw-faces-pending', 'iw-holding');
      this.root.textContent = '';
    }
    this.parts.clear();
    this.minimap?.dispose();
    this.mapChart.dispose();
    this.hud = null;
    this.compass = null;
    this.minimap = null;
    this.root = null;
  }
}
