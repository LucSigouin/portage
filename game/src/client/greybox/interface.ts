/**
 * The greybox UI: every screen and panel as plain lists and buttons, driven
 * only by the interface model. It keeps no state of its own beyond what the
 * browser needs (scroll position, focus) and decides nothing: every button
 * carries the intent the view model gave it.
 *
 * Each region is rendered to an HTML string and swapped in only when the
 * string changes, so an idle panel costs nothing.
 */
import './greybox.css';
import type {
  BuildRowModel, ButtonModel, ConfirmModel, CostRowModel, DebugModel, GameInterface, HudModel, InterfaceIntent,
  InterfaceModel, ItemSlotModel, LobbyModel, ObjectiveRowModel, PanelModel, SettingRowModel, ToastModel,
} from '../contracts.ts';

const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const intentAttribute = (intent: InterfaceIntent): string => `data-intent="${escapeHtml(JSON.stringify(intent))}"`;

function buttonHtml(button: ButtonModel, className = ''): string {
  const note = button.note ? `<small>${escapeHtml(button.note)}</small>` : '';
  return `<button class="${className}" ${intentAttribute(button.intent)}${button.enabled ? '' : ' disabled'}>`
    + `${escapeHtml(button.label)}${note}</button>`;
}

const objectivesHtml = (objectives: ObjectiveRowModel[]): string => `<ul class="gb-objectives">${objectives.map((objective) =>
  `<li class="${objective.done ? 'gb-done' : ''}">${objective.done ? '[x]' : '[ ]'} ${escapeHtml(objective.text)}`
  + `${objective.progressText ? ` <b>${escapeHtml(objective.progressText)}</b>` : ''}</li>`).join('')}</ul>`;

const costsHtml = (costs: CostRowModel[]): string => costs.map((cost) =>
  `<span class="gb-cost ${cost.enough ? '' : 'gb-short'}">${escapeHtml(cost.name)} ${cost.have}/${cost.need}</span>`).join(' ');

// --- Lobby, HUD, toasts ----------------------------------------------------------

function lobbyHtml(lobby: LobbyModel): string {
  return `<div class="gb-lobby-box"><h1>${escapeHtml(lobby.title)}</h1><p>${escapeHtml(lobby.tagline)}</p>`
    + `<nav>${lobby.buttons.map((button) => buttonHtml(button, 'gb-menu')).join('')}</nav></div>`;
}

function hudHtml(hud: HudModel, patterned: boolean): string {
  const meters = hud.meters.map((meter) =>
    `<div class="gb-meter ${meter.low ? 'gb-low' : ''}"><span>${meter.label}</span>`
    + `<div class="gb-bar ${patterned ? `gb-${meter.pattern}` : ''}"><i style="width:${meter.value}%"></i>`
    + `${meter.cap < 100 ? `<u style="left:${meter.cap}%"></u>` : ''}</div><b>${meter.value}</b></div>`).join('');
  const water = hud.water.visible
    ? `<div class="gb-meter gb-water ${hud.water.warning ? 'gb-low' : ''}"><span>Water</span>`
      + `<div class="gb-bar ${patterned ? 'gb-waves' : ''}"><i style="width:${hud.water.value}%"></i></div><b>${hud.water.value}</b></div>`
      + `<div class="gb-line">${escapeHtml(hud.water.label)} (${hud.water.trend})</div>`
    : '';
  const canoe = hud.canoeLines.map((line) => `<div class="gb-line gb-${line.tone}">${escapeHtml(line.text)}</div>`).join('');
  const tracker = hud.tracker
    ? `<div class="gb-tracker"><h3>${escapeHtml(hud.tracker.name)}${hud.tracker.ready ? ' (ready)' : ''}</h3>`
      + `${objectivesHtml(hud.tracker.objectives)}</div>`
    : '';
  const marks = hud.compass.marks.filter((mark) => Math.abs(mark.relativeDegrees) <= 90).map((mark) =>
    `<span class="gb-mark gb-mark-${mark.kind}" style="left:${50 + (mark.relativeDegrees / 90) * 50}%">`
    + `${escapeHtml(mark.label)}${mark.distanceText ? `<small>${escapeHtml(mark.distanceText)}</small>` : ''}</span>`).join('');
  const offscreen = hud.compass.marks.filter((mark) => mark.kind !== 'cardinal' && Math.abs(mark.relativeDegrees) > 90).map((mark) =>
    `${escapeHtml(mark.label)} ${mark.relativeDegrees < 0 ? 'behind left' : 'behind right'}, ${escapeHtml(mark.distanceText)}`).join(' | ');
  const prompt = hud.prompt
    ? `<div class="gb-prompt gb-prompt-${hud.prompt.mode}">${hud.prompt.keyLabel ? `<kbd>${escapeHtml(hud.prompt.keyLabel)}</kbd> ` : ''}`
      + `${escapeHtml(hud.prompt.text)}</div>`
    : '';
  const hotbar = hud.hotbar.map((slot) => (slot.intent
    ? `<button class="gb-slot ${slot.selected ? 'gb-selected' : ''}" ${intentAttribute(slot.intent)}>`
      + `<kbd>${escapeHtml(slot.keyLabel)}</kbd>${escapeHtml(slot.name)}</button>`
    : `<span class="gb-slot gb-empty"><kbd>${escapeHtml(slot.keyLabel)}</kbd></span>`)).join('');
  return `<div class="gb-top-left">${meters}${water}${canoe}</div>`
    + `<div class="gb-top-centre"><div class="gb-compass">${marks}</div>`
    + `<div class="gb-line">${hud.compass.cardinal} ${Math.round(hud.compass.headingDegrees)}&deg;${offscreen ? ` | ${offscreen}` : ''}</div></div>`
    + `<div class="gb-top-right"><div class="gb-line">${escapeHtml(hud.clockText)}${hud.night ? ' (night)' : ''}</div>`
    + `<div class="gb-line ${hud.stormWarning ? 'gb-danger' : ''}">${escapeHtml(hud.weatherText)}</div>`
    + `<div class="gb-line">${escapeHtml(hud.placeText)}</div>${tracker}</div>`
    + `<div class="gb-bottom">${hud.lineNote ?? hud.hint ? `<div class="gb-hint">${escapeHtml(hud.lineNote ?? hud.hint ?? '')}</div>` : ''}${prompt}`
    + `<div class="gb-hotbar">${hotbar}</div></div>`;
}

