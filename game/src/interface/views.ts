/**
 * The Ink & Wash views: one function per screen, card and panel, each turning
 * a piece of the interface model into a description of markup.
 *
 * They are pure. Nothing here reads the DOM, keeps state or knows a game
 * rule: every label, count and reason comes from the model, and every
 * control carries the intent the model gave it.
 */
import type {
  BuildRowModel, BuiltModel, ButtonModel, ConfirmModel, CostRowModel, CrewRowModel, DebugModel, HotbarSlotModel, HudModel, InterfaceIntent,
  LobbyModel, MapMarkerModel, NeedChipModel, ObjectiveRowModel, PanelModel, PromptModel, QuestRowModel, QuestTrackerModel,
  RecipeRowModel,
  SaveSlotModel, SettingRowModel, TextFieldModel, ToastModel,
} from '../client/contracts.ts';
import { control, h } from './dom.ts';
import { feedbackView } from './feedback.ts';
import { castView } from './cast.ts';
import type { ViewChild, ViewNode } from './dom.ts';
import type { ItemId } from '../data/index.ts';
import { ICON, SEAL, itemIcon, logotype, toqueIcon, waterGauge } from './icons.ts';
import { boatTabsView, elsewhereView } from './stations.ts';
import { craftDoorsView, craftRestView } from './craftdoors.ts';
import { NOTHING_SHOWN, inventoryBodyView, inventoryHintView, tileMenuView } from './inventoryview.ts';
import type { InventoryShown } from './inventoryview.ts';
import { toastActionView } from './takeback.ts';
import { keyFace, keyedText } from './keycaps.ts';
import { mapHintView, markLegendRows } from './mapmarks.ts';

const icon = (markup: string, className = ''): ViewNode => h('i.iw-i', { class: className, html: markup, 'aria-hidden': 'true' });

/** The drawing of an item, set before its name wherever the model names one. `data-item` says which. */
const itemIconView = (itemId: ItemId, className = ''): ViewNode =>
  h('i.iw-i.iw-item-ico', { class: className, html: itemIcon(itemId), 'aria-hidden': 'true', 'data-item': itemId });

const classes = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

const percent = (share: number): string => `${(share * 100).toFixed(2)}%`;

/** Destructive choices are drawn quietly, so the eye lands on the safe one. */
const isQuiet = (intent: InterfaceIntent): boolean =>
  intent.type === 'delete_save' || (intent.type === 'command' && intent.command.type === 'discard');

/** A paper button. The note says why it is disabled, or adds a detail. */
function buttonView(button: ButtonModel, selector: string, showNote = true, key: string | number | null = null): ViewNode {
  return control(h(selector, { key, type: 'button', disabled: !button.enabled, class: isQuiet(button.intent) ? 'iw-quiet' : '' },
    h('span.iw-label', null, button.label),
    showNote && button.note ? h('small.iw-note', null, button.note) : null), button.intent);
}

/** A line of the big menus: the lobby, the pause card, a survivor's answers. */
function menuItemView(button: ButtonModel, index: number): ViewNode {
  return control(h('button.iw-mi', { key: index, type: 'button', disabled: !button.enabled },
    h('span.iw-label', null, button.label),
    button.note ? h('span.iw-n', null, button.note) : null), button.intent);
}

function objectivesView(objectives: ObjectiveRowModel[]): ViewNode {
  return h('ul.iw-objectives', null, objectives.map((objective, index) => {
    // "2 / 4" also draws as pips while the count is small enough to take in at a glance.
    const counted = /^(\d+) \/ (\d+)$/.exec(objective.progressText);
    const total = counted ? Number(counted[2]) : 0;
    const filled = counted ? Number(counted[1]) : 0;
    return h('li', { key: index, class: objective.done ? 'iw-done' : '' },
      h('span.iw-objective-text', null, objective.text),
      h('span.iw-pips', null,
        counted && total <= 6
          ? Array.from({ length: total }, (_, pip) => h('i', { class: pip < filled ? 'iw-filled' : '' }))
          : null,
        objective.progressText ? h('b', null, objective.progressText) : h('i.iw-box', { class: objective.done ? 'iw-filled' : '' })));
  }));
}

const NEED_ICON: Record<NeedChipModel['kind'], string> = { hull: ICON.canoe, attachment: ICON.canoe, person: ICON.person, station: ICON.camp };

/**
 * What a recipe or a part asks for, a chip each: the drawing, the name, have/need. Luc's bugfix list, line 15: the
 * chips say what is missing, so no line of words repeats it. A chip that has enough is ruled in ink and ticked; a chip
 * that is short is ruled dashed in rust and crossed. The tick and the cross, and the solid and dashed rule, tell them
 * apart without the colour. What is missing that is not an item (a hull, a part, a survivor's word) gets a chip too.
 */
