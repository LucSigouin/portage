/**
 * The asset viewer's page. One room of the workshop: pick any drawn thing from the list, see it alone on the
 * stage, turn it, choose its variants, read its facts, save it as a picture, and copy the address to share it.
 *
 * It stores nothing (the address is the only memory) and asks nothing of any other site.
 */
import * as THREE from 'three';
import '../interface/fonts.css';
import '../interface/theme.css';
import './viewer.css';
import { FILTER_DEFINITIONS } from '../interface/icons.ts';
import { paperTexture } from '../interface/paper.ts';
import { GROUPS, catalogue, cleanOptions, defaultsOf, entryById } from './catalogue.ts';
import { rasterizeIcon } from './icon-save.ts';
import { ROOMS, SCREENS, THIS_ROOM, TOOLS } from './rooms.ts';
import { Stage } from './stage.ts';
import type { Background, View } from './stage.ts';
import { BACKGROUNDS, LIGHTS, fromQuery, toQuery } from './state.ts';
import type { ViewName, ViewerState } from './state.ts';
import type { GuideSection } from './guide.ts';
import type { Control, Entry, Options, Subject } from './types.ts';
import { MAXIMUM_PITCH, MINIMUM_PITCH, distanceLimits, viewFor } from './views.ts';

const query = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`The page is missing ${selector}`);
  return found;
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const VIEW_BUTTONS: { name: ViewName; label: string; key: string }[] = [
  { name: 'front', label: 'Front', key: 'F' },
  { name: 'side', label: 'Side', key: 'S' },
  { name: 'top', label: 'Top', key: 'T' },
  { name: 'paddle', label: 'Paddling camera', key: 'P' },
];
const BACKGROUND_LABELS: Record<Background, string> = { paper: 'Paper', checker: 'See-through', dark: 'Dark' };
const metres = (value: number): string => (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2));

class Viewer {
  private readonly root: HTMLElement;
  private readonly stage = new Stage();
  private readonly host: HTMLElement;
  private readonly flat: HTMLElement;
  private readonly list: HTMLElement;
  private readonly facts: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly entries = catalogue();
  private state: ViewerState;
  private entry: Entry;
  private subject: Subject | null = null;
  private failure = '';
  private frames = 0;
  private scheduled = false;
  private addressTimer = 0;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('vw', 'iw');
    root.style.setProperty('--iw-tex', `url(${paperTexture()})`);
    root.insertAdjacentHTML('beforeend', FILTER_DEFINITIONS);
    root.insertAdjacentHTML('beforeend', this.skeleton());
    this.host = query(root, '.vw-stage');
    this.flat = query(root, '.vw-flat');
    this.list = query(root, '.vw-items');
    this.facts = query(root, '.vw-facts');
    this.choices = query(root, '.vw-choices');
    this.caption = query(root, '.vw-caption');
    this.search = query(root, '.vw-search');
    this.host.prepend(this.stage.canvas, this.stage.seeThrough);

    this.state = fromQuery(window.location.search, this.entries[0].id);
    const entry = entryById(this.state.thing) ?? this.entries[0];
    this.entry = entry;
    this.state.thing = entry.id;
    this.state.options = cleanOptions(entry, this.state.options);

