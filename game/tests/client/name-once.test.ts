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
  it('counts only what tells something: one made is nothing, more is "× n"', () => {
    expect(recipeOutputText(1)).toBe('');
    expect(recipeOutputText(2)).toBe('× 2');
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
          expect(row.outputText, `${menu.name}: ${row.recipeId}`).not.toContain(ITEMS[recipe.output.itemId].name);
          expect(row.outputText, `${menu.name}: ${row.recipeId}`).toBe(recipe.output.count > 1 ? `× ${recipe.output.count}` : '');
        }
        const panel = panelOf(state, menu.panels);
        expect(collectText(panelView(panel!)), menu.name).not.toMatch(/\b1 x /);
      }
      expect(rows).toBeGreaterThan(0);
    });
  }
});
