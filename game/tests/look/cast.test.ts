/**
 * The cast (`look/cast.ts`): four people on one rig. Read from the figures themselves, with no graphics card.
 *
 * - The voyageur is the paddler as `createPaddler` has always made it: not a vertex, not a colour differs.
 * - The other three are the same rig redrawn: the same meshes, their own torso scale, the seat's colours on the
 *   coat, the legs and the head.
 * - Told apart in solid black: each one's outline against each other one's, and against the three survivors'.
 *   (All four stand on one rig: the arms and the legs are in the same place, so half of any two shapes is shared.)
 * - What each one wears and carries stays out of their own arms, legs and paddle, and out of everyone in the next
 *   seat, on every hull: at rest, through the pull of the stroke, bailing and asleep. Through the whole stroke, the
 *   recovery included, nothing of their own touches it either, and the paddler's own hands stay off the paddler's
 *   own head and chest (the stroke was redrawn: its hands went 12.5 cm into the head, and that was this test's
 *   yardstick). One thing is let through by name: the trapper's forearm brushes the front of his own beard.
 * - Ashore: standing, walking, running, jumping, with each tool in hand, and asleep.
 * - A player who comes back as someone else gets a new figure, and the old one is disposed of.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CREW_MARKS, HULL_TIERS, NPC_IDS, TOOL_IDS, characterOf } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import { LEAP_AIR_STEPS, LEAP_LAND_STEPS, createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { createCrew } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { inkMaterial } from '../../src/look/b2/palette.js';
import { CREW_LAYER } from '../../src/look/b2/post.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { CAST_BUILD } from '../../src/look/cast.ts';
import { buildCharacter } from '../../src/look/characters.ts';
import { crewOf } from '../../src/look/crew.ts';
import { jumpPose } from '../../src/look/jump-pose.ts';
import { clearance, partsOf, tightest } from './cast-clearance.ts';
import type { Capsule, Nearest } from './cast-clearance.ts';
import { LINEUPS, SAME, castAs } from './cast-lineups.ts';

const OTHERS = CHARACTER_IDS.filter((id) => id !== 'voyageur');
const membersOf = (view: CanoeView): Map<number, { figure: Figure; character: CharacterId; seat: number | null }> =>
  (view as unknown as { members: Map<number, { figure: Figure; character: CharacterId; seat: number | null }> }).members;

/** Every mesh under a figure, in the order it was made. */
function meshesOf(figure: Figure): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  figure.root.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  return meshes;
}

const torsoMesh = (figure: Figure): THREE.Mesh => figure.root.children[0].children[0] as THREE.Mesh;

/** Every colour a mesh carries, as hex, with how many vertices carry it. */
function coloursOf(mesh: THREE.Mesh, keep: (index: number) => boolean = () => true): Map<string, number> {
  const colours = new Map<string, number>();
  const attribute = mesh.geometry.getAttribute('aColor');
  for (let index = 0; index < attribute.count; index += 1) {
    if (!keep(index)) continue;
    const hex = `#${new THREE.Color(attribute.getX(index), attribute.getY(index), attribute.getZ(index)).getHexString()}`;
    colours.set(hex, (colours.get(hex) ?? 0) + 1);
  }
  return colours;
}

describe('the voyageur is the paddler, untouched', () => {
  it('asked for by name, by nobody, or by a word that is no one: the same figure, vertex for vertex and colour for colour, in every seat\'s colours', () => {
    for (const mark of CREW_MARKS) {
      const outfit = { coat: mark.coat, toque: mark.toque, legs: mark.legs };
      const plain = meshesOf(createCrew(outfit));
      for (const who of ['voyageur', undefined, 'nobody', 7] as unknown as CharacterId[]) {
        const figure = createCrew(outfit, who);
        const meshes = meshesOf(figure);
        expect(meshes.length).toBe(plain.length);
        expect(figure.root.children[0].scale.toArray()).toEqual([1, 1, 1]);
        meshes.forEach((mesh, index) => {
          for (const name of ['position', 'normal', 'aColor'] as const) {
            expect(Array.from(mesh.geometry.getAttribute(name).array), `${String(who)}: mesh ${index} ${name}`).toEqual(Array.from(plain[index].geometry.getAttribute(name).array));
          }
        });
      }
    }
  });

  it('a game where nobody has picked draws player 0 as the voyageur, and says who each figure is', () => {
    const state = createGame(7, { crew: 4 });
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    expect(view.figures()[0].character).toBe('voyageur');
    expect(view.figures().map((figure) => figure.character)).toEqual(state.players.map((player) => characterOf(player)));
    // And a pick is what is drawn.
    state.players[0].character = 'scout';
    view.sync(state, crewOf(state), 0, 0, true, true);
    expect(view.figures()[0].character).toBe('scout');
  });
});

