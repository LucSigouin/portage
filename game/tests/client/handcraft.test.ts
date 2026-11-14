/**
 * The crafting key lists hand crafts only (Luc, Round 4: "The craft menu with c should only show you what you can
 * craft without the benchs/tools").
 *
 * - C lists what the hands make and nothing a station makes, at a camp, aboard a canoe full of stations, anywhere.
 * - A hand recipe that needs a tool is listed once the crew owns the tool.
 * - Nothing became unreachable: every recipe is on a menu a player can open, wherever its station is.
 * - A camp's stations have menus of their own: a row of cards in C, and the interact key at the station.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { createPanelState, topPanel } from '../../src/client/panels.ts';
import {
  buildCraftNotes, buildCraftingPanel, campStationsHere, craftRestText, stationDoor,
} from '../../src/client/viewmodels/index.ts';
import { ATTACHMENTS, ATTACHMENT_IDS, CAMP_LAYOUTS, ISLANDS, QUEST_LIST, RECIPES, RECIPE_IDS } from '../../src/data/index.ts';
import type { IslandId, ItemId, QuestId, StationId } from '../../src/data/index.ts';
import { CRAFT_DOOR_ICON } from '../../src/interface/craftdoors.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { BUILDER_ICON, STATION_KIND_ICON } from '../../src/interface/stationicons.ts';
import { panelView } from '../../src/interface/views.ts';
import { DEFAULT_KEY_BINDINGS, createDefaultSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, dispatch, drainEvents, islandAt, selectInteractable, selectInventory, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, build, countIn, floatCanoeAt, give, newGame, standOn, teleport, teleportToCamp } from '../support.ts';
import { act, craftMenus, craftingPanel, panelOf } from './craftmenus.ts';

// The project has no Node types, and Vite hands a test an emptied stylesheet: read the file itself, as icons.test.ts does.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const craftDoorsCss = readFileSync(new URL('../../src/interface/craftdoors.css', import.meta.url), 'utf8');

const MID_LAKE = { x: -40, z: 1085 };
const CLOSE = { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null };
const STATION_ORDER: StationId[] = ['hands', 'fire', 'bench', 'smoker', 'forge'];
const CAMP_ISLANDS = ISLANDS.filter((island) => island.camp);
const NO_WANTS = { items: new Map(), attachments: new Map(), hullTiers: new Map() };

const recipesOf = (stationId: StationId): string[] => RECIPE_IDS.filter((recipeId) => RECIPES[recipeId].station === stationId);
const idsOf = (rows: { recipeId: string }[]): string[] => rows.map((row) => row.recipeId);

/** A long canoe on open water with these parts built, player 0 aboard. */
function afloat(...attachmentIds: Parameters<typeof build>[1][]): GameState {
  const state = newGame();
  state.canoe.hullTier = 3;
  build(state, ...attachmentIds);
  floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z);
  return state;
}