const costsView = (costs: CostRowModel[], needs: NeedChipModel[] = []): ViewNode => h('div.iw-costs', null,
  costs.map((cost, index) => h('span.iw-cost', { key: index, class: cost.enough ? 'iw-enough' : 'iw-short' },
    itemIconView(cost.itemId), cost.name, ' ', h('b', null, `${cost.have}/${cost.need}`),
    icon(cost.enough ? ICON.check : ICON.cross, 'iw-mark-have'))),
  needs.map((need, index) => h('span.iw-cost.iw-short.iw-need', { key: `need-${index}`, class: `iw-need-${need.kind}`, title: `Needs ${need.name}` },
    icon(NEED_ICON[need.kind], 'iw-need-ico'), need.name, icon(ICON.cross, 'iw-mark-have'))));

// --- Lobby -------------------------------------------------------------------------

export function lobbyView(lobby: LobbyModel): ViewNode[] {
  return [h('div.iw-lobby-col', { key: 'lobby' },
    h('div.iw-logo-row', null, h('h1.iw-logo-holder', { html: logotype(lobby.title) }), icon(SEAL, 'iw-seal-holder')),
    h('p.iw-tagline', null, lobby.tagline),
    h('nav.iw-menu', null, lobby.buttons.map(menuItemView)))];
}

// --- HUD ---------------------------------------------------------------------------

const METER_ICON = { hunger: ICON.hunger, thirst: ICON.thirst, energy: ICON.energy } as const;

/**
 * The crew list, stood on top of the vitals card: one row a player. Their toque in their own colour,
 * their label, three small meters in the order of the big ones above, where they are and how far.
 * A low meter is marked three ways: its bar is ringed in rust, the row gets a rust mark, and the
 * words say which. An away player's toque and meters are washed out and their name is tagged
 * "away"; the words keep their full ink. Nothing in it moves.
 */
export function crewView(crew: CrewRowModel[], patterned: boolean, hidden = false): ViewNode {
  return h('div.iw-crew.iw-paper', { key: 'crew', role: 'group', 'aria-label': 'Crew', hidden },
    h('i.iw-tape'),
    crew.map((mate) => h('div.iw-mate', {
      key: mate.playerId, 'data-player': mate.playerId, 'data-where': mate.where,
      class: classes(mate.you && 'iw-you', mate.lowText !== '' && 'iw-low', mate.away && 'iw-away'),
    },
    icon(toqueIcon(mate.color), 'iw-mate-toque'),
    // One tag at most: you, or away, or who hosts.
    h('span.iw-mate-name', null, mate.label,
      mate.you ? h('small.iw-kind', null, 'you')
        : mate.away ? h('small.iw-kind', null, 'away')
          : mate.host ? h('small.iw-kind', null, 'host') : null),
    h('span.iw-mate-meters', null, mate.meters.map((meter) => h('span.iw-bar', {
      key: meter.id, role: 'img', 'aria-label': `${meter.label} ${meter.value}`, title: `${meter.label} ${meter.value}`,
      class: classes(`iw-bar-${meter.id}`, patterned && `iw-${meter.pattern}`, meter.low && 'iw-low'),
    },
    h('i', { style: `--v:${meter.value / 100}` }),
    meter.cap < 100 ? h('u', { style: `--v:${meter.cap / 100}` }) : null))),
    mate.lowText !== '' ? h('b.iw-mate-alert', { key: 'alert', 'aria-hidden': 'true' }, '!')
      : mate.where === 'asleep' ? icon(ICON.moon, 'iw-mate-asleep') : null,
    h('span.iw-mate-place', null,
      h('span', null, mate.placeText),
      mate.distanceText ? h('span.iw-mate-far', null, mate.distanceText) : null,
      mate.lowText !== '' ? h('b.iw-mate-low', null, mate.lowText) : null))));
}

/**
 * Bottom left: the three meters, the water in the hull and the canoe's status lines. With a crew, the crew list over them.
 * Small (in a crew, behind a sheet: edgecards.ts) it is one row: the bars, their numbers and the water's words. The rest
 * takes the hidden attribute, so it is off the screen and out of a screen reader's reach alike.
 */
