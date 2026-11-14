/**
 * The bolted-on pieces, checked from their own meshes with no graphics card:
 * every id has a real drawing, each one sits at the mount the rules give,
 * the ones with a state follow it, and on the fully fitted long canoe no
 * crew member is inside a piece.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import type { AttachmentId } from '../../src/data/index.ts';
import { attachmentTransformForHull, createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { PLACEHOLDER_ATTACHMENTS, buildAttachment } from '../../src/look/attachments.ts';
import type { AttachmentPiece } from '../../src/look/attachments.ts';
import { STROKE_PULL, makeHullShape } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { deckInner, deckSpan } from '../../src/look/canoe/deck-parts.ts';
import { BARK_LAPS, INSIDE_SHEETS, PITCHED_SEAMS, SIDE_SHEETS, buildMends, buildSheets } from '../../src/look/canoe/mends.ts';
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
  state.canoe.attachments = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].minimumHullTier <= tier);
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
    expect(ATTACHMENT_IDS).toHaveLength(22);
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
                  found.set(`${pose}:${player.seat}:${part.id}`, { pose, seat: player.seat ?? -1, part: part.id, limb: `at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}, ${time.toFixed(2)} s` });
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

  it('knows what the drawing cannot solve on the ribbed hull: with three or four aboard, the aft kneeler is inside four pieces', () => {
    // The rules spread the seats with the hull's length and leave the mounts amidships where they are. On the long
    // hull the aft kneeler has 32 cm between their back and the stern paddler's knees, for the map table, the
    // canopy's hoop and the outriggers' aft spar. On the ribbed hull they have 4 cm. In the report, with the numbers.
    // The fishing rig is clear since the stroke in an outrigger's well keeps the hands ahead of the shoulders.
    // Four pieces since the paddle rests on the side it works on (it was five: the port outrigger too).
    const kneeler = ['seat 2 in canopy', 'seat 2 in cargo_rack', 'seat 2 in map_table', 'seat 2 in outrigger_starboard'];
    const seen: Record<number, string[]> = {};
    for (const crew of [3, 4]) {
      const found = hits(2, ['rest', 'paddle', 'stopstart', 'bail', 'sleep'], false, crew);
      seen[crew] = [...new Set(found.map((hit) => `seat ${hit.seat} in ${hit.part}`))].sort();
    }
    // The fourth, kneeling forward, has the mast's foot at their back as well.
    expect(seen).toEqual({ 3: ['seat 1 in firebox', ...kneeler], 4: ['seat 1 in firebox', ...kneeler, 'seat 3 in mast_sail'] });
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
  /** Twenty seconds of paddling with two hard turns: the stroke clock at every frame a paddle changed sides. */
  function changesOf(tier: number, crew: number, attachments: AttachmentId[]): { changes: number[]; view: CanoeView } {
    const state = fitted(tier, crew);
    state.canoe.attachments = attachments;
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
    return { changes, view };
  }

  it('alone or two aboard it happens late in the recovery, the blade carried forward clear of the water: never across the catch', () => {
    for (const crew of [1, 2]) {
      const { changes } = changesOf(3, crew, []);
      // Every third stroke, and the two turns.
      expect(changes.length, `crew of ${crew}`).toBeGreaterThanOrEqual(4);
      // The recovery starts where the pull ends (STROKE_PULL) and the blade drops in from 0.96. The stroke waits at
      // 0.87 (CHANGE_AT in canoe.ts) while the paddle is carried across.
      for (const phase of changes) {
        expect(phase, `crew of ${crew}`).toBeGreaterThan(STROKE_PULL + 0.2);
        expect(phase, `crew of ${crew}`).toBeLessThan(0.9);
      }
    }
  });

  it('a crew of four keeps its sides: there is no room to carry a paddle across low, and neighbours work opposite sides', () => {
    const { changes, view } = changesOf(3, 4, fitted(3, 4).canoe.attachments);
    expect(changes).toEqual([]);
    const side = (seat: number): number => view.figures().find((figure) => figure.seat === seat)!.side;
    expect([side(0), side(2), side(3), side(1)]).toEqual([side(0), -side(0), side(0), -side(0)]);
  });
});