/** The canoe on an island's landing, player 0 by the fire of its camp. */
function inCamp(islandId: IslandId, state: GameState = newGame()): GameState {
  standOn(state, islandId);
  teleportToCamp(state, islandId);
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

const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
  nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
const hasClass = (name: string) => (node: ViewNode): boolean => node.classes.split(' ').includes(name);
const draw = (panel: ReturnType<typeof buildCraftingPanel>): ViewNode[] => panelView({ title: 'Crafting', ...panel, close: CLOSE });

describe('C lists hand crafts only', () => {
  const places: [string, () => GameState][] = [
    ['on a beach with no station', () => { const state = newGame(); standOn(state, 'cabin_roofs'); return state; }],
    ['in Home Knoll\'s camp, by its fire and its stump bench', () => inCamp('home_knoll')],
    ['in Tink\'s yard, by her hearth and her forge', () => inCamp('scrapyard_bar')],
    ['aboard a canoe that carries all four stations, on open water', () => afloat('firebox', 'workbench', 'smoker', 'forge')],
    ['on foot beside that canoe, landed', () => { const state = afloat('firebox', 'workbench', 'smoker', 'forge'); standOn(state, 'cabin_roofs'); return state; }],
  ];
  for (const [where, stage] of places) {
    it(`${where}: every row is a hand recipe, and no station has a section`, () => {
      const state = stage();
      give(state, 'stone_knife');
      const panel = craftingPanel(state);
      expect(panel).toMatchObject({ title: 'Crafting', tab: 'hands', about: '' });
      expect(panel.stations.map((station) => station.name)).toEqual(['Hands']);
      expect(idsOf(panel.stations[0].recipes)).toEqual(recipesOf('hands'));
      const text = collectText(panelView(panel));
      for (const recipeId of RECIPE_IDS) {
        if (RECIPES[recipeId].station !== 'hands') expect(text, recipeId).not.toContain(RECIPES[recipeId].description);
      }
    });
  }

  it('stands on open water for the afloat cases: the test point is no island', () => {
    expect(islandAt(MID_LAKE.x, MID_LAKE.z)).toBeNull();
  });

  it('has more in reach than it lists: the rules still put the stations in reach, C just does not list them', () => {
    const state = afloat('firebox', 'workbench', 'smoker', 'forge');
    expect(selectInventory(state).stations).toEqual(STATION_ORDER);
    expect(craftingPanel(state).stations.flatMap((station) => station.recipes).map((row) => RECIPES[row.recipeId].station)).toEqual(['hands', 'hands']);
  });

  it('always opens on the hands, whatever it showed last', () => {
    const state = inCamp('home_knoll');
    let panels = act(state, createPanelState('game'), { type: 'open', panel: 'crafting' });
    panels = act(state, panels, { type: 'select_craft_tab', tab: 'fire' });
    expect(panelOf(state, panels)).toMatchObject({ id: 'crafting', tab: 'fire', title: 'Campfire' });
    panels = act(state, panels, { type: 'toggle', panel: 'crafting' });
    expect(topPanel(panels)).toBeNull();
    panels = act(state, panels, { type: 'toggle', panel: 'crafting' });
    expect(panelOf(state, panels)).toMatchObject({ id: 'crafting', tab: 'hands', title: 'Crafting' });
    // Coming from another panel too.
    panels = act(state, panels, { type: 'select_craft_tab', tab: 'bench' });
    panels = act(state, panels, { type: 'open', panel: 'inventory' });
    panels = act(state, panels, { type: 'open', panel: 'crafting' });
    expect(panelOf(state, panels)).toMatchObject({ id: 'crafting', tab: 'hands' });
  });
});

describe('a hand recipe that needs a tool', () => {
  it('is hidden until the crew owns the tool, and listed from then on', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    expect(state.tools).not.toContain('stone_knife');
    expect(idsOf(craftingPanel(state).stations[0].recipes)).toEqual(['stone_knife', 'rope']);
    give(state, 'stone_knife');
    expect(idsOf(craftingPanel(state).stations[0].recipes)).toEqual(['stone_knife', 'rope', 'hatchet', 'fishing_rod']);
    // The tool is the crew's: a guest who never held it sees the same list.
    const crew = newGame(7, { crew: 2 });
    standOn(crew, 'cabin_roofs');
    give(crew, 'stone_knife');
    expect(idsOf(craftingPanel(crew, 1).stations[0].recipes)).toEqual(['stone_knife', 'rope', 'hatchet', 'fishing_rod']);
  });

  it('stays when only materials are short, with its crosses and its Make button off', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    give(state, 'stone_knife');
    const hatchet = craftingPanel(state).stations[0].recipes.find((recipe) => recipe.recipeId === 'hatchet')!;
    expect(hatchet.craft.enabled).toBe(false);
    expect(hatchet.inputs.map((input) => [input.name, input.enough])).toEqual([
      ['Hatchet head', false], ['Driftwood', false], ['Rope', false], ['Stone knife (tool)', true],
    ]);
  });

  it('gets one line while it is hidden and an open quest asks for it, and none once it is listed', () => {
    const state = atQuest(newGame(), 'a_proper_edge');
    standOn(state, 'cabin_roofs');
    const hidden = craftingPanel(state);
    expect(idsOf(hidden.stations[0].recipes)).not.toContain('hatchet');
    expect(hidden.elsewhere).toEqual([{ stationId: 'hands', questText: 'For A proper edge', text: 'Hatchet needs a stone knife first.' }]);
    const lines = find(panelView(hidden), hasClass('iw-elsewhere'));
    expect(collectText(lines)).toContain('Hatchet needs a stone knife first.');
    expect(find(lines, hasClass('iw-quest-mark')).map((mark) => mark.attributes.title)).toEqual(['For A proper edge']);
    // The line is drawn with the hand, not with the canoe builder's hull and hammer.
    expect(find(lines, hasClass('iw-elsewhere-ico'))[0].html).toBe(STATION_KIND_ICON.hands);
    expect(STATION_KIND_ICON.hands).not.toBe(BUILDER_ICON);
    give(state, 'stone_knife');
    const listed = craftingPanel(state);
    expect(listed.elsewhere).toEqual([]);
    expect(listed.stations[0].recipes.find((recipe) => recipe.recipeId === 'hatchet')!.questText).toBe('For A proper edge');
  });

  it('says it once for two things that wait on the same tool', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    const wants = { ...NO_WANTS, items: new Map([['hatchet', 'For a test'], ['fishing_rod', 'For a test']] as const) };
    expect(buildCraftNotes(state, 0, [], STATION_ORDER, wants, DEFAULT_KEY_BINDINGS)).toEqual([]);
    const lines = buildCraftNotes(state, 0, [
      { recipeId: 'hatchet', known: true, craftable: false, maximumCount: 0, missing: { items: [], tools: ['stone_knife'], station: null, hullTier: null, attachments: [], flag: null } },
      { recipeId: 'fishing_rod', known: true, craftable: false, maximumCount: 0, missing: { items: [], tools: ['stone_knife'], station: null, hullTier: null, attachments: [], flag: null } },
    ], STATION_ORDER, wants, DEFAULT_KEY_BINDINGS);
    expect(lines).toEqual([{ stationId: 'hands', questText: 'For a test', text: 'Hatchet and fishing rod need a stone knife first.' }]);
  });
});

