/**
 * The crew on the page, without a DOM: the crew card under the vitals, the crewmates' toques on the
 * map, and the reward items in the quest log. Each is checked against the model it was drawn from,
 * and the solo HUD against the HUD it was before there was a crew.
 */
import { describe, expect, it } from 'vitest';
import { buildHudModel, buildMapPanel, buildQuestLogPanel } from '../../src/client/viewmodels/index.ts';
import type { HudModel, PanelModel } from '../../src/client/viewmodels/index.ts';
import { CREW_MARKS, ISLANDS_BY_ID, QUEST_IDS } from '../../src/data/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { itemIcon, toqueIcon } from '../../src/interface/icons.ts';
import { crewView, panelView, vitalsView } from '../../src/interface/views.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import type { GameState, PlayerState } from '../../src/sim/index.ts';
import { newGame } from '../support.ts';

const settings = createDefaultSettings();
const hudOf = (state: GameState, playerId = 0): HudModel => buildHudModel(state, settings, 0, playerId);
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const theme = readFileSync(new URL('../../src/interface/theme.css', import.meta.url), 'utf8');

/** Every node of a tree, the root first. */
function all(nodes: ViewNode[], into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    into.push(node);
    all(node.children, into);
  }
  return into;
}
const withClass = (nodes: ViewNode[], name: string): ViewNode[] => all(nodes).filter((node) => node.classes.split(' ').includes(name));
const frame = { title: 'Panel', close: { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null } };

function putAshore(player: PlayerState, islandId: IslandId, offset = 0): void {
  const centre = ISLANDS_BY_ID[islandId].center;
  player.mode = 'foot';
  player.seat = null;
  player.islandId = islandId;
  player.position = { x: centre.x + offset, y: 1, z: centre.z };
}

/** A crew of four: you aboard, one asleep on Cabin Roofs, one worn out on Birch Islet, one aboard and hungry. */
function splitCrew(): GameState {
  const state = newGame(7, { crew: 4 });
  for (const player of state.players) Object.assign(player, { hunger: 80, thirst: 70, energy: 60 });
  putAshore(state.players[1]!, 'cabin_roofs');
  state.players[1]!.asleep = true;
  putAshore(state.players[2]!, 'birch_islet');
  state.players[2]!.energy = 8;
  state.players[3]!.hunger = 0;
  return state;
}

describe('the crew card', () => {
  const hud = hudOf(splitCrew());
  const card = crewView(hud.crew, false);
  const rows = withClass([card], 'iw-mate');

  it('has one row a player, in player order, each with every word of its model', () => {
    expect(rows.map((row) => row.attributes['data-player'])).toEqual([0, 1, 2, 3]);
    rows.forEach((row, index) => {
      const mate = hud.crew[index]!;
      const text = collectText([row]);
      for (const word of [mate.label, mate.placeText, mate.distanceText, mate.lowText]) expect(text).toContain(word);
      expect(row.attributes['data-where']).toBe(mate.where);
    });
    expect(collectText([card])).toContain(ISLANDS_BY_ID.cabin_roofs.name);
    expect(collectText([card])).toContain(ISLANDS_BY_ID.birch_islet.name);
  });

  it('draws each row\'s toque in the colour the look dresses that player in', () => {
    rows.forEach((row, index) => {
      const toque = withClass([row], 'iw-mate-toque')[0]!;
      expect(toque.html).toBe(toqueIcon(CREW_MARKS[index]!.toque));
      expect(toque.html).toContain(`fill="${CREW_MARKS[index]!.toque}"`);
    });
    // At full strength, so the colour on the card is the colour on their head.
    expect(theme).toMatch(/\.iw-toque \.iw-wash \{\s*opacity: 1;/);
  });

  it('marks your own row as you, and no other', () => {
    expect(rows.map((row) => row.classes.split(' ').includes('iw-you'))).toEqual([true, false, false, false]);
    expect(rows.map((row) => withClass([row], 'iw-kind').map((tag) => collectText([tag])))).toEqual([['you'], [], [], []]);
  });

  it('draws three small meters a row, filled to that player\'s own numbers', () => {
    rows.forEach((row, index) => {
      const bars = withClass([row], 'iw-bar');
      expect(bars.map((bar) => bar.attributes['aria-label'])).toEqual(hud.crew[index]!.meters.map((meter) => `${meter.label} ${meter.value}`));
      expect(bars.map((bar) => bar.children[0]!.attributes.style)).toEqual(hud.crew[index]!.meters.map((meter) => `--v:${meter.value / 100}`));
    });
  });

  it('marks trouble three ways on the row that has it: the bar, the rust mark and the words', () => {
    const low = (row: ViewNode): boolean[] => withClass([row], 'iw-bar').map((bar) => bar.classes.split(' ').includes('iw-low'));
    expect(rows.map(low)).toEqual([[false, false, false], [false, false, false], [false, false, true], [true, false, false]]);
    expect(rows.map((row) => withClass([row], 'iw-mate-alert').length)).toEqual([0, 0, 1, 1]);
    expect(rows.map((row) => row.classes.split(' ').includes('iw-low'))).toEqual([false, false, true, true]);
    expect(rows.map((row) => collectText(withClass([row], 'iw-mate-low')))).toEqual(['', '', 'low energy', 'low hunger']);
    // A sleeper who is not in trouble gets the moon instead.
    expect(rows.map((row) => withClass([row], 'iw-mate-asleep').length)).toEqual([0, 1, 0, 0]);
  });

  it('follows the patterned-meters setting, like the big meters', () => {
    const patterned = withClass([crewView(hud.crew, true)], 'iw-bar').slice(0, 3).map((bar) => bar.classes);
    expect(patterned).toEqual(['iw-bar iw-bar-hunger iw-stripes', 'iw-bar iw-bar-thirst iw-waves', 'iw-bar iw-bar-energy iw-dots']);
  });

  it('never moves: no transition and no animation anywhere in the crew\'s styles', () => {
    const rules = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => /iw-(crew|mate|toque|mark-crew|marker-crew)/.test(rule[1]!));
    expect(rules.length).toBeGreaterThan(10);
    for (const rule of rules) expect(rule[2], rule[1]!.trim()).not.toMatch(/transition|animation/);
  });
});