describe('the patched hull', () => {
  const extras = (tier: number): number => {
    const state = fitted(tier, 1);
    state.canoe.attachments = [];
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    return (view as unknown as { tiers: Map<number, { group: THREE.Group }> }).tiers.get(tier)!.group.children.length;
  };

  it('is the only hull that wears the mends: laps of bark over its rails, and sheets of it along its sides and inside', () => {
    expect(extras(1)).toBe(extras(0) + 2);
    expect(extras(2)).toBe(extras(0));
    expect(extras(3)).toBe(extras(0));
  });

  it('has every lap of bark lying on a rail, on both sides, and a sheet on the bow deck', () => {
    const shape = makeHullShape(HULL_TIERS[1].dimensions);
    const position = buildMends(shape).geometry.getAttribute('position');
    const sides = { port: 0, starboard: 0, deck: 0 };
    for (let index = 0; index < position.count; index += 1) {
      const [x, y, z] = [position.getX(index), position.getY(index), position.getZ(index)];
      if (z > 0.78 * shape.HL) {
        // the sheet: on the deck, inside the rails
        expect(Math.abs(x)).toBeLessThan(shape.halfBeamAt(z));
        expect(Math.abs(y - shape.sheerAt(z))).toBeLessThan(0.06);
        sides.deck += 1;
        continue;
      }
      // a lap: within a hand of the rail it is folded over, never proud of it by more than 6 cm
      expect(Math.abs(Math.abs(x) - shape.halfBeamAt(z)), `x ${x.toFixed(2)} at z ${z.toFixed(2)}`).toBeLessThan(0.075);
      expect(y - shape.sheerAt(z), `y ${y.toFixed(2)} at z ${z.toFixed(2)}`).toBeGreaterThan(-0.1);
      expect(y - shape.sheerAt(z), `y ${y.toFixed(2)} at z ${z.toFixed(2)}`).toBeLessThan(0.065);
      sides[x > 0 ? 'port' : 'starboard'] += 1;
    }
    expect(sides.port).toBeGreaterThan(100);
    expect(sides.starboard).toBeGreaterThan(100);
    expect(sides.deck).toBeGreaterThan(20);
    // None lies where the lone paddler's blade crosses the rail: from 0.54 m astern of the stern seat to 0.78 m ahead of it.
    const seat = -0.3107 * HULL_TIERS[1].dimensions.length;
    for (const [, z, length] of BARK_LAPS) expect(z - length / 2, `lap at ${z}`).toBeGreaterThan(seat + 0.78);
  });

  describe('its sheets of bark, which tell it from the leaky hull at a glance', () => {
    const dimensions = HULL_TIERS[1].dimensions;
    const shape = makeHullShape(dimensions);
    /** Every triangle of the sheets outside the planking, or inside it: its area, its middle, and whether it is bark (pale) or pitch (near black). */
    const pieces = (part: 'outside' | 'inside'): { area: number; x: number; y: number; z: number; bark: boolean; pitch: boolean }[] => {
      const geometry = buildSheets(shape, part).geometry;
      const [position, colour] = [geometry.getAttribute('position'), geometry.getAttribute('aColor')];
      const corner = (index: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index);
      const list = [];
      for (let index = 0; index < position.count; index += 3) {
        const [a, b, c] = [corner(index), corner(index + 1), corner(index + 2)];
        const middle = a.clone().add(b).add(c).divideScalar(3);
        const light = (colour.getX(index) + colour.getY(index) + colour.getZ(index)) / 3;
        list.push({ area: b.clone().sub(a).cross(c.clone().sub(a)).length() / 2, x: middle.x, y: middle.y, z: middle.z, bark: light > 0.7, pitch: light < 0.25 });
      }
      return list;
    };
    const stationZ = (station: number): number => (-0.992 + (1.984 * station) / 36) * shape.HL;

    it('is what the canoe wears: the outside and the inside together', () => {
      const count = (part?: 'outside' | 'inside'): number => buildSheets(shape, part).geometry.getAttribute('position').count;
      expect(count()).toBe(count('outside') + count('inside'));
    });

    it('shows over a third of a square metre of bark above the waterline on each side, and lines the inside on both', () => {
      const area = (list: { area: number }[]): number => list.reduce((sum, piece) => sum + piece.area, 0);
      for (const side of [-1, 1]) {
        const outside = pieces('outside').filter((piece) => piece.bark && Math.sign(piece.x) === side && piece.y > dimensions.draft);
        const inside = pieces('inside').filter((piece) => piece.bark && Math.sign(piece.x) === side);
        // A side of this hull shows about 1.0 m2 above the water. The laps on the rails were 0.03 m2 of it.
        expect(area(outside), `bark showing outside, side ${side}`).toBeGreaterThan(0.34);
        expect(area(outside), `bark showing outside, side ${side}: the old paint still shows`).toBeLessThan(0.7);
        expect(area(inside), `bark inside, side ${side}`).toBeGreaterThan(1.2);
      }
    });

    it('lies on the planking: under the sheer strake, never proud of the hull, never under the floor inside', () => {
      for (const part of ['outside', 'inside'] as const) {
        for (const piece of pieces(part)) {
          const where = `${part}: x ${piece.x.toFixed(2)} y ${piece.y.toFixed(2)} z ${piece.z.toFixed(2)}`;
          // the sheer strake and the rail above it are left as they were
          expect(piece.y, where).toBeLessThan(shape.sheerAt(piece.z) - 0.02);
          // bark stands 6 mm off the planks; a line of pitch is at most 2.4 cm fat
          expect(Math.abs(piece.x), where).toBeLessThan(shape.halfBeamAt(piece.z) + (part === 'inside' ? 0 : piece.bark ? 0.008 : 0.04));
          if (part === 'inside') expect(piece.y, where).toBeGreaterThan(shape.HULL.floor - 0.02);
        }
      }
    });

    it('is run round with pitch: every sheet has a black line along each of its four edges', () => {
      for (const [part, sheets, inset] of [['outside', SIDE_SHEETS, -0.006], ['inside', INSIDE_SHEETS, 0.03]] as const) {
        const pitch = pieces(part).filter((piece) => piece.pitch);
        const near = (point: THREE.Vector3): boolean => pitch.some((piece) => Math.hypot(piece.x - point.x, piece.y - point.y, piece.z - point.z) < 0.06);
        for (const sheet of sheets) {
          const at = (station: number, edge: number): THREE.Vector3 => {
            const point = shape.hullPoint(-0.992 + (1.984 * station) / 36, sheet.side * [1, 0.93, 0.82, 0.68, 0.52, 0.36, 0.18, 0][edge], inset).clone();
            if (inset > 0 && point.y < shape.HULL.floor) point.y = shape.HULL.floor;
            return point;
          };
          const [middleStation, middleEdge] = [Math.round((sheet.from + sheet.to) / 2), Math.round((sheet.top + sheet.bottom) / 2)];
          for (const [station, edge] of [[middleStation, sheet.top], [middleStation, sheet.bottom], [sheet.from, middleEdge], [sheet.to, middleEdge]]) {
            expect(near(at(station, edge)), `pitch at station ${station}, edge ${edge} of the ${part} sheet from ${sheet.from} on side ${sheet.side}`).toBe(true);
          }
        }
      }
    });

    it('has two old seams payed with pitch from end to end on both sides', () => {
      expect(PITCHED_SEAMS.length).toBe(2);
      const pitch = pieces('outside').filter((piece) => piece.pitch);
      for (const side of [-1, 1]) {
        const along = pitch.filter((piece) => Math.sign(piece.x) === side).map((piece) => piece.z);
        expect(Math.max(...along) - Math.min(...along), `pitch runs along side ${side}`).toBeGreaterThan(0.85 * dimensions.length);
      }
    });

    it('leaves her name showing on both bows, and its joins on one side are not opposite those on the other', () => {
      // OTTER is stencilled from 0.54 to 0.69 of the half length on both bows (b2/canoe.js).
      for (const sheet of SIDE_SHEETS) expect(stationZ(sheet.to), `sheet from station ${sheet.from}`).toBeLessThan(0.54 * shape.HL - 0.1);
      // No line runs right round the hull, but for the two ends, where the run of sheets starts and stops.
      const joins = (side: number): number[] => SIDE_SHEETS.filter((sheet) => sheet.side === side).flatMap((sheet) => [sheet.from, sheet.to]);
      expect(joins(-1).filter((station) => joins(1).includes(station)).length).toBeLessThanOrEqual(2);
    });
  });
});

