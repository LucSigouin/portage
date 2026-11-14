/**
 * Ashore, as Luc asked (bugfix list, items 11 and 16): "I don't need to have the paddle with me" on land, and "when
 * we have the tool in our hand that's what the character has in their hand".
 *
 * - Stepping ashore, the paddle stays in the canoe, laid across the gunwales at the seat; boarding, it is in the
 *   hands again.
 * - The tool the player picked is drawn in the right hand, each crewmate their own; none when none is picked, none
 *   aboard (the paddle wins), none asleep.
 * - Standing still is still: two frames apart draw the figure the same.
 *
 * All of it for each of the cast (`look/cast.ts`): the whole crew drawn as that one person.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HULL_TIERS, TOOL_IDS } from '../../src/data/index.ts';
import type { ToolId } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { createCrew } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { HAND_TOOLS, buildHandTool, toolInkIds } from '../../src/look/hand-tools.ts';
import { SAME, castAs } from './cast-lineups.ts';

const FRAME = 1 / 60;

function run(view: CanoeView, state: GameState, seconds: number, start = 0): void {
  for (let time = start; time < start + seconds; time += FRAME) view.sync(state, crewOf(state), FRAME, time, true, false);
}

const figureOf = (view: CanoeView, playerId: number): Figure =>
  (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(playerId)!.figure;

/** Put a player on the ground beside the canoe, `metres` out to the side. */
function ashore(state: GameState, playerId: number, metres = 4): void {
  Object.assign(state.players[playerId], { mode: 'foot', seat: null, position: { x: state.canoe.position.x + metres, y: 1, z: state.canoe.position.z } });
}

/** True when `object` is `ancestor` or sits under it. */
function under(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = object; at; at = at.parent) if (at === ancestor) return true;
  return false;
}

/** Drawn: it and everything above it are visible. */
function drawn(object: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = object; at; at = at.parent) if (!at.visible) return false;
  return true;
}

/** The tools drawn in a figure's hands right now. */
function toolsShown(view: CanoeView, playerId: number): string[] {
  const names: string[] = [];
  view.figureOf(playerId)!.traverse((object) => {
    if (object.name.startsWith('tool:') && drawn(object)) names.push(object.name.slice(5));
  });
  return names;
}

/** Where every mesh of a figure is drawn, as one list of numbers. */
function poseOf(view: CanoeView, playerId: number): number[] {
  const root = view.figureOf(playerId)!;
  root.updateMatrixWorld(true);
  const numbers: number[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && drawn(object)) numbers.push(...object.matrixWorld.elements);
  });
  return numbers;
}

/** The box round a mesh as drawn, in the world. */
function worldBox(mesh: THREE.Object3D): THREE.Box3 {
  mesh.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(mesh, true);
}

