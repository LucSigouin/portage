/**
 * The bolted-on pieces, checked from their own meshes with no graphics card:
 * every id has a real drawing, each one sits at the mount the rules give,
 * the ones with a state follow it, and on the fully fitted long canoe no
 * crew member is inside a piece.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import type { AttachmentId } from '../../src/data/index.ts';
import { attachmentTransformForHull, createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { PLACEHOLDER_ATTACHMENTS, buildAttachment } from '../../src/look/attachments.ts';
import type { AttachmentPiece } from '../../src/look/attachments.ts';
import { makeHullShape } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { deckInner, deckSpan } from '../../src/look/canoe/deck-parts.ts';
import { crewOf } from '../../src/look/crew.ts';
import { boxTouchesTriangle, slabsOf, trianglesOf } from './canoe-geometry.ts';
import type { Triangles } from './canoe-geometry.ts';

function build(attachmentId: AttachmentId, tier: number): AttachmentPiece {
  const dimensions = HULL_TIERS[tier].dimensions;
  const transform = attachmentTransformForHull(attachmentId, tier);
  return buildAttachment(attachmentId, {
    hullTier: tier, shape: makeHullShape(dimensions), halfBeam: dimensions.beam / 2, gunwaleY: dimensions.depth - dimensions.draft,
    mount: transform.position, rotation: transform.rotation,
  });
}

const meshesOf = (object: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  return meshes;
};

/** A game with the long hull, every attachment and a crew of four, the canoe at the origin pointing down -z. */
function fitted(tier = 3, crew = 4): GameState {
  const state = createGame(7, { crew });
  state.canoe.hullTier = tier;
  state.canoe.attachments = ATTACHMENT_IDS.filter((attachmentId) => tier >= 3 || (attachmentId !== 'winch' && attachmentId !== 'radio'));
  state.canoe.position = { x: 0, y: 0, z: 0 };
  state.canoe.heading = 0;
  state.canoe.pitch = 0;
  state.canoe.roll = 0;
  state.canoe.beached = false;
  state.canoe.sailRaised = true;
  return state;
}

const holdersOf = (view: CanoeView): THREE.Object3D[] => (view as unknown as { attachments: THREE.Group }).attachments.children;
const figureOf = (view: CanoeView, playerId: number): Figure =>
  (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(playerId)!.figure;

describe('every attachment', () => {
  it('has its own drawing: many pieces, many colours, no stand-in box', () => {
    expect(ATTACHMENT_IDS).toHaveLength(19);
    expect(PLACEHOLDER_ATTACHMENTS).toEqual([]);
    for (const attachmentId of ATTACHMENT_IDS) {
      const ids = new Set<number>();
      const colours = new Set<string>();
      let vertices = 0;
      for (const mesh of meshesOf(build(attachmentId, 3).object)) {
        const info = mesh.geometry.getAttribute('aInfo');
        const colour = mesh.geometry.getAttribute('aColor');
        vertices += info.count;
        for (let index = 0; index < info.count; index += 1) {
          ids.add(info.getX(index));
          colours.add(`${colour.getX(index).toFixed(2)},${colour.getY(index).toFixed(2)},${colour.getZ(index).toFixed(2)}`);
        }
      }
      // The old stand-in was one box with two straps and four bolts: 7 pieces, about 500 vertices, 3 colours.
      expect(ids.size, `${attachmentId}: inked pieces`).toBeGreaterThanOrEqual(12);
      expect(colours.size, `${attachmentId}: colours`).toBeGreaterThanOrEqual(4);
      expect(vertices, `${attachmentId}: vertices`).toBeGreaterThan(900);
    }
  });

  it('sits at the mount the rules give, on both hulls that carry it', () => {
    for (const tier of [2, 3]) {
      for (const attachmentId of ATTACHMENT_IDS) {
        // In the mount's own space the mount is the origin: the piece must reach it, within a hand's width.
        const box = new THREE.Box3();
        const piece = build(attachmentId, tier);
        piece.update?.(fitted(tier).canoe, 0);
        for (const mesh of meshesOf(piece.object)) {
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!);
        }
        const gap = box.distanceToPoint(new THREE.Vector3(0, 0, 0));
        expect(gap, `${attachmentId} on tier ${tier}: metres from its mount`).toBeLessThan(0.1);
        // And it is not a piece that merely passes by: most of it is within reach of the mount.
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        expect(Math.hypot(centre.x, centre.z), `${attachmentId} on tier ${tier}: centre from its mount`).toBeLessThan(Math.max(size.x, size.z) * 0.62 + 0.05);
      }
    }
  });

  it('is hung by the canoe view exactly where the rules say', () => {
    for (const tier of [2, 3]) {
      const state = fitted(tier);
      const view = new CanoeView();
      view.sync(state, crewOf(state), 0, 0, true, true);
      const holders = holdersOf(view);
      expect(holders).toHaveLength(state.canoe.attachments.length);
      state.canoe.attachments.forEach((attachmentId, index) => {
        const transform = attachmentTransformForHull(attachmentId, tier);
        expect(holders[index].position.toArray(), attachmentId).toEqual(transform.position);
        expect([holders[index].rotation.x, holders[index].rotation.y, holders[index].rotation.z], attachmentId).toEqual(transform.rotation);
      });
    }
  });
});

