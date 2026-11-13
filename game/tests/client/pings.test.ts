/**
 * Pings on the maps: a click on the map panel's chart marks that spot (or takes down the mark that was clicked),
 * and each standing ping is a mark in its player's colour on the map and the minimap, on the minimap's rim when
 * it is past its edge.
 */
import { describe, expect, it } from 'vitest';
import { CREW_MARKS } from '../../src/data/index.ts';
import { buildInterfaceModel } from '../../src/client/viewmodels/index.ts';
import { CHART, chartPings, valleyChart } from '../../src/client/viewmodels/chart.ts';
import type { ChartPingModel } from '../../src/client/viewmodels/chart.ts';
import type { InterfaceIntent, MinimapModel } from '../../src/client/contracts.ts';
import { createPanelState } from '../../src/client/panels.ts';
import {
  MapChart, PING_GRAB, PING_MARK, chartClick, mapChartView, minimapKey, minimapPlace, minimapView, paintPingMarks, toCanvas,
} from '../../src/interface/chart.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { dispatch } from '../../src/sim/index.ts';
import type { Command } from '../../src/sim/index.ts';
import { newGame, run } from '../support.ts';

const geometry = valleyChart();
const SIZE = 560;

const commandOf = (intent: InterfaceIntent | null): Command | null => (intent && intent.type === 'command' ? intent.command : null);
const ping = (playerId: number, x: number, z: number): ChartPingModel => ({ playerId, x, z, color: CREW_MARKS[playerId]!.toque });

/** Where a world spot is on a chart of `SIZE` pixels, as the map panel draws it. */
const onChart = (x: number, z: number): [number, number] => toCanvas(mapChartView(geometry, SIZE, 1), SIZE, x, z);

describe('a click on the map panel', () => {
  it('marks the very spot under the pointer, to the metre', () => {
    expect(commandOf(chartClick(geometry, [], SIZE, SIZE / 2, SIZE / 2))).toEqual({ type: 'ping', x: CHART.centerX, z: CHART.centerZ });
    for (const [x, z] of [[412, -318], [-907, 1203], [0, 1000], [1100, -25]] as const) {
      const [px, py] = onChart(x, z);
      const command = commandOf(chartClick(geometry, [], SIZE, px, py));
      expect(command, `${x},${z}`).toEqual({ type: 'ping', x, z });
    }
  });

  it('is the same spot whatever size the chart is drawn at', () => {
    for (const size of [331, 560, 1120]) {
      const view = mapChartView(geometry, size, 1);
      const [px, py] = toCanvas(view, size, -640, 850);
      expect(commandOf(chartClick(geometry, [], size, px, py)), String(size)).toEqual({ type: 'ping', x: -640, z: 850 });
    }
  });

  it('does nothing off the round chart: its corners, and a chart with no size yet', () => {
    expect(chartClick(geometry, [], SIZE, 4, 4)).toBeNull();
    expect(chartClick(geometry, [], SIZE, SIZE - 30, SIZE - 30)).toBeNull();
    expect(chartClick(geometry, [], SIZE, SIZE / 2, -1)).toBeNull();
    expect(chartClick(geometry, [], 0, 0, 0)).toBeNull();
    // Just inside the rim it still marks.
    expect(commandOf(chartClick(geometry, [], SIZE, SIZE / 2, 1))?.type).toBe('ping');
  });

  it('takes down the ping whose mark was clicked, a crewmate\'s as well as your own', () => {
    const pings = [ping(0, 300, 300), ping(2, -700, -900)];
    const [ax, ay] = onChart(300, 300);
    const [bx, by] = onChart(-700, -900);
    expect(commandOf(chartClick(geometry, pings, SIZE, ax + 3, ay - 4))).toEqual({ type: 'clear_ping', playerId: 0 });
    expect(commandOf(chartClick(geometry, pings, SIZE, bx - PING_GRAB + 1, by))).toEqual({ type: 'clear_ping', playerId: 2 });
    // A click past the mark's reach marks a new spot beside it.
    expect(commandOf(chartClick(geometry, pings, SIZE, ax + PING_GRAB + 2, ay))?.type).toBe('ping');
  });

  it('picks the nearer of two marks that overlap', () => {
    const pings = [ping(0, 300, 300), ping(1, 330, 300)];
    const [ax, ay] = onChart(300, 300);
    const [bx] = onChart(330, 300);
    expect(bx - ax).toBeLessThan(PING_GRAB);
    expect(commandOf(chartClick(geometry, pings, SIZE, ax - 1, ay))).toEqual({ type: 'clear_ping', playerId: 0 });
    expect(commandOf(chartClick(geometry, pings, SIZE, bx + 1, ay))).toEqual({ type: 'clear_ping', playerId: 1 });
  });
});