describe('the vitals card', () => {
  it('alone, is drawn exactly as it was before there was a crew: no crew card, nothing else touched', () => {
    const solo = newGame(7);
    const crewed = newGame(7, { crew: 4 });
    const soloViews = vitalsView(hudOf(solo), false);
    expect(withClass(soloViews, 'iw-crew')).toEqual([]);
    expect(withClass(soloViews, 'iw-mate')).toEqual([]);
    // The same player in a crew of four gets the same card, plus the crew card as its last child.
    const crewViews = vitalsView(hudOf(crewed), false);
    expect(crewViews).toHaveLength(1);
    const added = crewViews[0]!.children.filter((child) => child.classes.split(' ').includes('iw-crew'));
    expect(added).toHaveLength(1);
    expect(crewViews[0]!.children[crewViews[0]!.children.length - 1]).toBe(added[0]);
    expect({ ...crewViews[0]!, children: crewViews[0]!.children.slice(0, -1) }).toEqual(soloViews[0]);
  });

  it('with a crew of two, three and four, hangs a card with that many rows', () => {
    for (const size of [2, 3, 4]) {
      expect(withClass(vitalsView(hudOf(newGame(7, { crew: size })), false), 'iw-mate')).toHaveLength(size);
    }
  });
});

describe('crewmates on the map', () => {
  const state = splitCrew();
  const panel = { ...frame, ...buildMapPanel(state, 0) } as Extract<PanelModel, { id: 'map' }>;
  const views = panelView(panel);

  it('draws each crewmate who is somewhere else as their toque, at their place', () => {
    const drawn = withClass(views, 'iw-marker-crew');
    const models = panel.markers.filter((marker) => marker.kind === 'crew');
    expect(models.map((marker) => marker.label)).toEqual(['Player 2', 'Player 3']);
    expect(drawn).toHaveLength(models.length);
    drawn.forEach((marker, index) => {
      const model = models[index]!;
      expect(marker.attributes.style).toBe(`left:${(model.left * 100).toFixed(2)}%;top:${(model.top * 100).toFixed(2)}%;--n:${model.crewIndex}`);
      expect(marker.attributes.title).toBe(model.label);
      expect(marker.children[0]!.html).toBe(toqueIcon(model.color!));
    });
    // On two islands: two different places on the chart.
    expect(drawn[0]!.attributes.style).not.toBe(drawn[1]!.attributes.style);
  });

  it('names them in the legend, beside the same toque', () => {
    const legend = withClass(views, 'iw-legend-crew');
    expect(legend.map((row) => collectText([row]))).toEqual(['Player 2', 'Player 3']);
    expect(legend.map((row) => row.children[0]!.html)).toEqual([toqueIcon(CREW_MARKS[1]!.toque), toqueIcon(CREW_MARKS[2]!.toque)]);
  });

  it('alone, the map has no toque on it', () => {
    const solo = panelView({ ...frame, ...buildMapPanel(newGame(7), 0) } as PanelModel);
    expect(withClass(solo, 'iw-marker-crew')).toEqual([]);
    expect(withClass(solo, 'iw-legend-crew')).toEqual([]);
  });
});

describe('quest rewards in the quest log', () => {
  const state = newGame(7);
  for (const questId of QUEST_IDS) state.quests[questId].status = 'active';
  const panel = { ...frame, ...buildQuestLogPanel(state) } as Extract<PanelModel, { id: 'quest_log' }>;
  const quests = panel.groups.flatMap((group) => group.quests);
  const entries = withClass(panelView(panel), 'iw-entry');

  it('shows every reward item of every quest with its icon, its name and its count', () => {
    expect(entries).toHaveLength(quests.length);
    expect(quests.filter((quest) => quest.rewards.length > 0).length).toBeGreaterThan(3);
    entries.forEach((entry, index) => {
      const quest = quests[index]!;
      const chips = withClass(withClass([entry], 'iw-rewards'), 'iw-cost');
      expect(chips).toHaveLength(quest.rewards.length);
      chips.forEach((chip, at) => {
        const item = quest.rewards[at]!;
        const icons = withClass([chip], 'iw-item-ico');
        expect(icons.map((icon) => [icon.attributes['data-item'], icon.html])).toEqual([[item.itemId, itemIcon(item.itemId)]]);
        expect(collectText([chip])).toContain(item.name);
        expect(collectText([chip])).toContain(`× ${item.count}`);
      });
      // A quest that gives no item has no reward line at all.
      expect(withClass([entry], 'iw-rewards')).toHaveLength(quest.rewards.length > 0 ? 1 : 0);
    });
  });
});