for (const lineup of SAME) {
describe(`${lineup.name}: ashore, the paddle stays in the canoe`, () => {
  it('stepping out, the paddle is no longer carried: it lies across the gunwales at the seat, and comes back aboard', () => {
    const state = castAs(createGame(7), lineup);
    const view = new CanoeView();
    run(view, state, 0.5);
    const figure = figureOf(view, 0);
    const paddle = figure.paddler.paddle;
    expect(view.figures()[0].paddle).toBe('hands');
    expect(under(paddle, figure.root) && drawn(paddle)).toBe(true);

    ashore(state, 0);
    run(view, state, 0.5, 0.5);
    // Not in the figure's hands, nor anywhere under it: in the canoe, drawn.
    expect(under(paddle, figure.root)).toBe(false);
    expect(under(paddle, view.group) && drawn(paddle)).toBe(true);
    expect(view.figures()[0].paddle).toBe('canoe');
    // It lies across the hull at gunwale height, in the canoe's own outline give or take its blade over the side.
    const box = worldBox(paddle);
    const canoe = state.canoe.position;
    const dimensions = HULL_TIERS[state.canoe.hullTier].dimensions;
    expect(Math.hypot((box.min.x + box.max.x) / 2 - canoe.x, (box.min.z + box.max.z) / 2 - canoe.z)).toBeLessThan(dimensions.length / 2);
    expect(box.max.y - canoe.y).toBeLessThan(dimensions.depth);
    expect(box.min.y - canoe.y).toBeGreaterThan(-dimensions.draft);
    // Lying flat: its long side is level.
    expect(box.max.y - box.min.y).toBeLessThan(0.2);

    // Back aboard: in the hands again.
    Object.assign(state.players[0], { mode: 'canoe', seat: 0, position: { ...canoe } });
    run(view, state, 0.5, 1);
    expect(under(paddle, figure.root) && drawn(paddle)).toBe(true);
    expect(view.figures()[0].paddle).toBe('hands');
  });

  it('a crew ashore leave one paddle each, at their own seats, and a seat someone sits in has none', () => {
    const state = castAs(createGame(7, { crew: 4 }), lineup);
    const view = new CanoeView();
    run(view, state, 0.2);
    for (const id of [0, 1, 2, 3]) ashore(state, id, 3 + id);
    run(view, state, 0.2, 0.2);
    expect(view.figures().map((figure) => figure.paddle)).toEqual(['canoe', 'canoe', 'canoe', 'canoe']);
    const centres = [0, 1, 2, 3].map((id) => worldBox(figureOf(view, id).paddler.paddle).getCenter(new THREE.Vector3()));
    for (let first = 0; first < 4; first += 1) {
      for (let second = first + 1; second < 4; second += 1) expect(centres[first].distanceTo(centres[second])).toBeGreaterThan(0.3);
    }
    // Player 3 comes back aboard into player 1's seat: player 1's paddle is not drawn on them.
    Object.assign(state.players[3], { mode: 'canoe', seat: 1, position: { ...state.canoe.position } });
    run(view, state, 0.2, 0.4);
    const [, second, , fourth] = view.figures();
    expect(fourth.paddle).toBe('hands');
    expect(second.paddle).toBe(null);
    expect(drawn(figureOf(view, 1).paddler.paddle)).toBe(false);
  });

  it('a figure standing on its own, as the asset viewer draws one walking, carries no paddle; seated, it has it again', () => {
    const figure = createCrew(undefined, lineup.cast[0]);
    figure.paddle(1, 0.2, 1, 1);
    expect(figure.paddler.paddle.visible).toBe(true);
    figure.stand(0, 1.4, 1, 0);
    expect(figure.paddler.paddle.visible).toBe(false);
    figure.paddle(1, 0.2, 1, 1);
    expect(figure.paddler.paddle.visible).toBe(true);
  });

  it('the paddle left aboard is hidden with the crew, as a staged picture without the paddlers wants', () => {
    const state = castAs(createGame(7), lineup);
    ashore(state, 0);
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, false, true);
    expect(drawn(figureOf(view, 0).paddler.paddle)).toBe(false);
  });
});

