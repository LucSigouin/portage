/**
 * A quest's words say what is true of the valley (the master review of round 3, finding 5).
 *
 * Quest 3, "Stop the leak", said "Peel birch bark on Birch Islet" and "bark from Birch Islet across the water".
 * Since every birch is a spot, Home Knoll's birches give bark too and the step counts any bark: the words no longer
 * say bark comes from one island. They still name Birch Islet, the island thickest with birch, so a new player is
 * still pointed at the first voyage.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, NODES, QUESTS } from '../src/data/index.ts';
import type { IslandId } from '../src/data/index.ts';
import { toastForEvent } from '../src/client/viewmodels/toasts.ts';
import { wildNodesOn } from '../src/sim/gathering.ts';
import { newGame } from './support.ts';

/** The birches of an island that give bark: the placed spots and the wild trees. */
const birches = (islandId: IslandId): number =>
  NODES.filter((node) => node.islandId === islandId && node.name === 'Birch').length
  + wildNodesOn(islandId).filter((node) => node.definition.name === 'Birch').length;

describe('quest 3, Stop the leak', () => {
  const quest = QUESTS.stop_the_leak;
  const step = quest.objectives.find((objective) => objective.type === 'have_item' && objective.itemId === 'birch_bark')!;

  it('asks for bark from anywhere: the step is the same rule and the same count as before', () => {
    expect(step).toMatchObject({ type: 'have_item', itemId: 'birch_bark', count: 3 });
    expect('islandId' in step).toBe(false);
    expect(quest.objectives.map((objective) => objective.type)).toEqual(['have_item', 'have_item', 'craft', 'hull']);
  });

  it('does not say the bark comes from Birch Islet alone, on the card or in the story', () => {
    expect(step.text).toBe('Peel birch bark, plenty on Birch Islet');
    expect(quest.description).toBe('Gum from the spruce, bark from any birch. Birch Islet, across the water, is thick with them. Cook pitch and patch the seams.');
    for (const words of [step.text, quest.description]) {
      expect(words).not.toMatch(/bark (on|from) Birch Islet/);
      expect(words).not.toMatch(/\bonly\b/i);
    }
  });

  it('still names Birch Islet, and what it says of it is true: no island has more birch, and Home Knoll has some', () => {
    expect(step.text).toContain(ISLANDS_BY_ID.birch_islet.name);
    expect(quest.description).toContain(ISLANDS_BY_ID.birch_islet.name);
    const counts = ISLANDS.map((island) => [island.id, birches(island.id)] as const);
    const most = Math.max(...counts.map(([, count]) => count));
    expect(birches('birch_islet')).toBe(most);
    expect(birches('birch_islet')).toBeGreaterThan(2 * birches('home_knoll'));
    // The reason the old words were untrue. If Home Knoll's birches are ever made scenery, the words may name one island again.
    expect(birches('home_knoll')).toBeGreaterThan(0);
  });

  it('reads well as the note when the step is done', () => {
    const state = newGame();
    const index = quest.objectives.indexOf(step);
    expect(toastForEvent({ type: 'quest_advanced', questId: 'stop_the_leak', objectiveIndex: index, progress: 3, required: 3 }, state))
      .toEqual({ text: 'Done: Peel birch bark, plenty on Birch Islet', tone: 'good' });
  });
});