const toastsHtml = (toasts: ToastModel[]): string => toasts.map((toast) =>
  `<div class="gb-toast gb-${toast.tone}" style="opacity:${toast.life < 0.2 ? 0.5 : 1}">${escapeHtml(toast.text)}</div>`).join('');

function debugHtml(debug: DebugModel): string {
  const rate = debug.showFrameRate
    ? `<div>${debug.framesPerSecond} fps | frame ${debug.frameMilliseconds.toFixed(1)} ms | work ${debug.workMilliseconds.toFixed(1)} ms</div>`
    : '';
  return rate + debug.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

// --- Panels ------------------------------------------------------------------------

function settingRowHtml(row: SettingRowModel): string {
  const id = `data-setting="${row.setting}"`;
  let control: string;
  if (row.kind === 'slider') {
    control = `<input type="range" ${id} min="${row.minimum}" max="${row.maximum}" step="${row.step}" value="${row.value}">`
      + `<output>${escapeHtml(row.valueText)}</output>`;
  } else if (row.kind === 'toggle') {
    control = `<input type="checkbox" ${id}${row.value ? ' checked' : ''}><output>${escapeHtml(row.valueText)}</output>`;
  } else {
    control = `<select ${id}>${row.options.map((option) =>
      `<option value="${escapeHtml(JSON.stringify(option.value))}"${option.value === row.value ? ' selected' : ''}>`
      + `${escapeHtml(option.label)}</option>`).join('')}</select>`;
  }
  return `<label class="gb-row"><span>${escapeHtml(row.label)}</span>${control}</label>`;
}

function slotHtml(slot: ItemSlotModel): string {
  if (slot.itemId === null) return '<li class="gb-item gb-empty">empty</li>';
  return `<li class="gb-item" title="${escapeHtml(slot.description)}"><b>${escapeHtml(slot.name)}</b> x${slot.count}`
    + `<span class="gb-actions">${slot.buttons.map((button) => buttonHtml(button)).join('')}</span></li>`;
}

function buildRowHtml(row: BuildRowModel): string {
  return `<li class="gb-entry ${row.built ? 'gb-done' : ''}"><div><b>${escapeHtml(row.name)}</b>${row.built ? ' (built)' : ''}`
    + `<p>${escapeHtml(row.description)}</p>${costsHtml(row.costs)}`
    + `${row.missingText ? `<p class="gb-warning">${escapeHtml(row.missingText)}</p>` : ''}</div>`
    + `${row.build ? buttonHtml({ ...row.build, note: null }) : ''}</li>`;
}

function panelBodyHtml(panel: PanelModel): string {
  switch (panel.id) {
    case 'settings':
      return `<nav class="gb-tabs">${panel.tabs.map((tab) =>
        `<button class="${tab.selected ? 'gb-selected' : ''}" ${intentAttribute(tab.intent)}>${escapeHtml(tab.label)}</button>`).join('')}</nav>`
        + panel.rows.map(settingRowHtml).join('')
        + (panel.bindings.length > 0 ? `<h3>Keys</h3><p class="gb-notice">${escapeHtml(panel.bindingNotice) || 'Click a key to change it.'}</p>`
          + `<table class="gb-bindings">${panel.bindings.map((binding) =>
            `<tr class="${binding.unbound ? 'gb-warning' : ''}"><td>${escapeHtml(binding.label)}</td><td>${binding.contextLabel}</td>`
            + binding.slots.map((slot) => `<td><button class="${slot.capturing ? 'gb-selected' : ''}" ${intentAttribute(slot.rebind)}>`
              + `${slot.capturing ? 'Press a key' : escapeHtml(slot.keyLabel ?? '(none)')}</button>`
              + `${slot.clear ? `<button class="gb-small" ${intentAttribute(slot.clear)} title="Remove this key">x</button>` : ''}</td>`).join('')
            + '</tr>').join('')}</table>` : '')
        + (panel.resetBindings ? buttonHtml(panel.resetBindings) : '');
    case 'how_to_play':
      return panel.sections.map((section) => `<h3>${escapeHtml(section.heading)}</h3>`
        + section.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
        + (section.controls.length > 0 ? `<table class="gb-controls">${section.controls.map((control) =>
          `<tr><td>${escapeHtml(control.label)}</td><td><kbd>${escapeHtml(control.keys)}</kbd></td></tr>`).join('')}</table>` : '')).join('');
    case 'credits':
      return `<div class="gb-credits">${panel.lines.map((line) => `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('')}</div>`;
    case 'pause':
      return `<p>${escapeHtml(panel.summary)}</p><nav class="gb-column">${panel.buttons.map((button) => buttonHtml(button, 'gb-menu')).join('')}</nav>`;
    case 'save_slots':
      return `<ul class="gb-list">${panel.slots.map((slot) =>
        `<li class="gb-entry"><div><b>${escapeHtml(slot.title)}</b>${slot.current ? ' (playing)' : ''}`
        + `<p>${escapeHtml(slot.summary)}</p>${slot.questText ? `<p>${escapeHtml(slot.questText)}</p>` : ''}`
        + `${slot.savedText ? `<p>${escapeHtml(slot.savedText)}</p>` : ''}</div>`
        + `<span class="gb-actions">${slot.buttons.map((button) => buttonHtml(button)).join('')}</span></li>`).join('')}</ul>`;
    case 'inventory':
      return `<div class="gb-columns"><section><h3>${escapeHtml(panel.backpack.label)}</h3><ul class="gb-list">${panel.backpack.slots.map(slotHtml).join('')}</ul>`
        + `${buttonHtml(panel.stow)} ${buttonHtml(panel.fillWater)}</section>`
        + `<section class="${panel.cargo.accessible ? '' : 'gb-dim'}"><h3>${escapeHtml(panel.cargo.label)}</h3>`
        + `<ul class="gb-list">${panel.cargo.slots.map(slotHtml).join('')}</ul></section></div>`
        + `<h3>Tool belt</h3><p>${panel.belt.filter((tool) => tool.toolId !== null).map((tool) =>
          `<button class="${tool.selected ? 'gb-selected' : ''}" ${intentAttribute(tool.buttons[0]!.intent)}>${escapeHtml(tool.name)}</button>`).join(' ') || 'No tools'}</p>`
        + (panel.keyItems.length > 0 ? `<h3>Key items</h3><p>${panel.keyItems.map((item) => `${escapeHtml(item.name)} x${item.count}`).join(', ')}</p>` : '')
        + (panel.pendingRewards ? `<p class="gb-warning">${escapeHtml(panel.pendingRewards.text)} ${buttonHtml(panel.pendingRewards.claim)}</p>` : '')
        + `<p>${escapeHtml(panel.stationsText)}</p>`;
    case 'crafting':
      return panel.stations.map((station) =>
        `<h3>${escapeHtml(station.name)}</h3><ul class="gb-list">${station.recipes.map((recipe) =>
          `<li class="gb-entry ${recipe.known ? '' : 'gb-dim'}"><div><b>${escapeHtml(recipe.name)}</b> ${escapeHtml(recipe.outputText)}`
          + `<p>${escapeHtml(recipe.description)}</p>${costsHtml(recipe.inputs)}`
          + `${recipe.missingText ? `<p class="gb-warning">${escapeHtml(recipe.missingText)}</p>` : ''}`
          + `${recipe.sourceText ? `<p>${escapeHtml(recipe.sourceText)}</p>` : ''}</div>`
          + `<span class="gb-actions">${buttonHtml({ ...recipe.craft, note: null })}${recipe.craftAll ? buttonHtml(recipe.craftAll) : ''}</span></li>`).join('')}</ul>`).join('');
    case 'canoe_builder':
      return (panel.blockedText ? `<p class="gb-warning">${escapeHtml(panel.blockedText)}</p>` : '')
        + `<p>${panel.statLines.map(escapeHtml).join(' | ')}</p>`
        + `<h3>Hull</h3><ul class="gb-list">${panel.hull ? buildRowHtml(panel.hull) : '<li>The hull is as good as it gets.</li>'}</ul>`
        + `<h3>Attachments</h3><ul class="gb-list">${panel.attachments.map(buildRowHtml).join('')}</ul>`;
    case 'quest_log':
      return panel.groups.map((group) => `<h3>${escapeHtml(group.heading)}</h3><ul class="gb-list">${group.quests.map((quest) =>
        `<li class="gb-entry ${quest.done ? 'gb-done' : ''}"><div><b>${escapeHtml(quest.name)}</b> <small>${escapeHtml(quest.statusText)}`
        + `${quest.giverText ? `, ${escapeHtml(quest.giverText)}` : ''}</small><p>${escapeHtml(quest.description)}</p>`
        + `${quest.done ? '' : objectivesHtml(quest.objectives)}</div>${quest.track ? buttonHtml(quest.track) : ''}</li>`).join('')}</ul>`).join('');
    case 'map':
      return `<p>${escapeHtml(panel.summary)}</p><div class="gb-map">`
        + panel.regions.map((region) => `<div class="gb-region" style="top:${region.top * 100}%;height:${region.height * 100}%">`
          + `${escapeHtml(region.name)} (roughness ${region.roughness})</div>`).join('')
        + panel.islands.map((island) => `<div class="gb-island" style="left:${island.left * 100}%;top:${island.top * 100}%;`
          + `width:${island.width * 100}%;height:${island.height * 100}%;transform:translate(-50%,-50%) rotate(${island.rotationDegrees}deg)"></div>`
          + `<div class="gb-island-name" style="left:${island.left * 100}%;top:${(island.top + island.height / 2) * 100}%">`
          + `${escapeHtml(island.name)}${island.bearingText ? `<small>${escapeHtml(island.bearingText)}</small>` : ''}</div>`).join('')
        + panel.markers.map((marker) => `<div class="gb-marker gb-marker-${marker.kind}" style="left:${marker.left * 100}%;top:${marker.top * 100}%">`
          + `<i></i>${escapeHtml(marker.label)}</div>`).join('')
        + '</div>';
    case 'dialogue':
      return `<p class="gb-speech">${escapeHtml(panel.text)}</p><nav class="gb-column">${panel.options.map((option) => buttonHtml(option)).join('')}</nav>`;
    // The crew lobby is the Ink & Wash interface's. The greybox only says where things stand.
    case 'crew_host':
      return `<p>${escapeHtml(panel.status)}</p>${panel.room ? `<p><b>${escapeHtml(panel.room.code)}</b> ${escapeHtml(panel.room.link)}</p>` : ''}`
        + panel.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
        + `<nav class="gb-column">${[...panel.actions, ...(panel.stop ? [panel.stop] : [])].map((button) => buttonHtml(button)).join('')}</nav>`;
    case 'crew_join':
      return `<p>${escapeHtml(panel.status)}</p>${panel.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}`
        + `<nav class="gb-column">${[panel.join, ...(panel.cancel ? [panel.cancel] : [])].map((button) => buttonHtml(button)).join('')}</nav>`;
    // The Feedback card is the Ink & Wash interface's too. What a player typed is never built into markup: not drawn here at all.
    case 'feedback':
      return `<p>${escapeHtml(panel.status)}</p>`;
    // The pick screen is the Ink & Wash interface's as well. Here: the four as plain buttons, and the one that starts.
    case 'character_select':
      return `<p>${escapeHtml(panel.subtitle)}</p><nav class="gb-column">${panel.cards.map((card) =>
        `<button class="${card.marked ? 'gb-selected' : ''}" ${intentAttribute(card.intent)}>${escapeHtml(card.name)}<small>${escapeHtml(card.line)}</small></button>`).join('')}`
        + `${buttonHtml(panel.start)}</nav>`;
  }
}