describe('the other three are the same rig, redrawn', () => {
  for (const who of OTHERS) {
    it(`the ${who}: the paddler's meshes, their own torso, every piece on the crew's layer and drawn with the look's one material`, () => {
      const plain = meshesOf(createCrew());
      const figure = createCrew(undefined, who);
      const meshes = meshesOf(figure);
      expect(meshes.length).toBe(plain.length);
      expect(figure.root.children[0].scale.toArray()).toEqual([...CAST_BUILD[who].scale]);
      for (const mesh of meshes) {
        expect(mesh.layers.isEnabled(CREW_LAYER)).toBe(true);
        expect(mesh.material).toBe(inkMaterial);
        for (const name of ['position', 'normal', 'aColor', 'aInfo', 'aTex']) expect(mesh.geometry.getAttribute(name), name).toBeDefined();
        const positions = mesh.geometry.getAttribute('position').array as Float32Array;
        expect(positions.every((value) => Number.isFinite(value))).toBe(true);
      }
      // Their own drawing: the torso is not the paddler's.
      expect(torsoMesh(figure).geometry.getAttribute('position').count).not.toBe(plain[0].geometry.getAttribute('position').count);
    });

    it(`the ${who} in each seat's colours: the coat on the sleeves, the legs on the trousers, the seat's own colour on the head`, () => {
      const [, sy] = CAST_BUILD[who].scale;
      for (const mark of CREW_MARKS) {
        const figure = createCrew({ coat: mark.coat, toque: mark.toque, legs: mark.legs }, who);
        for (const side of [figure.paddler.L, figure.paddler.R]) {
          expect([...coloursOf(side.upper).keys()]).toEqual([mark.coat]);
          expect(coloursOf(side.thigh).has(mark.legs)).toBe(true);
        }
        // From the brow up (the top 20 cm of the figure), the headgear: a fifth of it or more is the seat's colour.
        const torso = torsoMesh(figure);
        const positions = torso.geometry.getAttribute('position');
        const head = coloursOf(torso, (index) => positions.getY(index) * sy > CAST_BUILD[who].top - 0.2);
        const total = [...head.values()].reduce((sum, count) => sum + count, 0);
        expect((head.get(mark.toque) ?? 0) / total, `${who}, ${mark.label}`).toBeGreaterThan(0.2);
        // And that colour is the highest thing on the figure, give or take a hand: what the camera sees from above.
        let top = -Infinity;
        let topOfColour = -Infinity;
        const colours = torso.geometry.getAttribute('aColor');
        const wanted = new THREE.Color(mark.toque);
        for (let index = 0; index < positions.count; index += 1) {
          const y = positions.getY(index) * sy;
          top = Math.max(top, y);
          if (Math.abs(colours.getX(index) - wanted.r) + Math.abs(colours.getY(index) - wanted.g) + Math.abs(colours.getZ(index) - wanted.b) < 1e-4) topOfColour = Math.max(topOfColour, y);
        }
        expect(top - topOfColour).toBeLessThan(0.1);
        expect(top).toBeCloseTo(CAST_BUILD[who].top, 2);
      }
    });
  }
});

/** A figure filled in solid black on a grid of 3 cm squares: seen from the front (x, y) or from the side (z, y). */
function blackOf(root: THREE.Object3D, from: 'front' | 'side'): Uint8Array {
  const [cell, columns, rows] = [0.03, 48, 72];
  const black = new Uint8Array(columns * rows);
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute('position');
    const flat = (point: THREE.Vector3): [number, number] => [((from === 'front' ? point.x : point.z) + 0.72) / cell, point.y / cell];
    for (let index = 0; index + 2 < positions.count; index += 3) {
      const [p, q, r] = [a, b, c].map((point, corner) => flat(point.fromBufferAttribute(positions, index + corner).applyMatrix4(mesh.matrixWorld)));
      const area = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let row = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1]))); row <= Math.min(rows - 1, Math.floor(Math.max(p[1], q[1], r[1]))); row += 1) {
        for (let column = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0]))); column <= Math.min(columns - 1, Math.floor(Math.max(p[0], q[0], r[0]))); column += 1) {
          const [x, y] = [column + 0.5, row + 0.5];
          const u = ((q[0] - x) * (r[1] - y) - (q[1] - y) * (r[0] - x)) / area;
          const v = ((r[0] - x) * (p[1] - y) - (r[1] - y) * (p[0] - x)) / area;
          if (u >= 0 && v >= 0 && u + v <= 1) black[row * columns + column] = 1;
        }
      }
    }
  });
  return black;
}