describe(`${lineup.name}: ashore, the picked tool is in the hand`, () => {
  it('every tool there is has a drawing, bigger than the fist round it, and no two drawings the same shape', () => {
    expect([...HAND_TOOLS].sort()).toEqual([...TOOL_IDS].sort());
    const looks = HAND_TOOLS.map((tool) => {
      const mesh = buildHandTool(tool);
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      return { tool, size };
    });
    for (const one of looks) {
      // Bigger than the mitt that closes on it (12 cm across), so it shows past the hand.
      expect(Math.max(one.size.x, one.size.y, one.size.z), one.tool).toBeGreaterThan(0.15);
      for (const other of looks) {
        if (other === one) continue;
        // Each is its own outline: some side of its box differs from every other's by more than 2 cm.
        const apart = Math.max(Math.abs(one.size.x - other.size.x), Math.abs(one.size.y - other.size.y), Math.abs(one.size.z - other.size.z));
        expect(apart, `${one.tool} and ${other.tool}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('shows the picked tool in the right hand, each one in turn, and nothing with none picked', () => {
    const state = castAs(createGame(7), lineup);
    ashore(state, 0);
    const view = new CanoeView();
    state.players[0].selectedTool = null;
    run(view, state, 0.2);
    expect(toolsShown(view, 0)).toEqual([]);
    expect(view.figures()[0].holding).toBe(null);
    for (const tool of TOOL_IDS) {
      state.players[0].selectedTool = tool;
      run(view, state, 0.1);
      expect(toolsShown(view, 0)).toEqual([tool]);
      expect(view.figures()[0].holding).toBe(tool);
      // In the right hand (the figure's -x), at the fist.
      const hand = figureOf(view, 0).paddler.R.H;
      let held: THREE.Object3D | null = null;
      view.figureOf(0)!.traverse((object) => { if (object.name === `tool:${tool}`) held = object; });
      expect(held!.position.distanceTo(hand)).toBeLessThan(1e-9);
      expect(hand.x).toBeLessThan(-0.15);
    }
    state.players[0].selectedTool = null;
    run(view, state, 0.1);
    expect(toolsShown(view, 0)).toEqual([]);
  });

  it('each crewmate holds their own, with their own ink: two tools side by side are two outlines', () => {
    const state = castAs(createGame(7, { crew: 4 }), lineup);
    const picks: (ToolId | null)[] = ['hatchet', 'fishing_rod', null, 'hatchet'];
    picks.forEach((tool, id) => {
      ashore(state, id, 3 + id);
      state.players[id].selectedTool = tool;
    });
    const view = new CanoeView();
    run(view, state, 0.2);
    expect(view.figures().map((figure) => figure.holding)).toEqual(picks);
    picks.forEach((tool, id) => expect(toolsShown(view, id)).toEqual(tool ? [tool] : []));
    // The ink each one's tool is drawn in, as held. Wires and lines (THIN) are never outlined, so they may share.
    const inkOf = (id: number): Set<number> => {
      const ink = new Set<number>();
      view.figureOf(id)!.traverse((object) => {
        if (!object.name.startsWith('tool:') || !drawn(object)) return;
        const info = (object as THREE.Mesh).geometry.getAttribute('aInfo');
        for (let index = 0; index < info.count; index += 1) if (Math.round(info.getX(index) * 2048) !== 2040) ink.add(info.getX(index));
      });
      return ink;
    };
    const held = [0, 1, 3].map(inkOf);
    for (const ink of held) expect(ink.size).toBeGreaterThan(0);
    for (let first = 0; first < held.length; first += 1) {
      for (let second = first + 1; second < held.length; second += 1) for (const id of held[first]) expect(held[second].has(id)).toBe(false);
    }
    // And the ids each crewmate's tools may use are theirs alone.
    const owners = [0, 1, 2, 3].map((id) => new Set(toolInkIds(id)));
    for (let first = 0; first < 4; first += 1) {
      for (let second = first + 1; second < 4; second += 1) for (const id of owners[first]) expect(owners[second].has(id)).toBe(false);
    }
  });

  it('draws its pieces in ink the shared counter never hands out, so no tool merges into the mitt that holds it', () => {
    for (const owner of [0, 1, 2, 3]) {
      for (const tool of HAND_TOOLS) {
        const info = buildHandTool(tool, owner).geometry.getAttribute('aInfo');
        for (let index = 0; index < info.count; index += 1) {
          const n = info.getX(index) * 2048;
          // Whole elevenths of the ink buffer, inside what the pen calls solid; THIN (2040) for wires and lines.
          expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
          if (Math.round(n) === 2040) continue;
          expect(n >= 5 && n <= 2036, `${tool}: ${n}`).toBe(true);
          expect(n < 16 || n > 2018, `${tool}: ${n}`).toBe(true);
        }
      }
    }
  });

  it('puts nothing in the hand aboard, where the paddle wins, nor asleep', () => {
    const state = castAs(createGame(7), lineup);
    state.players[0].selectedTool = 'hatchet';
    const view = new CanoeView();
    run(view, state, 0.2);
    expect(toolsShown(view, 0)).toEqual([]);
    expect(view.figures()[0].holding).toBe(null);
    ashore(state, 0);
    run(view, state, 0.2);
    expect(toolsShown(view, 0)).toEqual(['hatchet']);
    state.players[0].asleep = true;
    run(view, state, 2);
    expect(toolsShown(view, 0)).toEqual([]);
  });

  it('carries the tool clear of the legs, standing', () => {
    for (const tool of TOOL_IDS) {
      const state = castAs(createGame(7), lineup);
      ashore(state, 0);
      state.players[0].selectedTool = tool;
      const view = new CanoeView();
      run(view, state, 0.2);
      const figure = figureOf(view, 0);
      let held: THREE.Object3D | null = null;
      view.figureOf(0)!.traverse((object) => { if (object.name === `tool:${tool}`) held = object; });
      const box = worldBox(held!);
      for (const limb of [figure.paddler.R.thigh, figure.paddler.R.shin, figure.paddler.L.thigh, figure.paddler.L.shin]) {
        expect(box.intersectsBox(worldBox(limb).expandByScalar(-0.01)), `${tool} and a leg`).toBe(false);
      }
    }
  });
});

describe(`${lineup.name}: standing still is still`, () => {
  it('two frames 0.3 s apart draw a figure standing ashore the same, empty-handed or holding a tool', () => {
    for (const tool of [null, 'stone_knife'] as (ToolId | null)[]) {
      const state = castAs(createGame(7), lineup);
      ashore(state, 0);
      state.players[0].selectedTool = tool;
      const view = new CanoeView();
      run(view, state, 1);
      const first = poseOf(view, 0);
      run(view, state, 0.3, 1);
      expect(poseOf(view, 0)).toEqual(first);
    }
  });
});
}