describe('the canoe says how big it is as drawn, for the built view to frame', () => {
  const boundsOf = (tier: number, attachments: AttachmentId[], crew = 1, place?: (state: GameState) => void): THREE.Box3 => {
    const state = fitted(tier, crew);
    state.canoe.attachments = attachments;
    place?.(state);
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    return view.bounds();
  };
  const sizeOf = (box: THREE.Box3): THREE.Vector3 => box.getSize(new THREE.Vector3());

  it('the bare hull: its own length and beam, from under the waterline to the tips of its ends', () => {
    for (const tier of [0, 1, 2, 3]) {
      const { length, beam, depth, draft } = HULL_TIERS[tier].dimensions;
      const box = boundsOf(tier, []);
      const size = sizeOf(box);
      expect(size.z, `tier ${tier} length`).toBeGreaterThan(length - 0.1);
      expect(size.z, `tier ${tier} length`).toBeLessThan(length + 0.35);
      expect(size.x, `tier ${tier} beam`).toBeGreaterThan(beam - 0.02);
      expect(size.x, `tier ${tier} beam`).toBeLessThan(beam + 0.25);
      expect(box.min.y, `tier ${tier} keel`).toBeCloseTo(-draft, 1);
      // The sheer rises about 30 cm at the ends; the starter kit's bedroll stands no higher.
      expect(box.max.y, `tier ${tier} top`).toBeGreaterThan(depth - draft);
      expect(box.max.y, `tier ${tier} top`).toBeLessThan(depth - draft + 0.6);
    }
  });

  it('grows with what is bolted on: a mast makes it taller, an outrigger wider on its own side', () => {
    const bare = boundsOf(2, []);
    const masted = boundsOf(2, ['mast_sail']);
    expect(masted.max.y).toBeGreaterThan(bare.max.y + 1.5);
    const port = boundsOf(2, ['outrigger_port']);
    // Port is -x in canoe space.
    expect(port.min.x).toBeLessThan(bare.min.x - 0.8);
    // Its spars are lashed down on the far rail, a hand past it.
    expect(port.max.x).toBeLessThan(bare.max.x + 0.1);
    const all = boundsOf(3, ATTACHMENT_IDS.slice());
    expect(sizeOf(all).x).toBeGreaterThan(3);
    expect(all.max.y).toBeGreaterThan(2.5);
  });

  it('leaves the crew out: the same box with four aboard as with one', () => {
    const [one, four] = [boundsOf(1, [], 1), boundsOf(1, [], 4)];
    // Four aboard push the starter kit up to the thwart: the box is the hull's either way, never a paddler's head or a paddle's blade.
    expect(four.max.y).toBeLessThan(HULL_TIERS[1].dimensions.depth + 0.5);
    expect(sizeOf(four).x).toBeCloseTo(sizeOf(one).x, 2);
    expect(sizeOf(four).z).toBeCloseTo(sizeOf(one).z, 2);
  });

  it('counts a paddle left across the gunwales: with the crew ashore the box holds all the canoe draws', () => {
    for (const crew of [1, 4]) {
      const state = fitted(2, crew);
      state.canoe.attachments = [];
      const view = new CanoeView();
      // Aboard first, so each one has a seat to leave their paddle at. Then everyone steps ashore.
      view.sync(state, crewOf(state), 0, 0, true, true);
      const aboard = view.bounds().clone();
      for (const player of state.players) Object.assign(player, { mode: 'foot', seat: null, position: { x: 30 + player.id, y: 1, z: 30 } });
      view.sync(state, crewOf(state), 0, 0, true, true);
      const box = view.bounds();
      // Everything the canoe's own group draws now: the hull, its kit and the paddles left in it. The figures are ashore.
      view.group.updateMatrixWorld(true);
      const toCanoe = view.group.matrixWorld.clone().invert();
      const drawn = new THREE.Box3();
      view.group.traverseVisible((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        drawn.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toCanoe.clone().multiply(mesh.matrixWorld)));
      });
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis], `crew of ${crew}: min ${axis}`).toBeLessThanOrEqual(drawn.min[axis] + 1e-6);
        expect(box.max[axis], `crew of ${crew}: max ${axis}`).toBeGreaterThanOrEqual(drawn.max[axis] - 1e-6);
      }
      // A paddle lies across the hull and stands out past its side: the box is wider than the hull's own.
      expect(sizeOf(box).x, `crew of ${crew}: width with a paddle left aboard`).toBeGreaterThan(sizeOf(aboard).x + 0.2);
    }
  });

  it('is in canoe space: the same box wherever the canoe lies and whichever way it points', () => {
    const home = boundsOf(2, ['mast_sail', 'outrigger_port']);
    const away = boundsOf(2, ['mast_sail', 'outrigger_port'], 1, (state) => {
      state.canoe.position = { x: 412, y: 0.2, z: -377 };
      state.canoe.heading = 2.1;
    });
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(away.min[axis], `min ${axis}`).toBeCloseTo(home.min[axis], 3);
      expect(away.max[axis], `max ${axis}`).toBeCloseTo(home.max[axis], 3);
    }
  });

  it('is empty before the canoe has been drawn', () => {
    expect(new CanoeView().bounds().isEmpty()).toBe(true);
  });
});
