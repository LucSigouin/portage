/**
 * The canoe and its crew. The hull for each tier is lofted from the rules
 * engine's dimensions with B2's hull builder, turned to face -z and sunk by
 * its draft, so the group's origin is the hull centre on the waterline: the
 * game's canoe space. Attachments sit at their mount transforms.
 *
 * Every player is drawn from their own state, the local one included:
 * - dressed by player id (`outfitOf`), so a person looks the same on every screen;
 * - aboard, at the rules engine's seat for them (`seatTransformForHull`): seats 0 and 1 sit, 2 and 3 kneel;
 * - paddling, bailing, asleep or at rest by their own flags, never by the canoe's speed;
 * - ashore, standing where the state puts them, walking by their own change in position, the tool they picked in
 *   the right hand and their paddle left in the canoe, across the gunwales at their seat.
 * All of them, and the canoe, are heroes: the world view draws them at the
 * window's full size (see LOOK.md).
 */
import * as THREE from 'three';
import { HULL_TIERS, TUNING } from '../data/index.ts';
import type { ToolId } from '../data/index.ts';
import { FIXED_STEP, airborne, attachmentTransformForHull, leapHeight, seatTransformForHull } from '../sim/index.ts';
import { outfitOf } from './crew.ts';
import type { Crew } from './crew.ts';
import type { GameState } from '../sim/index.ts';
import { buildAttachment } from './attachments.ts';
import type { AttachmentPiece } from './attachments.ts';
import { STROKE_PULL, buildBilge, buildHull, buildStarterKit, createCrew, makeHullShape } from './b2/canoe.js';
import { CREW_LAYER } from './b2/post.js';
import type { Crew as Figure, HullShape, SeatedPose } from './b2/canoe.js';
import { deckInner, deckSpan, sparsAlong } from './canoe/deck-parts.ts';
import { buildMends, buildSheets } from './canoe/mends.ts';
import { TOOL_CARRY, buildHandTool } from './hand-tools.ts';
import { jumpPose } from './jump-pose.ts';

interface TierMeshes {
  shape: HullShape;
  group: THREE.Group;
  kit: THREE.Mesh;
  /** The kit shoved up to the thwart, for when someone kneels amidships. Built the first time it is needed. */
  kitCrewed: THREE.Mesh | null;
  bilge: THREE.Mesh;
  /** How high the kit stands along the hull, slice by slice: measured the first time someone wants to change sides over it. */
  kitTops: Float32Array | null;
}

/** Strokes a second while paddling, scoops a second while bailing, and metres walked per stride. */
const STROKE_RATE = 0.78;
const BAIL_RATE = 0.8;
const STRIDE_METRES = 1.5;
/** A seated figure's origin sits this far above the top of its seat. */
const SEAT_LIFT = 0.035;
/** A sleeper ashore lies this far above the ground: their back rests on it. */
const LYING_LIFT = 0.16;
/** The hull tier that is the leaky boat mended. */
const PATCHED_TIER = 1;
/** The share of a stroke that is the pull; the rest is the recovery. The figure's own split (`paddle` in b2/canoe.js). */
const PULL_SHARE = STROKE_PULL;
/** A paddle laid across the gunwales lies this far ahead of its paddler's seat. */
const REST_AHEAD = 0.42;
/** A paddle from grip to blade tip, as the figure's is built. */
const PADDLE_LENGTH = 1.485;
/** Where in the stroke a paddler changes sides: in the recovery, the blade out of the water, flat, swinging forward. */
const CHANGE_AT = 0.87;
/** A change of sides takes this long. The crew's stroke waits for it, then goes on from where it was. */
const CHANGE_SECONDS = 0.9;
/** The paddle is carried across the bow, level: it sweeps this far ahead of its paddler, who needs that much clear. */
const CARRY_REACH = 1.75;
/** It is carried this far above whatever lies ahead: at the lap at the lowest, and never higher than the chest. */
const CARRY_CLEARANCE = 0.1;
const CARRY_LOWEST = 0.44;
const CARRY_HIGHEST = 0.6;
/** What stands in a hull is measured along it in slices this long, over this many metres either way from amidships. */
const SLICE = 0.1;
const SLICES_HALF = 40;

/** A row of slices along the hull with nothing in them yet. */
const emptySlices = (): Float32Array => new Float32Array(SLICES_HALF * 2).fill(-Infinity);

/**
 * Raise `tops` to the top of every mesh under `root`: per slice along z, the highest y of any triangle that reaches
 * into it. `toHull` takes a mesh's world space to the hull's own (bow toward +z, the waterline at y = 0).
 */
