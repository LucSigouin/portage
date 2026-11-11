/**
 * The canoe and its crew. The hull for each tier is lofted from the rules
 * engine's dimensions with B2's hull builder, turned to face -z and sunk by
 * its draft, so the group's origin is the hull centre on the waterline: the
 * game's canoe space. Attachments sit at their mount transforms.
 *
 * Every crew member is drawn: the local player paddles from the stern seat,
 * the others sit along the centreline ahead of them, and anyone ashore
 * stands where the state puts them. All of them, and the canoe, are heroes:
 * the world view draws them at the window's full size (see LOOK.md).
 */
import * as THREE from 'three';
import { HULL_TIERS } from '../data/index.ts';
import { attachmentTransformForHull } from '../sim/index.ts';
import type { Crew } from './crew.ts';
import type { GameState } from '../sim/index.ts';
import { buildAttachment } from './attachments.ts';
import type { AttachmentPiece } from './attachments.ts';
import { buildBilge, buildHull, buildStarterKit, createCrew, makeHullShape } from './b2/canoe.js';
import type { Crew as Figure, HullShape, Outfit } from './b2/canoe.js';
import { PAL } from './b2/palette.js';

interface TierMeshes {
  shape: HullShape;
  group: THREE.Group;
  kit: THREE.Mesh;
  bilge: THREE.Mesh;
}

/** Strokes a second while paddling, and metres walked per stride. */
const STROKE_RATE = 0.78;
const STRIDE_METRES = 1.5;

export interface StrokeEvent { x: number; z: number; strength: number; size: number }

/** What each crew member wears, by their place in the crew. The first is B2's paddler. */
const OUTFITS: readonly Outfit[] = [
  {},
  { coat: PAL.barrelBlue, toque: PAL.ochre, legs: '#5d4b42' },
  { coat: PAL.sageDeep, toque: PAL.cream, legs: '#4b4d57' },
  { coat: PAL.rustLight, toque: PAL.slate, legs: '#57697b' },
];
/** Where the others sit, as a share of the way from the stern seat to the bow seat. */
const SEATS = [1, 0.36, 0.68] as const;

type CrewMember = Crew['local'];

/** One of the crew other than the local player: their figure and their walk. */
interface Mate {
  figure: Figure;
  stride: number;
  moving: number;
  lastX: number;
  lastZ: number;
}

export class CanoeView {
  /** Canoe space: origin at the hull centre on the waterline, bow toward -z. */
  readonly group = new THREE.Group();
  /** The crew who are ashore. Lives in the scene, not the canoe. */
  readonly ashore = new THREE.Group();
  private readonly hullSpace = new THREE.Group();
  private readonly attachments = new THREE.Group();
  private readonly tiers = new Map<number, TierMeshes>();
  private readonly crew: Figure = createCrew();
  private readonly mates: Mate[] = [];
  private pieces: AttachmentPiece[] = [];
  private attachmentsKey = '';
  private tier = -1;
  private phase = 0.2;
  private effort = 0;
  private side = 1;
  private strokes = 0;
  private stride = 0;
  private moving = 0;
  private lastHeading = 0;
  private lastWalked = 0;

  constructor() {
    // B2's hull points +z with its keel at y = 0. Turn it to the game's bow.
    this.hullSpace.rotation.y = Math.PI;
    this.group.rotation.order = 'YXZ';
    this.group.add(this.hullSpace, this.attachments);
  }

  /** The hull this tier draws. Built the first time the tier is seen. */
  private tierMeshes(tier: number): TierMeshes {
    let meshes = this.tiers.get(tier);
    if (!meshes) {
      const shape = makeHullShape(HULL_TIERS[tier].dimensions);
      const group = new THREE.Group();
      const kit = buildStarterKit(shape);
      const bilge = buildBilge(shape);
      group.add(buildHull(shape, tier), kit, bilge);
      group.position.y = -HULL_TIERS[tier].dimensions.draft;
      meshes = { shape, group, kit, bilge };
      this.tiers.set(tier, meshes);
      this.hullSpace.add(group);
    }
    return meshes;
  }