/** Where a station is: every camp that has one, and the part that carries it on the canoe, afloat and landed. */
function placesOf(stationId: StationId): { name: string; stage: (state: GameState) => void }[] {
  if (stationId === 'hands') {
    return [
      { name: 'afloat', stage: (state) => floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z) },
      { name: 'on a beach', stage: (state) => standOn(state, 'cabin_roofs') },
      { name: 'in a camp', stage: (state) => void inCamp('home_knoll', state) },
    ];
  }
  const camps = CAMP_ISLANDS.filter((island) => island.camp!.stations.includes(stationId)).map((island) => ({
    name: `the camp on ${island.name}`, stage: (state: GameState) => void inCamp(island.id, state),
  }));
  const parts = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].station === stationId).flatMap((attachmentId) => [
    {
      name: `the ${ATTACHMENTS[attachmentId].name.toLowerCase()} aboard, on open water`,
      stage: (state: GameState): void => { state.canoe.hullTier = 3; build(state, attachmentId); floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z); },
    },
    {
      name: `the ${ATTACHMENTS[attachmentId].name.toLowerCase()} on the landed canoe, on foot beside it`,
      stage: (state: GameState): void => { state.canoe.hullTier = 3; build(state, attachmentId); standOn(state, 'cabin_roofs'); },
    },
  ]);
  return [...camps, ...parts];
}

/** How many of an item the crew holds: in the pack, in the cargo, or on the tool belt. */
const held = (state: GameState, itemId: ItemId): number =>
  countIn(state.players[0].backpack, itemId) + countIn(state.canoe.cargo, itemId) + (state.tools.includes(itemId as never) ? 1 : 0);