function panelHtml(panel: PanelModel): string {
  const title = panel.id === 'dialogue' ? panel.speaker : panel.title;
  return `<div class="gb-panel-box gb-panel-${panel.id}"><header><h2>${escapeHtml(title)}</h2>${buttonHtml(panel.close)}</header>`
    + `<div class="gb-panel-body">${panelBodyHtml(panel)}</div></div>`;
}

const confirmHtml = (confirm: ConfirmModel): string =>
  `<div class="gb-panel-box gb-confirm-box"><h2>${escapeHtml(confirm.title)}</h2><p>${escapeHtml(confirm.message)}</p>`
  + `<nav>${buttonHtml(confirm.accept)}${buttonHtml(confirm.cancel)}</nav></div>`;

// --- The interface -------------------------------------------------------------------

type RegionName = 'lobby' | 'hud' | 'toasts' | 'panel' | 'confirm' | 'debug';
const REGIONS: readonly RegionName[] = ['lobby', 'hud', 'toasts', 'panel', 'confirm', 'debug'];

export class GreyboxInterface implements GameInterface {
  private root: HTMLElement | null = null;
  private emit: (intent: InterfaceIntent) => void = () => {};
  private readonly regions = new Map<RegionName, HTMLElement>();
  private readonly rendered = new Map<RegionName, string>();
  private hovered: Element | null = null;
  private readonly abort = new AbortController();

