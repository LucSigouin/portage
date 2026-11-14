/**
 * The boat's menu, in the Ink & Wash hand (Luc's list, Round 3).
 *
 * `boatTabsView` is the row of icons across the top of the panel B opens: the canoe builder, then one card for
 * each crafting attachment built on the canoe. A click on a card shows that station's menu. Switching is a plain
 * swap: the body under the row is taken away and the other one written, with no slide and no fade.
 *
 * `elsewhereView` is the crafting panel's short list of stations that are not here and that an open quest needs.
 *
 * Pure, like `views.ts`: every word and every intent comes from the model.
 */
import './stations.css';
import type { BoatTabModel, CraftElsewhereModel } from '../client/viewmodels/stations.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { STATION_KIND_ICON, stationIcon } from './stationicons.ts';

/** The red ! on a card or a line: the same mark the recipes carry, named by the quest. */
const questMark = (questText: string): ViewNode | null => (questText
  ? h('b.iw-quest-mark', { key: 'quest', title: questText, 'aria-label': questText }, '!')
  : null);

/**
 * The row of icon cards. The card of the menu that is open is ruled in ink and underlined; a station out of reach
 * is washed out, ruled dashed and cannot be pressed, and its note says where to stand. `data-boat-tab` names each.
 */
export function boatTabsView(tabs: BoatTabModel[], hint: string): ViewNode {
  return h('nav.iw-boat-tabs', { key: 'boat-tabs', 'aria-label': 'The canoe\'s menus' },
    tabs.map((tab) => control(h('button.iw-boat-tab', {
      key: tab.tab, type: 'button', disabled: !tab.enabled, class: tab.selected ? 'iw-on' : '', 'data-boat-tab': tab.tab,
      'aria-current': tab.selected ? 'page' : null, title: tab.note ? `${tab.label}: ${tab.note}` : `${tab.label}. ${tab.about}`,
    },
    h('i.iw-i.iw-boat-ico', { html: stationIcon(tab.tab), 'aria-hidden': 'true' }),
    h('span.iw-label', null, tab.label),
    tab.note ? h('small.iw-note', null, tab.note) : null,
    questMark(tab.questText)), tab.intent)),
    hint ? h('p.iw-boat-hint', { key: 'hint' }, hint) : null);
}

/** One line a station: its mark, the red !, and the words. Under the recipes, in the quiet hand. */
export function elsewhereView(lines: CraftElsewhereModel[]): ViewNode | null {
  if (lines.length === 0) return null;
  return h('section.iw-elsewhere', { key: 'elsewhere' },
    h('h3', null, 'For your quests, not in this list'),
    h('ul', null, lines.map((entry) => h('li', { key: entry.stationId, 'data-station': entry.stationId },
      questMark(entry.questText),
      h('i.iw-i.iw-elsewhere-ico', { html: STATION_KIND_ICON[entry.stationId], 'aria-hidden': 'true' }),
      h('span', null, entry.text)))));
}