describe('pieces seen from their plain side', () => {
  /** How many of a piece's vertices lie where `inside` says, in the mount's own space. */
  const count = (attachmentId: AttachmentId, inside: (x: number, y: number, z: number, lowest: number) => boolean): number => {
    let found = 0;
    const meshes = meshesOf(build(attachmentId, 3).object);
    const box = new THREE.Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!);
    }
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        if (inside(position.getX(index), position.getY(index), position.getZ(index), box.min.y)) found += 1;
      }
    }
    return found;
  };

  it('the workbench shows a saw and a coil of line on the back of its tool board, which is what the port side sees', () => {
    // The bench is on the port deck: outboard is -x. The board's back is 22 cm out from the mount, the bench top 62 cm up.
    expect(count('workbench', (x, y) => x < -0.223 && y > 0.66)).toBeGreaterThan(300);
  });

  it('the radio shack has a window, its name and the lead-in on its aft wall, which is what shows from astern', () => {
    // The wall is 14 cm aft of the mount, the shack 30 cm wide about a centre 6 cm to starboard, 32 cm tall.
    expect(count('radio', (x, y, z, lowest) => z > 0.1405 && z < 0.18 && Math.abs(x - 0.06) < 0.15 && y < lowest + 0.31)).toBeGreaterThan(300);
  });
});

describe('pieces with a state', () => {
  const visibleVertices = (piece: AttachmentPiece): number =>
    meshesOf(piece.object).reduce((sum, mesh) => {
      let shown = true;
      for (let node: THREE.Object3D | null = mesh; node; node = node.parent) shown &&= node.visible;
      return sum + (shown ? mesh.geometry.getAttribute('position').count : 0);
    }, 0);
  /** The colours a piece shows right now that glow fully (a lit lamp). */
  const lamps = (piece: AttachmentPiece): number =>
    meshesOf(piece.object).reduce((sum, mesh) => {
      let shown = true;
      for (let node: THREE.Object3D | null = mesh; node; node = node.parent) shown &&= node.visible;
      const info = mesh.geometry.getAttribute('aInfo');
      let glowing = 0;
      for (let index = 0; index < info.count; index += 1) if (info.getY(index) >= 0.99) glowing += 1;
      return sum + (shown ? glowing : 0);
    }, 0);

  it('the sail is set when raised and furled on the boom when not', () => {
    const state = fitted();
    const piece = build('mast_sail', 3);
    const heights = (): number => {
      const box = new THREE.Box3();
      piece.object.updateMatrixWorld(true);
      piece.object.traverseVisible((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!);
      });
      return box.max.y;
    };
    state.canoe.sailRaised = true;
    piece.update!(state.canoe, 0);
    const raised = visibleVertices(piece);
    const cloth = meshesOf(piece.object).filter((mesh) => (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).usage === THREE.DynamicDrawUsage);
    expect(cloth).toHaveLength(1);
    expect(cloth[0].parent!.visible).toBe(true);
    state.canoe.sailRaised = false;
    piece.update!(state.canoe, 0);
    expect(cloth[0].parent!.visible).toBe(false);
    expect(visibleVertices(piece)).not.toBe(raised);
    // The mast stands either way.
    expect(heights()).toBeGreaterThan(4);
  });

  it('the sail moves slowly: under 4 cm in a tenth of a second anywhere on it', () => {
    const state = fitted();
    const piece = build('mast_sail', 3);
    const cloth = meshesOf(piece.object).find((mesh) => (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).usage === THREE.DynamicDrawUsage)!;
    let fastest = 0;
    for (let time = 0; time < 20; time += 0.1) {
      piece.update!(state.canoe, time);
      const before = Float32Array.from(cloth.geometry.getAttribute('position').array);
      piece.update!(state.canoe, time + 0.1);
      const after = cloth.geometry.getAttribute('position').array;
      for (let index = 0; index < before.length; index += 3) {
        fastest = Math.max(fastest, Math.hypot(after[index] - before[index], after[index + 1] - before[index + 1], after[index + 2] - before[index + 2]));
      }
    }
    expect(fastest).toBeGreaterThan(0.0005);
    expect(fastest).toBeLessThan(0.004);
  });

  it('the lantern glows only when the canoe says it is lit', () => {
    const state = fitted();
    const piece = build('lantern_mast', 3);
    state.canoe.lanternLit = true;
    piece.update!(state.canoe, 0);
    expect(lamps(piece)).toBeGreaterThan(0);
    state.canoe.lanternLit = false;
    piece.update!(state.canoe, 0);
    expect(lamps(piece)).toBe(0);
  });

  it('the canopy is rolled forward under way and drawn over the cockpit when beached', () => {
    const state = fitted();
    const piece = build('canopy', 3);
    const spanShown = (): number => {
      const box = new THREE.Box3();
      piece.object.traverseVisible((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const info = mesh.geometry.getAttribute('aInfo');
        const position = mesh.geometry.getAttribute('position');
        // cloth only (material tag 5 or a stitched patch 14)
        for (let index = 0; index < info.count; index += 1) {
          if (info.getZ(index) === 5 || info.getZ(index) === 14) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, index));
        }
      });
      return box.isEmpty() ? 0 : box.max.z - box.min.z;
    };
    state.canoe.beached = false;
    piece.update!(state.canoe, 0);
    expect(spanShown()).toBeLessThan(0.3);
    state.canoe.beached = true;
    piece.update!(state.canoe, 0);
    expect(spanShown()).toBeGreaterThan(0.9);
  });

  it('the water in the rain pail stands at the rain progress', () => {
    const state = fitted();
    const piece = build('rain_catcher', 3);
    const level = (): number => {
      const water = meshesOf(piece.object).find((mesh) => mesh.position.lengthSq() > 0 || mesh.geometry.getAttribute('position').count < 200)!;
      // The mount is tilted 0.2 rad about z; in canoe space the water only ever moves straight up.
      const turned = water.position.clone().applyEuler(new THREE.Euler(0, 0, 0.2));
      expect(Math.abs(turned.x)).toBeLessThan(1e-6);
      return turned.y;
    };
    state.canoe.rainProgress = 0;
    piece.update!(state.canoe, 0);
    const empty = level();
    state.canoe.rainProgress = 1;
    piece.update!(state.canoe, 0);
    expect(level() - empty).toBeGreaterThan(0.12);
  });
});

