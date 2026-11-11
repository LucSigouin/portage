/**
 * How the crew is drawn, from each player's own state: who wears what, where
 * each one sits, what each one is doing, and how the pen thins on a far
 * figure. These need no graphics card: they read the figures the canoe view
 * poses, and the pen's law as a plain function.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CREW_MARKS, HULL_TIERS } from '../../src/data/index.ts';
import { createGame, seatTransformForHull } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { makeHullShape } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { HERO_PEN, heroPen } from '../../src/look/b2/post.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf, setLocalPlayerId } from '../../src/look/crew.ts';

const FRAME = 1 / 60;

/** Run the view for a while, as the game does: one sync a frame. */
function run(view: CanoeView, state: GameState, seconds: number, each: (time: number) => void = () => {}): number {
  let dips = 0;
  for (let time = 0; time < seconds; time += FRAME) {
    each(time);
    dips += view.sync(state, crewOf(state), FRAME, time, true, false).length;
  }
  return dips;
}

const figureOf = (view: CanoeView, playerId: number): Figure =>
  (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(playerId)!.figure;

/** Every colour a figure's meshes carry, as hex. */
function coloursOf(view: CanoeView, playerId: number): Set<string> {
  const colours = new Set<string>();
  view.figureOf(playerId)!.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attribute = mesh.geometry.getAttribute('aColor');
    for (let index = 0; index < attribute.count; index += 1) {
      colours.add(`#${new THREE.Color(attribute.getX(index), attribute.getY(index), attribute.getZ(index)).getHexString()}`);
    }
  });
  return colours;
}

/** The box round one mesh of a figure, in the hull's own space (the space the figures sit in). */
function boxOf(view: CanoeView, mesh: THREE.Mesh): THREE.Box3 {
  view.group.updateMatrixWorld(true);
  const hull = view.figureOf(0)!.parent!;
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().copy(hull.matrixWorld).invert().multiply(mesh.matrixWorld));
}

/** A figure's body: every mesh but the paddle. */
function bodyOf(view: CanoeView, playerId: number): THREE.Mesh[] {
  const figure = figureOf(view, playerId);
  const meshes: THREE.Mesh[] = [];
  figure.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh !== figure.paddler.paddle && mesh.visible) meshes.push(mesh);
  });
  return meshes;
}

afterEach(() => setLocalPlayerId(0));

describe('outfits', () => {
  it('follow the player id, whichever player the screen follows', () => {
    for (const local of [0, 2]) {
      setLocalPlayerId(local);
      const state = createGame(7, { crew: 4 });
      const view = new CanoeView();
      view.sync(state, crewOf(state), 0, 0, true, true);
      expect(view.localFigure()).toBe(view.figureOf(local));
      expect(view.figures().map((figure) => figure.id)).toEqual([0, 1, 2, 3]);
      for (const figure of view.figures()) {
        const mark = CREW_MARKS[figure.id];
        expect(figure.coat, `player ${figure.id}, screen of player ${local}`).toBe(mark.coat);
        expect(figure.legs).toBe(mark.legs);
        const colours = coloursOf(view, figure.id);
        for (const colour of [mark.coat, mark.toque, mark.legs]) expect(colours.has(colour), `${colour} on player ${figure.id}`).toBe(true);
      }
      // And it is that player the figure stands in for: whoever sits at a player's seat wears that player's coat.
      for (const player of state.players) {
        expect(view.figures().find((figure) => figure.seat === player.seat)!.coat, `seat of player ${player.id}, screen of player ${local}`).toBe(CREW_MARKS[player.id].coat);
      }
    }
  });

  it('leave player 0 in the lone paddler\'s clothes: ochre coat, red toque, blue-grey legs', () => {
    expect(CREW_MARKS[0]).toMatchObject({ coat: '#d5a542', toque: '#a9483a', legs: '#57697b' });
    const state = createGame(7);
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    const colours = coloursOf(view, 0);
    for (const colour of ['#d5a542', '#a9483a', '#57697b']) expect(colours.has(colour)).toBe(true);
    // Nobody else's coat is on them.
    for (const mark of CREW_MARKS.slice(1)) expect(colours.has(mark.coat)).toBe(false);
  });
});