function measureTops(root: THREE.Object3D, toHull: THREE.Matrix4, tops: Float32Array): void {
  const matrix = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    const index = object.geometry.getIndex();
    matrix.multiplyMatrices(toHull, object.matrixWorld);
    const count = index ? index.count : positions.count;
    for (let first = 0; first + 2 < count; first += 3) {
      let [nearest, furthest, top] = [Infinity, -Infinity, -Infinity];
      for (let each = 0; each < 3; each += 1) {
        corner.fromBufferAttribute(positions, index ? index.getX(first + each) : first + each).applyMatrix4(matrix);
        nearest = Math.min(nearest, corner.z);
        furthest = Math.max(furthest, corner.z);
        top = Math.max(top, corner.y);
      }
      const from = Math.max(0, Math.floor(nearest / SLICE) + SLICES_HALF);
      const to = Math.min(tops.length - 1, Math.floor(furthest / SLICE) + SLICES_HALF);
      for (let slice = from; slice <= to; slice += 1) tops[slice] = Math.max(tops[slice], top);
    }
  });
}
/** Where in the stroke the blade marks the water: the catch and the exit firmly, the middle of the pull lightly. */
const DIPS = { catch: 0.03, middle: 0.3, exit: PULL_SHARE - 0.04 } as const;
/** A game just handed over with the canoe going astern faster than this shows back strokes from its first frame. */
const ASTERN_SPEED = 0.05;
/**
 * Which way the crew drives the canoe is read from its speed and how that speed is changing: the speed the rules are
 * taking it to (`sim/canoe.ts` eases the speed toward a target). Past this either way, metres a second, the stroke
 * turns to match; between, it stays as it was. The reading is held to a canoe's range and smoothed over a few frames,
 * so one odd frame (running aground stops the canoe dead) turns nothing.
 */
const DRIVE_TURNS = 0.25;
const DRIVE_RANGE = 5;
const DRIVE_RATE = 12;
/** Below this the stroke's last trace is let go: the paddle lies at rest, exactly. */
const EFFORT_REST = 0.004;
/** From rest the stroke is taken up here: in the recovery, the blade lifted and swinging to its first catch. */
const TAKE_UP = 0.8;
/** A paddle's tip stays this far inside the inner edge of an outrigger's deck (the planks' ends are ragged by 5 cm). */
const DECK_CLEARANCE = 0.08;
/** A bow or stern paddler's blade stops this far short of a deck's end: the tip past the blade, and a margin. */
const DECK_END_CLEARANCE = 0.26;
/** A kneeler's blade keeps this far from an outrigger's spar ahead or behind: the tip past the blade, its width, a margin. */
const SPAR_CLEARANCE = 0.3;
/** However hemmed in, a stroke reaches at least this far ahead and behind the paddler. */
const MINIMUM_REACH = 0.08;

export interface StrokeEvent { x: number; z: number; strength: number; size: number }

type CrewMember = Crew['local'];

/** One player's figure, and what it is in the middle of. */
interface Member {
  figure: Figure;
  /** Seat aboard, null ashore. */
  seat: number | null;
  /** 0 to 1 each: the stroke, the bailing, asleep, the walk. They ease toward the player's flags. */
  effort: number;
  bailing: number;
  asleep: number;
  moving: number;
  bailPhase: number;
  /** The side this one's paddle works on: +1 the figure's left, -1 its right. */
  side: number;
  /** 0 to 1 through a change of sides, the paddle carried across the bow to `side`. 1: settled. */
  cross: number;
  /** How high this one carries the paddle across, above their seat: clear of what lies ahead in the hull. */
  carry: number;
  stride: number;
  lastX: number;
  lastZ: number;
  /** False until this figure has been placed once, and on the frame it steps out of the canoe: no stride then. */
  afoot: boolean;
  /** True once this figure has sat in the canoe: its first stroke starts on its own side, later ones ease over. */
  seated: boolean;
  /** The seat this one last sat in, and the side their paddle worked on there: ashore, the paddle is left there, its blade out on that side. */
  lastSeat: number | null;
  restSide: number;
  /** Placed in the hull as this one sits: holds their paddle while they are ashore. */
  berth: THREE.Group;
  /** The tools this one has had in hand, each drawn the first time it is picked. One is shown at a time, ashore. */
  tools: Map<ToolId, THREE.Mesh>;
  holding: ToolId | null;
  /** Metres the figure is drawn above the ground it is over: a jump. 0 aboard. */
  lift: number;
}

/** What `figures()` says of one crew figure: what is drawn, not what the state asked for. */
export interface FigureReport {
  id: number;
  /** Seat aboard (0 to 3), null ashore. */
  seat: number | null;
  /** Where the figure is: in canoe space aboard, in the world ashore. */
  position: [number, number, number];
  /** 0 to 1 each. */
  paddling: number;
  bailing: number;
  asleep: number;
  walking: number;
  kneeling: boolean;
  /** The side its paddle works on, +1 or -1. */
  side: number;
  /** Radians of walk cycle so far. */
  stride: number;
  /** The colours its coat sleeve and its trouser leg carry. */
  coat: string;
  legs: string;
  /** The tool drawn in its hand: ashore, the one the player picked. Null aboard, asleep, or with none picked. */
  holding: ToolId | null;
  /** Where its paddle is drawn: in its hands aboard, left in the canoe while it is ashore, or nowhere (its seat is taken). */
  paddle: 'hands' | 'canoe' | null;
  /** Metres its feet are drawn above the ground: a jump. 0 on the ground and aboard. */
  lift: number;
}