describe('the fully fitted long canoe with a crew of four', () => {
  /** `stopstart`: paddling, laying the paddle down and taking it up again, every 1.3 s. */
  type Pose = 'rest' | 'paddle' | 'stopstart' | 'bail' | 'sleep';
  interface Hit { pose: Pose; seat: number; part: AttachmentId; limb: string }

  /** Every place a crew member's body is inside a piece, over a few seconds of that pose. `paddles` checks the paddles instead. */
  function hits(tier: number, poses: Pose[], paddles = false, crew = 4): Hit[] {
    const found = new Map<string, Hit>();
    for (const pose of poses) {
      const state = fitted(tier, crew);
      for (const player of state.players) {
        player.paddling = pose === 'paddle' || pose === 'stopstart';
        player.bailing = pose === 'bail';
        player.asleep = pose === 'sleep';
      }
      const view = new CanoeView();
      view.sync(state, crewOf(state), 0, 0, true, true);
      view.group.updateMatrixWorld(true);
      const parts: { id: AttachmentId; triangles: Triangles }[] = holdersOf(view).map((holder, index) => ({
        id: state.canoe.attachments[index], triangles: trianglesOf(holder),
      }));
      // Long enough for the paddles to change sides twice.
      const seconds = pose === 'paddle' ? 9 : pose === 'stopstart' ? 5.2 : pose === 'bail' ? 2.6 : 0.4;
      for (let time = 0; time < seconds; time += 1 / 12) {
        if (pose === 'stopstart') for (const player of state.players) player.paddling = Math.floor(time / 1.3) % 2 === 0;
        view.sync(state, crewOf(state), 1 / 12, time, true, false);
        view.group.updateMatrixWorld(true);
        for (const player of state.players) {
          const figure = figureOf(view, player.id);
          figure.root.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || !mesh.visible || (mesh === figure.paddler.paddle) !== paddles) return;
            const rail = HULL_TIERS[tier].dimensions.beam / 2 + 0.05;
            for (const box of slabsOf(mesh, paddles ? 0.05 : 0.1)) {
              // A paddle is checked where it is outboard: changing sides, it swings across the boat in a fifth of a second.
              if (paddles && Math.min(Math.abs(box.min.x), Math.abs(box.max.x)) < rail) continue;
              for (const part of parts) {
                if (found.has(`${pose}:${player.seat}:${part.id}`)) continue;
                if (boxTouchesTriangle(box, part.triangles)) {
                  const at = box.getCenter(new THREE.Vector3());
                  found.set(`${pose}:${player.seat}:${part.id}`, { pose, seat: player.seat ?? -1, part: part.id, limb: `at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}` });
                }
              }
            }
          });
        }
      }
    }
    return [...found.values()];
  }
  const told = (list: Hit[]): string[] => list.map((hit) => `${hit.pose} seat ${hit.seat} in ${hit.part}`).sort();

  it('seats nobody inside a piece: at rest, paddling, starting and stopping, bailing or asleep', () => {
    // The rules put the firebox 41 cm behind the bow seat and 44 cm ahead of the forward kneeler, so it is drawn
    // low. That kneeler's hands are clear of it through the stroke. They used to cross it when the paddle changed
    // sides at the catch: the change is made early in the recovery now, with the hands drawn back (canoe.ts).
    const found = hits(3, ['rest', 'paddle', 'stopstart', 'bail', 'sleep']);
    expect(told(found), found.map((hit) => `${hit.part} ${hit.limb}`).join('; ')).toEqual([]);
  });

  it('lets the two seated paddlers swing their paddles clear of every piece', () => {
    const inTheWay = hits(3, ['paddle', 'rest'], true).filter((hit) => hit.seat <= 1);
    expect(told(inTheWay)).toEqual([]);
  });

  it('on the ribbed hull, the lone paddler fits round everything it can carry', () => {
    expect(told(hits(2, ['rest', 'paddle', 'bail', 'sleep'], false, 1))).toEqual([]);
    expect(told(hits(2, ['rest', 'paddle'], true, 1))).toEqual([]);
  });

  it('on the ribbed hull, a bow paddler fits too, but for the firebox the rules mount on the bow seat', () => {
    // Tier 2: the bow seat is at z = -1.269 and the firebox mount at z = -1.25. In the report.
    const found = hits(2, ['rest', 'paddle', 'bail', 'sleep'], false, 2);
    expect([...new Set(found.map((hit) => `seat ${hit.seat} in ${hit.part}`))].sort()).toEqual(['seat 1 in firebox']);
  });

  it('lets the two kneelers swing their paddles clear of every piece too, the outrigger decks included', () => {
    // Seats 2 and 3 kneel beside the decks. Paddling, at rest, and laying the paddle down and taking it up.
    const inTheWay = hits(3, ['paddle', 'rest', 'stopstart'], true).filter((hit) => hit.seat >= 2);
    expect(told(inTheWay), inTheWay.map((hit) => `${hit.part} ${hit.limb}`).join('; ')).toEqual([]);
  });

  it('knows what the drawing cannot solve on the ribbed hull: with three or four aboard, the aft kneeler is inside six pieces', () => {
    // The rules spread the seats with the hull's length and leave the mounts amidships where they are. On the long
    // hull the aft kneeler has 32 cm between their back and the stern paddler's knees, for the map table, the
    // canopy's hoop and the outriggers' aft spar. On the ribbed hull they have 4 cm. In the report, with the numbers.
    const kneeler = ['seat 2 in canopy', 'seat 2 in cargo_rack', 'seat 2 in fishing_rig', 'seat 2 in map_table', 'seat 2 in outrigger_port', 'seat 2 in outrigger_starboard'];
    for (const crew of [3, 4]) {
      const found = hits(2, ['rest', 'paddle', 'stopstart', 'bail', 'sleep'], false, crew);
      // The fourth, kneeling forward, has the mast's foot at their back as well.
      expect([...new Set(found.map((hit) => `seat ${hit.seat} in ${hit.part}`))].sort(), `crew of ${crew}`).toEqual(['seat 1 in firebox', ...kneeler, ...(crew === 4 ? ['seat 3 in mast_sail'] : [])]);
    }
  });

  it('on the ribbed hull, three or four paddles are clear of every piece as well', () => {
    for (const crew of [3, 4]) {
      const inTheWay = hits(2, ['paddle', 'rest', 'stopstart'], true, crew);
      expect(told(inTheWay), `crew of ${crew}: ${inTheWay.map((hit) => `${hit.part} ${hit.limb}`).join('; ')}`).toEqual([]);
    }
  });
});

