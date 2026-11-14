/**
 * The boat's menu and the stations on screen (Luc's list, Round 3):
 *
 * - B opens one panel. Across its top, an icon for the canoe builder and one for each crafting attachment built on
 *   the canoe. An icon shows that station's own menu: its recipes and nothing else. It works afloat, for anyone aboard.
 * - A crafting list never shows a recipe whose station is out of reach. One that only lacks materials stays.
 */
import { describe, expect, it } from 'vitest';
import {
  boatOpensOn, buildCanoeBuilderPanel, buildCraftingPanel, buildInterfaceModel,
} from '../../src/client/viewmodels/index.ts';
import type { PanelModel } from '../../src/client/viewmodels/index.ts';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { BoatTabId, PanelState } from '../../src/client/panels.ts';
import { Session } from '../../src/client/session.ts';
import type { SessionSignal } from '../../src/client/session.ts';
import { ATTACHMENTS, ATTACHMENT_IDS, QUEST_LIST, RECIPES, RECIPE_IDS } from '../../src/data/index.ts';
import type { AttachmentId, QuestId, StationId } from '../../src/data/index.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { BUILDER_ICON, STATION_ICON_IDS, stationIcon } from '../../src/interface/stationicons.ts';
import { panelView } from '../../src/interface/views.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { addPlayer, dispatch, islandAt } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, build, floatCanoeAt, give, newGame, standOn, teleport, teleportToCamp } from '../support.ts';
import { craftMenus, craftRows } from './craftmenus.ts';

// The project has no Node types, and Vite hands a test an emptied stylesheet: read the file itself, as icons.test.ts does.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const stationsCss = readFileSync(new URL('../../src/interface/stations.css', import.meta.url), 'utf8');

const MID_LAKE = { x: -40, z: 1085 };
const CLOSE = { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null };
const CRAFTING_PARTS: AttachmentId[] = ['firebox', 'workbench', 'smoker', 'forge'];

/** A ribbed canoe on open water with these parts built, player 0 aboard. */
function afloat(...attachmentIds: AttachmentId[]): GameState {
  const state = newGame();
  state.canoe.hullTier = 2;
  build(state, ...attachmentIds);
  floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z);
  return state;
}

/** A game where every main quest before `questId` is done and `questId` has been given. */
function atQuest(state: GameState, questId: QuestId): GameState {
  for (const quest of QUEST_LIST) {
    if (quest.kind !== 'main') continue;
    if (quest.id === questId) {
      state.quests[quest.id].status = 'active';
      break;
    }
    state.quests[quest.id].status = 'completed';
  }
  return state;
}

const craftingIds = (state: GameState, playerId = 0): string[] =>
  buildCraftingPanel(state, playerId).stations.flatMap((station) => station.recipes).map((recipe) => recipe.recipeId);

const recipesOf = (stationId: StationId): string[] => RECIPE_IDS.filter((recipeId) => RECIPES[recipeId].station === stationId);

/** Every recipe on every menu the player can open where they stand: C, a camp's cards, the boat's stations (Round 4). */
const menuIds = (state: GameState, playerId = 0): string[] => craftRows(state, playerId).map((recipe) => recipe.recipeId);

const tabsOf = (state: GameState, playerId = 0, tab: BoatTabId = 'builder'): string[] =>
  buildCanoeBuilderPanel(state, playerId, tab).tabs.map((entry) => entry.tab);

/** The boat's panel as the whole interface model gives it, opened the way the session opens it. */
function boatPanel(state: GameState, playerId = 0, panels?: PanelState): Extract<PanelModel, { id: 'canoe_builder' }> {
  const opened = panels ?? reducePanels(createPanelState('game'), { type: 'open', panel: 'canoe_builder' },
    { canoeBeached: state.canoe.beached, boatOpensOn: boatOpensOn(state, playerId) }).state;
  const model = buildInterfaceModel({
    panels: opened, settings: createDefaultSettings(), game: state, playerId, paused: false, cameraYaw: 0, toasts: [], slots: [],
    latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
  });
  if (model.panel?.id !== 'canoe_builder') throw new Error('expected the boat\'s panel');
  return model.panel;
}