    this.buildList();
    this.buildToolbar();
    this.bindStage();
    new ResizeObserver(() => this.resize()).observe(this.host);
    window.addEventListener('popstate', () => this.fromAddress());
    window.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== this.search && !(document.activeElement instanceof HTMLSelectElement)) {
        event.preventDefault();
        this.search.focus();
      }
    });
    this.resize();
    this.rebuild();
  }

  // --- The skeleton ------------------------------------------------------------------------------------------------

  private skeleton(): string {
    const rooms = ROOMS.map((room) => `<a class="iw-tab${room.id === THIS_ROOM ? ' iw-on' : ''}" href="${room.href}" title="${room.note}"${room.id === THIS_ROOM ? ' aria-current="page"' : ''}>${room.label}</a>`).join('');
    const tools = TOOLS.map((tool) => `<a class="vw-link" href="${tool.href}" title="${tool.note}">${tool.label}</a>`).join('');
    const screens = SCREENS.map((screen) => `<li><a href="${screen.href}" title="${screen.note}">${screen.label}</a></li>`).join('');
    return `
      <header class="vw-bar">
        <div class="vw-brand"><span class="vw-logo">Portage</span><span class="vw-sub">workshop</span></div>
        <nav class="vw-rooms" aria-label="Rooms">${rooms}</nav>
        <nav class="vw-tools" aria-label="Tools">${tools}
          <details class="vw-screens"><summary class="vw-link">Game screens</summary><ul>${screens}</ul></details>
        </nav>
      </header>
      <main class="vw-main">
        <section class="vw-things iw-paper" aria-label="The list">
          <i class="iw-tape iw-a"></i>
          <h2>Things</h2>
          <label class="vw-find"><span>Search</span><input class="vw-search" type="search" placeholder="canoe, sail, odile…" autocomplete="off" spellcheck="false"></label>
          <p class="vw-count" aria-live="polite"></p>
          <div class="vw-items" role="group" aria-label="Every drawn thing"></div>
        </section>
        <section class="vw-centre" aria-label="The stage">
          <div class="vw-toolbar" role="toolbar" aria-label="Views and background"></div>
          <div class="vw-stage" tabindex="0" role="img" aria-label="The chosen thing, alone"><div class="vw-flat" aria-hidden="true"></div></div>
          <p class="vw-caption"></p>
        </section>
        <aside class="vw-side" aria-label="About this thing">
          <section class="vw-facts-card iw-paper"><i class="iw-tape iw-b"></i><div class="vw-facts"></div></section>
          <section class="vw-choices-card iw-paper"><i class="iw-tape iw-a"></i><h2>Choices</h2><div class="vw-choices"></div></section>
        </aside>
      </main>`;
  }

  // --- The list ----------------------------------------------------------------------------------------------------

  private buildList(): void {
    for (const group of GROUPS) {
      const members = this.entries.filter((entry) => entry.group === group.id);
      const section = make('section', 'vw-group');
      section.dataset.group = group.id;
      const heading = make('h3');
      heading.append(make('span', '', group.label), make('small', 'vw-n', String(members.length)));
      heading.title = group.about;
      section.append(heading);
      for (const entry of members) {
        const button = make('button', 'vw-item', entry.name);
        button.type = 'button';
        button.dataset.id = entry.id;
        button.title = `${entry.id}${entry.description ? ` — ${entry.description}` : ''}`;
        button.addEventListener('click', () => this.choose(entry.id));
        section.append(button);
      }
      this.list.append(section);
    }
    this.list.addEventListener('keydown', (event) => this.listKeys(event));
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.visibleItems()[0]?.focus();
      }
    });
    this.filter();
  }

  private visibleItems(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('.vw-item:not([hidden])')];
  }

  private filter(): void {
    const words = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.vw-item')) {
      const entry = entryById(button.dataset.id as string) as Entry;
      const text = `${entry.name} ${entry.id} ${entry.description} ${GROUPS.find((group) => group.id === entry.group)?.label}`.toLowerCase();
      const match = words.every((word) => text.includes(word));
      button.hidden = !match;
      if (match) shown += 1;
    }
    for (const section of this.list.querySelectorAll<HTMLElement>('.vw-group')) {
      section.hidden = section.querySelectorAll('.vw-item:not([hidden])').length === 0;
    }
    query(this.root, '.vw-count').textContent = shown === this.entries.length ? `${shown} things` : `${shown} of ${this.entries.length} things`;
    this.markCurrent();
  }

  /** The current item is the one tab stop of the list; the arrow keys move between the rest. */
  private markCurrent(): void {
    const items = this.visibleItems();
    const current = items.find((button) => button.dataset.id === this.entry.id);
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.vw-item')) {
      const here = button.dataset.id === this.entry.id;
      if (here) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      button.tabIndex = button === (current ?? items[0]) ? 0 : -1;
    }
  }

  private listKeys(event: KeyboardEvent): void {
    const items = this.visibleItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const move = (to: number): void => {
      event.preventDefault();
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') {
      if (at === 0) {
        event.preventDefault();
        this.search.focus();
      } else move(at - 1);
    } else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'PageDown') move(at + 8);
    else if (event.key === 'PageUp') move(at - 8);
  }

  private choose(id: string): void {
    const entry = entryById(id);
    if (!entry) return;
    this.entry = entry;
    this.state = { ...this.state, thing: id, options: defaultsOf(entry), view: 'home', free: null };
    this.rebuild();
  }

  // --- The toolbar -------------------------------------------------------------------------------------------------

  private buildToolbar(): void {
    const bar = query<HTMLElement>(this.root, '.vw-toolbar');
    const group = (label: string): HTMLElement => {
      const node = make('div', 'vw-segment');
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', label);
      bar.append(node);
      return node;
    };
    const button = (parent: HTMLElement, label: string, onPress: () => void, extra = ''): HTMLButtonElement => {
      const node = make('button', `iw-btn iw-small vw-btn ${extra}`.trim(), label);
      node.type = 'button';
      node.addEventListener('click', onPress);
      parent.append(node);
      return node;
    };
    const views = group('View');
    for (const view of VIEW_BUTTONS) button(views, view.label, () => this.setView(view.name), `vw-view vw-view-${view.name}`).title = `${view.label} (${view.key})`;
    button(views, 'Reset', () => this.setView('home'), 'vw-reset').title = 'Back to the opening view (0)';
    const ground = group('Ground');
    button(ground, 'Grid', () => this.update({ grid: !this.state.grid }), 'vw-grid').title = 'Grid floor in metres (G)';
    const backgrounds = group('Background');
    for (const name of BACKGROUNDS) button(backgrounds, BACKGROUND_LABELS[name], () => this.update({ background: name }), `vw-bg vw-bg-${name}`);
    const light = group('Light');
    for (const name of LIGHTS) button(light, name === 'day' ? 'Day' : 'Night', () => this.update({ light: name }), `vw-light vw-light-${name}`);
    const actions = group('Share');
    button(actions, 'Save picture', () => void this.save(), 'vw-save iw-go').title = 'A PNG of the thing alone, with a see-through background';
    button(actions, 'Copy link', () => void this.copyLink(), 'vw-link-copy').title = 'The address holds this exact picture';
  }

  private update(change: Partial<ViewerState>): void {
    this.state = { ...this.state, ...change };
    this.refresh();
    this.schedule();
    this.touchAddress();
  }

  private setView(name: ViewName): void {
    this.state = { ...this.state, view: name, free: null };
    this.refresh();
    this.schedule();
    this.touchAddress();
  }

  private refresh(): void {
    const { state } = this;
    for (const node of this.root.querySelectorAll<HTMLButtonElement>('.vw-view')) node.setAttribute('aria-pressed', String(node.classList.contains(`vw-view-${state.view}`)));
    query<HTMLButtonElement>(this.root, '.vw-view-paddle').disabled = !this.subject?.paddle;
    for (const node of this.root.querySelectorAll<HTMLButtonElement>('.vw-view, .vw-reset')) node.disabled = node.disabled || (this.entry.flat && node.classList.contains('vw-view'));
    const grid = query<HTMLButtonElement>(this.root, '.vw-grid');
    grid.setAttribute('aria-pressed', String(state.grid));
    grid.disabled = this.entry.flat;
    for (const name of BACKGROUNDS) query(this.root, `.vw-bg-${name}`).setAttribute('aria-pressed', String(state.background === name));
    for (const name of LIGHTS) query(this.root, `.vw-light-${name}`).setAttribute('aria-pressed', String(state.light === name));
    this.host.dataset.background = state.background;
    this.host.dataset.flat = String(this.entry.flat);
    this.stage.canvas.hidden = this.entry.flat || state.background === 'checker';
    this.stage.seeThrough.hidden = this.entry.flat || state.background !== 'checker';
    this.flat.hidden = !this.entry.flat;
    this.root.dataset.light = state.light;
    this.markCurrent();
  }

  // --- The stage ---------------------------------------------------------------------------------------------------

  private resize(): void {
    const box = this.host.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    this.stage.resize(box.width, box.height, window.devicePixelRatio || 1);
    this.schedule();
  }

  private currentView(): View {
    return this.subject ? viewFor(this.state.view, this.subject, this.stage.aspect, this.state.free) : { yaw: 215, pitch: 20, distance: 5, aim: 'centre' };
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  private render(): void {
    const subject = this.subject;
    if (!subject) return;
    if (subject.svg !== null) {
      this.renderFlat(subject);
    } else {
      this.stage.draw({ view: this.currentView(), background: this.state.background, grid: this.state.grid, light: this.state.light });
    }
    this.describeView();
    this.frames += 1;
    this.host.dataset.frame = String(this.frames);
  }

  private renderFlat(subject: Subject): void {
    if (this.flat.dataset.id !== this.entry.id) {
      this.flat.innerHTML = subject.svg as string;
      this.flat.dataset.id = this.entry.id;
    }
    const zoom = this.state.free?.distance ?? 1;
    this.flat.style.setProperty('--vw-zoom', String(1 / zoom));
  }

  private describeView(): void {
    const subject = this.subject;
    if (!subject) return;
    const spacing = this.stage.gridSpacing();
    const names: Record<ViewName, string> = { home: 'Opening view', front: 'Front', side: 'Side', top: 'Top', paddle: 'Paddling camera', free: 'Free view' };
    const parts = [names[this.state.view]];
    if (!this.entry.flat) {
      const view = this.currentView();
      parts.push(`${metres(view.distance)} m out`);
      if (spacing !== null) parts.push(`grid squares ${spacing >= 1 ? spacing : spacing.toFixed(2)} m, bold line every ${spacing * 5 >= 1 ? spacing * 5 : (spacing * 5).toFixed(2)} m`);
      else parts.push('grid off');
    } else parts.push('flat drawing: turning does not apply');
    this.caption.textContent = parts.join(' · ');
    this.host.setAttribute('aria-label', `${this.entry.name}, alone. ${parts.join('. ')}.`);
  }

  private bindStage(): void {
    const host = this.host;
    host.addEventListener('pointerdown', (event) => {
      if (this.entry.flat || event.button !== 0) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId);
      host.focus({ preventScroll: true });
    });
    host.addEventListener('pointermove', (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const view = this.free();
      view.yaw -= (event.clientX - this.drag.x) * 0.4;
      view.pitch = Math.max(MINIMUM_PITCH, Math.min(MAXIMUM_PITCH, view.pitch + (event.clientY - this.drag.y) * 0.3));
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.afterCamera(false);
    });
    const end = (event: PointerEvent): void => {
      if (this.drag?.id === event.pointerId) {
        this.drag = null;
        this.touchAddress();
      }
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom(Math.exp(event.deltaY * 0.0012));
    }, { passive: false });
    host.addEventListener('keydown', (event) => this.stageKeys(event));
  }

  /** The camera as a free view, so the next change is a change of it. */
  private free(): View {
    if (this.state.view !== 'free' || !this.state.free) {
      this.state = { ...this.state, view: 'free', free: { ...this.currentView() } };
      this.refresh();
    }
    return this.state.free as View;
  }

  private zoom(factor: number): void {
    const view = this.free();
    if (this.entry.flat) {
      view.distance = Math.max(0.25, Math.min(2, view.distance * factor));
    } else if (this.subject) {
      const [near, far] = distanceLimits(this.subject);
      view.distance = Math.max(near, Math.min(far, view.distance * factor));
    }
    this.afterCamera(true);
  }

  private afterCamera(settled: boolean): void {
    // The camera is kept to what the address can hold, so a pasted link reopens exactly this view.
    const view = this.state.free;
    if (view) {
      view.yaw = Number((((view.yaw % 360) + 360) % 360).toFixed(1));
      view.pitch = Number(view.pitch.toFixed(1));
      view.distance = Number(view.distance.toFixed(3));
    }
    this.schedule();
    if (settled) this.touchAddress();
  }

  private stageKeys(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const fine = event.shiftKey ? 1 : 5;
    const turn = (yaw: number, pitch: number): void => {
      event.preventDefault();
      if (this.entry.flat) return;
      const view = this.free();
      view.yaw += yaw;
      view.pitch = Math.max(MINIMUM_PITCH, Math.min(MAXIMUM_PITCH, view.pitch + pitch));
      this.afterCamera(true);
    };
    switch (event.key) {
      case 'ArrowLeft': turn(-fine, 0); break;
      case 'ArrowRight': turn(fine, 0); break;
      case 'ArrowUp': turn(0, fine); break;
      case 'ArrowDown': turn(0, -fine); break;
      case '+': case '=': event.preventDefault(); this.zoom(1 / 1.15); break;
      case '-': case '_': event.preventDefault(); this.zoom(1.15); break;
      case '0': case 'Home': event.preventDefault(); this.setView('home'); break;
      case 'f': case 'F': this.setView('front'); break;
      case 's': case 'S': this.setView('side'); break;
      case 't': case 'T': this.setView('top'); break;
      case 'p': case 'P': if (this.subject?.paddle) this.setView('paddle'); break;
      case 'g': case 'G': if (!this.entry.flat) this.update({ grid: !this.state.grid }); break;
      case 'b': case 'B': this.update({ background: BACKGROUNDS[(BACKGROUNDS.indexOf(this.state.background) + 1) % BACKGROUNDS.length] }); break;
      case 'n': case 'N': this.update({ light: this.state.light === 'day' ? 'night' : 'day' }); break;
      default: break;
    }
  }

  // --- A thing chosen ----------------------------------------------------------------------------------------------

  private rebuild(): void {
    this.subject?.dispose();
    this.subject = null;
    this.stage.setSubject(null);
    this.failure = '';
    try {
      this.subject = this.entry.build(this.state.options);
      this.stage.setSubject(this.subject);
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      console.error(`The viewer could not build ${this.entry.id}: ${this.failure}`);
    }
    this.flat.dataset.id = '';
    this.buildFacts();
    this.buildChoices();
    this.refresh();
    this.schedule();
    this.touchAddress();
  }

  private buildFacts(): void {
    const { entry, subject } = this;
    const group = GROUPS.find((candidate) => candidate.id === entry.group);
    this.facts.replaceChildren();
    this.facts.append(make('h2', '', entry.name));
    this.facts.append(make('p', 'vw-kind', `${group?.label ?? ''} · `), make('code', 'vw-id', entry.id));
    if (entry.description) this.facts.append(make('p', 'vw-about', entry.description));
    if (entry.guide) this.facts.append(this.guide(entry.guide()));
    if (this.failure) {
      this.facts.append(make('p', 'vw-failure', `Could not be built: ${this.failure}`));
      return;
    }
    if (!subject) return;
    const size = subject.box.getSize(new THREE.Vector3());
    const rows: [string, string][] = entry.flat
      ? [['Size', '24 × 24 drawing units'], ['Triangles', 'none: a flat drawing'], ['Draw calls', 'none: SVG']]
      : [
          ['Size', `${metres(size.x)} × ${metres(size.y)} × ${metres(size.z)} m`], ['', 'across × high × long'],
          ['Triangles', subject.triangles.toLocaleString('en-US')],
          ['Draw calls', `${subject.drawCalls.toLocaleString('en-US')} per pass`],
        ];
    const list = make('dl', 'vw-rows');
    for (const [name, value] of rows) {
      const row = make('div');
      row.append(make('dt', '', name), make('dd', '', value));
      list.append(row);
    }
    this.facts.append(list);
    const source = make('div', 'vw-source');
    source.append(make('h3', '', 'Drawn by'));
    for (const file of entry.source) source.append(make('code', '', file));
    this.facts.append(source);
    for (const note of subject.notes) this.facts.append(make('p', 'vw-note', note));
  }

  /** The guide: each section a heading and short lines, a bold lead then the rest. Words only, nothing moves. */
  private guide(sections: GuideSection[]): HTMLElement {
    const guide = make('div', 'vw-guide');
    for (const section of sections) {
      const block = make('section', 'vw-guide-part');
      block.append(make('h3', '', section.title));
      if (section.lines.length === 0) {
        block.append(make('p', 'vw-note', section.empty ?? 'Nothing.'));
      } else {
        const list = make('ul');
        for (const line of section.lines) {
          const row = make('li');
          row.append(make('strong', '', line.lead), document.createTextNode(` ${line.text}`));
          list.append(row);
        }
        block.append(list);
      }
      guide.append(block);
    }
    return guide;
  }

  private buildChoices(): void {
    this.choices.replaceChildren();
    if (this.entry.controls.length === 0) {
      this.choices.append(make('p', 'vw-note', 'Nothing to choose: this one is drawn one way.'));
      return;
    }
    for (const control of this.entry.controls) {
      if (control.when && this.state.options[control.when.key] !== control.when.is) continue;
      this.choices.append(this.choiceRow(control));
    }
  }

  private choiceRow(control: Control): HTMLElement {
    const row = make('label', 'vw-choice');
    row.append(make('span', '', control.label));
    const select = make('select');
    select.dataset.key = control.key;
    for (const option of control.choices) {
      const node = make('option', '', option.label);
      node.value = option.value;
      node.selected = this.state.options[control.key] === option.value;
      select.append(node);
    }
    select.addEventListener('change', () => this.answer(control.key, select.value));
    row.append(select);
    return row;
  }

  private answer(key: string, value: string): void {
    const options: Options = { ...this.state.options, [key]: value };
    this.state = { ...this.state, options };
    this.rebuild();
  }

  // --- The address -------------------------------------------------------------------------------------------------

  private touchAddress(): void {
    window.clearTimeout(this.addressTimer);
    this.addressTimer = window.setTimeout(() => {
      const next = `?${toQuery(this.state, defaultsOf(this.entry))}`;
      if (next !== window.location.search) window.history.replaceState(null, '', next);
    }, 200);
  }

  private fromAddress(): void {
    this.state = fromQuery(window.location.search, this.entries[0].id);
    this.entry = entryById(this.state.thing) ?? this.entries[0];
    this.state.thing = this.entry.id;
    this.state.options = cleanOptions(this.entry, this.state.options);
    this.rebuild();
  }

  // --- Saving ------------------------------------------------------------------------------------------------------

  private async save(): Promise<void> {
    if (!this.subject) return;
    let blob: Blob | null;
    if (this.subject.svg !== null) {
      blob = await rasterizeIcon(query<SVGSVGElement>(this.flat, 'svg'), 1024);
    } else {
      const canvas = this.stage.capture({ view: this.currentView(), background: 'checker', grid: false, light: this.state.light });
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      this.schedule();
    }
    if (!blob) return;
    const link = make('a');
    link.href = URL.createObjectURL(blob);
    link.download = `portage-${this.entry.id.replace('/', '-')}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  private async copyLink(): Promise<void> {
    window.clearTimeout(this.addressTimer);
    window.history.replaceState(null, '', `?${toQuery(this.state, defaultsOf(this.entry))}`);
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.caption.textContent = 'Link copied.';
    } catch {
      this.caption.textContent = 'Copy the address from the bar: it holds this picture.';
    }
  }

  /** For the browser tests. */
  probe(): { thing: string; options: Options; view: ViewName; free: View | null; background: Background; grid: boolean; light: string; frames: number; width: number; height: number; failure: string; triangles: number; drawCalls: number; ids: string[] } {
    return {
      thing: this.entry.id, options: this.state.options, view: this.state.view, free: this.state.free, background: this.state.background, grid: this.state.grid, light: this.state.light,
      frames: this.frames, width: this.stage.width, height: this.stage.height, failure: this.failure, triangles: this.subject?.triangles ?? 0, drawCalls: this.subject?.drawCalls ?? 0,
      ids: this.entries.map((entry) => entry.id),
    };
  }

  /** For the browser tests: choose a thing as a click on the list would. */
  open(id: string): void {
    this.choose(id);
  }
}

declare global {
  interface Window {
    viewer?: Viewer;
  }
}

window.viewer = new Viewer(query(document, '#app'));