/** The share of two black shapes that is in one and not the other: 0 the same shape, 1 nothing in common. */
function apart(one: Uint8Array, other: Uint8Array): number {
  let [either, differ] = [0, 0];
  for (let index = 0; index < one.length; index += 1) {
    if (one[index] || other[index]) either += 1;
    if (one[index] !== other[index]) differ += 1;
  }
  return differ / either;
}

/** One of the cast standing ashore, empty-handed, facing +z with its feet on the ground. */
function standing(who: CharacterId): Figure {
  const figure = createCrew(undefined, who);
  figure.stand(0);
  return figure;
}

describe('four people, told apart in solid black', () => {
  const shapes = CHARACTER_IDS.map((who) => {
    const figure = standing(who);
    const box = new THREE.Box3();
    figure.root.updateMatrixWorld(true);
    figure.root.traverseVisible((object) => { if ((object as THREE.Mesh).isMesh) box.union(new THREE.Box3().setFromObject(object, true)); });
    return { who, front: blackOf(figure.root, 'front'), side: blackOf(figure.root, 'side'), box, body: new THREE.Box3().setFromObject(torsoMesh(figure), true) };
  });

  it('each one\'s outline differs from each other one\'s, from the front (and so from behind) and from the side', () => {
    const pairs = shapes.flatMap((one) => shapes.filter((other) => one.who < other.who).map((other) => ({ names: `${one.who} and ${other.who}`, front: apart(one.front, other.front), side: apart(one.side, other.side) })));
    for (const pair of pairs) console.log(`CAST black: ${pair.names}: ${(pair.front * 100).toFixed(0)}% of the two shapes differs from the front, ${(pair.side * 100).toFixed(0)}% from the side`);
    expect(pairs.length).toBe(6);
    // A fifth or more of the two shapes laid over each other belongs to one alone, either way round. The four stand
    // on one rig, so their arms and legs lie over each other: the fifth is all body, head, headgear and what is carried.
    for (const pair of pairs) {
      expect(pair.front, `${pair.names}, front`).toBeGreaterThan(0.2);
      expect(pair.side, `${pair.names}, side`).toBeGreaterThan(0.2);
    }
  });

  it('the angler stands tallest and the scout shortest, and the trapper\'s body is the widest', () => {
    // Wide: the body with what is on it. (The arms hang in the same place on all four.)
    const size = Object.fromEntries(shapes.map((shape) => [shape.who, { tall: shape.box.max.y, wide: shape.body.max.x - shape.body.min.x }]));
    console.log(`CAST sizes: ${shapes.map((shape) => `${shape.who} ${size[shape.who].tall.toFixed(2)} m tall, ${size[shape.who].wide.toFixed(2)} m wide`).join('; ')}`);
    expect(size.angler.tall).toBeGreaterThan(size.voyageur.tall + 0.03);
    expect(size.angler.tall).toBeGreaterThan(size.trapper.tall + 0.03);
    expect(size.scout.tall).toBeLessThan(size.voyageur.tall - 0.08);
    expect(size.scout.tall).toBeLessThan(size.trapper.tall - 0.08);
    expect(size.trapper.wide).toBeGreaterThan(size.voyageur.wide + 0.06);
    expect(size.trapper.wide).toBeGreaterThan(size.angler.wide + 0.06);
    expect(size.trapper.wide).toBeGreaterThan(size.scout.wide + 0.06);
  });

  it('none is a survivor\'s outline either: each differs from Odile\'s, Wren\'s and Tink\'s by more than a quarter', () => {
    for (const npc of NPC_IDS) {
      const survivor = buildCharacter(npc);
      // A survivor faces -z: turned round to face the same way.
      survivor.rotation.y = Math.PI;
      const [front, side] = [blackOf(survivor, 'front'), blackOf(survivor, 'side')];
      for (const shape of shapes) {
        if (shape.who === 'voyageur') continue;
        console.log(`CAST black: ${shape.who} and the survivor ${npc}: ${(apart(shape.front, front) * 100).toFixed(0)}% front, ${(apart(shape.side, side) * 100).toFixed(0)}% side`);
      }
      for (const shape of shapes) {
        if (shape.who === 'voyageur') continue;
        expect(apart(shape.front, front), `${shape.who} and ${npc}, front`).toBeGreaterThan(0.25);
        expect(apart(shape.side, side), `${shape.who} and ${npc}, side`).toBeGreaterThan(0.25);
      }
    }
  });
});