export function vitalsView(hud: HudModel, patterned: boolean, small = false): ViewNode[] {
  const water = hud.water;
  const left = small || undefined;
  return [h('div.iw-vitals.iw-paper', { key: 'vitals' },
    h('i.iw-tape', { hidden: left }),
    hud.meters.map((meter) => h('div.iw-meter', { key: meter.id, class: meter.low ? 'iw-low' : '' },
      icon(METER_ICON[meter.id]),
      h('span.iw-lab', { hidden: left }, meter.label),
      h('div.iw-bar', { class: classes(`iw-bar-${meter.id}`, patterned && `iw-${meter.pattern}`) },
        h('i', { style: `--v:${meter.value / 100}` }),
        meter.cap < 100 ? h('u', { style: `--v:${meter.cap / 100}` }) : null),
      h('span.iw-val', null, meter.value))),
    water.visible ? h('div.iw-bilge', { key: 'water', class: water.warning ? 'iw-low' : '' },
      h('div.iw-gauge-holder', { hidden: left, html: waterGauge(water.value / 100, patterned) }),
      h('div.iw-bilge-text', null,
        h('b', null, water.label),
        h('span', null, `${water.value}%`, icon(ICON[water.trend], 'iw-trend-holder'), water.trend))) : null,
    hud.canoeLines.length > 0 ? h('div.iw-canoe-lines', { key: 'canoe', hidden: left }, hud.canoeLines.map((line, index) =>
      h('div', { key: index, class: `iw-tone-${line.tone}` }, line.text))) : null,
    hud.crew.length > 1 ? crewView(hud.crew, patterned, small) : null)];
}

/**
 * One quest on the card. The first is written large with every step, the done ones struck through. The others
 * (a player may follow three) are written smaller, with only the steps still to do, so three fit above the meters.
 */
function trackerView(tracker: QuestTrackerModel, first: boolean): ViewNode {
  return h('div.iw-tracker', { key: tracker.questId, class: first ? '' : 'iw-tracker-more' },
    h('h3', null, tracker.name,
      tracker.kind === 'side' ? h('small.iw-kind', null, tracker.kind) : null,
      tracker.ready ? icon(ICON.check, 'iw-ready') : null),
    objectivesView(first ? tracker.objectives : tracker.objectives.filter((objective) => !objective.done)));
}

/** Top left: the field notes. The day, the place, the weather and the quests on this player's card. */
export function notesView(hud: HudModel): ViewNode[] {
  return [h('div.iw-notes.iw-paper', { key: 'notes' },
    h('i.iw-tape'),
    h('div.iw-over', null, icon(hud.night ? ICON.moon : ICON.sun, 'iw-sky'), h('span', null, hud.clockText), h('span', null, hud.placeText)),
    h('div.iw-weather', { class: hud.stormWarning ? 'iw-tone-danger' : '' }, hud.weatherText),
    hud.trackers.map((tracker, index) => trackerView(tracker, index === 0)))];
}

/**
 * The built view's slip: what was built, under the canoe, while the screen holds it. It is written and taken
 * away whole: nothing fades. The slip itself takes no click: the screen behind it does (interface.ts).
 */
export function builtView(built: BuiltModel): ViewNode[] {
  return [h('div.iw-shown-slip.iw-paper', { key: 'built', role: 'status' },
    h('small.iw-shown-kicker', null, built.kicker),
    h('b.iw-shown-title', null, built.title),
    h('span.iw-shown-text', null, built.text),
    h('small.iw-shown-hint', null, built.hint))];
}

export function hintView(hint: string): ViewNode[] {
  return [h('div.iw-hint', { key: 'hint' }, keyedText(hint))];
}

/** The line to the host has stalled: a slip that stands where the tip does until the host is heard again. It does not move. */
export function lineNoteView(note: string): ViewNode[] {
  return [h('div.iw-hint.iw-line-note', { key: 'line-note', role: 'status' }, note)];
}

export function promptView(prompt: PromptModel): ViewNode[] {
  return [h('div.iw-prompt.iw-paper', { key: 'prompt', class: classes(`iw-prompt-${prompt.mode}`, prompt.keyLabel === '' && 'iw-prompt-keyless') },
    prompt.keyLabel === '' ? null : h('span.iw-key', null, keyFace(prompt.keyLabel)),
    h('span.iw-prompt-text', null, prompt.text))];
}

export function hotbarView(hotbar: HotbarSlotModel[]): ViewNode[] {
  return [h('div.iw-hotbar', { key: 'hotbar' }, hotbar.map((slot) => (slot.intent && slot.itemId
    // The number keys pick these; they stay out of the Tab order so Tab stays the game's.
    ? control(h('button.iw-slot.iw-paper', {
      key: slot.number, type: 'button', tabindex: -1, class: slot.selected ? 'iw-selected' : '', title: slot.name,
      'aria-label': `${slot.keyLabel}: ${slot.name}`, 'aria-pressed': String(slot.selected),
    },
    h('span.iw-n', null, keyFace(slot.keyLabel)),
    itemIconView(slot.itemId),
    slot.selected ? h('span.iw-nm', null, slot.name) : null,
    slot.selected ? h('i.iw-underline') : null), slot.intent)
    : h('div.iw-slot.iw-empty', { key: slot.number }, h('span.iw-n', null, keyFace(slot.keyLabel))))))];
}