const colourOf = (mesh: THREE.Mesh): string => {
  const colours = mesh.geometry.getAttribute('aColor');
  return `#${new THREE.Color(colours.getX(0), colours.getY(0), colours.getZ(0)).getHexString()}`;
};

export class CanoeView {
  /** Canoe space: origin at the hull centre on the waterline, bow toward -z. */
  readonly group = new THREE.Group();
  /** The crew who are ashore. Lives in the scene, not the canoe. */
  readonly ashore = new THREE.Group();
  private readonly hullSpace = new THREE.Group();
  private readonly attachments = new THREE.Group();
  private readonly tiers = new Map<number, TierMeshes>();
  /** One figure per player id, made the first time that player is seen. */
  private readonly members = new Map<number, Member>();
  private pieces: AttachmentPiece[] = [];
  /** Where each attachment with a flame has it, in canoe space. */
  private flames: { lantern: THREE.Vector3 | null; firebox: THREE.Vector3 | null } = { lantern: null, firebox: null };
  private readonly flamePoint = new THREE.Vector3();
  private attachmentsKey = '';
  private tier = -1;
  /** The crew's one stroke clock, 0 to 1 round a stroke from the catch: everyone paddling is in time. Astern it runs backwards. */
  private phase = 0.2;
  /** The side the stern paddler works on. The others alternate from it along the hull. */
  private side = 1;
  /**
   * True while the crew back-paddles: the stroke's clock runs backwards, the blade going in behind and pushed
   * forward. The rules keep no paddling direction per player, so the look reads it from where the canoe's speed is
   * being taken (`drive`): a paddler pressing back shows a back stroke at once, while the canoe still runs ahead.
   */
  private astern = false;
  /** The speed the crew is driving the canoe to, as read from its speed and the change in it, and what that was read from. */
  private drive = 0;
  private lastSpeed = 0;
  private lastStateTime = 0;
  private strokes = 0;
  /** How high the fittings stand along the hull, slice by slice (bow toward +z, above the waterline): what a paddle carried across the bow has to clear. */
  private fittingTops = emptySlices();
  /** Whether the crew has room to change sides, and what it was worked out for: the hull and its fittings, and who sits where. */
  private room = false;
  private roomFittings = '';
  private roomSeats = -1;
  private lastHeading = 0;
  private localId = 0;
  private readonly shaft = new THREE.Vector3();
  private readonly toCanoe = new THREE.Matrix4();
  private readonly pieceMatrix = new THREE.Matrix4();
  private readonly pieceBox = new THREE.Box3();

  constructor() {
    // B2's hull points +z with its keel at y = 0. Turn it to the game's bow.
    this.hullSpace.rotation.y = Math.PI;
    this.group.rotation.order = 'YXZ';
    this.group.add(this.hullSpace, this.attachments);
    // Player 0 is made first, as the lone paddler always was: the figure's pen seeds follow the order of making.
    this.member(0);
  }