describe('seats', () => {
  for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
    it(`a crew of four sits at the rules engine's seats on hull tier ${tier}, nobody inside another or the hull`, () => {
      const state = createGame(7, { crew: 4 });
      state.canoe.hullTier = tier;
      const view = new CanoeView();
      view.sync(state, crewOf(state), 0, 0, true, true);
      const figures = view.figures();
      expect(figures.length).toBe(4);
      for (const figure of figures) {
        const seat = seatTransformForHull(tier, state.players[figure.id].seat as number).position;
        expect(figure.seat).toBe(state.players[figure.id].seat);
        expect(figure.position[0]).toBeCloseTo(seat[0], 9);
        expect(figure.position[1]).toBeCloseTo(seat[1] + 0.035, 9);
        expect(figure.position[2]).toBeCloseTo(seat[2], 9);
        // Seats 0 and 1 sit on the cane seats. Seats 2 and 3 kneel between them.
        expect(figure.kneeling).toBe(figure.seat! >= 2);
      }
      // No part of one body is inside a part of another's.
      for (const first of figures) for (const second of figures) {
        if (first.id >= second.id) continue;
        for (const one of bodyOf(view, first.id)) for (const other of bodyOf(view, second.id)) {
          expect(boxOf(view, one).intersectsBox(boxOf(view, other)), `players ${first.id} and ${second.id}`).toBe(false);
        }
      }
      // Nobody is through the hull: every body is above the keel, and every leg is inside the planking.
      const { dimensions } = HULL_TIERS[tier];
      const shape = makeHullShape(dimensions);
      for (const figure of figures) {
        const limbs = figureOf(view, figure.id).paddler;
        for (const mesh of bodyOf(view, figure.id)) expect(boxOf(view, mesh).min.y).toBeGreaterThan(-dimensions.draft);
        for (const side of [limbs.L, limbs.R]) for (const mesh of [side.thigh, side.knee, side.shin, side.boot]) {
          const box = boxOf(view, mesh);
          const station = (box.min.z + box.max.z) / 2;
          expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThan(shape.halfBeamAt(station) - 0.02);
        }
      }
    });
  }

  it('someone aboard without a seat (a staged shot) takes a seat nobody holds', () => {
    const state = createGame(7, { crew: 3 });
    state.players[0].seat = null;
    state.players[1].seat = 0;
    state.players[2].seat = 1;
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    expect(view.figures().map((figure) => figure.seat)).toEqual([2, 0, 1]);
  });
});

describe('what each one is doing', () => {
  it('a drifting canoe shows nobody paddling: the stroke follows each player\'s flag, not the canoe\'s speed', () => {
    const state = createGame(7, { crew: 2 });
    state.canoe.speed = 3;
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    const hand = figureOf(view, 0).paddler.L.H;
    const before = hand.clone();
    expect(run(view, state, 2)).toBe(0);
    expect(view.figures().map((figure) => figure.paddling)).toEqual([0, 0]);
    expect(hand.distanceTo(before)).toBe(0);
    // Player 1 takes a stroke on a canoe that is standing still: they paddle, player 0 does not.
    state.canoe.speed = 0;
    state.players[1].paddling = true;
    const other = figureOf(view, 1).paddler.L.H;
    const otherBefore = other.clone();
    let reach = 0;
    const dips = run(view, state, 2, () => { reach = Math.max(reach, other.distanceTo(otherBefore)); });
    const [stern, bow] = view.figures();
    expect(stern.paddling).toBe(0);
    expect(bow.paddling).toBeGreaterThan(0.99);
    expect(reach).toBeGreaterThan(0.3);
    expect(dips).toBeGreaterThan(0);
    expect(hand.distanceTo(before)).toBe(0);
    // They stop: the paddle comes back to rest.
    state.players[1].paddling = false;
    run(view, state, 2);
    expect(view.figures()[1].paddling).toBeLessThan(0.01);
  });

  it('crewmates paddle on alternating sides, counted along the hull from the stern', () => {
    const four = createGame(7, { crew: 4 });
    for (const player of four.players) player.paddling = true;
    const view = new CanoeView();
    view.sync(four, crewOf(four), 0, 0, true, true);
    const side = (seat: number): number => view.figures().find((figure) => figure.seat === seat)!.side;
    // Along the hull the seats run 0 (stern), 2, 3, 1 (bow).
    expect([side(0), side(2), side(3), side(1)]).toEqual([side(0), -side(0), side(0), -side(0)]);
    const two = createGame(7, { crew: 2 });
    const pair = new CanoeView();
    pair.sync(two, crewOf(two), 0, 0, true, true);
    expect(pair.figures()[1].side).toBe(-pair.figures()[0].side);
  });

  it('bailing and sleeping aboard follow the player who does them', () => {
    const state = createGame(7, { crew: 3 });
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    state.players[1].bailing = true;
    state.players[2].asleep = true;
    // The hand on the side they bail over holds the tin; the other braces on the far gunwale.
    const limbs = figureOf(view, 1).paddler;
    const hand = view.figures()[1].side > 0 ? limbs.L.H : limbs.R.H;
    const start = hand.clone();
    let reach = 0;
    run(view, state, 2, () => { reach = Math.max(reach, hand.distanceTo(start)); });
    const [first, second, third] = view.figures();
    expect([first.bailing, first.asleep, first.paddling]).toEqual([0, 0, 0]);
    expect(second.bailing).toBeGreaterThan(0.99);
    expect(second.asleep).toBe(0);
    expect(third.asleep).toBeGreaterThan(0.99);
    expect(third.bailing).toBe(0);
    // The bailer's hand works between the bilge and the gunwale; their tin is in the picture.
    expect(reach).toBeGreaterThan(0.25);
    expect(bodyOf(view, 1).length).toBe(bodyOf(view, 0).length + 1);
    state.players[1].bailing = false;
    run(view, state, 2);
    expect(view.figures()[1].bailing).toBeLessThan(0.01);
    expect(bodyOf(view, 1).length).toBe(bodyOf(view, 0).length);
  });

  it('a sleeper ashore lies down, and gets up again', () => {
    const state = createGame(7, { crew: 2 });
    const ground = { x: state.canoe.position.x + 4, y: 1, z: state.canoe.position.z };
    Object.assign(state.players[1], { mode: 'foot', seat: null, position: ground });
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    const root = view.figureOf(1)!;
    expect(root.rotation.x).toBeCloseTo(0, 9);
    state.players[1].asleep = true;
    run(view, state, 2);
    expect(view.figures()[1].asleep).toBeGreaterThan(0.99);
    expect(root.rotation.x).toBeCloseTo(-Math.PI / 2, 2);
    expect(root.position.y).toBeGreaterThan(ground.y + 0.1);
    state.players[1].asleep = false;
    run(view, state, 2);
    expect(Math.abs(root.rotation.x)).toBeLessThan(0.01);
  });

  it('each player walks by their own change in position, the local one included', () => {
    const state = createGame(7, { crew: 2 });
    state.players.forEach((player, index) => {
      Object.assign(player, { mode: 'foot', seat: null, position: { x: state.canoe.position.x + 4 + index, y: 1, z: state.canoe.position.z } });
    });
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    // The game's shared counter runs on, but nobody moves: nobody walks.
    run(view, state, 1, () => { state.statistics.distanceWalked += 0.05; });
    expect(view.figures().map((figure) => [figure.walking, figure.stride])).toEqual([[0, 0], [0, 0]]);
    // Player 1 walks. Player 0, whom the screen follows, stands.
    run(view, state, 1, () => { state.players[1].position.x += 0.03; });
    let [local, mate] = view.figures();
    expect([local.walking, local.stride]).toEqual([0, 0]);
    expect(mate.walking).toBeGreaterThan(0.9);
    // 1.8 m at 1.5 m a stride.
    expect(mate.stride).toBeCloseTo((1.8 / 1.5) * Math.PI * 2, 1);
    // Now the local player walks and the mate stops.
    const strideBefore = mate.stride;
    run(view, state, 1, () => { state.players[0].position.z += 0.03; });
    [local, mate] = view.figures();
    expect(local.walking).toBeGreaterThan(0.9);
    expect(local.stride).toBeGreaterThan(5);
    expect(mate.walking).toBeLessThan(0.01);
    expect(mate.stride).toBe(strideBefore);
  });

  it('stepping out of the canoe is not a stride', () => {
    const state = createGame(7);
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    Object.assign(state.players[0], { mode: 'foot', seat: null, position: { x: state.canoe.position.x + 2, y: 1, z: state.canoe.position.z + 1 } });
    run(view, state, 0.5);
    expect(view.figures()[0].stride).toBe(0);
  });
});

