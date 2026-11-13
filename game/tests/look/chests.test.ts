/**
 * The three chests as drawn, checked from their own meshes: each stands clear of every other piece on every hull
 * that may carry it, the two deck chests stand on the deck's planks, the sea chest rides above the cargo rack's
 * stack, the three are told apart by what they are made of, and why the sea chest needs the long hull.
 * (That no crew member is inside one is checked in attachments.test.ts, which fits every piece.)
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import type { AttachmentId } from '../../src/data/index.ts';
import { attachmentTransformForHull, createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { PLANK_CHEST, SEA_CHEST, TIN_TRUNK } from '../../src/look/canoe/chest-parts.ts';
import { DECK, deckInner } from '../../src/look/canoe/deck-parts.ts';
import { crewOf } from '../../src/look/crew.ts';
import { boxTouchesTriangle, slabsOf, trianglesOf } from './canoe-geometry.ts';
import type { Triangles } from './canoe-geometry.ts';

const CHESTS: AttachmentId[] = ['plank_chest', 'tin_trunk', 'sea_chest'];

/** Everything the hull may carry, the canoe at the origin pointing down -z. */
function fitted(tier: number, crew = 1): GameState {
  const state = createGame(7, { crew });
  state.canoe.hullTier = tier;
  state.canoe.attachments = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].minimumHullTier <= tier);
  state.canoe.position = { x: 0, y: 0, z: 0 };
  state.canoe.heading = 0;
  state.canoe.pitch = 0;
  state.canoe.roll = 0;
  state.canoe.beached = false;
  state.canoe.sailRaised = true;
  return state;
}

function viewOf(state: GameState): { view: CanoeView; holder: (attachmentId: AttachmentId) => THREE.Object3D } {
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, 0, true, true);
  view.group.updateMatrixWorld(true);
  const holders = (view as unknown as { attachments: THREE.Group }).attachments.children;
  return { view, holder: (attachmentId) => holders[state.canoe.attachments.indexOf(attachmentId)] };
}

const meshesOf = (object: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  return meshes;
};

/** The triangles of a piece that come within a box: the only ones worth testing against what is in it. */
function near(triangles: Triangles, box: THREE.Box3): Triangles {
  const kept: number[] = [];
  for (let triangle = 0; triangle < triangles.count; triangle += 1) {
    const at = triangle * 6;
    const { boxes } = triangles;
    if (boxes[at] > box.max.x || boxes[at + 3] < box.min.x || boxes[at + 1] > box.max.y || boxes[at + 4] < box.min.y || boxes[at + 2] > box.max.z || boxes[at + 5] < box.min.z) continue;
    kept.push(triangle);
  }
  const corners = new Float32Array(kept.length * 9);
  const boxes = new Float32Array(kept.length * 6);
  kept.forEach((triangle, index) => {
    corners.set(triangles.corners.subarray(triangle * 9, triangle * 9 + 9), index * 9);
    boxes.set(triangles.boxes.subarray(triangle * 6, triangle * 6 + 6), index * 6);
  });
  return { corners, boxes, count: kept.length };
}

