/**
 * The master review of round 4, finding 3: an open sheet cut the quest card, the crew list, the health bars and the
 * minimap mid-word. They stand aside while a sheet is open, at once, and come back when it closes.
 */
import { describe, expect, it } from 'vitest';
import { setEdgeCardsHidden, sheetHidesEdges } from '../../src/interface/edgecards.ts';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };
const source = (name: string): string => readFileSync(new URL(`../../src/interface/${name}`, import.meta.url), 'utf8');

describe('the edge cards while a sheet is open', () => {
  it('stand aside for the inventory, crafting and every other sheet, not for a talk or the open world', () => {
    for (const id of ['inventory', 'crafting', 'map', 'quest_log', 'pause', 'canoe_builder']) expect(sheetHidesEdges({ id } as never), id).toBe(true);
    expect(sheetHidesEdges({ id: 'dialogue' } as never)).toBe(false);
    expect(sheetHidesEdges(null)).toBe(false);
  });

  it('are hidden by the hidden attribute, and shown again', () => {
    const cards = [{ hidden: false }, { hidden: false }] as HTMLElement[];
    setEdgeCardsHidden([...cards, undefined], true);
    expect(cards.map((card) => card.hidden)).toEqual([true, true]);
    setEdgeCardsHidden(cards, false);
    expect(cards.map((card) => card.hidden)).toEqual([false, false]);
  });

  it('the interface hides the vitals (crew list and health bars), the quest card, the tip and prompt slips under the sheet and the minimap', () => {
    expect(source('interface.ts')).toContain("setEdgeCardsHidden([part('vitals'), part('notes'), part('hint'), part('prompt'), this.minimap?.element], this.edgesHidden)");
  });

  it('nothing fades or slides: no transition and no animation in its style sheet', () => {
    const sheet = source('edgecards.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sheet).not.toMatch(/transition|animation/);
    expect(sheet).toContain('.iw.iw-sheet-open > .iw-toasts');
  });
});