const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
  nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
const hasClass = (name: string) => (node: ViewNode): boolean => node.classes.split(' ').includes(name);

describe('hidden, not greyed: a recipe whose station is out of reach is not listed', () => {
  it('lists only what hands can make on a beach with no station, and nothing marked "not in reach"', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    // With the knife on the belt every hand recipe is listed (Round 4 hides one whose tool the crew does not own).
    give(state, 'stone_knife');
    expect(buildCraftingPanel(state).stations.map((station) => station.name)).toEqual(['Hands']);
    expect(craftingIds(state)).toEqual(recipesOf('hands'));
    expect(craftingIds(state)).not.toContain('pitch');
    const drawn = panelView({ ...buildCraftingPanel(state), title: 'Crafting', close: CLOSE });
    expect(collectText(drawn)).not.toMatch(/not in reach/i);
    expect(find(drawn, hasClass('iw-out-of-reach'))).toEqual([]);
    for (const name of ['Pitch', 'Plank', 'Smoked fish', 'Metal sheet']) expect(collectText(drawn), name).not.toContain(name);
  });

  it('lists a station\'s recipes once the station is in reach, on that station\'s own menu: a camp fire, then the firebox aboard', () => {
    const state = newGame();
    give(state, 'stone_knife');
    standOn(state, 'home_knoll');
    expect(menuIds(state)).not.toContain('pitch');
    teleportToCamp(state, 'home_knoll');
    // Round 4: C lists the hands alone. The camp's fire and its bench each have a menu of their own, on a card of C.
    expect(buildCraftingPanel(state).stations.map((station) => station.name)).toEqual(['Hands']);
    expect(craftMenus(state).map((menu) => menu.name)).toEqual(['C: Hands', 'C: Campfire', 'C: Stump bench']);
    expect(craftMenus(state).map((menu) => menu.recipes.map((recipe) => recipe.recipeId))).toEqual([recipesOf('hands'), recipesOf('fire'), recipesOf('bench')]);

    const aboard = afloat();
    give(aboard, 'stone_knife');
    expect(menuIds(aboard)).not.toContain('pitch');
    build(aboard, 'firebox');
    expect(craftMenus(aboard).map((menu) => menu.name)).toEqual(['C: Hands', 'B: Firebox']);
    expect(menuIds(aboard)).toEqual([...recipesOf('hands'), ...recipesOf('fire')]);
  });

  it('keeps a recipe that only lacks materials, with its crosses and its Make button off', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    const pitch = buildCraftingPanel(state, 0, undefined, 'fire').stations[0].recipes.find((recipe) => recipe.recipeId === 'pitch')!;
    expect(pitch.craft.enabled).toBe(false);
    expect(pitch.missingText).toBe('Needs 2 more spruce gum, 1 more driftwood');
    expect(pitch.inputs.map((input) => input.enough)).toEqual([false, false]);
    // And one that lacks only a tool, or only a survivor's word, stays too, at its station.
    expect(menuIds(state)).toEqual(expect.arrayContaining(['plank', 'sailcloth']));
  });

  it('never strands a quest: what an open quest needs from a station that is not here gets one line, with where to go', () => {
    const state = atQuest(newGame(), 'stop_the_leak');
    standOn(state, 'cabin_roofs');
    const beach = buildCraftingPanel(state);
    // "Stop the leak" asks for pitch, and pitch is cooked at a fire. No fire here: the recipe is not listed.
    expect(beach.stations.flatMap((station) => station.recipes).map((recipe) => recipe.recipeId)).not.toContain('pitch');
    expect(beach.elsewhere).toEqual([{
      stationId: 'fire', questText: 'For Stop the leak', text: 'Pitch needs a fire: any camp, or a firebox built on the canoe.',
    }]);
    const drawn = panelView({ ...beach, title: 'Crafting', close: CLOSE });
    const lines = find(drawn, hasClass('iw-elsewhere'));
    expect(lines.length).toBe(1);
    expect(collectText(lines)).toContain('Pitch needs a fire');
    expect(find(lines, hasClass('iw-quest-mark')).map((mark) => mark.attributes.title)).toEqual(['For Stop the leak']);
    // The line is not a recipe: nothing to press.
    expect(find(lines, (node) => node.tag === 'button')).toEqual([]);

    // At a fire the recipe itself is back, on the campfire's menu, with its red !, and the line is gone.
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    const camp = buildCraftingPanel(state);
    expect(buildCraftingPanel(state, 0, undefined, 'fire').stations[0].recipes.find((recipe) => recipe.recipeId === 'pitch')!.questText).toBe('For Stop the leak');
    expect(camp.elsewhere).toEqual([]);
    expect(find(panelView({ ...camp, title: 'Crafting', close: CLOSE }), hasClass('iw-elsewhere'))).toEqual([]);
  });

  it('writes no line for a station no open quest needs, nor for a recipe nobody has taught', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    // The first quest asks for nothing that is made at a station.
    expect(buildCraftingPanel(state).elsewhere).toEqual([]);
    // "Ribs and rails" asks for a saw and a hammer: the bench. The firebox built aboard is named as built.
    atQuest(state, 'ribs_and_rails');
    build(state, 'workbench');
    teleport(state, 'cabin_roofs', -330, 985);
    expect(buildCraftingPanel(state).elsewhere).toEqual([{
      stationId: 'bench', questText: 'For Ribs and rails', text: 'Saw and hammer need a bench: the camp on Home Knoll, or the workbench on the canoe.',
    }]);
  });
});