describe('a kneeler beside an outrigger deck', () => {
  const PADDLE_LENGTH = 1.485;
  /** Run a crew of four through a spell of paddling, and hand every frame to `each`. */
  function watch(tier: number, attachments: AttachmentId[] | null, seconds: number, each: (view: CanoeView, state: GameState, time: number) => void, drive?: (state: GameState, time: number) => void): void {
    const state = fitted(tier, 4);
    if (attachments) state.canoe.attachments = attachments;
    for (const player of state.players) player.paddling = true;
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    for (let time = 0; time < seconds; time += 1 / 30) {
      drive?.(state, time);
      view.sync(state, crewOf(state), 1 / 30, time, true, false);
      view.group.updateMatrixWorld(true);
      each(view, state, time);
    }
  }
  /** Sixteen points down a kneeler's paddle at this moment, grip to blade tip, in canoe space (the canoe lies at the origin). */
  const along = (view: CanoeView, playerId: number): THREE.Vector3[] => {
    const paddle = figureOf(view, playerId).paddler.paddle;
    return Array.from({ length: 16 }, (_, index) => paddle.localToWorld(new THREE.Vector3(0, (-PADDLE_LENGTH * index) / 15, 0)));
  };
  /** How far out from the centreline a kneeler's paddle reaches at this moment: its blade tip, and its grip. */
  const reach = (view: CanoeView, playerId: number): { tip: number; grip: number } => {
    const points = along(view, playerId);
    return { tip: Math.abs(points[15].x), grip: Math.abs(points[0].x) };
  };

  for (const tier of [2, 3]) {
    it(`keeps the paddle between the two decks on hull tier ${tier}, wherever a deck runs beside it: paddling, resting, starting and stopping`, () => {
      // The planks' inner ends are ragged by up to 5 cm. A blade is 9 cm to each side of its shaft, so a paddle is
      // beside a deck from 9 cm before the deck's forward edge to 9 cm past its aft one. Ahead of the decks and
      // astern of them there is open water, and a paddle may reach as far out as it likes.
      const edge = deckInner(HULL_TIERS[tier].dimensions.beam / 2) - 0.05;
      const runs = deckSpan(tier);
      let furthest = 0;
      let beside = 0;
      watch(tier, null, 12, (view, state) => {
        for (const player of state.players.filter((one) => (one.seat ?? 0) >= 2)) {
          for (const point of along(view, player.id)) {
            if (point.z < runs.forward - 0.09 || point.z > runs.aft + 0.09) continue;
            beside += 1;
            furthest = Math.max(furthest, Math.abs(point.x));
          }
        }
      }, (state, time) => {
        for (const player of state.players) player.paddling = Math.floor(time / 1.3) % 2 === 0;
      });
      expect(beside).toBeGreaterThan(1000);
      expect(furthest).toBeGreaterThan(0.5);
      expect(furthest).toBeLessThan(edge);
    });
  }

  it('with no outrigger fitted, a kneeler keeps the figure\'s own stroke: the blade swings out wide on the way back', () => {
    let furthest = 0;
    watch(3, [], 6, (view, state) => {
      for (const player of state.players.filter((one) => (one.seat ?? 0) >= 2)) furthest = Math.max(furthest, reach(view, player.id).tip);
    });
    expect(furthest).toBeGreaterThan(1);
  });
});