describe('the map panel\'s chart, clicked', () => {
  /** A stand-in for the page: a round card holding a canvas 400 pixels a side, its corner at (100, 50). */
  function page() {
    const listeners = new Map<string, (event: unknown) => void>();
    const attributes = new Map<string, string>();
    const card = {
      addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
    };
    const canvas = { parentElement: card, getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 400 }), getContext: () => null };
    const holder = { querySelector: () => canvas } as unknown as HTMLElement;
    return { holder, listeners, attributes };
  }
  const chartOf = (pings: ChartPingModel[]) => ({ geometry, seen: new Uint8Array(1), fullChart: false, pings });

  it('sends the ping for the spot clicked, and says on the card that it can be clicked', () => {
    const sent: InterfaceIntent[] = [];
    const chart = new MapChart();
    chart.listen((intent) => void sent.push(intent));
    const { holder, listeners, attributes } = page();
    chart.follow(holder, chartOf([]));
    expect(attributes.get('title')).toMatch(/mark a spot/);
    listeners.get('click')!({ button: 0, clientX: 300, clientY: 250 });
    expect(sent.map(commandOf)).toEqual([{ type: 'ping', x: CHART.centerX, z: CHART.centerZ }]);
    // The secondary button, and a click in the card's corner, send nothing.
    listeners.get('click')!({ button: 2, clientX: 300, clientY: 250 });
    listeners.get('click')!({ button: 0, clientX: 104, clientY: 54 });
    expect(sent).toHaveLength(1);
  });

  it('sends the clearing when a mark is clicked, and stops listening when the map closes', () => {
    const sent: InterfaceIntent[] = [];
    const chart = new MapChart();
    chart.listen((intent) => void sent.push(intent));
    const { holder, listeners } = page();
    const view = mapChartView(geometry, 400, 1);
    const [px, py] = toCanvas(view, 400, 500, -600);
    chart.follow(holder, chartOf([ping(3, 500, -600)]));
    listeners.get('click')!({ button: 0, clientX: 100 + px, clientY: 50 + py });
    expect(sent.map(commandOf)).toEqual([{ type: 'clear_ping', playerId: 3 }]);
    chart.follow(null, chartOf([]));
    expect(listeners.has('click')).toBe(false);
  });
});