describe('the boat\'s menu: the row of icons', () => {
  it('shows the canoe builder alone on a canoe with no station, and says what would add one', () => {
    const state = afloat('cargo_rack', 'rain_catcher', 'outrigger_port');
    const panel = buildCanoeBuilderPanel(state);
    expect(panel.tabs.map((tab) => [tab.tab, tab.label, tab.selected, tab.enabled])).toEqual([['builder', 'Canoe builder', true, true]]);
    expect(panel.station).toBeNull();
    expect(panel.stationsHint).toBe('No station aboard yet. Build a firebox, a workbench, a smoker or a forge, and it gets its own menu here, to use on the water.');
    expect(boatOpensOn(state)).toBe('builder');
    // Afloat the builder says why nothing can be built, and still lists every part.
    expect(panel.blockedText).toBe('Beach the canoe to work on it.');
    expect(panel.attachments.length).toBe(ATTACHMENT_IDS.length);
  });

  it('adds one icon for each crafting attachment that is built, in the builder\'s order, and none for one that is not', () => {
    const two = afloat('workbench', 'firebox', 'outrigger_port', 'cargo_rack');
    expect(tabsOf(two)).toEqual(['builder', 'firebox', 'workbench']);
    expect(buildCanoeBuilderPanel(two).stationsHint).toBe('');
    const four = afloat('forge', 'smoker', 'workbench', 'firebox', 'outrigger_port', 'outrigger_starboard', 'planter', 'map_table');
    expect(tabsOf(four)).toEqual(['builder', ...CRAFTING_PARTS]);
    expect(buildCanoeBuilderPanel(four).tabs.map((tab) => tab.label)).toEqual(['Canoe builder', 'Firebox', 'Workbench', 'Smoker', 'Forge']);
    // Every crafting attachment in the data gets an icon: the row is read from the data, not typed in.
    const every = afloat(...ATTACHMENT_IDS);
    expect(tabsOf(every).slice(1)).toEqual(ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].station !== null));
  });

  it('has a drawing of its own for each station and for the builder', () => {
    expect([...STATION_ICON_IDS].sort()).toEqual(ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].station !== null).sort());
    const drawings = [BUILDER_ICON, ...CRAFTING_PARTS.map((attachmentId) => stationIcon(attachmentId))];
    expect(new Set(drawings).size).toBe(5);
    for (const drawing of drawings) {
      expect(drawing).toMatch(/^<svg class="iw-ico" viewBox="0 0 24 24"/);
      expect(drawing).toContain('class="iw-pen"');
      expect(drawing).toContain('class="iw-wash"');
      expect(drawing).not.toMatch(/animate|transition/);
    }
  });

  it('draws each icon as a card that names its menu, and marks the one that is open', () => {
    const state = afloat('firebox', 'forge', 'outrigger_starboard');
    const drawn = panelView({ ...buildCanoeBuilderPanel(state, 0, 'forge'), title: 'Forge', close: CLOSE });
    const cards = find(drawn, hasClass('iw-boat-tab'));
    expect(cards.map((card) => card.attributes['data-boat-tab'])).toEqual(['builder', 'firebox', 'forge']);
    expect(cards.map((card) => collectText([card]))).toEqual(['Canoe builder', 'Firebox', 'Forge']);
    // The name is the card's label by itself (the browser spec reads it there: a card may also carry a red !).
    expect(cards.map((card) => collectText(find([card], hasClass('iw-label'))))).toEqual(['Canoe builder', 'Firebox', 'Forge']);
    expect(cards.map((card) => card.classes.split(' ').includes('iw-on'))).toEqual([false, false, true]);
    expect(cards.map((card) => card.attributes['aria-current'] ?? null)).toEqual([null, null, 'page']);
    expect(cards.map((card) => card.intent)).toEqual([
      { type: 'select_boat_tab', tab: 'builder' }, { type: 'select_boat_tab', tab: 'firebox' }, { type: 'select_boat_tab', tab: 'forge' },
    ]);
    for (const card of cards) expect(find([card], hasClass('iw-boat-ico'))[0].html).toBe(stationIcon(card.attributes['data-boat-tab'] as BoatTabId));
    // The row sits above the body, outside it: it does not scroll away with the recipes.
    const sheet = drawn[0];
    const row = sheet.children.findIndex(hasClass('iw-boat-tabs'));
    const body = sheet.children.findIndex(hasClass('iw-body'));
    expect(row).toBeGreaterThan(0);
    expect(body).toBe(row + 1);
  });

  it('puts the red ! on the card whose menu makes what an open quest asks for', () => {
    const state = atQuest(afloat('firebox', 'workbench', 'outrigger_port'), 'stop_the_leak');
    state.canoe.hullTier = 0; // the leaky canoe: the patched hull is the next one, and the quest's
    const tabs = buildCanoeBuilderPanel(state).tabs;
    // "Stop the leak": cook pitch (the firebox), patch the hull (the builder). The workbench makes nothing it wants.
    expect(tabs.map((tab) => [tab.tab, tab.questText])).toEqual([
      ['builder', 'For Stop the leak'], ['firebox', 'For Stop the leak'], ['workbench', ''],
    ]);
  });
});