/** The deepest any of a figure's own forearms, hands or paddle goes into its own body or head: the paddler's own fault line. */
function ownDepth(figure: Figure, character: CharacterId): number {
  const parts = partsOf(figure, character);
  let deepest = Infinity;
  for (const body of parts.body) for (const other of [...parts.reach.filter((part) => /forearm|hand/.test(part.name)), ...parts.paddle]) deepest = Math.min(deepest, clearance(body, other));
  return deepest;
}

describe('aboard, what each one wears and carries stays clear', () => {
  /** A crew posed on one side, with no change of side: `each` is called at rest, through a stroke, bailing and asleep. */
  function poses(lineup: (typeof LINEUPS)[number], tier: number, side: number, each: (view: CanoeView, when: string, stroke: number | null) => void): void {
    const state: GameState = castAs(createGame(7, { crew: 4 }), lineup);
    state.canoe.hullTier = tier;
    const view = new CanoeView();
    (view as unknown as { side: number }).side = side;
    const pose = (snap: boolean, seconds = 0): void => { view.sync(state, crewOf(state), seconds, 0, true, snap); view.group.updateMatrixWorld(true); };
    pose(true);
    each(view, 'at rest', null);
    for (const player of state.players) player.paddling = true;
    pose(true);
    for (let step = 0; step < 100; step += 2) {
      (view as unknown as { phase: number }).phase = step / 100;
      pose(false);
      each(view, `stroke ${step}`, step / 100);
    }
    for (const player of state.players) Object.assign(player, { paddling: false, bailing: true });
    pose(true);
    for (let frame = 0; frame < 60; frame += 1) {
      pose(false, 1 / 30);
      each(view, 'bailing', null);
    }
    for (const player of state.players) Object.assign(player, { bailing: false, asleep: true });
    pose(true);
    each(view, 'asleep', null);
  }

  /**
   * The first half of the stroke: the blade in the water and the arms out ahead. This test holds a figure against
   * everyone beside them there. The whole stroke, each figure against their own things, is the next test's.
   */
  const PULL_ENDS = 0.5;
  /**
   * The trapper's beard is hair, and it hangs where the hand on the grip passes the chin: his own forearm goes
   * this deep into its front through the pull, and no deeper (6.7 cm measured, hull 3, a kneeler, a tenth into the stroke).
   */
  const BEARD_BRUSH = 0.07;

  it('at rest, through the pull, bailing and asleep: clear of their own arms, legs and paddle and of everyone beside them, on every hull, in every seat', () => {
    const tight = new Map<string, Nearest>();
    for (const lineup of LINEUPS) for (let tier = 0; tier < HULL_TIERS.length; tier += 1) for (const side of [1, -1]) {
      poses(lineup, tier, side, (view, when, stroke) => {
        if (stroke !== null && stroke >= PULL_ENDS) return;
        const crew = [...membersOf(view).values()].map((member) => ({ parts: partsOf(member.figure, member.character), label: `${member.character} in seat ${member.seat}` }));
        tightest(crew, tight, `${lineup.name}, hull ${tier}, side ${side}, ${when}`, (solid) => /beard|fur hat/.test(solid));
      });
    }
    const sorted = [...tight.entries()].sort((first, second) => first[1].clearance - second[1].clearance);
    expect(sorted.length).toBeGreaterThan(50);
    for (const [pair, nearest] of sorted.slice(0, 6)) console.log(`CAST clear: ${(nearest.clearance * 100).toFixed(1)} cm, ${pair} (${nearest.what})`);
    for (const [pair, nearest] of sorted) expect(nearest.clearance, `${pair}: ${nearest.what}`).toBeGreaterThanOrEqual(0);
  });

  it('through the whole stroke, the recovery included, nothing of theirs is hit by their own arms, legs or paddle, and the paddler\'s own hands stay off the paddler\'s own head and chest', () => {
    let paddler = Infinity;
    const cast = new Map<string, Nearest>();
    for (const lineup of SAME) for (let tier = 0; tier < HULL_TIERS.length; tier += 1) for (const side of [1, -1]) {
      poses(lineup, tier, side, (view, when) => {
        for (const member of membersOf(view).values()) {
          if (member.character === 'voyageur') {
            paddler = Math.min(paddler, ownDepth(member.figure, 'voyageur'));
            continue;
          }
          const parts = partsOf(member.figure, member.character);
          tightest([{ parts, label: `${member.character} in seat ${member.seat}` }], cast, `hull ${tier}, side ${side}, ${when}`);
        }
      });
    }
    console.log(`CAST recovery: the paddler's own hands and paddle stay ${(paddler * 100).toFixed(1)} cm clear of the paddler's own head and chest`);
    const sorted = [...cast.entries()].sort((first, second) => first[1].clearance - second[1].clearance);
    for (const [pair, nearest] of sorted.slice(0, 6)) console.log(`CAST recovery: ${(nearest.clearance * 100).toFixed(1)} cm, ${pair} (${nearest.what})`);
    // The old stroke put the paddler's hands 12.5 cm into the paddler's own head, and the cast was held to no worse.
    // The stroke no longer does: the paddler is clear, and so is everything the cast wears and carries.
    expect(paddler, 'the paddler\'s own hands and paddle against the paddler\'s own head and chest').toBeGreaterThanOrEqual(0);
    expect(sorted.length).toBeGreaterThan(50);
    for (const [pair, nearest] of sorted) {
      const brushed = /^trapper's beard \/ own (left|right) forearm$/.test(pair);
      expect(nearest.clearance, `${pair}: ${nearest.what}`).toBeGreaterThanOrEqual(brushed ? -BEARD_BRUSH : 0);
    }
  });

  it('a crew of trappers keeps its jackets as slim at the hip as the paddler\'s coat, give or take 3 cm: a kneeler behind lays a paddle there', () => {
    const reach = (who: CharacterId): number => {
      const figure = createCrew(undefined, who);
      const [sx, sy, sz] = CAST_BUILD[who].scale;
      const positions = torsoMesh(figure).geometry.getAttribute('position');
      let widest = 0;
      for (let index = 0; index < positions.count; index += 1) {
        if (positions.getY(index) * sy < 0.12) widest = Math.max(widest, Math.hypot(positions.getX(index) * sx, positions.getZ(index) * sz));
      }
      return widest;
    };
    for (const who of OTHERS) expect(reach(who), who).toBeLessThan(reach('voyageur') + 0.03);
  });
});