describe('changing sides', () => {
  it('happens early in the recovery, with the hands drawn back: never across the catch', () => {
    const state = fitted(3, 4);
    for (const player of state.players) player.paddling = true;
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    const phaseOf = (): number => (view as unknown as { phase: number }).phase;
    let sides = view.figures().map((figure) => figure.side);
    const changes: number[] = [];
    for (let time = 0; time < 20; time += 1 / 30) {
      // A hard turn begun at the catch asks for the outside of the turn at once: the worst moment to swing a paddle over.
      if (time > 9 && time < 9.6) state.canoe.heading += 0.02;
      if (time > 14.1 && time < 14.7) state.canoe.heading -= 0.02;
      view.sync(state, crewOf(state), 1 / 30, time, true, false);
      const now = view.figures().map((figure) => figure.side);
      if (now.some((side, index) => side !== sides[index])) changes.push(phaseOf());
      sides = now;
    }
    // Every third stroke, and the two turns.
    expect(changes.length).toBeGreaterThanOrEqual(4);
    for (const phase of changes) {
      expect(phase).toBeGreaterThanOrEqual(0.46);
      expect(phase).toBeLessThanOrEqual(0.6 + 0.78 / 30);
    }
    // Neighbours along the hull still work opposite sides.
    const side = (seat: number): number => view.figures().find((figure) => figure.seat === seat)!.side;
    expect([side(0), side(2), side(3), side(1)]).toEqual([side(0), -side(0), side(0), -side(0)]);
  });
});