  /** Half the beam of the hull being drawn, for the wake. */
  halfBeam(state: GameState): number {
    return HULL_TIERS[state.canoe.hullTier].dimensions.beam / 2;
  }

  private rebuildAttachments(state: GameState, shape: HullShape): void {
    for (const child of [...this.attachments.children]) {
      this.attachments.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    const dimensions = HULL_TIERS[state.canoe.hullTier].dimensions;
    this.pieces = state.canoe.attachments.map((attachmentId) => {
      const transform = attachmentTransformForHull(attachmentId, state.canoe.hullTier);
      const piece = buildAttachment(attachmentId, {
        hullTier: state.canoe.hullTier,
        shape,
        halfBeam: dimensions.beam / 2,
        gunwaleY: dimensions.depth - dimensions.draft,
        mount: transform.position,
      });
      const holder = new THREE.Group();
      holder.position.set(...transform.position);
      holder.rotation.set(...transform.rotation);
      holder.add(piece.object);
      this.attachments.add(holder);
      return piece;
    });
  }

  /**
   * Move everything to where the state says. `seconds` is how far the look's
   * paint time moved this frame (0 while paused), `time` the paint time,
   * `snap` true on the first frame of a new state.
   * Returns the paddle dips of this frame, for rings on the water.
   */
  sync(state: GameState, everyone: Crew, seconds: number, time: number, showPlayer: boolean, snap: boolean): StrokeEvent[] {
    const canoe = state.canoe;
    const player = everyone.local;
    this.group.position.set(canoe.position.x, canoe.position.y, canoe.position.z);
    this.group.rotation.set(canoe.pitch, -canoe.heading, -canoe.roll);

    if (canoe.hullTier !== this.tier) {
      this.tier = canoe.hullTier;
      const shown = this.tierMeshes(this.tier);
      for (const meshes of this.tiers.values()) meshes.group.visible = meshes === shown;
    }
    const { shape, kit, bilge } = this.tierMeshes(this.tier);
    const key = `${canoe.hullTier}:${canoe.attachments.join(',')}`;
    if (key !== this.attachmentsKey) {
      this.attachmentsKey = key;
      this.rebuildAttachments(state, shape);
    }
    for (const piece of this.pieces) piece.update?.(canoe, time);

    // The bare canoe carries the paddler's kit. Once it is ribbed, the cargo goes on racks.
    kit.visible = canoe.hullTier < 2;
    // The leak: bilge water that rises with the water level.
    bilge.visible = canoe.waterLevel > 1;
    const flooded = canoe.waterLevel / 100;
    bilge.position.y = 0.09 + flooded * (shape.HULL.D - 0.15);
    bilge.scale.set(1 + flooded * 0.55, 1, 1 + flooded * 0.5);

    const events: StrokeEvent[] = [];
    const crew = this.crew;
    crew.root.visible = showPlayer;
    if (player.mode === 'canoe') {
      if (crew.root.parent !== this.hullSpace) this.hullSpace.add(crew.root);
      crew.root.position.set(0, shape.HULL.seatY + 0.035 - shape.HULL.draft, shape.HULL.seatZ);
      crew.root.rotation.set(0, 0, 0);
      // Paddling shows when the canoe is under way by muscle: not beached, not bailing, not under sail.
      const underSail = canoe.sailRaised && canoe.attachments.includes('mast_sail');
      const wanted = !canoe.beached && !canoe.bailing && !underSail && Math.abs(canoe.speed) > 0.3 ? 1 : 0;
      // A game just handed over (a load, a staged shot) starts mid-stroke, not from rest.
      this.effort = snap ? wanted : this.effort + (wanted - this.effort) * Math.min(1, seconds * 4);
      const previous = this.phase;
      if (this.effort > 0.3) this.phase += seconds * STROKE_RATE;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.strokes += 1;
      }
      // Steer by paddling on the outside of the turn; otherwise switch every third stroke.
      const turn = seconds > 0 ? Math.atan2(Math.sin(canoe.heading - this.lastHeading), Math.cos(canoe.heading - this.lastHeading)) / seconds : 0;
      if (turn < -0.12) this.side = -1;
      else if (turn > 0.12) this.side = 1;
      else if (this.phase < previous && this.strokes % 3 === 0) this.side = -this.side;
      const stroke = crew.paddle(seconds, this.phase, this.effort, this.side);
      if (this.effort > 0.6 && seconds > 0) {
        const crossed = (mark: number): boolean => previous < mark && this.phase >= mark;
        if (crossed(0.03) || crossed(0.44)) events.push({ x: stroke.blade.x, z: stroke.blade.z, strength: 0.95, size: 0.9 });
        if (crossed(0.2)) events.push({ x: stroke.blade.x, z: stroke.blade.z, strength: 0.7, size: 0.6 });
      }
    } else {
      if (crew.root.parent !== this.ashore) this.ashore.add(crew.root);
      crew.root.position.set(player.position.x, player.position.y, player.position.z);
      // The model faces +z; the game's forward is -z turned by the heading.
      crew.root.rotation.set(0, Math.PI - player.heading, 0);
      const walked = state.statistics.distanceWalked - this.lastWalked;
      const walking = seconds > 0 && walked > 0.002 ? 1 : 0;
      if (seconds > 0) this.moving += (walking - this.moving) * Math.min(1, seconds * 8);
      if (walked > 0 && walked < 5) this.stride += (walked / STRIDE_METRES) * Math.PI * 2;
      crew.stand(time, this.stride, this.moving);
      this.effort = 0;
    }
    this.lastHeading = canoe.heading;
    this.lastWalked = state.statistics.distanceWalked;
    everyone.others.forEach((member, index) => this.syncMate(member, index, shape, seconds, time, showPlayer));
    for (let index = everyone.others.length; index < this.mates.length; index += 1) this.mates[index].figure.root.visible = false;
    return events;
  }