describe('the boat\'s menu: one menu per station', () => {
  for (const attachmentId of CRAFTING_PARTS) {
    it(`the ${attachmentId}'s menu lists its own recipes and nothing else`, () => {
      const state = afloat(...CRAFTING_PARTS, 'outrigger_port', 'outrigger_starboard');
      const panel = buildCanoeBuilderPanel(state, 0, attachmentId);
      const stationId = ATTACHMENTS[attachmentId].station!;
      expect(panel.station).toMatchObject({ attachmentId, name: ATTACHMENTS[attachmentId].name, blockedText: '' });
      expect(panel.station!.recipes.map((recipe) => recipe.recipeId)).toEqual(recipesOf(stationId));
      expect(panel.title).toBe(ATTACHMENTS[attachmentId].name);
      expect(panel.tabs.filter((tab) => tab.selected).map((tab) => tab.tab)).toEqual([attachmentId]);
      // Drawn: the recipes of this station, and no hull, no parts, no stats.
      const drawn = panelView({ ...panel, title: panel.title!, close: CLOSE });
      const entries = find(drawn, hasClass('iw-entry'));
      expect(entries.map((entry) => entry.key)).toEqual(recipesOf(stationId));
      expect(find(drawn, hasClass('iw-stats'))).toEqual([]);
      expect(find(drawn, hasClass('iw-body'))[0].attributes['data-station']).toBe(attachmentId);
    });
  }

  it('keeps the chips, the ticks and crosses, and the red ! as the crafting panel draws them', () => {
    const state = atQuest(afloat('firebox'), 'stop_the_leak');
    give(state, 'spruce_gum', 2, 'cargo');
    const inBoat = buildCanoeBuilderPanel(state, 0, 'firebox').station!.recipes.find((recipe) => recipe.recipeId === 'pitch')!;
    // The same row as a camp fire's own menu gives, in the crafting panel (Round 4: C itself lists the hands alone).
    const camp = atQuest(newGame(), 'stop_the_leak');
    standOn(camp, 'home_knoll');
    teleportToCamp(camp, 'home_knoll');
    give(camp, 'spruce_gum', 2);
    const inCrafting = buildCraftingPanel(camp, 0, undefined, 'fire').stations[0].recipes.find((recipe) => recipe.recipeId === 'pitch')!;
    expect(inBoat).toEqual(inCrafting);
    expect(inBoat.questText).toBe('For Stop the leak');
    expect(inBoat.inputs.map((input) => [input.name, input.have, input.need, input.enough])).toEqual([['Spruce gum', 2, 2, true], ['Driftwood', 0, 1, false]]);
    expect(inBoat.needs).toEqual([]);
  });

  it('shows the canoe builder for a tab that is no station on this canoe', () => {
    const state = afloat('firebox');
    for (const tab of ['builder', 'forge', 'cargo_rack'] as const) {
      const panel = buildCanoeBuilderPanel(state, 0, tab);
      expect(panel.station, tab).toBeNull();
      expect(panel.title, tab).toBeUndefined();
      expect(panel.tabs.find((entry) => entry.selected)!.tab, tab).toBe('builder');
    }
  });

  it('swaps plainly: each menu is a body of its own, and nothing in the row\'s styles moves', () => {
    const state = afloat('firebox', 'workbench', 'outrigger_port');
    const bodyKey = (tab: BoatTabId): string | null =>
      find(panelView({ ...buildCanoeBuilderPanel(state, 0, tab), title: 'x', close: CLOSE }), hasClass('iw-body'))[0].key;
    expect(new Set([bodyKey('builder'), bodyKey('firebox'), bodyKey('workbench')]).size).toBe(3);
    expect(stationsCss.length).toBeGreaterThan(500);
    // Comments aside, no rule animates, eases or shifts a card.
    const rules = stationsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/transition|animation|@keyframes|transform/);
  });
});

