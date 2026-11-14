// The island shot (`?shot=island`) stands its lead beside the first spot on Home Knoll that is not used up. A spot
// is solid now (Luc, Round 4: "you can still walk through some things"), so the lead stands on clear ground beside
// it, never inside the pile. The look, rules and interface specs all open this shot.
import { describe, expect, it } from 'vitest';
import { stageShot } from '../../src/client/debug/staging.ts';
import { bodyBlocked } from '../../src/sim/index.ts';

describe('the island shot stands clear of the solids', () => {
  it('stages its lead on foot on Home Knoll, outside every solid', () => {
    const state = stageShot('island').state;
    if (!state) throw new Error('the island shot stages a game');
    const lead = state.players[0];
    if (!lead) throw new Error('the island shot has a player');
    expect(lead.mode).toBe('foot');
    expect(lead.islandId).toBe('home_knoll');
    expect(bodyBlocked(lead.position.x, lead.position.z)).toBe(false);
  });
});