/** A chest's box in canoe space. */
const boxOf = (holder: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(holder);

describe('each chest stands clear of every other piece', () => {
  for (const tier of [2, 3]) {
    it(`on hull tier ${tier}: under way with the sail set, and beached with the canopy drawn`, () => {
      for (const beached of [false, true]) {
        const state = fitted(tier);
        state.canoe.beached = beached;
        state.canoe.sailRaised = !beached;
        const { holder } = viewOf(state);
        const chests = CHESTS.filter((attachmentId) => state.canoe.attachments.includes(attachmentId));
        expect(chests).toEqual(tier === 3 ? CHESTS : ['plank_chest', 'tin_trunk']);
        for (const chest of chests) {
          const own = trianglesOf(holder(chest));
          expect(own.count, chest).toBeGreaterThan(500);
          const whole = boxOf(holder(chest));
          // The heart of the chest: a box well inside its sides. Nothing of another piece may be in there either.
          const size = whole.getSize(new THREE.Vector3());
          const heart = whole.clone().expandByVector(size.clone().multiplyScalar(-0.3));
          for (const other of state.canoe.attachments) {
            if (other === chest) continue;
            // A deck chest stands on its outrigger's deck: there it is checked from a centimetre above the planks.
            const deck = other === (chest === 'plank_chest' ? 'outrigger_port' : chest === 'tin_trunk' ? 'outrigger_starboard' : '');
            const floor = deck ? ATTACHMENTS[chest].transform.position[1] + 0.01 : -Infinity;
            const close = near(trianglesOf(holder(other)), whole);
            let touching = boxTouchesTriangle(heart, close);
            // Every triangle the chest is drawn with, as its own small box, against every triangle of the other piece.
            for (let triangle = 0; triangle < own.count && !touching; triangle += 1) {
              const at = triangle * 6;
              const box = new THREE.Box3(
                new THREE.Vector3(own.boxes[at], Math.max(own.boxes[at + 1], floor), own.boxes[at + 2]),
                new THREE.Vector3(own.boxes[at + 3], own.boxes[at + 4], own.boxes[at + 5]),
              );
              touching = box.max.y >= box.min.y && boxTouchesTriangle(box, close);
            }
            expect(touching, `${chest} against ${other}, tier ${tier}, ${beached ? 'beached' : 'under way'}`).toBe(false);
          }
        }
      }
    });
  }
});

describe('where each chest stands', () => {
  it('the two deck chests stand on the planks of their own deck, between its two stations', () => {
    for (const tier of [2, 3]) {
      const state = fitted(tier);
      const { holder } = viewOf(state);
      const inner = deckInner(HULL_TIERS[tier].dimensions.beam / 2);
      const outer = Math.abs(ATTACHMENTS.outrigger_port.transform.position[0]) - DECK.kerb;
      for (const [chest, side, fore, aft] of [['plank_chest', -1, 'workbench', 'smoker'], ['tin_trunk', 1, 'planter', 'forge']] as const) {
        const box = boxOf(holder(chest));
        const deckTop = ATTACHMENTS[chest].transform.position[1];
        expect(box.min.y, `${chest} stands on the deck, tier ${tier}`).toBeGreaterThan(deckTop - 0.002);
        expect(box.min.y, `${chest} stands on the deck, tier ${tier}`).toBeLessThan(deckTop + 0.01);
        expect(Math.min(side * box.min.x, side * box.max.x), `${chest} inner edge`).toBeGreaterThan(inner);
        expect(Math.max(side * box.min.x, side * box.max.x), `${chest} outer edge`).toBeLessThan(outer);
        // Aft of the forward station's mount and forward of the aft one's.
        expect(box.min.z, chest).toBeGreaterThan(attachmentTransformForHull(fore, tier).position[2] + 0.25);
        expect(box.max.z, chest).toBeLessThan(attachmentTransformForHull(aft, tier).position[2] - 0.25);
      }
    }
  });

  it('the tin trunk lies low: the fishing rods pass over it', () => {
    const { holder } = viewOf(fitted(3));
    const deckTop = ATTACHMENTS.tin_trunk.transform.position[1];
    expect(boxOf(holder('tin_trunk')).max.y).toBeLessThan(deckTop + 0.35);
    expect(TIN_TRUNK.height + TIN_TRUNK.crown).toBeLessThan(0.31);
  });

  it('the sea chest lies across the hull at the rails, inside them, over the cargo rack\'s stack', () => {
    const state = fitted(3);
    const { holder } = viewOf(state);
    const { beam, depth, draft } = HULL_TIERS[3].dimensions;
    const box = boxOf(holder('sea_chest'));
    // Its bearer is let in between the rails: nothing of it is outboard, or under the rail by more than its bearer.
    expect(box.min.x).toBeGreaterThan(-beam / 2);
    expect(box.max.x).toBeLessThan(beam / 2);
    expect(box.min.y).toBeGreaterThan(depth - draft - 0.05);
    expect(box.max.y).toBeLessThan(depth - draft + 0.32);
    // The stack on the floor behind the thwart is under it, not in it.
    const stack = new THREE.Box3(new THREE.Vector3(-0.3, -1, -0.05), new THREE.Vector3(0.3, box.min.y - 0.002, 0.2));
    expect(boxTouchesTriangle(stack, trianglesOf(holder('cargo_rack')))).toBe(true);
    expect(SEA_CHEST.length).toBeGreaterThan(PLANK_CHEST.length);
  });

  it('the sea chest needs the long hull: on the ribbed one, with four aboard, the aft kneeler\'s paddle lies in it', () => {
    const lying = (tier: number): boolean => {
      const state = fitted(tier, 4);
      if (!state.canoe.attachments.includes('sea_chest')) state.canoe.attachments.push('sea_chest');
      const { view, holder } = viewOf(state);
      view.sync(state, crewOf(state), 1 / 12, 0.2, true, false);
      view.group.updateMatrixWorld(true);
      const triangles = trianglesOf(holder('sea_chest'));
      const kneeler = state.players.find((player) => player.seat === 2)!;
      const figure = (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(kneeler.id)!.figure;
      return slabsOf(figure.paddler.paddle, 0.05).some((slab) => boxTouchesTriangle(slab, triangles));
    };
    expect(lying(2)).toBe(true);
    expect(lying(3)).toBe(false);
  });
});

describe('the three chests are told apart', () => {
  /** The colour most of a chest is, by the area drawn in it, as a hue name. */
  const mostOf = (attachmentId: AttachmentId): string => {
    const { holder } = viewOf(fitted(3));
    const area = new Map<string, number>();
    for (const mesh of meshesOf(holder(attachmentId))) {
      const [position, colour] = [mesh.geometry.getAttribute('position'), mesh.geometry.getAttribute('aColor')];
      const corner = (index: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index);
      for (let index = 0; index < position.count; index += 3) {
        const [red, green, blue] = [colour.getX(index), colour.getY(index), colour.getZ(index)];
        const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
        const name = Math.min(red, green, blue) > 0.75 ? 'pale' : spread < 0.06 ? 'grey' : blue > red ? 'blue' : red > blue + 0.12 ? 'wood' : 'other';
        const size = corner(index + 1).sub(corner(index)).cross(corner(index + 2).sub(corner(index))).length() / 2;
        area.set(name, (area.get(name) ?? 0) + size);
      }
    }
    return [...area.entries()].sort((first, second) => second[1] - first[1])[0][0];
  };

  it('by what they are made of: bare planks, grey tin, blue paint', () => {
    expect(CHESTS.map(mostOf)).toEqual(['wood', 'grey', 'blue']);
  });

  it('and by their shape: the trunk lies fore and aft with a rounded lid, the other two athwart, the sea chest the longest', () => {
    const { holder } = viewOf(fitted(3));
    const size = (attachmentId: AttachmentId): THREE.Vector3 => boxOf(holder(attachmentId)).getSize(new THREE.Vector3());
    expect(size('plank_chest').x).toBeGreaterThan(size('plank_chest').z);
    expect(size('tin_trunk').z).toBeGreaterThan(size('tin_trunk').x);
    expect(size('sea_chest').x).toBeGreaterThan(size('plank_chest').x + 0.2);
  });
});