describe('the pings as the chart draws them', () => {
  it('gives each ping its player\'s own colour, the one the crew list knows them by', () => {
    const game = newGame(7, { crew: 4 });
    expect(chartPings(game)).toEqual([]);
    dispatch(game, { type: 'ping', x: 100, z: 100 }, 0);
    dispatch(game, { type: 'ping', x: -200, z: 300 }, 3);
    expect(chartPings(game)).toEqual([
      { playerId: 0, x: 100, z: 100, color: CREW_MARKS[0]!.toque },
      { playerId: 3, x: -200, z: 300, color: CREW_MARKS[3]!.toque },
    ]);
    expect(new Set(CREW_MARKS.map((mark) => mark.toque)).size).toBe(4);
  });

  it('is the same array while no ping changes, and a new one when one does', () => {
    const game = newGame(7, { crew: 2 });
    dispatch(game, { type: 'ping', x: 100, z: 900 }, 0);
    const first = chartPings(game);
    run(game, { paddle: 1 }, 2);
    expect(chartPings(game)).toBe(first);
    dispatch(game, { type: 'clear_ping', playerId: 0 }, 1);
    expect(chartPings(game)).not.toBe(first);
    expect(chartPings(game)).toEqual([]);
  });

  it('rides in the interface model beside the chart, for the map and the minimap alike', () => {
    const game = newGame(7, { crew: 2 });
    dispatch(game, { type: 'ping', x: 100, z: 900 }, 1);
    const model = buildInterfaceModel({
      panels: createPanelState('game'), settings: createDefaultSettings(), game, paused: false, cameraYaw: 0, toasts: [], slots: [],
      latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
    });
    expect(model.chart!.pings).toEqual([{ playerId: 1, x: 100, z: 900, color: CREW_MARKS[1]!.toque }]);
  });
});

describe('a ping on the minimap', () => {
  const model = (x: number, z: number): MinimapModel => ({ x, z, headingDegrees: 0, radiusMetres: 360, marks: [] });
  const size = 192;

  it('sits where it is when it is near, and on the rim at its bearing when it is past the edge', () => {
    const view = minimapView(model(0, 0), size, 1);
    expect(minimapPlace(view, size, 90, -45)).toMatchObject({ pinned: false });
    const far = minimapPlace(view, size, -3000, 0);
    expect(far.pinned).toBe(true);
    expect(far.y).toBe(size / 2);
    expect(far.x).toBeLessThan(size / 2 - 70);
    expect(far.x).toBeGreaterThanOrEqual(0);
  });

  it('is part of what the minimap is drawn from: it repaints when a ping comes, moves a pixel or goes, and not otherwise', () => {
    const bare = minimapKey(model(0, 0), size, 1);
    expect(minimapKey(model(0, 0), size, 1, [])).toBe(bare);
    const one = minimapKey(model(0, 0), size, 1, [ping(1, 90, -45)]);
    expect(one).not.toBe(bare);
    expect(minimapKey(model(0, 0), size, 1, [ping(1, 90, -45)])).toBe(one);
    expect(minimapKey(model(0, 0), size, 1, [ping(1, 90.4, -45.3)])).toBe(one);
    expect(minimapKey(model(0, 0), size, 1, [ping(1, 98, -45)])).not.toBe(one);
    // Another player's ping on the same spot is another colour: another picture.
    expect(minimapKey(model(0, 0), size, 1, [ping(2, 90, -45)])).not.toBe(one);
  });
});

describe('a ping\'s mark', () => {
  it('is filled in its player\'s colour with an ink line round it, where it was put', () => {
    const calls: string[] = [];
    let path: [number, number][] = [];
    const context = {
      lineJoin: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
      beginPath: () => { path = []; },
      moveTo: (x: number, y: number) => void path.push([x, y]),
      lineTo: (x: number, y: number) => void path.push([x, y]),
      closePath: () => {},
      arc: (x: number, y: number) => void path.push([x, y]),
      fill() { calls.push(`fill ${this.fillStyle} ${path.length}`); },
      stroke() { calls.push(`stroke ${this.strokeStyle}`); },
    };
    paintPingMarks(context as unknown as CanvasRenderingContext2D, [{ x: 50, y: 60, color: '#d5a542' }, { x: 120, y: 30, color: '#6b8396' }], 2);
    expect(calls).toEqual([
      'fill #d5a542 8', 'stroke #2a2b33', 'fill #2a2b33 1',
      'fill #6b8396 8', 'stroke #2a2b33', 'fill #2a2b33 1',
    ]);
    // Taller than wide, and big enough to hit: its grab reaches past its own points.
    expect(PING_MARK.tall).toBeGreaterThan(PING_MARK.wide);
    expect(PING_GRAB).toBeGreaterThanOrEqual(PING_MARK.tall);
  });
});
