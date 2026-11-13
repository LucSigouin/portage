/**
 * Luc's list, line 21: an "F Use the bench" prompt at the stump that opens crafting. The same at the workbench on
 * the canoe, once it is built. The rules say where the prompt shows; the screen opens the panel (tests/client).
 */
import { describe, expect, it } from 'vitest';
import { CAMP_LAYOUTS, TUNING } from '../src/data/index.ts';
import { selectInteractable, selectInventory } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { workbenchPosition } from '../src/sim/interact.ts';
import { build, newGame, standOn, teleport } from './support.ts';

const stump = (): { x: number; z: number } => CAMP_LAYOUTS.home_knoll!.landmarks.find((landmark) => landmark.kind === 'stump_bench')!;

/** The canoe on the Home Knoll beach, hull tier 2, with the port outrigger, and the player on foot beside it. */
function withWorkbench(): GameState {
  const state = newGame(7);
  state.canoe.hullTier = 2;
  build(state, 'outrigger_port', 'workbench');
  standOn(state, 'home_knoll');
  return state;
}

describe('"F Use the bench"', () => {
  it('shows at the stump bench, from every side, and the bench is in reach there', () => {
    const bench = stump();
    for (const [x, z] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.2, 1.2]] as const) {
      const state = newGame(7);
      standOn(state, 'home_knoll');
      teleport(state, 'home_knoll', bench.x + x, bench.z + z);
      expect(selectInteractable(state), `${x}, ${z}`).toMatchObject({ kind: 'bench', prompt: 'Use the bench' });
      expect(selectInventory(state).stations).toContain('bench');
    }
  });

  it('does not show a step past its reach, nor at the fire or the lean-to', () => {
    const state = newGame(7);
    standOn(state, 'home_knoll');
    const bench = stump();
    teleport(state, 'home_knoll', bench.x + TUNING.foot.benchRange + 0.3, bench.z);
    expect(selectInteractable(state)?.kind ?? null).not.toBe('bench');
    for (const landmark of CAMP_LAYOUTS.home_knoll!.landmarks.filter((entry) => entry.kind !== 'stump_bench')) {
      teleport(state, 'home_knoll', landmark.x + 1, landmark.z);
      expect(selectInteractable(state)?.kind ?? null, landmark.kind).not.toBe('bench');
    }
  });

  it('shows at the workbench on the canoe once it is built, and the rest of the hull still offers boarding', () => {
    const state = withWorkbench();
    const at = workbenchPosition(state);
    // The workbench is on the port deck: to port of the hull, a little forward of the middle.
    const port = { x: Math.sin(state.canoe.heading - Math.PI / 2), z: -Math.cos(state.canoe.heading - Math.PI / 2) };
    const offset = { x: at.x - state.canoe.position.x, z: at.z - state.canoe.position.z };
    expect(offset.x * port.x + offset.z * port.z).toBeCloseTo(1.1, 5);
    teleport(state, 'home_knoll', at.x + 0.5, at.z);
    expect(selectInteractable(state)).toMatchObject({ kind: 'bench', name: 'Workbench', prompt: 'Use the bench' });
    expect(selectInventory(state).stations).toContain('bench');
    // At the stern, the canoe is boarded as before.
    const stern = { x: state.canoe.position.x - Math.sin(state.canoe.heading) * 2.2, z: state.canoe.position.z + Math.cos(state.canoe.heading) * 2.2 };
    teleport(state, 'home_knoll', stern.x, stern.z);
    expect(selectInteractable(state)).toMatchObject({ kind: 'board' });
  });

  it('does not show at the canoe without a workbench', () => {
    const state = withWorkbench();
    const at = workbenchPosition(state);
    state.canoe.attachments = state.canoe.attachments.filter((attachmentId) => attachmentId !== 'workbench');
    teleport(state, 'home_knoll', at.x + 0.5, at.z);
    expect(selectInteractable(state)?.kind ?? null).not.toBe('bench');
  });
});