  mount(root: HTMLElement, emit: (intent: InterfaceIntent) => void): void {
    this.root = root;
    this.emit = emit;
    root.classList.add('gb');
    for (const name of REGIONS) {
      const element = document.createElement('div');
      element.className = `gb-${name}`;
      root.appendChild(element);
      this.regions.set(name, element);
    }
    const options = { signal: this.abort.signal };
    root.addEventListener('click', (event) => this.onClick(event), options);
    root.addEventListener('change', (event) => this.onChange(event), options);
    root.addEventListener('pointerover', (event) => this.onPointerOver(event), options);
  }

  private onClick(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('[data-intent]') : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute('disabled')) return;
    this.emit(JSON.parse(target.dataset.intent ?? 'null') as InterfaceIntent);
    // Keep the keyboard on the game, not on the button that was clicked.
    target.blur();
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
    this.emit({ type: 'change_setting', setting: setting as never, value });
  }

  private onPointerOver(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('button:not([disabled])') : null;
    if (target === this.hovered) return;
    this.hovered = target;
    if (target) this.emit({ type: 'hover' });
  }

  private render(name: RegionName, html: string): void {
    if (this.rendered.get(name) === html) return;
    const element = this.regions.get(name);
    if (!element) return;
    // Swapping the markup would drop the scroll position and the focused control: carry both over.
    const body = element.querySelector('.gb-panel-body');
    const scrollTop = body ? body.scrollTop : 0;
    const active = document.activeElement;
    const focusedSetting = active instanceof HTMLElement && element.contains(active) ? active.dataset.setting : undefined;
    element.innerHTML = html;
    element.hidden = html === '';
    this.rendered.set(name, html);
    const nextBody = element.querySelector('.gb-panel-body');
    if (nextBody) nextBody.scrollTop = scrollTop;
    if (focusedSetting) element.querySelector<HTMLElement>(`[data-setting="${focusedSetting}"]`)?.focus();
  }

  update(model: InterfaceModel): void {
    if (!this.root) return;
    this.root.style.setProperty('--gb-scale', String(model.uiScale));
    this.root.classList.toggle('gb-paused', model.paused);
    this.render('lobby', model.lobby ? lobbyHtml(model.lobby) : '');
    this.render('hud', model.hud ? hudHtml(model.hud, model.patternedMeters) : '');
    this.render('toasts', toastsHtml(model.toasts));
    this.render('panel', model.panel ? panelHtml(model.panel) : '');
    this.render('confirm', model.confirm ? confirmHtml(model.confirm) : '');
    this.render('debug', model.debug ? debugHtml(model.debug) : '');
  }

  dispose(): void {
    this.abort.abort();
    for (const element of this.regions.values()) element.remove();
    this.regions.clear();
    this.rendered.clear();
    this.root = null;
  }
}