  /** The figure for a player, in their own colours. Made the first time the player is seen. */
  private member(playerId: number): Member {
    let member = this.members.get(playerId);
    if (!member) {
      const { coat, toque, legs } = outfitOf(playerId);
      const figure = createCrew({ coat, toque, legs });
      figure.root.rotation.order = 'YXZ';
      member = {
        figure, seat: null, effort: 0, bailing: 0, asleep: 0, moving: 0, bailPhase: 0.6, side: 1, cross: 1, carry: CARRY_LOWEST, stride: 0, lastX: 0, lastZ: 0, afoot: false, seated: false,
        lastSeat: null, restSide: 1, berth: new THREE.Group(), tools: new Map(), holding: null, lift: 0,
      };
      member.berth.rotation.order = 'YXZ';
      this.members.set(playerId, member);
    }
    return member;
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
      // The patched hull is told from the leaky one by its bark: sheets along its sides and inside, laps over its rails.
      if (tier === PATCHED_TIER) group.add(buildMends(shape), buildSheets(shape));
      group.position.y = -HULL_TIERS[tier].dimensions.draft;
      meshes = { shape, group, kit, kitCrewed: null, bilge, kitTops: null };
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
        rotation: transform.rotation,
      });
      const holder = new THREE.Group();
      holder.position.set(...transform.position);
      holder.rotation.set(...transform.rotation);
      holder.add(piece.object);
      this.attachments.add(holder);
      return piece;
    });
    const flame = (attachmentId: string): THREE.Vector3 | null => {
      const spot = this.pieces[(state.canoe.attachments as string[]).indexOf(attachmentId)]?.lamp;
      return spot ? new THREE.Vector3(...spot) : null;
    };
    this.flames = { lantern: flame('lantern_mast'), firebox: flame('firebox') };
    // What a paddle carried across the bow has to clear. The hull's own space runs the other way from the canoe's.
    this.fittingTops = emptySlices();
    this.group.updateMatrixWorld(true);
    measureTops(this.attachments, this.toCanoe.copy(this.hullSpace.matrixWorld).invert(), this.fittingTops);
    this.roomFittings = '';
  }

  /**
   * Whether everyone aboard can change sides, and how high each carries the paddle across. A paddle is carried
   * across the bow level, at the lap: it needs the hull clear ahead of its paddler as far as it sweeps, with nobody
   * sitting there and nothing bolted on standing higher than the chest. Short of room, the crew keeps its sides.
   * Worked out again only when the hull, its fittings or the seating change.
   */
  private roomToChange(aboard: Member[], tier: TierMeshes, fittings: string): boolean {
    let seats = 0;
    for (const member of aboard) seats |= 1 << (member.seat as number);
    if (fittings === this.roomFittings && seats === this.roomSeats) return this.room;
    this.roomFittings = fittings;
    this.roomSeats = seats;
    const { shape, kit } = tier;
    const draft = shape.HULL.draft;
    this.room = aboard.length > 0;
    for (const member of aboard) {
      const root = member.figure.root.position;
      const [near, far] = [root.z + 0.15, root.z + CARRY_REACH];
      if (aboard.some((other) => other !== member && other.figure.root.position.z > root.z && other.figure.root.position.z < far)) this.room = false;
      if (kit.visible && !tier.kitTops) {
        tier.kitTops = emptySlices();
        this.group.updateMatrixWorld(true);
        measureTops(kit, this.toCanoe.copy(this.hullSpace.matrixWorld).invert(), tier.kitTops);
      }
      let tallest = -Infinity;
      for (let z = near; z <= Math.min(far, shape.HL); z += SLICE) tallest = Math.max(tallest, shape.sheerAt(z) - draft);
      const [first, last] = [Math.max(0, Math.floor(near / SLICE) + SLICES_HALF), Math.min(SLICES_HALF * 2 - 1, Math.floor(far / SLICE) + SLICES_HALF)];
      for (let slice = first; slice <= last; slice += 1) {
        tallest = Math.max(tallest, this.fittingTops[slice]);
        if (kit.visible && tier.kitTops) tallest = Math.max(tallest, tier.kitTops[slice]);
      }
      member.carry = Math.max(CARRY_LOWEST, tallest - root.y + CARRY_CLEARANCE);
      if (member.carry > CARRY_HIGHEST) this.room = false;
    }
    return this.room;
  }

  /** Where the lantern's flame and the firebox's are drawn, in the world, as of the last `sync`. Null where the canoe has none. */
  lights(): { lantern: [number, number, number] | null; firebox: [number, number, number] | null } {
    this.group.updateMatrixWorld();
    const world = (spot: THREE.Vector3 | null): [number, number, number] | null =>
      spot && (this.flamePoint.copy(spot).applyMatrix4(this.group.matrixWorld).toArray() as [number, number, number]);
    return { lantern: world(this.flames.lantern), firebox: world(this.flames.firebox) };
  }

  /**
   * Move everything to where the state says. `seconds` is how far the look's
   * paint time moved this frame (0 while paused), `time` the paint time,
   * `snap` true on the first frame of a new state.
   * Returns the paddle dips of this frame, for rings on the water.
   */
  sync(state: GameState, everyone: Crew, seconds: number, time: number, showPlayer: boolean, snap: boolean): StrokeEvent[] {
    const canoe = state.canoe;
    this.group.position.set(canoe.position.x, canoe.position.y, canoe.position.z);
    this.group.rotation.set(canoe.pitch, -canoe.heading, -canoe.roll);

    if (canoe.hullTier !== this.tier) {
      this.tier = canoe.hullTier;
      const shown = this.tierMeshes(this.tier);
      for (const meshes of this.tiers.values()) meshes.group.visible = meshes === shown;
    }
    const tier = this.tierMeshes(this.tier);
    const { shape, bilge } = tier;
    const key = `${canoe.hullTier}:${canoe.attachments.join(',')}`;
    if (key !== this.attachmentsKey) {
      this.attachmentsKey = key;
      this.rebuildAttachments(state, shape);
    }
    for (const piece of this.pieces) piece.update?.(canoe, time);

    const players = [everyone.local, ...everyone.others];
    this.localId = everyone.local.id;
    // The crew moves by the rules' own clock. The paint time handed in is cut to the frame's length, and the rules
    // step sixty times a second: on a screen drawn faster than that (a frame cap of 90 or more, or none) a frame with
    // a rules step in it stood for only a part of the step, and the stroke ran at half speed or less. Such a frame
    // now moves the crew by the whole step, as it moves the canoe. Never more than a step for a longer jump (a
    // night slept, a replay run fast), and nothing while paused.
    const elapsed = state.time - this.lastStateTime;
    const beat = seconds > 0 && elapsed > 0 ? Math.min(elapsed, Math.max(seconds, FIXED_STEP)) : seconds;
    // Aboard without a seat is a state the rules never make (a staged shot can): such a one takes the first seat nobody holds.
    const spare = [0, 1, 2, 3].filter((seat) => !players.some((player) => player.mode === 'canoe' && player.seat === seat));
    const seats = new Map(players.map((player) => [player, player.mode === 'canoe' ? player.seat ?? spare.shift() ?? 0 : null]));
    const seatOf = (player: CrewMember): number | null => seats.get(player) ?? null;

    // The bare canoe carries the paddler's kit. Once it is ribbed, the cargo goes on racks.
    // With someone kneeling amidships the loose kit is shoved up to the thwart, out from under them.
    const kneelers = players.some((player) => (seatOf(player) ?? 0) >= 2);
    if (kneelers && canoe.hullTier < 2 && !tier.kitCrewed) {
      tier.kitCrewed = buildStarterKit(shape, true);
      tier.group.add(tier.kitCrewed);
    }
    tier.kit.visible = canoe.hullTier < 2 && !kneelers;
    if (tier.kitCrewed) tier.kitCrewed.visible = canoe.hullTier < 2 && kneelers;
    // The leak: bilge water that rises with the water level.
    bilge.visible = canoe.waterLevel > 1;
    const flooded = canoe.waterLevel / 100;
    bilge.position.y = shape.HULL.floor + 0.012 + flooded * (shape.HULL.D - shape.HULL.floor - 0.07);
    bilge.scale.set(1 + flooded * 0.55, 1, 1 + flooded * 0.5);

    // What each one is doing eases toward their own flags. A game just handed over (a load, a staged shot)
    // starts mid-stroke, not from rest.
    const ease = (value: number, wanted: number, rate: number): number => (snap ? wanted : value + (wanted - value) * Math.min(1, beat * rate));
    let working = 0;
    let crossing = false;
    for (const player of players) {
      const member = this.member(player.id);
      member.seat = seatOf(player);
      const aboard = member.seat !== null;
      if (snap || !aboard) member.cross = 1;
      if (member.cross < 1) crossing = true;
      member.effort = aboard ? ease(member.effort, player.paddling ? 1 : 0, 4) : 0;
      if (!player.paddling && member.effort < EFFORT_REST) member.effort = 0;
      member.bailing = aboard ? ease(member.bailing, player.bailing ? 1 : 0, 5) : 0;
      member.asleep = ease(member.asleep, player.asleep ? 1 : 0, 3);
      if (member.bailing > 0.02) member.bailPhase = (member.bailPhase + beat * BAIL_RATE) % 1;
      working = Math.max(working, member.effort);
    }

    // Which way the crew drives: read while someone paddles, from the canoe's speed and the change in it.
    if (snap || elapsed < 0 || elapsed > 1) {
      this.drive = canoe.speed;
      if (snap) this.astern = canoe.speed < -ASTERN_SPEED;
    } else if (elapsed > 0) {
      const driven = canoe.speed + (canoe.speed - this.lastSpeed) / elapsed / TUNING.canoe.thrustResponse;
      this.drive += (Math.max(-DRIVE_RANGE, Math.min(DRIVE_RANGE, driven)) - this.drive) * Math.min(1, elapsed * DRIVE_RATE);
      if (players.some((player) => player.mode === 'canoe' && player.paddling)) {
        if (this.drive < -DRIVE_TURNS) this.astern = true;
        else if (this.drive > DRIVE_TURNS) this.astern = false;
      }
    }
    this.lastSpeed = canoe.speed;
    this.lastStateTime = state.time;
    // One stroke clock for the crew. It runs while anyone paddles, and waits while a paddle is carried across the bow.
    // Astern it runs backwards: the same stroke the other way round, with nothing to jump when the crew turns it.
    // With every paddle at rest, the next stroke is taken up from the recovery: reach forward first, then pull.
    if (working === 0 && !snap) this.phase = TAKE_UP;
    const previous = this.phase;
    if (working > 0.3 && !crossing) this.phase += (this.astern ? -1 : 1) * beat * STROKE_RATE;
    let wrapped = 0;
    if (this.phase >= 1) wrapped = 1;
    else if (this.phase < 0) wrapped = -1;
    this.phase -= wrapped;
    if (wrapped !== 0) this.strokes += 1;
    // Steer by paddling on the outside of the turn; otherwise switch every third stroke.
    const turn = beat > 0 ? Math.atan2(Math.sin(canoe.heading - this.lastHeading), Math.cos(canoe.heading - this.lastHeading)) / beat : 0;
    if (turn < -0.12) this.side = -1;
    else if (turn > 0.12) this.side = 1;
    else if (wrapped !== 0 && this.strokes % 3 === 0) this.side = -this.side;
    this.lastHeading = canoe.heading;
    // Crewmates paddle on alternating sides, counted along the hull from the stern.
    const fromStern = players
      .filter((player) => seatOf(player) !== null)
      .sort((first, second) => seatTransformForHull(this.tier, seatOf(second) as number).position[2] - seatTransformForHull(this.tier, seatOf(first) as number).position[2]);

    // An outrigger's deck leaves a kneeler only the well between hull and deck to paddle in.
    const decks = { port: canoe.attachments.includes('outrigger_port'), starboard: canoe.attachments.includes('outrigger_starboard') };
    const anyDeck = decks.port || decks.starboard;
    const wellEdge = deckInner(this.halfBeam(state)) - DECK_CLEARANCE;
    const deckRuns = deckSpan(this.tier);
    // A mark in the stroke, passed this frame, whichever way the clock runs.
    const advanced = this.phase + wrapped - previous;
    const passes = (mark: number): boolean => {
      const ahead = (((advanced > 0 ? mark - previous : previous - mark) % 1) + 1) % 1;
      return advanced !== 0 && ahead > 0 && ahead <= Math.abs(advanced);
    };
    // A paddler changes sides in the recovery, as the blade swings forward flat over the water: the stroke waits
    // there while the paddle is carried across the bow, low, and goes on from the same place on the other side.
    // Only with room for it, and never when everyone is on their side already.
    const seated = players.map((player) => this.member(player.id)).filter((member) => member.seat !== null);
    for (const member of seated) {
      const seat = seatTransformForHull(this.tier, member.seat as number);
      member.figure.root.position.set(-seat.position[0], seat.position[1] + SEAT_LIFT, -seat.position[2]);
    }
    const wantedOf = (player: CrewMember): number => this.side * (fromStern.indexOf(player) % 2 ? -1 : 1);
    const due = passes(CHANGE_AT) && players.some((player) => seatOf(player) !== null && this.member(player.id).seated && this.member(player.id).side !== wantedOf(player))
      && this.roomToChange(seated, tier, key);
    if (due) this.phase = CHANGE_AT;
    const stroke = this.phase;

    const events: StrokeEvent[] = [];
    for (const player of players) {
      const member = this.member(player.id);
      const { figure } = member;
      const root = figure.root;
      root.visible = showPlayer;
      if (member.seat !== null) {
        if (root.parent !== this.hullSpace) this.hullSpace.add(root);
        const seat = seatTransformForHull(this.tier, member.seat);
        // The hull's own space is canoe space turned half round: x and z change sign.
        root.position.set(-seat.position[0], seat.position[1] + SEAT_LIFT, -seat.position[2]);
        root.rotation.set(-seat.rotation[0], seat.rotation[1], -seat.rotation[2]);
        // Counted along the hull from the stern, every second one works their paddle on the other side, and rests it there.
        const across = fromStern.indexOf(player) % 2 ? -1 : 1;
        // Seated for the first time, a paddler takes their side at once. After that a change is carried across the
        // bow, and one called back half way (the canoe turned the other way) comes back the way it went.
        if (!member.seated) {
          member.side = this.side * across;
          member.cross = 1;
        } else if (member.side !== this.side * across && (member.cross < 1 || due)) {
          member.side = this.side * across;
          member.cross = 1 - member.cross;
        }
        if (member.cross < 1) member.cross = Math.min(1, member.cross + beat / CHANGE_SECONDS);
        const kneel = member.seat >= 2 ? 1 : 0;
        // The hull's widest half beam along the stroke, from the hip back to the catch ahead: the blade works outside it.
        const station = root.position.z;
        const along = [-0.3, 0, 0.35, 0.75].map((ahead) => station + ahead);
        const beam = Math.max(...along.map((z) => shape.halfBeamAt(z)));
        // And its gunwale at the highest, above the seat: the lower hand rides over it.
        const gunwale = Math.max(...along.map((z) => shape.sheerAt(z))) - shape.HULL.draft - root.position.y;
        // And where a paddle laid across the gunwales lies, a little ahead of the lap.
        const rail = shape.sheerAt(station + REST_AHEAD) - shape.HULL.draft - root.position.y;
        const more: SeatedPose = { kneel, floor: seat.position[1] + SEAT_LIFT + shape.HULL.draft, bail: member.bailing, bailPhase: member.bailPhase, sleep: member.asleep, beam, gunwale, rail };
        if (member.cross < 1) {
          more.cross = member.cross;
          more.carry = member.carry;
        }
        // A kneeler beside a deck brings the blade back through the water the way it went: the pull run backwards,
        // the blade turned edge on. The figure's own recovery swings the blade out wide, under the deck.
        const hemmed = kneel === 1 && anyDeck;
        // Its blade works in the well: the tip stays inside the deck's inner edge, out from the figure's centre, and
        // the stroke stays between the spars ahead and behind.
        if (hemmed) {
          more.well = wellEdge - Math.abs(root.position.x);
          const gaps = sparsAlong(this.tier).map((spar) => seat.position[2] - spar);
          const ahead = Math.min(Infinity, ...gaps.filter((gap) => gap > 0)) - SPAR_CLEARANCE;
          const behind = Math.max(-Infinity, ...gaps.filter((gap) => gap < 0)) + SPAR_CLEARANCE;
          more.span = [Math.min(-MINIMUM_REACH, behind), Math.max(MINIMUM_REACH, ahead)];
        } else if (anyDeck) {
          // Seated past a deck's end, the stroke stops short of it: the blade never reaches over the planks.
          const ahead = seat.position[2] - deckRuns.aft - DECK_END_CLEARANCE;
          const behind = seat.position[2] - deckRuns.forward + DECK_END_CLEARANCE;
          more.span = [behind < 0 ? Math.min(-MINIMUM_REACH, behind) : -Infinity, ahead > 0 ? Math.max(MINIMUM_REACH, ahead) : Infinity];
        }
        const back = hemmed && stroke > PULL_SHARE ? (stroke - PULL_SHARE) / (1 - PULL_SHARE) : 0;
        const dip = figure.paddle(member.seated ? beat : 1, back > 0 ? PULL_SHARE * (1 - back) : stroke, member.effort, member.side, more);
        member.seated = true;
        if (back > 0) figure.paddler.paddle.rotateY(Math.sin(back * Math.PI) * member.effort * (Math.PI / 2));
        if (anyDeck) this.clearOfDecks(root, figure.paddler.paddle, decks, wellEdge, deckRuns);
        if (member.effort > 0.6 && beat > 0) {
          if (passes(DIPS.catch) || passes(DIPS.exit)) events.push({ x: dip.blade.x, z: dip.blade.z, strength: 0.95, size: 0.9 });
          if (passes(DIPS.middle)) events.push({ x: dip.blade.x, z: dip.blade.z, strength: 0.7, size: 0.6 });
        }
        member.afoot = false;
        member.moving = 0;
        member.lastSeat = member.seat;
        member.restSide = member.side;
        member.lift = 0;
        this.hold(member, null, player.id);
      } else {
        if (root.parent !== this.ashore) this.ashore.add(root);
        // The model faces +z; the game's forward is -z turned by the heading. A sleeper is laid on their back.
        // A jump lifts the figure off the ground it is over; the state's own height stays the ground's (so does the camera).
        member.lift = leapHeight(player.leap) * (1 - member.asleep);
        root.position.set(player.position.x, player.position.y + LYING_LIFT * member.asleep + member.lift, player.position.z);
        root.rotation.set((-Math.PI / 2) * member.asleep, Math.PI - player.heading, 0);
        // The walk is this player's own change in position. Stepping out of the canoe, or a new state, is no stride.
        const walked = member.afoot && !snap ? Math.hypot(player.position.x - member.lastX, player.position.z - member.lastZ) : 0;
        if (snap) member.moving = 0;
        else if (beat > 0) member.moving += ((walked > 0.002 ? 1 : 0) - member.moving) * Math.min(1, beat * 8);
        // Off the ground the legs do not walk: the stride waits for the landing.
        if (walked > 0 && walked < 5 && !airborne(player.leap)) member.stride += (walked / STRIDE_METRES) * Math.PI * 2;
        // The tool they picked is in the right hand; a sleeper has put it down.
        const tool = member.asleep < 0.5 ? player.selectedTool : null;
        figure.stand(time, member.stride, member.moving, member.asleep, tool !== null, jumpPose(player.leap?.steps ?? 0));
        this.hold(member, tool, player.id);
        member.afoot = true;
      }
      member.lastX = player.position.x;
      member.lastZ = player.position.z;
    }
    // Each one ashore left their paddle across the gunwales at the seat they last sat in (never seen aboard: the seat
    // of their number), unless someone sits there now.
    const taken = new Set(players.map(seatOf).filter((seat): seat is number => seat !== null));
    for (const player of players) {
      const member = this.member(player.id);
      const berth = member.berth;
      const seat = member.seat === null ? member.lastSeat ?? Math.min(3, player.id) : null;
      if (seat === null || taken.has(seat)) {
        berth.visible = false;
        continue;
      }
      taken.add(seat);
      if (berth.parent !== this.hullSpace) this.hullSpace.add(berth);
      const place = seatTransformForHull(this.tier, seat);
      berth.position.set(-place.position[0], place.position[1] + SEAT_LIFT, -place.position[2]);
      berth.rotation.set(-place.rotation[0], place.rotation[1], -place.rotation[2]);
      berth.visible = showPlayer;
      member.figure.leave(berth, member.restSide, shape.sheerAt(berth.position.z + REST_AHEAD) - shape.HULL.draft - berth.position.y);
      if (anyDeck) this.clearOfDecks(berth, member.figure.paddler.paddle, decks, wellEdge, deckRuns);
    }
    // Anyone who has left the game is no longer drawn.
    for (const [playerId, member] of this.members) {
      if (!players.some((player) => player.id === playerId)) {
        member.figure.root.visible = false;
        member.berth.visible = false;
      }
    }
    return events;
  }

  /**
   * A paddle beside an outrigger deck never lies in it. Where its tip would pass the inner ends of the deck's planks
   * (a paddle laid across the gunwales does), it is drawn inboard along its own shaft until the tip is short of
   * them: the hands keep their hold, and it lies between the two decks. Past a deck's ends the pull fades out over
   * a quarter metre, so nothing jumps.
   */
  private clearOfDecks(holder: THREE.Object3D, paddle: THREE.Object3D, decks: { port: boolean; starboard: boolean }, wellEdge: number, deckRuns: { forward: number; aft: number }): void {
    const shaft = this.shaft.set(0, -1, 0).applyQuaternion(paddle.quaternion);
    // The figure (or the berth of a paddle left aboard) sits in the hull's own space: port is +x there, and z runs
    // the other way from canoe space.
    const tipX = holder.position.x + paddle.position.x + shaft.x * PADDLE_LENGTH;
    const tipZ = -(holder.position.z + paddle.position.z + shaft.z * PADDLE_LENGTH);
    const over = Math.abs(tipX) - wellEdge;
    if (over <= 0 || !(tipX > 0 ? decks.port : decks.starboard)) return;
    // A blade is 9 cm to each side of its shaft.
    const past = Math.min(1, Math.max(0, (Math.max(deckRuns.forward - tipZ, tipZ - deckRuns.aft) - 0.12) / 0.25));
    const beside = 1 - past * past * (3 - 2 * past);
    paddle.position.addScaledVector(shaft, -beside * Math.min(0.4, over / Math.max(0.3, Math.abs(shaft.x))));
  }

  /** Puts `tool` in the member's right hand (null: an empty hand). A tool is drawn the first time it is picked. */
  private hold(member: Member, tool: ToolId | null, playerId: number): void {
    member.holding = tool;
    for (const [toolId, mesh] of member.tools) mesh.visible = toolId === tool;
    if (tool === null) return;
    let mesh = member.tools.get(tool);
    if (!mesh) {
      mesh = buildHandTool(tool, playerId);
      // A tool in hand is the crew's: the pen draws it as crisply as the figure holding it.
      mesh.layers.enable(CREW_LAYER);
      member.tools.set(tool, mesh);
      member.figure.root.add(mesh);
    }
    mesh.visible = true;
    // In the fist, its working end carried ahead and up.
    mesh.position.copy(member.figure.paddler.R.H);
    mesh.rotation.set(Math.PI / 2 - TOOL_CARRY[tool], 0, 0);
  }

  /**
   * How big the canoe is as drawn at the last `sync`: the hull that is shown, everything bolted onto it and each
   * paddle left across its gunwales by someone ashore (it stands out half a metre past the hull's side), as a
   * box in canoe space. The crew are left out. The built view frames the canoe with it.
   */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    target.makeEmpty();
    const shown = this.tiers.get(this.tier);
    if (!shown) return target;
    this.group.updateMatrixWorld(true);
    this.toCanoe.copy(this.group.matrixWorld).invert();
    const paddlesLeft = [...this.members.values()].map((member) => member.berth).filter((berth) => berth.visible && berth.parent === this.hullSpace);
    for (const root of [shown.group, this.attachments, ...paddlesLeft]) {
      root.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        // A sail's cloth is redrawn every frame: measure it as it is now.
        object.geometry.computeBoundingBox();
        if (!object.geometry.boundingBox) return;
        target.union(this.pieceBox.copy(object.geometry.boundingBox).applyMatrix4(this.pieceMatrix.multiplyMatrices(this.toCanoe, object.matrixWorld)));
      });
    }
    return target;
  }

  /** Every crew figure in the picture, by player id: where it is, what it is doing, what it wears. */
  figures(): FigureReport[] {
    return [...this.members.entries()]
      .filter(([, { figure }]) => figure.root.visible && figure.root.parent !== null)
      .sort(([first], [second]) => first - second)
      .map(([id, member]) => {
        const { x, y, z } = member.figure.root.position;
        return {
          id,
          seat: member.seat,
          position: member.seat === null ? [x, y, z] : [-x, y, -z],
          paddling: member.effort,
          bailing: member.bailing,
          asleep: member.asleep,
          walking: member.moving,
          kneeling: member.seat !== null && member.seat >= 2,
          side: member.side,
          stride: member.stride,
          coat: colourOf(member.figure.paddler.L.upper),
          legs: colourOf(member.figure.paddler.L.thigh),
          holding: member.holding,
          paddle: member.seat !== null ? 'hands' : member.berth.visible && member.berth.parent !== null ? 'canoe' : null,
          lift: member.lift,
        };
      });
  }

  /** How many crew figures are in the picture right now. */
  figuresShown(): number {
    return this.figures().length;
  }

  /** A player's figure, wherever it stands or sits. Null before that player has been seen. */
  figureOf(playerId: number): THREE.Object3D | null {
    return this.members.get(playerId)?.figure.root ?? null;
  }

  /** The local player's figure, wherever it stands or sits. */
  localFigure(): THREE.Object3D {
    return this.member(this.localId).figure.root;
  }

  /** Each hero the world view draws apart from the world: the canoe with all aboard, and each person ashore. */
  heroes(): THREE.Object3D[] {
    return [this.group, ...this.ashore.children.filter((figure) => figure.visible)];
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