export const toastsView = (toasts: ToastModel[]): ViewNode[] => toasts.map((toast) =>
  h('div.iw-toast', { key: toast.id, class: `iw-toast-${toast.tone}${toast.action ? ' iw-toast-offer' : ''}`, role: 'status' }, h('i.iw-dab'),
    toast.itemId ? itemIconView(toast.itemId) : null, h('span', null, keyedText(toast.text, toast.said)),
    // A dropped stack's way back, while it may still be taken (takeback.ts).
    toast.action ? toastActionView(toast.action) : null));

export function debugView(debug: DebugModel): ViewNode[] {
  const lines = debug.showFrameRate
    ? [`${debug.framesPerSecond} fps · frame ${debug.frameMilliseconds.toFixed(1)} ms · work ${debug.workMilliseconds.toFixed(1)} ms`, ...debug.lines]
    : debug.lines;
  return lines.map((line, index) => h('div', { key: index }, line));
}

// --- Panels ------------------------------------------------------------------------

type PanelSize = 'wide' | 'mid' | 'narrow';

/**
 * The cut mark: a pen rule and two words under a panel's body, for when the body goes on below its bottom edge
 * (a long panel in a short window). It is in every sheet, hidden. The interface shows it while there is more
 * below and hides it at the end (`InkInterface.markCut`). It takes no room and it never moves.
 */
const cutMarkView = (): ViewNode => h('div.iw-cut', { key: 'cut', hidden: true, 'aria-hidden': 'true' },
  h('span.iw-cut-words', null, icon(ICON.caret), 'more below', icon(ICON.caret)));

