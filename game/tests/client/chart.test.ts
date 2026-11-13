/**
 * The round chart (Luc's bugfix list, line 7): the real shores traced from the rules' own ground, the fog
 * drawn soft over what the crew has not seen, and a minimap that draws only when its player moves a whole pixel
 * or turns a whole degree, with a flag for each quest on that player's card.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS } from '../../src/data/index.ts';
import type { QuestId } from '../../src/data/index.ts';
import { buildHudModel } from '../../src/client/viewmodels/index.ts';
import { CHART, contourSegments, lakeSeenShare, seenCells, valleyChart } from '../../src/client/viewmodels/chart.ts';
import type { MinimapModel } from '../../src/client/contracts.ts';
import { fogMaskAlpha, minimapKey, minimapPlace, minimapView } from '../../src/interface/chart.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FOG, cellSeen, dispatch, emptySeen, fullSeen, revealCircle, selectMap, terrainHeight } from '../../src/sim/index.ts';
import { newGame, standOn } from '../support.ts';

const settings = createDefaultSettings();

/** Every point the segments name, as [x, z]. */
const pointsOf = (segments: Float32Array): [number, number][] => {
  const points: [number, number][] = [];
  for (let index = 0; index < segments.length; index += 2) points.push([segments[index]!, segments[index + 1]!]);
  return points;
};

describe('the chart\'s shores', () => {
  it('traces a level line where it lies: round a cone, at its radius', () => {
    const samples = 41;
    const step = 5;
    const values = new Float32Array(samples * samples);
    for (let row = 0; row < samples; row += 1) {
      for (let column = 0; column < samples; column += 1) values[row * samples + column] = 60 - Math.hypot(column * step - 100, row * step - 100);
    }
    const segments = contourSegments(values, samples, 0, 0, step, 0);
    const points = pointsOf(segments);
    expect(points.length).toBeGreaterThan(60);
    for (const [x, z] of points) expect(Math.abs(Math.hypot(x - 100, z - 100) - 60)).toBeLessThan(0.5);
    // Flat ground, all above or all below the line, has no line.
    expect(contourSegments(values, samples, 0, 0, step, 100).length).toBe(0);
    expect(contourSegments(values, samples, 0, 0, step, -200).length).toBe(0);
  });

  it('draws every shore of the valley where the rules put the water\'s edge, and works it out once', () => {
    const chart = valleyChart();
    expect(valleyChart()).toBe(chart);
    const points = pointsOf(chart.shore);
    expect(points.length).toBeGreaterThan(1000);
    // Every point has land and water within a sample of it, on the rules' own ground; most lie on the water line
    // to the centimetre (a shelf's step can put one up to a sample off it).
    const off: number[] = [];
    const reach = chart.sampleMetres;
    for (let index = 0; index < points.length; index += 5) {
      const [x, z] = points[index]!;
      const round = [-reach, 0, reach].flatMap((dx) => [-reach, 0, reach].map((dz) => terrainHeight(x + dx, z + dz)));
      expect(Math.max(...round), `${x}, ${z}`).toBeGreaterThanOrEqual(0);
      expect(Math.min(...round), `${x}, ${z}`).toBeLessThan(0);
      off.push(Math.abs(terrainHeight(x, z)));
    }
    off.sort((first, second) => first - second);
    expect(off[Math.floor(off.length / 2)]).toBeLessThan(0.05);
    // Every island has a shore drawn round it, inside the round chart.
    for (const island of ISLANDS) {
      const near = points.some(([x, z]) => Math.hypot(x - island.center.x, z - island.center.z) <= Math.max(island.radiusX, island.radiusZ) + 20);
      expect(near, island.id).toBe(true);
      expect(Math.hypot(island.center.x - CHART.centerX, island.center.z - CHART.centerZ), island.id).toBeLessThan(CHART.radius);
    }
  });
});

describe('the fog', () => {
  const { columns, rows } = FOG;
  const seenBlock = (): Uint8Array => {
    const cells = new Uint8Array(columns * rows);
    for (let row = 40; row < 46; row += 1) for (let column = 30; column < 36; column += 1) cells[row * columns + column] = 1;
    return cells;
  };

  it('is clear over the middle of what was seen, closed over the rest, and soft only at the edge', () => {
    const scale = 4;
    const alpha = fogMaskAlpha(seenBlock(), columns, rows, scale);
    const width = columns * scale;
    const pixel = (column: number, row: number): number => alpha[(row * scale + scale / 2) * width + column * scale + scale / 2]!;
    expect(alpha.length).toBe(columns * rows * scale * scale);
    expect(pixel(32, 42)).toBe(255);
    expect(pixel(33, 43)).toBe(255);
    expect(pixel(10, 10)).toBe(0);
    expect(pixel(32, 50)).toBe(0);
    expect(pixel(40, 42)).toBe(0);
    // Nothing seen, nothing shown.
    expect(fogMaskAlpha(new Uint8Array(columns * rows), columns, rows, scale).every((value) => value === 0)).toBe(true);
    // Between the two, only within a cell or so of the block's edge.
    const halfway = [...alpha].findIndex((value) => value > 0 && value < 255);
    const y = Math.floor(halfway / width) / scale;
    const x = (halfway % width) / scale;
    expect(x).toBeGreaterThan(28);
    expect(x).toBeLessThan(38);
    expect(y).toBeGreaterThan(38);
    expect(y).toBeLessThan(48);
  });

  it('is unpacked once per record of the crew\'s chart: the same array while nothing new is seen', () => {
    const first = revealCircle(emptySeen(), 0, 0, 300);
    const cells = seenCells(first);
    expect(seenCells(first)).toBe(cells);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) expect(cells[row * columns + column] === 1).toBe(cellSeen(first, column, row));
    }
    const more = revealCircle(first, 400, 0, 300);
    expect(seenCells(more)).not.toBe(cells);
    expect(lakeSeenShare(seenCells(emptySeen()))).toBe(0);
    expect(lakeSeenShare(seenCells(fullSeen()))).toBe(1);
    expect(lakeSeenShare(seenCells(more))).toBeGreaterThan(0);
  });
});

