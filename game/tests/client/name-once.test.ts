/**
 * A recipe's row names the thing once (Luc's feedback note #8: "name, then name x1"). Beside the name stands how many
 * it makes, and only when that is more than one. In C by hand, at a camp's cards, and in the station menus on B.
 */
import { describe, expect, it } from 'vitest';
import { recipeOutputText } from '../../src/client/viewmodels/index.ts';
import { ITEMS, RECIPES, RECIPE_IDS } from '../../src/data/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { collectText } from '../../src/interface/dom.ts';
import { panelView } from '../../src/interface/views.ts';
import type { GameState } from '../../src/sim/index.ts';
import { build, floatCanoeAt, give, newGame, standOn, teleportToCamp } from '../support.ts';
import { craftMenus, panelOf } from './craftmenus.ts';

function inCamp(islandId: IslandId): GameState {
  const state = newGame();
  standOn(state, islandId);
  teleportToCamp(state, islandId);
  return state;
}

function afloat(): GameState {
  const state = newGame();
  build(state, 'firebox', 'workbench', 'smoker', 'forge');
  floatCanoeAt(state, -40, 1085);
  return state;
}

/** Every recipe known, so each row shows its name and what it makes. */
function knowingAll(state: GameState): GameState {
  for (const recipeId of RECIPE_IDS) {
    const flag = RECIPES[recipeId].requiresFlag;
    if (flag) state.flags[flag] = true;
  }
  give(state, 'stone_knife');
  return state;
}

describe('a recipe row says its name once', () => {
  it('a recipe named as its output says the name once: one made is nothing, more is "× n"', () => {
    expect(recipeOutputText('Rope', 'rope', 1)).toBe('');
    expect(recipeOutputText('Plank', 'plank', 2)).toBe('× 2');
    expect(recipeOutputText('Charcoal from driftwood', 'charcoal', 1)).toBe('');
  });

  it('a recipe named for something else names what it makes: "Boil water" makes Clean water (review r5, finding 2)', () => {
    expect(recipeOutputText('Boil water', 'clean_water', 1)).toBe('Clean water');
    expect(recipeOutputText('Boil water', 'clean_water', 3)).toBe('Clean water × 3');
  });

  it('every recipe\'s row says what it makes and never its name twice', () => {
    for (const recipeId of RECIPE_IDS) {
      const recipe = RECIPES[recipeId];
      const made = ITEMS[recipe.output.itemId].name;
      const row = `${recipe.name} ${recipeOutputText(recipe.name, recipe.output.itemId, recipe.output.count)}`;
      expect(row.toLowerCase(), recipeId).toContain(made.toLowerCase());
      expect(row.toLowerCase().split(made.toLowerCase()).length - 1, recipeId).toBe(1);
      if (recipe.output.count > 1) expect(row, recipeId).toContain(`× ${recipe.output.count}`);
    }
  });

  for (const [where, stage] of [['at Home Knoll\'s camp', () => inCamp('home_knoll')], ['aboard a canoe with all four stations', afloat]] as const) {
    it(`${where}: no row repeats the name of what it makes`, () => {
      const state = knowingAll(stage());
      const menus = craftMenus(state);
      expect(menus.length).toBeGreaterThan(1);
      let rows = 0;
      for (const menu of menus) {
        for (const row of menu.recipes) {
          if (!row.known) continue;
          rows += 1;
          const recipe = RECIPES[row.recipeId];
          const made = ITEMS[recipe.output.itemId].name;
          expect(`${row.name} ${row.outputText}`.split(made).length - 1, `${menu.name}: ${row.recipeId}`).toBe(1);
          expect(row.outputText, `${menu.name}: ${row.recipeId}`).toBe(recipeOutputText(recipe.name, recipe.output.itemId, recipe.output.count));
        }
        const panel = panelOf(state, menu.panels);
        expect(collectText(panelView(panel!)), menu.name).not.toMatch(/\b1 x /);
      }
      expect(rows).toBeGreaterThan(0);
    });
  }
});
