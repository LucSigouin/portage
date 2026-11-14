/**
 * How to Play is up to date (the master review of round 3, finding 6): it says what round 3 added, with the keys
 * the game really answers, and it no longer says a camp sleeps.
 */
import { describe, expect, it } from 'vitest';
import { TAKE_BACK_KEY_CODE } from '../../src/client/viewmodels/takeback.ts';
import { HOW_TO_PLAY_DROP_KEY, buildHowToPlayPanel } from '../../src/client/viewmodels/menus.ts';
import { TOAST_SECONDS, buildHudModel, keyLabel } from '../../src/client/viewmodels/index.ts';
import { ISLANDS_BY_ID } from '../../src/data/index.ts';
import type { LandmarkKind } from '../../src/data/index.ts';
import { BED_LANDMARK_KINDS, CAMP_LAYOUTS } from '../../src/data/world.ts';
import { DROP_KEY_CODE, QUICK_PRESS_HINT } from '../../src/interface/inventoryview.ts';
import { MAP_MARK_HINT } from '../../src/client/viewmodels/gamepanels.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { MAXIMUM_TRACKED, TAKE_BACK } from '../../src/sim/index.ts';
import { newGame, standOn } from '../support.ts';

const settings = createDefaultSettings();
const panel = buildHowToPlayPanel(settings);
const section = (heading: string) => panel.sections.find((entry) => entry.heading === heading)!;
const controls = panel.sections.flatMap((entry) => entry.controls);
const keysOf = (label: string): string | undefined => controls.find((control) => control.label === label)?.keys;
const everyWord = JSON.stringify(panel);

describe('How to Play says what round 3 added', () => {
  it('beside the panel each belongs to, with no new section: the page keeps its five headings', () => {
    expect(panel.sections.map((entry) => entry.heading)).toEqual(['The loop', 'In the canoe', 'On foot', 'Panels and camera', 'Staying alive']);
    expect(section('Panels and camera').controls.map((control) => control.keys)).toEqual(['Tab', 'Click', 'Shift+click', 'Q', 'Z', 'C', 'B', 'J', 'M', 'Esc']);
  });

  it('Shift+click, Q on a stack, and Z to take a drop back, with the keys the inventory really answers', () => {
    expect(keysOf('A stack to the other side')).toBe('Shift+click');
    expect(keysOf('Pointer on a stack: drop it')).toBe('Q');
    expect(keysOf('Take a drop back, within 5 s')).toBe('Z');
    // Held to the keys themselves, to how long the note stands, and to what the inventory's own footer says.
    expect(HOW_TO_PLAY_DROP_KEY).toBe(keyLabel(DROP_KEY_CODE));
    expect(keysOf(`Take a drop back, within ${TOAST_SECONDS.warning} s`)).toBe(keyLabel(TAKE_BACK_KEY_CODE));
    expect(TAKE_BACK.seconds).toBeGreaterThanOrEqual(TOAST_SECONDS.warning);
    expect(QUICK_PRESS_HINT).toContain(`${HOW_TO_PLAY_DROP_KEY} with the pointer on a tile: drop it.`);
    expect(QUICK_PRESS_HINT).toContain(`${keyLabel(TAKE_BACK_KEY_CODE)} takes a drop back`);
  });

  it('a click on a stack: its menu, and Give to a crewmate close by (the master review of round 4, finding 5)', () => {
    expect(keysOf('A stack: eat, drop, or give to a crewmate close by')).toBe('Click');
    expect(everyWord).toContain('give to a crewmate');
  });

  it('the map mark, on the map\'s own line, and the map says the rest itself', () => {
    expect(keysOf('Map: a click marks a spot for the crew')).toBe('M');
    expect(MAP_MARK_HINT).toContain('mark a spot for the crew');
    expect(MAP_MARK_HINT).toContain('take it down');
  });

  it('up to three tracked quests, as many as a card holds', () => {
    expect(MAXIMUM_TRACKED).toBe(3);
    expect(keysOf('Quest log: track up to three quests')).toBe('J');
  });

  it('the jump, with its key as it is bound, and the auto-paddle', () => {
    expect(section('On foot').controls).toContainEqual({ label: 'Jump', keys: 'Space' });
    expect(section('In the canoe').controls).toContainEqual({ label: 'Auto-paddle: press again, or paddle, to stop', keys: 'Q' });
    const rebound = createDefaultSettings();
    rebound.controls.keyBindings.jump = ['KeyG'];
    rebound.controls.keyBindings.map = ['KeyN'];
    const again = buildHowToPlayPanel(rebound).sections.flatMap((entry) => entry.controls);
    expect(again).toContainEqual({ label: 'Jump', keys: 'G' });
    // A bound key follows its binding. The three fixed ones do not move.
    expect(again).toContainEqual({ label: 'Map: a click marks a spot for the crew', keys: 'N' });
    expect(again).toContainEqual({ label: 'Pointer on a stack: drop it', keys: 'Q' });
  });

  it('B opens the builder and the station menus, afloat too', () => {
    expect(keysOf('The canoe: its builder (beached), its stations (afloat too)')).toBe('B');
  });
});

describe('How to Play says where sleep is', () => {
  it('at a bed, not at a camp: the fire does not sleep', () => {
    expect(section('Staying alive').lines).toContain(
      'Energy comes back when you rest. Sleep at a bed (the lean-to, or a bedroll) after 19:00 to refill it and skip the night.');
    expect(everyWord).not.toMatch(/sleep at a camp/i);
    // What the page calls a bed is what the valley has: every camp that sleeps has a lean-to, a bedroll or the keeper's hut.
    expect([...BED_LANDMARK_KINDS].sort()).toEqual(['bedroll', 'keeper_hut', 'lean_to']);
    const beds = new Set<LandmarkKind>();
    for (const island of Object.values(ISLANDS_BY_ID)) {
      if (!island.camp?.sleep) continue;
      // A camp that sleeps has a bed to sleep at.
      expect(CAMP_LAYOUTS[island.id]!.beds.length, island.name).toBeGreaterThan(0);
      for (const bed of CAMP_LAYOUTS[island.id]!.beds) beds.add(bed.kind);
    }
    expect(beds.has('lean_to')).toBe(true);
    expect(beds.has('bedroll')).toBe(true);
  });

  it('and so does the tip of a worn-out player', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    state.players[0].energy = 5;
    const hint = buildHudModel(state, settings, 0).hint;
    expect(hint).toBe('Worn out. Stand still to rest, or sleep at a bed.');
  });
});