describe('the minimap', () => {
  const model = (x: number, z: number, headingDegrees = 90): MinimapModel => ({
    x, z, headingDegrees, radiusMetres: 360,
    marks: [{ kind: 'canoe', label: 'Canoe', x: x + 50, z: z - 20, color: '' }],
  });
  const size = 192;

  it('draws nothing new while its player stands still or drifts under a pixel, and draws again after a pixel or a degree', () => {
    const metresPerPixel = 360 / (size / 2);
    const still = minimapKey(model(100, 200), size, 2);
    expect(minimapKey(model(100, 200), size, 2)).toBe(still);
    expect(minimapKey(model(100 + metresPerPixel * 0.3, 200 - metresPerPixel * 0.3), size, 2)).toBe(still);
    expect(minimapKey(model(100 + metresPerPixel * 1.2, 200), size, 2)).not.toBe(still);
    expect(minimapKey(model(100, 200, 91), size, 2)).not.toBe(still);
    // Its view sits on a whole pixel, so the chart slides in whole pixels.
    const view = minimapView(model(100.3, 200.7), size, 2);
    expect(Number.isInteger(Math.round(view.middleX * view.pixelsPerMetre * 1e6) / 1e6)).toBe(true);
    expect(Number.isInteger(Math.round(view.middleZ * view.pixelsPerMetre * 1e6) / 1e6)).toBe(true);
  });

  it('puts a near mark where it is, and pins a far one to the rim at its bearing', () => {
    const view = minimapView(model(0, 0), size, 1);
    const near = minimapPlace(view, size, 90, 0);
    expect(near).toEqual({ x: size / 2 + 24, y: size / 2, pinned: false });
    const east = minimapPlace(view, size, 2000, 0);
    expect(east.pinned).toBe(true);
    expect(east.y).toBe(size / 2);
    expect(east.x).toBeLessThan(size);
    expect(east.x).toBeGreaterThan(size - 16);
    const northWest = minimapPlace(view, size, -1000, -1000);
    expect(northWest.pinned).toBe(true);
    expect(northWest.x).toBe(northWest.y);
    expect(northWest.x).toBeLessThan(size / 2);
  });

  it('flags only the quests on its player\'s own card, and shows the crewmates and the canoe', () => {
    const state = newGame(7, { crew: 2 });
    state.discoveredIslands = ISLANDS.map((island) => island.id);
    // Ready to hand in: each points at the survivor who gave it.
    for (const questId of ['odile_windfall', 'tink_hot_work', 'wren_bell_rope'] as const) state.quests[questId].status = 'ready';
    // Player 0 ashore on the Knoll, the canoe on its beach; player 1 paddled off to the east.
    standOn(state, 'home_knoll');
    state.players[1]!.position = { x: state.players[0]!.position.x + 200, y: 0, z: state.players[0]!.position.z };
    const flagged = (playerId: number): string[] =>
      buildHudModel(state, settings, 0, playerId).minimap.marks.filter((mark) => mark.kind === 'quest').map((mark) => mark.label);
    const questMarks = selectMap(state, 0).markers.filter((marker) => marker.kind === 'quest');
    const flaggable = questMarks.filter((marker) => marker.questId !== 'bail_out' && marker.questId !== null);
    expect(flaggable.length).toBeGreaterThan(0);
    const extra = flaggable[0]!;
    expect(flagged(0)).not.toContain(extra.label);
    expect(dispatch(state, { type: 'track_quest', questId: extra.questId as QuestId }, 0).ok).toBe(true);
    expect(flagged(0)).toContain(extra.label);
    // Player 1 did not pick it: no flag on their minimap.
    expect(flagged(1)).not.toContain(extra.label);
    expect(dispatch(state, { type: 'track_quest', questId: extra.questId as QuestId, tracked: false }, 0).ok).toBe(true);
    expect(flagged(0)).not.toContain(extra.label);
    const marks = buildHudModel(state, settings, 0, 0).minimap.marks;
    expect(marks.filter((mark) => mark.kind === 'crew')).toHaveLength(1);
    expect(marks.filter((mark) => mark.kind === 'canoe')).toHaveLength(1);
    expect(buildHudModel(state, settings, 0, 0).minimap.radiusMetres).toBe(360);
  });
});