describe('nothing is unreachable', () => {
  it('walks every recipe: wherever its station is, a menu the player can open lists it, and its Make button makes it', () => {
    const walked: string[] = [];
    for (const recipeId of RECIPE_IDS) {
      const recipe = RECIPES[recipeId];
      const places = placesOf(recipe.station);
      expect(places.length, `${recipeId} has somewhere to be made`).toBeGreaterThan(0);
      for (const place of places) {
        const label = `${recipeId} at ${place.name}`;
        const state = newGame();
        place.stage(state);
        for (const toolId of recipe.tools) give(state, toolId);
        if (recipe.requiresFlag) state.flags[recipe.requiresFlag] = true;
        for (const input of recipe.inputs) give(state, input.itemId, input.count);
        // Every menu this player can open, each opened through the panel machine: C, its cards, B's stations.
        const menus = craftMenus(state);
        const holding = menus.filter((menu) => menu.recipes.some((row) => row.recipeId === recipeId));
        expect(holding.map((menu) => menu.name), `${label}: on a menu (of ${menus.map((menu) => menu.name).join(', ')})`).not.toEqual([]);
        // Only a hand recipe is on the hands' list.
        expect(holding.some((menu) => menu.name === 'C: Hands'), label).toBe(recipe.station === 'hands');
        const row = holding[0].recipes.find((entry) => entry.recipeId === recipeId)!;
        expect(row, label).toMatchObject({ known: true, missingText: '', craft: { enabled: true } });
        // Pressing Make sends the row's own command, and the rules make it.
        if (row.craft.intent.type !== 'command') throw new Error(`${label}: Make sends a command`);
        const before = held(state, recipe.output.itemId);
        expect(dispatch(state, row.craft.intent.command), label).toMatchObject({ ok: true });
        // (At least: a quest that closes on this craft may hand out more of the same.)
        expect(held(state, recipe.output.itemId), label).toBeGreaterThanOrEqual(before + recipe.output.count);
        walked.push(label);
      }
    }
    // Every recipe, and every kind of station at every place it stands: 6 camps, 4 parts on the canoe.
    expect(new Set(walked.map((label) => label.split(' at ')[0])).size).toBe(RECIPE_IDS.length);
    expect(STATION_ORDER.map((stationId) => placesOf(stationId).length)).toEqual([3, 6 + 2, 1 + 2, 2, 1 + 2]);
  });

  it('keeps a camp\'s menus when the canoe beside it carries the same stations', () => {
    // The camp is read from the rules, not guessed from what the canoe lacks.
    const state = inCamp('home_knoll');
    state.canoe.hullTier = 3;
    build(state, 'firebox', 'workbench');
    Object.assign(state.canoe.position, { x: state.players[0].position.x + 2, z: state.players[0].position.z });
    expect(campStationsHere(state)).toEqual(['fire', 'bench']);
    expect(craftMenus(state).map((menu) => menu.name)).toEqual(['C: Hands', 'C: Campfire', 'C: Stump bench', 'B: Firebox', 'B: Workbench']);
  });

  it('knows a camp by the rules: its stations in it, none on its beach, none on the water', () => {
    for (const island of CAMP_ISLANDS) {
      const state = inCamp(island.id);
      expect(campStationsHere(state), island.name).toEqual(island.camp!.stations);
      // The same answer the rules give for a canoe with nothing built on it.
      expect(['hands', ...campStationsHere(state)], island.name).toEqual(selectInventory(state).stations);
      build(state, 'firebox', 'workbench', 'smoker', 'forge');
      floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z);
      expect(campStationsHere(state), island.name).toEqual([]);
    }
    const beach = newGame();
    standOn(beach, 'home_knoll');
    expect(campStationsHere(beach)).toEqual([]);
    // Asking does not touch the game.
    const state = inCamp('home_knoll');
    build(state, 'firebox');
    const before = JSON.stringify(state);
    campStationsHere(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('a camp\'s stations have menus of their own', () => {
  it('stands a row of cards across the top of C in a camp: the hands, then each station of that camp', () => {
    const cards = (state: GameState): [string, string, string, boolean][] =>
      craftingPanel(state).doors.map((door) => [door.tab, door.kind, door.label, door.selected]);
    expect(cards(inCamp('home_knoll'))).toEqual([
      ['hands', 'hands', 'Hands', true], ['fire', 'campfire', 'Campfire', false], ['bench', 'bench', 'Stump bench', false],
    ]);
    // Tink's fire is the hearth of her forge: no campfire is drawn there.
    expect(CAMP_LAYOUTS.scrapyard_bar!.landmarks.map((landmark) => landmark.kind)).not.toContain('campfire');
    expect(cards(inCamp('scrapyard_bar'))).toEqual([
      ['hands', 'hands', 'Hands', true], ['fire', 'hearth', 'Hearth', false], ['forge', 'forge', 'Forge', false],
    ]);
    for (const island of CAMP_ISLANDS) {
      expect(craftingPanel(inCamp(island.id)).doors.map((door) => door.tab), island.name).toEqual(['hands', ...island.camp!.stations]);
    }
  });

  it('has no row away from a camp: on a beach, on the water, beside a canoe full of stations', () => {
    const beach = newGame();
    standOn(beach, 'home_knoll');
    expect(craftingPanel(beach).doors).toEqual([]);
    expect(find(panelView(craftingPanel(beach)), hasClass('iw-craft-doors'))).toEqual([]);
    const aboard = afloat('firebox', 'workbench', 'smoker', 'forge');
    expect(craftingPanel(aboard).doors).toEqual([]);
    standOn(aboard, 'cabin_roofs');
    expect(craftingPanel(aboard).doors).toEqual([]);
  });

  it('shows a station\'s own recipes and nothing else on its card, under the station\'s name', () => {
    const home = inCamp('home_knoll');
    expect(craftingPanel(home, 0, 'fire')).toMatchObject({ title: 'Campfire', tab: 'fire', about: 'Fire: cooks, boils and renders', elsewhere: [], restText: '' });
    expect(idsOf(craftingPanel(home, 0, 'fire').stations.flatMap((station) => station.recipes))).toEqual(recipesOf('fire'));
    expect(craftingPanel(home, 0, 'bench')).toMatchObject({ title: 'Stump bench', tab: 'bench', about: 'Bench: sawing and sewing' });
    expect(idsOf(craftingPanel(home, 0, 'bench').stations.flatMap((station) => station.recipes))).toEqual(recipesOf('bench'));
    const yard = inCamp('scrapyard_bar');
    expect(craftingPanel(yard, 0, 'fire')).toMatchObject({ title: 'Hearth', tab: 'fire' });
    expect(craftingPanel(yard, 0, 'forge')).toMatchObject({ title: 'Forge', tab: 'forge', about: 'Forge: scrap into parts' });
    expect(idsOf(craftingPanel(yard, 0, 'forge').stations.flatMap((station) => station.recipes))).toEqual(recipesOf('forge'));
    // The card that is open is the one marked.
    expect(craftingPanel(home, 0, 'bench').doors.filter((door) => door.selected).map((door) => door.label)).toEqual(['Stump bench']);
  });

  it('falls back to the hands for a station that is not in this camp', () => {
    expect(craftingPanel(inCamp('home_knoll'), 0, 'forge')).toMatchObject({ title: 'Crafting', tab: 'hands' });
    const aboard = afloat('firebox');
    expect(craftingPanel(aboard, 0, 'fire')).toMatchObject({ title: 'Crafting', tab: 'hands' });
  });

  it('keeps a recipe that only lacks materials, a tool or a survivor\'s word, as the boat\'s menus do', () => {
    const state = inCamp('home_knoll');
    const fire = craftingPanel(state, 0, 'fire').stations[0].recipes;
    expect(fire.find((recipe) => recipe.recipeId === 'pitch')).toMatchObject({ missingText: 'Needs 2 more spruce gum, 1 more driftwood', craft: { enabled: false } });
    const bench = craftingPanel(state, 0, 'bench').stations[0].recipes;
    expect(bench.find((recipe) => recipe.recipeId === 'plank')!.inputs.at(-1)).toMatchObject({ name: 'Saw (tool)', enough: false });
    expect(bench.find((recipe) => recipe.recipeId === 'sailcloth')).toMatchObject({ known: false, name: 'Unknown recipe' });
  });

  it('puts the red ! on the card of a station an open quest needs, and writes no line for it', () => {
    const state = atQuest(inCamp('home_knoll'), 'stop_the_leak');
    const panel = craftingPanel(state);
    expect(panel.doors.map((door) => [door.label, door.questText])).toEqual([['Hands', ''], ['Campfire', 'For Stop the leak'], ['Stump bench', '']]);
    expect(panel.elsewhere).toEqual([]);
    const cards = find(panelView(panel), hasClass('iw-craft-door'));
    expect(cards.map((card) => find([card], hasClass('iw-quest-mark')).map((mark) => mark.attributes.title))).toEqual([[], ['For Stop the leak'], []]);
    // And on the recipe itself, in the campfire's menu.
    expect(craftingPanel(state, 0, 'fire').stations[0].recipes.find((recipe) => recipe.recipeId === 'pitch')!.questText).toBe('For Stop the leak');
    // The next quest cooks too. One that asks nothing of a station leaves the cards bare.
    const eat = craftingPanel(atQuest(inCamp('home_knoll'), 'something_to_eat'));
    expect(eat.doors.find((door) => door.tab === 'fire')!.questText).toBe('For Something to eat');
    expect(craftingPanel(atQuest(inCamp('home_knoll'), 'first_haul')).doors.map((door) => door.questText)).toEqual(['', '', '']);
  });

  it('draws the row over the body, each card a button that names its menu, the open one marked', () => {
    const state = inCamp('home_knoll');
    const drawn = panelView(craftingPanel(state, 0, 'fire'));
    const [sheet] = drawn;
    const row = find(drawn, hasClass('iw-craft-doors'));
    expect(row).toHaveLength(1);
    // The row is the sheet's own child, not inside the scrolling body: it stays put while the recipes scroll.
    expect(sheet.children).toContain(row[0]);
    expect(find(find(drawn, hasClass('iw-body')), hasClass('iw-craft-doors'))).toEqual([]);
    const cards = find(row, hasClass('iw-craft-door'));
    expect(cards.map((card) => [card.tag, card.attributes['data-craft-tab'], collectText([card])])).toEqual([
      ['button', 'hands', 'Hands'], ['button', 'fire', 'Campfire'], ['button', 'bench', 'Stump bench'],
    ]);
    expect(cards.map((card) => [hasClass('iw-on')(card), card.attributes['aria-current']])).toEqual([[false, null], [true, 'page'], [false, null]]);
    expect(cards.map((card) => card.intent)).toEqual([
      { type: 'select_craft_tab', tab: 'hands' }, { type: 'select_craft_tab', tab: 'fire' }, { type: 'select_craft_tab', tab: 'bench' },
    ]);
    expect(collectText(find(drawn, (node) => node.tag === 'h2'))).toBe('Campfire');
    expect(collectText(find(drawn, hasClass('iw-sub')))).toBe('Fire: cooks, boils and renders');
    // The hands keep the heading they had; a station's menu is named by the sheet.
    expect(collectText(find(panelView(craftingPanel(state)), (node) => node.tag === 'h3'))).toBe('Hands');
    expect(find(drawn, (node) => node.tag === 'h3')).toEqual([]);
  });

  it('has a drawing for every card: the hand, the campfire and the stump are their own', () => {
    const drawings = Object.values(CRAFT_DOOR_ICON);
    expect(drawings).toHaveLength(6);
    for (const drawing of drawings) {
      expect(drawing).toMatch(/^<svg class="iw-ico" viewBox="0 0 24 24"/);
      expect(drawing).toContain('class="iw-pen"');
      expect(drawing).toContain('class="iw-wash"');
      expect(drawing).not.toMatch(/animate|transition/);
    }
    expect(new Set(drawings).size).toBe(6);
    for (const own of [CRAFT_DOOR_ICON.hands, CRAFT_DOOR_ICON.campfire, CRAFT_DOOR_ICON.bench]) {
      expect([BUILDER_ICON, STATION_KIND_ICON.fire, STATION_KIND_ICON.bench]).not.toContain(own);
    }
    const cards = find(panelView(craftingPanel(inCamp('scrapyard_bar'))), hasClass('iw-craft-ico'));
    expect(cards.map((card) => card.html)).toEqual([CRAFT_DOOR_ICON.hands, CRAFT_DOOR_ICON.hearth, CRAFT_DOOR_ICON.forge]);
  });

  it('swaps plainly: each menu is a body of its own, and nothing in the row\'s styles moves', () => {
    const state = inCamp('home_knoll');
    const bodyKey = (tab?: StationId): string | null => find(panelView(craftingPanel(state, 0, tab)), hasClass('iw-body'))[0].key;
    expect(new Set([bodyKey(), bodyKey('fire'), bodyKey('bench')]).size).toBe(3);
    expect(craftDoorsCss.length).toBeGreaterThan(500);
    // Comments aside, no rule animates, eases or shifts a card.
    const rules = craftDoorsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/transition|animation|@keyframes|transform/);
    // The sheet hangs from its top only while the row is there: away from a camp C sits where it always did.
    expect(rules).toContain('.iw-panel-crafting:has(.iw-craft-doors)');
    expect(rules).not.toMatch(/\.iw-panel-crafting\s*\{/);
  });
});

describe('where the rest is made', () => {
  it('says one quiet line when the canoe\'s stations are in reach, with the boat\'s key as it is bound', () => {
    const state = afloat('firebox', 'workbench');
    const panel = craftingPanel(state);
    expect(panel.restText).toBe('The firebox and the workbench have their own menus on the boat (B).');
    expect(collectText(find(panelView(panel), hasClass('iw-craft-rest')))).toBe(panel.restText);
    expect(craftingPanel(afloat('smoker')).restText).toBe('The smoker has its own menu on the boat (B).');
    const settings = createDefaultSettings();
    settings.controls.keyBindings = { ...settings.controls.keyBindings, canoeBuilder: ['KeyN'] };
    expect(craftingPanel(afloat('smoker'), 0, undefined, settings).restText).toBe('The smoker has its own menu on the boat (N).');
    // Nothing aboard, or the canoe out of reach: nothing to say.
    expect(craftingPanel(afloat()).restText).toBe('');
    expect(find(panelView(craftingPanel(afloat())), hasClass('iw-craft-rest'))).toEqual([]);
    const walkedOff = inCamp('home_knoll');
    build(walkedOff, 'smoker');
    expect(craftingPanel(walkedOff).restText).toBe('');
  });

  it('sends a quest to the boat\'s menu for what a station aboard makes', () => {
    const state = atQuest(afloat('firebox'), 'stop_the_leak');
    expect(craftingPanel(state).elsewhere).toEqual([
      { stationId: 'fire', questText: 'For Stop the leak', text: 'Pitch is made at the firebox: the boat\'s menu (B).' },
    ]);
    const eat = atQuest(afloat('firebox'), 'something_to_eat');
    expect(craftingPanel(eat).elsewhere.map((line) => line.text)).toEqual([
      'Clean water, cooked fish, roast roots and stew are made at the firebox: the boat\'s menu (B).',
    ]);
  });

  it('keeps round 3\'s line for a station that is nowhere near', () => {
    const state = atQuest(newGame(), 'stop_the_leak');
    standOn(state, 'cabin_roofs');
    expect(craftingPanel(state).elsewhere).toEqual([
      { stationId: 'fire', questText: 'For Stop the leak', text: 'Pitch needs a fire: any camp, or a firebox built on the canoe.' },
    ]);
  });

  it('says so in one plain line when there is nothing to make by hand, and names where the rest is', () => {
    const none = (state: GameState): string => craftRestText(state, 0, 0, STATION_ORDER, DEFAULT_KEY_BINDINGS);
    const beach = newGame();
    standOn(beach, 'cabin_roofs');
    expect(none(beach)).toBe('Nothing to make by hand yet. The rest is made at a fire, a bench, a smoker or a forge: at a camp, or built on the canoe.');
    expect(none(inCamp('home_knoll'))).toBe('Nothing to make by hand yet. The campfire and the stump bench have their own menus, above.');
    expect(none(inCamp('orchard_hill'))).toBe('Nothing to make by hand yet. The campfire has its own menu, above.');
    expect(none(afloat('firebox'))).toBe('Nothing to make by hand yet. The firebox has its own menu on the boat (B).');
    // With something to make it is quiet, unless the boat's stations are in reach.
    expect(craftRestText(beach, 0, 2, STATION_ORDER, DEFAULT_KEY_BINDINGS)).toBe('');
    // Drawn: the heading, the line, and no empty list.
    const empty = { ...buildCraftingPanel(beach), restText: none(beach) };
    empty.stations = [{ name: 'Hands', recipes: [] }];
    const drawn = draw(empty);
    expect(collectText(find(drawn, hasClass('iw-craft-rest')))).toBe(none(beach));
    expect(find(drawn, hasClass('iw-grid'))).toEqual([]);
    expect(find(drawn, hasClass('iw-entry'))).toEqual([]);
  });
});

// --- The interact key, on a whole client ----------------------------------------------------

interface Client {
  app: App;
  models: InterfaceModel[];
}

function client(game: GameState): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  app.session.adoptGame(game);
  return { app, models };
}

function frames(app: App, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) app.frame(FIXED_STEP);
}

function press(app: App, keyCode: string): void {
  app.session.keyDown(keyCode);
  app.session.keyUp(keyCode);
  frames(app, 0.05);
}

describe('the interact key at a station opens that station\'s own menu', () => {
  it('opens the stump bench\'s menu at the stump, and C after that is the hands again', () => {
    const game = inCamp('home_knoll');
    const stump = CAMP_LAYOUTS.home_knoll!.landmarks.find((landmark) => landmark.kind === 'stump_bench')!;
    teleport(game, 'home_knoll', stump.x + 1.5, stump.z);
    const { app, models } = client(game);
    frames(app, 0.1);
    expect(models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Use the bench', keyLabel: 'F' });
    press(app, 'KeyF');
    expect(app.session.panels).toMatchObject({ stack: ['crafting'], craftTab: 'bench' });
    const panel = models.at(-1)!.panel;
    if (panel?.id !== 'crafting') throw new Error('expected the crafting panel');
    expect(panel).toMatchObject({ title: 'Stump bench', tab: 'bench' });
    expect(idsOf(panel.stations[0].recipes)).toEqual(recipesOf('bench'));
    // Nothing went to the rules: no refusal, no command.
    expect(models.at(-1)!.toasts).toEqual([]);
    press(app, 'Escape');
    expect(app.session.panels.stack).toEqual([]);
    press(app, 'KeyC');
    expect(models.at(-1)!.panel).toMatchObject({ id: 'crafting', title: 'Crafting', tab: 'hands' });
    // A click on a card swaps the menu, and the card's own intent is all it takes.
    const fire = (models.at(-1)!.panel as Extract<InterfaceModel['panel'], { id: 'crafting' }>).doors.find((door) => door.tab === 'fire')!;
    app.session.handleIntent(fire.intent);
    frames(app, 0.05);
    expect(models.at(-1)!.panel).toMatchObject({ id: 'crafting', title: 'Campfire', tab: 'fire' });
  });

  it('opens the workbench\'s menu on the boat at the canoe\'s workbench', () => {
    const game = newGame();
    game.canoe.hullTier = 3;
    build(game, 'firebox', 'workbench');
    standOn(game, 'cabin_roofs');
    const { app, models } = client(game);
    // Walk the player onto the workbench's own spot, wherever the hull puts it.
    let found = false;
    for (let dx = -4; dx <= 4 && !found; dx += 0.5) {
      for (let dz = -4; dz <= 4 && !found; dz += 0.5) {
        const x = game.canoe.position.x + dx;
        const z = game.canoe.position.z + dz;
        Object.assign(game.players[0].position, { x, y: terrainHeight(x, z), z });
        found = selectInteractable(game)?.kind === 'bench';
      }
    }
    expect(found).toBe(true);
    frames(app, 0.1);
    expect(models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Use the bench' });
    press(app, 'KeyF');
    expect(app.session.panels).toMatchObject({ stack: ['canoe_builder'], boatTab: 'workbench' });
    expect(models.at(-1)!.panel).toMatchObject({ id: 'canoe_builder', title: 'Workbench', station: { attachmentId: 'workbench' } });
  });

  it('leads each kind of station to its menu: the camp\'s own first, then the part on the canoe, else nothing', () => {
    const home = inCamp('home_knoll');
    expect(stationDoor(home, 0, 'fire')).toEqual({ panel: 'crafting', tab: 'fire' });
    expect(stationDoor(home, 0, 'bench')).toEqual({ panel: 'crafting', tab: 'bench' });
    expect(stationDoor(home, 0, 'forge')).toBeNull();
    expect(stationDoor(inCamp('scrapyard_bar'), 0, 'forge')).toEqual({ panel: 'crafting', tab: 'forge' });
    const aboard = afloat('firebox', 'forge');
    expect(stationDoor(aboard, 0, 'fire')).toEqual({ panel: 'canoe_builder', tab: 'firebox' });
    expect(stationDoor(aboard, 0, 'forge')).toEqual({ panel: 'canoe_builder', tab: 'forge' });
    expect(stationDoor(aboard, 0, 'bench')).toBeNull();
  });

  it('never lands on the hands: at every camp, whatever the rules offer to work at opens a station\'s menu', () => {
    // A tripwire for the merge: a prompt with no command is a station to work at (today the stump bench). Whatever
    // the rules add beside it (the fire) must open that station's menu, not the list of hand crafts.
    const worked: string[] = [];
    for (const island of CAMP_ISLANDS) {
      for (const landmark of CAMP_LAYOUTS[island.id]!.landmarks) {
        const game = inCamp(island.id);
        teleport(game, island.id, landmark.x + 1.5, landmark.z);
        const offered = selectInteractable(game);
        if (!offered || 'command' in offered) continue;
        const { app, models } = client(game);
        frames(app, 0.1);
        press(app, 'KeyF');
        const panel = models.at(-1)!.panel;
        const label = `${offered.name} on ${island.name}`;
        expect(panel?.id === 'crafting' || panel?.id === 'canoe_builder', label).toBe(true);
        if (panel?.id === 'crafting') {
          expect(panel.tab, label).not.toBe('hands');
          expect(panel.stations[0].recipes.length, label).toBeGreaterThan(0);
        }
        worked.push(label);
      }
    }
    expect(worked).toContain('Stump bench on Home Knoll');
  });
});