describe('ashore, what each one wears and carries stays clear', () => {
  for (const who of OTHERS) {
    it(`the ${who}: standing, walking, running, through a jump, with a tool carried, and asleep`, () => {
      const figure = createCrew(undefined, who);
      const tight = new Map<string, Nearest>();
      const look = (when: string): void => {
        figure.root.updateMatrixWorld(true);
        tightest([{ parts: partsOf(figure, who), label: who }], tight, when);
      };
      for (const holding of [false, true]) {
        figure.stand(0, 0, 0, 0, holding);
        look(holding ? 'standing with a tool' : 'standing');
        for (let stride = 0; stride < Math.PI * 2; stride += 0.1) {
          figure.stand(0, stride, 1, 0, holding);
          look('walking and running');
          figure.stand(0, stride, 0.5, 0, holding);
          look('setting off');
        }
        for (let steps = 0; steps <= LEAP_AIR_STEPS + LEAP_LAND_STEPS; steps += 0.5) {
          for (const stride of [0, 1.2, 4]) for (const moving of [0, 1]) {
            figure.stand(0, stride, moving, 0, holding, jumpPose(steps));
            look(`a jump, step ${steps}`);
          }
        }
      }
      for (const lying of [0.25, 0.5, 0.75, 1]) {
        figure.stand(0, 0, 0, lying);
        look('lying down');
      }
      const sorted = [...tight.entries()].sort((first, second) => first[1].clearance - second[1].clearance);
      console.log(`CAST ashore: the ${who}'s tightest is ${(sorted[0][1].clearance * 100).toFixed(1)} cm, ${sorted[0][0]} (${sorted[0][1].what})`);
      for (const [pair, nearest] of sorted) expect(nearest.clearance, `${pair}: ${nearest.what}`).toBeGreaterThanOrEqual(0);
    });

    it(`the ${who}: every tool in the hand is clear of what is worn and carried`, () => {
      for (const tool of TOOL_IDS) {
        const state = createGame(7);
        Object.assign(state.players[0], { character: who, mode: 'foot', seat: null, selectedTool: tool, position: { x: state.canoe.position.x + 4, y: 1, z: state.canoe.position.z } });
        const view = new CanoeView();
        for (let frame = 0; frame < 12; frame += 1) view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
        const member = membersOf(view).get(0)!;
        member.figure.root.updateMatrixWorld(true);
        let held: THREE.Object3D | null = null;
        member.figure.root.traverse((object) => { if (object.name === `tool:${tool}`) held = object; });
        expect(held, tool).not.toBeNull();
        const box = new THREE.Box3().setFromObject(held!, true);
        for (const solid of partsOf(member.figure, who).solids) {
          for (let step = 0; step <= 8; step += 1) {
            const point = solid.from.clone().lerp(solid.to, step / 8);
            expect(box.distanceToPoint(point) - solid.radius, `${tool} and the ${solid.name}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  }
});

describe('a player who comes back as someone else', () => {
  it('gets a new figure in the same seat, the old one taken out and disposed of, and the shared material left alone', () => {
    const state = createGame(7, { crew: 2 });
    for (const player of state.players) player.paddling = true;
    const view = new CanoeView();
    for (let frame = 0; frame < 120; frame += 1) view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
    const before = membersOf(view).get(1)!;
    const old = before.figure;
    const disposed = new Set<THREE.BufferGeometry>();
    const geometries = [...meshesOf(old), old.paddler.paddle].map((mesh) => mesh.geometry);
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed.add(geometry));
    let materialGone = false;
    inkMaterial.addEventListener('dispose', () => { materialGone = true; });
    const drawnBefore = view.figuresShown();
    const first = view.figureOf(0);

    state.players[1].character = 'angler';
    view.sync(state, crewOf(state), 1 / 60, 0.5, true, false);
    const after = membersOf(view).get(1)!;
    expect(after.figure).not.toBe(old);
    expect(after.character).toBe('angler');
    expect(view.figures()[1]).toMatchObject({ character: 'angler', seat: before.seat, coat: CREW_MARKS[1].coat });
    // The old one is out of the picture, paddle and all, and every geometry it had is disposed of.
    expect(old.root.parent).toBeNull();
    expect(old.paddler.paddle.parent === null || old.paddler.paddle.parent === old.root).toBe(true);
    expect(disposed.size).toBe(new Set(geometries).size);
    expect(materialGone).toBe(false);
    // Nobody else was made again, and there is still one figure a player.
    expect(view.figureOf(0)).toBe(first);
    expect(view.figuresShown()).toBe(drawnBefore);
    // The new one paddles on: its paddle is in its hands.
    expect(view.figures()[1].paddle).toBe('hands');
    expect(view.figures()[1].paddling).toBeGreaterThan(0.9);

    // The same person again: nothing is made again.
    view.sync(state, crewOf(state), 1 / 60, 0.6, true, false);
    expect(membersOf(view).get(1)!.figure).toBe(after.figure);
  });

  it('ashore with a tool and a paddle left in the canoe: the paddle left aboard is the new figure\'s, the old one\'s is gone', () => {
    const state = createGame(7);
    Object.assign(state.players[0], { mode: 'foot', seat: null, selectedTool: 'hatchet', position: { x: state.canoe.position.x + 4, y: 1, z: state.canoe.position.z } });
    const view = new CanoeView();
    for (let frame = 0; frame < 6; frame += 1) view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
    const old = membersOf(view).get(0)!.figure;
    expect(view.figures()[0]).toMatchObject({ character: 'voyageur', paddle: 'canoe', holding: 'hatchet' });
    state.players[0].character = 'trapper';
    for (let frame = 0; frame < 6; frame += 1) view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
    expect(view.figures()[0]).toMatchObject({ character: 'trapper', paddle: 'canoe', holding: 'hatchet' });
    expect(old.paddler.paddle.parent).toBeNull();
    expect(old.root.parent).toBeNull();
    const paddles: THREE.Object3D[] = [];
    view.group.traverse((object) => { if (object === old.paddler.paddle || object === membersOf(view).get(0)!.figure.paddler.paddle) paddles.push(object); });
    expect(paddles).toEqual([membersOf(view).get(0)!.figure.paddler.paddle]);
  });
});

/** Kept for the reader: a capsule is what `cast-clearance.ts` measures with. */
export type { Capsule };