  /** Another crew member: seated ahead of the paddler with their paddle at rest, or standing where they are ashore. */
  private syncMate(member: CrewMember, index: number, shape: HullShape, seconds: number, time: number, shown: boolean): void {
    let mate = this.mates[index];
    if (!mate) {
      mate = { figure: createCrew(OUTFITS[(index + 1) % OUTFITS.length]), stride: 0, moving: 0, lastX: member.position.x, lastZ: member.position.z };
      this.mates[index] = mate;
    }
    const root = mate.figure.root;
    root.visible = shown;
    if (member.mode === 'canoe') {
      if (root.parent !== this.hullSpace) this.hullSpace.add(root);
      const { seatY, seatZ, bowSeatZ, draft } = shape.HULL;
      root.position.set(0, seatY + 0.035 - draft, seatZ + (bowSeatZ - seatZ) * SEATS[index % SEATS.length]);
      root.rotation.set(0, 0, 0);
      mate.figure.paddle(seconds, 0, 0, index % 2 ? 1 : -1);
    } else {
      if (root.parent !== this.ashore) this.ashore.add(root);
      root.position.set(member.position.x, member.position.y, member.position.z);
      root.rotation.set(0, Math.PI - member.heading, 0);
      const walked = Math.hypot(member.position.x - mate.lastX, member.position.z - mate.lastZ);
      if (seconds > 0) mate.moving += ((walked > 0.002 ? 1 : 0) - mate.moving) * Math.min(1, seconds * 8);
      if (walked < 5) mate.stride += (walked / STRIDE_METRES) * Math.PI * 2;
      mate.figure.stand(time, mate.stride, mate.moving);
    }
    mate.lastX = member.position.x;
    mate.lastZ = member.position.z;
  }

  /** How many crew figures are in the picture right now. */
  figuresShown(): number {
    return [this.crew, ...this.mates.map((mate) => mate.figure)].filter(({ root }) => root.visible && root.parent !== null).length;
  }

  /** The local player's figure, wherever it stands or sits. */
  localFigure(): THREE.Object3D {
    return this.crew.root;
  }

  /** Each hero the world view draws apart from the world: the canoe with all aboard, and each person ashore. */
  heroes(): THREE.Object3D[] {
    return [this.group, ...this.ashore.children];
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.ashore.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
}