describe('the boat\'s menu afloat', () => {
  it('stands on open water: the test point is no island', () => {
    expect(islandAt(MID_LAKE.x, MID_LAKE.z)).toBeNull();
  });

  it('opens on the first station aboard when afloat, and on the canoe builder when beached or with none', () => {
    const state = afloat('workbench', 'firebox', 'outrigger_port');
    expect(boatOpensOn(state)).toBe('firebox');
    expect(boatPanel(state)).toMatchObject({ title: 'Firebox', station: { attachmentId: 'firebox' } });
    standOn(state, 'cabin_roofs');
    expect(boatOpensOn(state)).toBe('builder');
    expect(boatPanel(state)).toMatchObject({ title: 'Canoe builder', station: null, blockedText: '' });
    expect(boatOpensOn(afloat())).toBe('builder');
    expect(boatPanel(afloat())).toMatchObject({ title: 'Canoe builder', station: null, blockedText: 'Beach the canoe to work on it.' });
  });

  for (const [attachmentId, recipeId, inputs] of [
    ['firebox', 'pitch', [['spruce_gum', 2], ['driftwood', 1]]],
    ['workbench', 'hammer', [['scrap_metal', 2], ['driftwood', 1], ['rope', 1]]],
    ['smoker', 'smoked_fish', [['raw_fish', 1], ['driftwood', 1]]],
    ['forge', 'metal_sheet', [['scrap_metal', 3], ['charcoal', 1]]],
  ] as const) {
    it(`the ${attachmentId}'s Make button works on open water, for the host and for a guest aboard`, () => {
      for (const who of ['host', 'guest'] as const) {
        const state = afloat(attachmentId, 'outrigger_port', 'outrigger_starboard');
        const playerId = who === 'host' ? 0 : addPlayer(state)!.id;
        const short = buildCanoeBuilderPanel(state, playerId, attachmentId).station!.recipes.find((recipe) => recipe.recipeId === recipeId)!;
        expect(short.craft.enabled, who).toBe(false); // listed, short of materials
        for (const [itemId, count] of inputs) give(state, itemId, count, 'cargo');
        const row = buildCanoeBuilderPanel(state, playerId, attachmentId).station!.recipes.find((recipe) => recipe.recipeId === recipeId)!;
        expect(row.craft, who).toMatchObject({ enabled: true, intent: { type: 'command', command: { type: 'craft', recipeId, count: 1 } } });
        if (row.craft.intent.type !== 'command') throw new Error('expected a command');
        expect(state.canoe.beached).toBe(false);
        expect(dispatch(state, row.craft.intent.command, playerId).ok, who).toBe(true);
      }
    });
  }

  it('gives a guest the same row and the same menus as the host', () => {
    const state = afloat(...CRAFTING_PARTS, 'outrigger_port', 'outrigger_starboard');
    const guest = addPlayer(state)!;
    expect(buildCanoeBuilderPanel(state, guest.id, 'smoker')).toEqual(buildCanoeBuilderPanel(state, 0, 'smoker'));
    expect(boatOpensOn(state, guest.id)).toBe('firebox');
    expect(boatPanel(state, guest.id).station!.recipes.map((recipe) => recipe.recipeId)).toEqual(recipesOf('fire'));
  });

  it('keeps a station\'s icon for a player who walked off, unpressable, and lists nothing they cannot make', () => {
    const state = newGame();
    state.canoe.hullTier = 2;
    build(state, 'firebox', 'workbench', 'outrigger_port');
    standOn(state, 'cabin_roofs');
    // Beside the landed canoe the stations work on foot.
    expect(buildCanoeBuilderPanel(state).tabs.map((tab) => tab.enabled)).toEqual([true, true, true]);
    expect(buildCanoeBuilderPanel(state, 0, 'firebox').station!.recipes.length).toBe(recipesOf('fire').length);
    teleport(state, 'cabin_roofs', -330, 985);
    const away = buildCanoeBuilderPanel(state);
    expect(away.tabs.map((tab) => [tab.tab, tab.enabled, tab.note])).toEqual([
      ['builder', true, ''], ['firebox', false, 'At the canoe'], ['workbench', false, 'At the canoe'],
    ]);
    const cards = find(panelView({ ...away, title: 'Canoe builder', close: CLOSE }), hasClass('iw-boat-tab'));
    expect(cards.map((card) => card.attributes.disabled)).toEqual([false, true, true]);
    // A menu left open while the canoe went: it says so and lists no recipe.
    expect(buildCanoeBuilderPanel(state, 0, 'firebox').station).toMatchObject({ blockedText: 'Walk to the canoe to use the firebox.', recipes: [] });
    // And the crafting panel up here lists hand recipes only.
    expect(buildCraftingPanel(state).stations.map((station) => station.name)).toEqual(['Hands']);
  });
});