/** The sheet every full panel is written on: taped corners, a title, a body that scrolls, a way out. */
function sheet(
  panel: PanelModel, size: PanelSize, subtitle: string, body: ViewChild, footerStart: ViewChild = null,
): ViewNode[] {
  return [h('section.iw-panel.iw-paper', { key: panel.id, class: `iw-panel-${panel.id} iw-${size}`, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    size === 'wide' ? h('i.iw-tape.iw-b') : null,
    h('header', null, h('h2', null, panel.title), subtitle ? h('span.iw-sub', null, subtitle) : null),
    body,
    cutMarkView(),
    h('footer', null, footerStart ?? h('span'), buttonView(panel.close, 'button.iw-btn.iw-go')))];
}

function settingRowView(row: SettingRowModel): ViewNode {
  const id = `iw-setting-${row.setting}`;
  let field: ViewNode;
  if (row.kind === 'slider') {
    field = h('span.iw-sl', null,
      h('input', {
        type: 'range', id, 'data-setting': row.setting, min: row.minimum, max: row.maximum, step: row.step, value: row.value,
        'aria-valuetext': row.valueText,
      }),
      h('output', { for: id }, row.valueText));
  } else if (row.kind === 'toggle') {
    field = h('span.iw-tg', null,
      h('input', { type: 'checkbox', id, 'data-setting': row.setting, checked: row.value }),
      h('span.iw-box', { html: ICON.check }),
      h('output', { for: id }, row.valueText));
  } else {
    field = h('span.iw-dd', null,
      h('select', { id, 'data-setting': row.setting, value: JSON.stringify(row.value) }, row.options.map((option) =>
        h('option', { key: JSON.stringify(option.value), value: JSON.stringify(option.value) }, option.label))),
      icon(ICON.caret));
  }
  return h('div.iw-row', { key: row.setting }, h('label.iw-l', { for: id }, row.label), field);
}

function settingsView(panel: Extract<PanelModel, { id: 'settings' }>): ViewNode[] {
  const tabs = h('div.iw-tabs', null, panel.tabs.map((tab) => control(h('button.iw-tab', {
    key: tab.tab, type: 'button', class: tab.selected ? 'iw-on' : '', 'aria-current': tab.selected ? 'page' : null,
  }, tab.label), tab.intent)));
  const bindings = panel.bindings.length > 0 ? [
    h('p.iw-notice', { key: 'notice', role: 'status' }, keyedText(panel.bindingNotice || 'Click a key to change it.')),
    h('table.iw-bindings', { key: 'bindings', style: `--iw-rows:${Math.ceil(panel.bindings.length / 2)}` },
      h('tbody', null, panel.bindings.map((binding) => h('tr', { key: binding.action, class: binding.unbound ? 'iw-unbound' : '' },
        h('th', { scope: 'row' }, binding.label, h('small', null, binding.contextLabel)),
        binding.slots.map((slot) => h('td', { key: slot.slot },
          control(h('button.iw-key.iw-bind', {
            type: 'button', class: slot.capturing ? 'iw-listen' : slot.keyLabel === null ? 'iw-none' : '',
          }, slot.capturing ? 'press…' : keyFace(slot.keyLabel ?? 'none')), slot.rebind),
          slot.clear ? control(h('button.iw-clear', {
            type: 'button', 'aria-label': 'Remove this key', title: 'Remove this key', html: ICON.cross,
          }), slot.clear) : null)))))),
  ] : null;
  return sheet(panel, 'wide', panel.version, [
    tabs,
    h('div.iw-body', { key: 'body' }, h('div.iw-rows', null, panel.rows.map(settingRowView)), bindings),
  ], panel.resetBindings ? buttonView(panel.resetBindings, 'button.iw-btn.iw-quiet') : null);
}

/** "W / Up, S / Down" as key caps: a comma parts the keys, a slash the two ways to press one. */
const keyCapsView = (keys: string): ViewNode[] => keys.split(', ').map((group, index) =>
  h('span.iw-ks', { key: index }, group.split(' / ').map((key, alternative) => h('span.iw-key', { key: alternative }, keyFace(key)))));

function howToPlayView(panel: Extract<PanelModel, { id: 'how_to_play' }>): ViewNode[] {
  return sheet(panel, 'wide', '', h('div.iw-body.iw-howto', { key: 'body' }, panel.sections.map((section, index) =>
    h('section', { key: index },
      h('h3', null, section.heading),
      section.lines.map((line, lineIndex) => h('p', { key: lineIndex }, line)),
      section.controls.length > 0 ? h('dl.iw-keys', null, section.controls.map((line, lineIndex) =>
        h('div', { key: lineIndex }, h('dt', { 'aria-label': line.keys }, keyCapsView(line.keys)), h('dd', null, line.label)))) : null))));
}

function creditsView(panel: Extract<PanelModel, { id: 'credits' }>): ViewNode[] {
  return sheet(panel, 'mid', '', h('div.iw-body.iw-credits', { key: 'body', class: panel.completed ? 'iw-completed' : '' },
    icon(SEAL, 'iw-seal-holder'),
    panel.lines.map((line, index) => (line
      ? h('p', { key: index, class: index === 0 ? 'iw-credit-title' : '' }, line)
      : h('p.iw-gap', { key: index, 'aria-hidden': 'true' })))));
}

function pauseView(panel: Extract<PanelModel, { id: 'pause' }>): ViewNode[] {
  return [h('section.iw-panel.iw-paper.iw-narrow', { key: panel.id, class: `iw-panel-${panel.id}`, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    icon(SEAL, 'iw-seal-holder'),
    h('h2', null, panel.title),
    h('p.iw-pause-note', null, panel.summary),
    h('nav.iw-menu', null, panel.buttons.map(menuItemView)),
    h('div.iw-foot', null, buttonView(panel.close, 'button.iw-btn.iw-quiet')))];
}

function saveSlotView(slot: SaveSlotModel): ViewNode {
  return h('li.iw-save', { key: slot.slot, class: classes(slot.empty && 'iw-blank', slot.corrupt && 'iw-corrupt', slot.current && 'iw-current') },
    h('div.iw-entry-text', null,
      h('h3', null, slot.title, slot.current ? h('small.iw-kind', null, 'playing') : null),
      h('p.iw-save-summary', null, slot.summary),
      slot.questText ? h('p', null, slot.questText) : null,
      slot.savedText ? h('p', null, slot.savedText) : null),
    h('div.iw-actions', null, slot.buttons.map((button, index) => buttonView(button, 'button.iw-btn', true, index))));
}

// The inventory has its own module (`inventoryview.ts`): the tiles, their keys, and the two quick presses.
export { itemDetailKey, itemDetailKeys } from './inventoryview.ts';

// The small menu at a tile is the sheet's own child, after its body: the body scrolls and would cut it.
const inventoryView = (panel: Extract<PanelModel, { id: 'inventory' }>, shown: InventoryShown): ViewNode[] =>
  sheet(panel, 'wide', panel.stationsText, [inventoryBodyView(panel, shown), tileMenuView(panel, shown.menu)], inventoryHintView());

/**
 * The red ! before a recipe or a part an open quest still asks for (Luc's bugfix list, line 19). It is a mark, not a
 * colour alone: the ! itself says it, and its title and label name the quest. It stands still.
 */
const questMarkView = (questText: string): ViewNode | null => (questText
  ? h('b.iw-quest-mark', { key: 'quest', title: questText, 'aria-label': questText }, '!')
  : null);

function recipeView(recipe: RecipeRowModel): ViewNode {
  return h('li.iw-entry', { key: recipe.recipeId, class: recipe.known ? '' : 'iw-unknown' },
    h('div.iw-entry-text', null,
      questMarkView(recipe.questText),
      recipe.itemId ? itemIconView(recipe.itemId, 'iw-lead') : null,
      h('b', null, recipe.name), ' ', h('span.iw-count', null, recipe.outputText),
      recipe.known ? null : h('small.iw-kind', null, 'not learned'),
      h('small', null, recipe.description),
      costsView(recipe.inputs, recipe.needs),
      recipe.sourceText ? h('p.iw-source', null, recipe.sourceText) : null),
    h('div.iw-actions', null,
      buttonView(recipe.craft, 'button.iw-btn.iw-small', false, 'one'),
      recipe.craftAll ? buttonView(recipe.craftAll, 'button.iw-btn.iw-small', true, 'all') : null));
}

/**
 * The crafting panel (key C): the hand crafts. In a camp, a row of cards across its top: the hands, and each station
 * of that camp, whose card shows that station's own menu (`craftdoors.ts`). Each menu's body has its own key, so a
 * swap writes a fresh body from its top: nothing slides. A station that is not here is not listed (`stations.ts`).
 */
function craftingView(panel: Extract<PanelModel, { id: 'crafting' }>): ViewNode[] {
  // With nothing to make, the line that says so stands where the list would, straight under the heading.
  const empty = panel.stations.every((station) => station.recipes.length === 0);
  const rest = craftRestView(panel.restText);
  return sheet(panel, 'wide', panel.about, [craftDoorsView(panel.doors), h('div.iw-body', { key: `body-${panel.tab}`, 'data-craft-tab': panel.tab },
    panel.stations.map((station) => h('section', { key: station.name },
      panel.tab === 'hands' ? h('h3', null, station.name) : null,
      station.recipes.length > 0 ? h('ul.iw-grid', null, station.recipes.map(recipeView)) : null)),
    empty ? rest : null,
    elsewhereView(panel.elsewhere),
    empty ? null : rest)]);
}

function buildRowView(row: BuildRowModel): ViewNode {
  return h('li.iw-entry', { key: row.id, class: row.built ? 'iw-built' : '' },
    h('div.iw-entry-text', null,
      questMarkView(row.questText),
      h('b', null, row.name),
      row.built ? h('span.iw-stamp', null, icon(ICON.check, 'iw-ready'), 'built') : null,
      h('small', null, row.description),
      row.built ? null : costsView(row.costs, row.needs)),
    row.build ? h('div.iw-actions', null, buttonView(row.build, 'button.iw-btn.iw-small', false)) : null);
}

/**
 * The boat's panel (key B). Across its top, the row of icons: the canoe builder, and each station built on the
 * canoe. Under it, the one menu that is open: the builder's stats, hull and parts, or a station's recipes and
 * nothing else. Each menu's body has its own key, so a swap writes a fresh body from its top: nothing slides.
 */
function canoeBuilderView(panel: Extract<PanelModel, { id: 'canoe_builder' }>): ViewNode[] {
  const tabs = boatTabsView(panel.tabs, panel.stationsHint);
  const station = panel.station;
  if (station) {
    return sheet(panel, 'wide', station.about, [tabs, h('div.iw-body.iw-boat-station', { key: `body-${station.attachmentId}`, 'data-station': station.attachmentId },
      station.blockedText ? h('p.iw-blocked', { key: 'blocked' }, station.blockedText) : null,
      h('ul.iw-grid', { key: 'recipes' }, station.recipes.map(recipeView)))]);
  }
  return sheet(panel, 'wide', '', [tabs, h('div.iw-body', { key: 'body' },
    panel.blockedText ? h('p.iw-blocked', { key: 'blocked' }, panel.blockedText) : null,
    h('ul.iw-stats', { key: 'stats' }, panel.statLines.map((line, index) => h('li', { key: index }, line))),
    h('section', { key: 'hull' },
      h('h3', null, 'Hull'),
      h('ul.iw-grid.iw-single', null, panel.hull ? buildRowView(panel.hull)
        : h('li.iw-entry.iw-built', null, h('div.iw-entry-text', null, 'The hull is as good as it gets.')))),
    h('section', { key: 'attachments' },
      h('h3', null, 'Attachments'),
      h('ul.iw-grid', null, panel.attachments.map(buildRowView))))]);
}

function questView(quest: QuestRowModel): ViewNode {
  return h('li.iw-entry', { key: quest.questId, class: classes(quest.done && 'iw-built', quest.tracked && 'iw-tracked') },
    h('div.iw-entry-text', null,
      quest.tracked ? icon(ICON.flag, 'iw-tracked-flag') : null,
      h('b', null, quest.name), ' ',
      h('span.iw-count', null, quest.statusText),
      quest.giverText ? h('span.iw-giver', null, quest.giverText) : null,
      h('small', null, quest.description),
      quest.done ? null : objectivesView(quest.objectives),
      // What handing it in gives, each item with its drawing.
      quest.rewards.length > 0 ? h('div.iw-costs.iw-rewards', { key: 'rewards' },
        h('span.iw-rewards-label', null, 'Reward'),
        quest.rewards.map((item, index) => h('span.iw-cost', { key: index },
          itemIconView(item.itemId), item.name, ' ', h('b', null, `× ${item.count}`)))) : null),
    quest.track ? h('div.iw-actions', null, buttonView(quest.track, 'button.iw-btn.iw-small')) : null);
}

function questLogView(panel: Extract<PanelModel, { id: 'quest_log' }>): ViewNode[] {
  return sheet(panel, 'wide', '', h('div.iw-body', { key: 'body' }, panel.groups.map((group) =>
    h('section', { key: group.heading }, h('h3', null, group.heading), h('ul.iw-grid', null, group.quests.map(questView))))));
}

const MARKER_ICON: Record<MapMarkerModel['kind'], string> = {
  player: ICON.you, canoe: ICON.canoe, respawn: ICON.camp, quest: ICON.flag, survivor: ICON.person, crew: ICON.person,
};

/** A crewmate is marked by their toque, in their colour. Everything else has its own drawing. */
const markerIcon = (marker: MapMarkerModel): ViewNode =>
  icon(marker.kind === 'crew' && marker.color ? toqueIcon(marker.color) : MARKER_ICON[marker.kind]);

/** The four points of the compass round the chart's rim. */
const RIM_LETTERS = [['n', 'N'], ['e', 'E'], ['s', 'S'], ['w', 'W']] as const;

/**
 * The map: the valley's round chart, north up (painted on the canvas by `MapChart`, with the crew's fog over it),
 * and on it in ink the names of the waters the crew has been on and of the islands it has found, and the marks.
 */
function mapView(panel: Extract<PanelModel, { id: 'map' }>): ViewNode[] {
  const chart = h('div.iw-chart', { class: panel.fullChart ? 'iw-full-chart' : '' },
    h('canvas.iw-chart-canvas', { key: 'canvas', 'aria-hidden': 'true' }),
    RIM_LETTERS.map(([side, letter]) => h('b.iw-rim-letter', { key: `rim-${side}`, class: `iw-rim-${side}`, 'aria-hidden': 'true' }, letter)),
    panel.regions.filter((region) => region.seen).map((region) => h('span.iw-water-name', {
      key: region.name, style: `left:${percent(region.labelLeft)};top:${percent(region.labelTop)}`,
    }, region.name, h('small', null, `rough ${region.roughness}`))),
    panel.islands.map((island) => [
      // A name near the edge of the chart is nudged inward, so it is never cut off.
      h('span.iw-island-name', {
        key: `${island.islandId}-name`,
        style: `left:clamp(4.2rem, ${percent(island.left)}, calc(100% - 4.2rem));top:${percent(island.top + island.height / 2)}`,
      },
        island.name, island.bearingText ? h('small', null, island.bearingText) : null),
    ]),
    panel.markers.map((marker, index) => h('span.iw-marker', {
      key: `marker-${index}`, class: `iw-marker-${marker.kind}`, title: marker.label,
      // Crewmates who share a spot fan out sideways by their place in the crew, so none hides another.
      style: `left:${percent(marker.left)};top:${percent(marker.top)}${marker.kind === 'crew' ? `;--n:${marker.crewIndex ?? 0}` : ''}`,
    }, markerIcon(marker))));
  const legend = h('ul.iw-legend', null, panel.markers.map((marker, index) =>
    h('li', { key: index, class: marker.kind === 'crew' ? 'iw-legend-crew' : '' }, markerIcon(marker), h('span', null, marker.label))),
    // The marks standing, each with its player's name and colour (mapmarks.ts).
    markLegendRows(panel));
  return sheet(panel, 'wide', panel.summary, h('div.iw-body.iw-map-body', { key: 'body' }, chart, legend), mapHintView(panel));
}

function dialogueView(panel: Extract<PanelModel, { id: 'dialogue' }>): ViewNode[] {
  return [h('section.iw-panel.iw-paper', { key: panel.id, class: `iw-panel-${panel.id}`, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    h('header', null, h('h2', null, panel.speaker), buttonView(panel.close, 'button.iw-btn.iw-quiet')),
    h('p.iw-speech', null, panel.text),
    h('nav.iw-menu.iw-answers', null, panel.options.map(menuItemView)))];
}

// --- The crew lobby ------------------------------------------------------------------

/** A line the player types on, ruled like the pickers. What is typed goes back as a `crew_field` intent. */
function textFieldView(field: TextFieldModel): ViewNode {
  const id = `iw-field-${field.field}`;
  return h('div.iw-row.iw-field', { key: field.field },
    h('label.iw-l', { for: id }, field.label),
    h('input.iw-text', {
      type: 'text', id, 'data-field': field.field, value: field.value, maxlength: field.maxLength, placeholder: field.placeholder,
      disabled: !field.enabled, autocomplete: 'off', autocapitalize: field.field === 'code' ? 'characters' : 'words', spellcheck: 'false',
      class: field.field === 'code' ? 'iw-text-code' : '',
    }));
}

/** How the line is doing. Always there, so the card keeps its height when the words come and go. Nothing in it moves. */
const crewStatusView = (status: string, tone: string): ViewNode =>
  h('p.iw-crew-status', { key: 'status', role: 'status', class: `iw-tone-${tone}` }, status);

/** The card every crew panel is written on. The first action is the one Enter presses from a field. */
function crewSheet(panel: PanelModel, body: ViewChild, actions: ButtonModel[], quiet: ButtonModel | null): ViewNode[] {
  return [h('section.iw-panel.iw-paper.iw-mid.iw-panel-crew', { key: panel.id, class: `iw-panel-${panel.id}`, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    h('header', null, h('h2', null, panel.title)),
    h('div.iw-body', { key: 'body' }, body),
    cutMarkView(),
    h('footer', null,
      quiet ? buttonView(quiet, 'button.iw-btn.iw-quiet', true, 'quiet') : h('span'),
      h('div.iw-actions', null,
        actions.map((action, index) => {
          const view = buttonView(action, index === 0 ? 'button.iw-btn.iw-go' : 'button.iw-btn', true, index);
          if (index === 0) view.attributes = { ...view.attributes, 'data-primary': '' };
          return view;
        }),
        buttonView(panel.close, 'button.iw-btn', true, 'close'))))];
}

function crewHostView(panel: Extract<PanelModel, { id: 'crew_host' }>): ViewNode[] {
  const room = panel.room;
  return crewSheet(panel, [
    textFieldView(panel.name),
    room ? h('div.iw-room', { key: 'room' },
      h('div.iw-room-code', null, h('span.iw-room-label', null, 'Crew code'), h('b.iw-code', { 'data-room-code': '' }, room.code)),
      h('div.iw-room-link', null,
        h('label.iw-room-label', { for: 'iw-invite-link' }, 'Invite link'),
        h('input.iw-text.iw-text-link', { type: 'text', id: 'iw-invite-link', readonly: true, value: room.link, 'data-copy-source': '' }),
        control(h('button.iw-btn.iw-small', { type: 'button', 'data-copy': room.link },
          h('span.iw-label', null, room.copy.label),
          room.copy.note ? h('small.iw-note', null, room.copy.note) : null), room.copy.intent))) : null,
    crewStatusView(panel.status, panel.statusTone),
    panel.lines.map((line, index) => h('p.iw-crew-line', { key: `line-${index}` }, line)),
    panel.roster.length > 0 ? h('ul.iw-roster', { key: 'roster', 'aria-label': 'Crewmates' },
      panel.roster.map((mate) => h('li.iw-roster-mate', { key: mate.playerId },
        h('span.iw-roster-name', null, mate.name),
        h('span.iw-roster-state', null, mate.here ? 'Here' : 'Away'),
        buttonView(mate.remove, 'button.iw-btn.iw-small', true, 'remove')))) : null,
  ], panel.actions, panel.stop);
}

function crewJoinView(panel: Extract<PanelModel, { id: 'crew_join' }>): ViewNode[] {
  return crewSheet(panel, [
    textFieldView(panel.code),
    textFieldView(panel.name),
    crewStatusView(panel.status, panel.statusTone),
    panel.lines.map((line, index) => h('p.iw-crew-line', { key: `line-${index}` }, line)),
  ], [panel.join], panel.cancel);
}

/** `shown`: the inventory tile whose menu is open and the tile its info panel is about (`inventorymenu.ts`). Every other panel ignores it. */
export function panelView(panel: PanelModel, shown: InventoryShown = NOTHING_SHOWN): ViewNode[] {
  switch (panel.id) {
    case 'settings': return settingsView(panel);
    case 'how_to_play': return howToPlayView(panel);
    case 'credits': return creditsView(panel);
    case 'pause': return pauseView(panel);
    case 'save_slots':
      return sheet(panel, 'mid', '', h('ul.iw-body.iw-saves', { key: 'body' }, panel.slots.map(saveSlotView)));
    case 'inventory': return inventoryView(panel, shown);
    case 'crafting': return craftingView(panel);
    case 'canoe_builder': return canoeBuilderView(panel);
    case 'quest_log': return questLogView(panel);
    case 'map': return mapView(panel);
    case 'dialogue': return dialogueView(panel);
    case 'crew_host': return crewHostView(panel);
    case 'crew_join': return crewJoinView(panel);
    case 'feedback': return feedbackView(panel);
    case 'character_select': return castView(panel);
  }
}

export function confirmView(confirm: ConfirmModel): ViewNode[] {
  return [h('section.iw-panel.iw-paper.iw-narrow.iw-confirm-box', { key: 'confirm', role: 'alertdialog', 'aria-label': confirm.title },
    h('i.iw-tape.iw-a'),
    h('h2', null, confirm.title),
    h('p.iw-confirm-message', null, confirm.message),
    h('div.iw-confirm-actions', null,
      buttonView(confirm.accept, 'button.iw-btn.iw-go'),
      buttonView(confirm.cancel, 'button.iw-btn')))];
}