describe('the pen on a far hero', () => {
  // The world the window's height covers at a depth, at the game's 60 degree field of view.
  const span = (metres: number): number => 2 * Math.tan(Math.PI / 6) * metres;

  it('is the full pen at every normal play distance', () => {
    // Walking camera 6 m out, canoe camera 8.5 m, the staged full canoe 10.5 m out with the long hull's far end 3.3 m past that.
    for (const metres of [0, 2.5, 6, 8, 8.5, 10.5, 13.8]) expect(heroPen(span(metres)), `${metres} m`).toBe(1);
    expect(heroPen(HERO_PEN.start)).toBe(1);
  });

  it('thins as the hero gets small: half its width with the walking camera fully out, never under its floor', () => {
    expect(heroPen(span(18))).toBeGreaterThan(0.4);
    expect(heroPen(span(18))).toBeLessThan(0.55);
    expect(heroPen(span(28))).toBeLessThan(0.35);
    for (let metres = 0; metres < 400; metres += 0.5) {
      expect(heroPen(span(metres))).toBeGreaterThanOrEqual(HERO_PEN.floor);
      expect(heroPen(span(metres))).toBeLessThanOrEqual(1);
    }
  });

  it('changes smoothly with zoom: no step, no kink where it starts, never back up', () => {
    let last = heroPen(0);
    let steepest = 0;
    for (let metres = 0.01; metres < 60; metres += 0.01) {
      const pen = heroPen(span(metres));
      expect(pen).toBeLessThanOrEqual(last);
      steepest = Math.max(steepest, last - pen);
      last = pen;
    }
    // A centimetre of zoom never moves the pen by more than a fifth of a percent of its width.
    expect(steepest).toBeLessThan(0.002);
    // It leaves the full pen without a corner: the first centimetres past the start change next to nothing.
    expect(heroPen(HERO_PEN.start + 0.05)).toBeGreaterThan(0.9995);
  });
});