describe('the boat\'s menu holds the tab it opened on', () => {
  const AFLOAT = { canoeBeached: false, boatOpensOn: 'firebox' as BoatTabId };

  it('latches the tab when the panel opens, and after that only a click changes it', () => {
    let panels = reducePanels(createPanelState('game'), { type: 'toggle', panel: 'canoe_builder' }, AFLOAT).state;
    expect(panels).toMatchObject({ stack: ['canoe_builder'], boatTab: 'firebox' });
    // The canoe is beached under the open panel (a crewmate landed it): the menu does not swap by itself.
    const state = afloat('firebox', 'workbench', 'outrigger_port');
    standOn(state, 'cabin_roofs');
    expect(boatOpensOn(state)).toBe('builder');
    expect(boatPanel(state, 0, panels).station?.attachmentId).toBe('firebox');
    // A click does.
    panels = reducePanels(panels, { type: 'select_boat_tab', tab: 'workbench' }, AFLOAT).state;
    expect(boatPanel(state, 0, panels).station?.attachmentId).toBe('workbench');
    panels = reducePanels(panels, { type: 'select_boat_tab', tab: 'builder' }, AFLOAT).state;
    expect(boatPanel(state, 0, panels).station).toBeNull();
    // Closed and opened again, it starts over from where the canoe is now.
    panels = reducePanels(panels, { type: 'toggle', panel: 'canoe_builder' }, AFLOAT).state;
    panels = reducePanels(panels, { type: 'toggle', panel: 'canoe_builder' }, { canoeBeached: true, boatOpensOn: 'builder' }).state;
    expect(panels).toMatchObject({ stack: ['canoe_builder'], boatTab: 'builder' });
    // Opened over another panel-key panel, the same.
    panels = reducePanels(createPanelState('game'), { type: 'toggle', panel: 'inventory' }, AFLOAT).state;
    panels = reducePanels(panels, { type: 'toggle', panel: 'canoe_builder' }, AFLOAT).state;
    expect(panels).toMatchObject({ stack: ['canoe_builder'], boatTab: 'firebox' });
    // Another panel opening leaves the boat's tab alone.
    expect(reducePanels(panels, { type: 'toggle', panel: 'map' }, { canoeBeached: false, boatOpensOn: 'builder' }).state.boatTab).toBe('firebox');
  });

  it('runs through the session: B afloat opens the first station, a card swaps the menu with the tab sound, Make crafts', () => {
    const session = new Session({ storage: new FakeStorage(), now: () => 1_000_000, randomSeed: () => 101 });
    const signals: SessionSignal[] = [];
    session.subscribe((signal) => signals.push(signal));
    session.newGame(0);
    const state = session.game!;
    state.canoe.hullTier = 2;
    build(state, 'firebox', 'workbench', 'outrigger_port');
    floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z);
    give(state, 'spruce_gum', 2, 'cargo');
    give(state, 'driftwood', 1, 'cargo');
    session.keyDown('KeyB');
    expect(session.panels).toMatchObject({ stack: ['canoe_builder'], boatTab: 'firebox' });
    expect(signals.filter((signal) => signal.type === 'notice')).toEqual([]);
    signals.length = 0;
    session.handleIntent({ type: 'select_boat_tab', tab: 'workbench' });
    expect(session.panels.boatTab).toBe('workbench');
    expect(signals).toEqual([{ type: 'interface_sound', sound: 'tab' }]);
    // The same card again: nothing changes and nothing sounds.
    signals.length = 0;
    session.handleIntent({ type: 'select_boat_tab', tab: 'workbench' });
    expect(signals).toEqual([]);
    session.handleIntent({ type: 'select_boat_tab', tab: 'firebox' });
    session.handleIntent({ type: 'command', command: { type: 'craft', recipeId: 'pitch', count: 1 } });
    expect(state.canoe.cargo.some((stack) => stack.itemId === 'pitch')).toBe(true);
    expect(session.panels.stack).toEqual(['canoe_builder']);
  });
});
