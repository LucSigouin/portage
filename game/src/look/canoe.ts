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
 * - ashore, standing where the state puts them, walking by their own change in position.
 * All of them, and the canoe, are heroes: the world view draws them at the
 * window's full size (see LOOK.md).
 */
import * as THREE from 'three';
import { HULL_TIERS } from '../data/index.ts';
import { attachmentTransformForHull, seatTransformForHull } from '../sim/index.ts';
import { outfitOf } from './crew.ts';
import type { Crew } from './crew.ts';
import type { GameState } from '../sim/index.ts';
import { buildAttachment } from './attachments.ts';
import type { AttachmentPiece } from './attachments.ts';
import { buildBilge, buildHull, buildStarterKit, createCrew, makeHullShape } from './b2/canoe.js';
import type { Crew as Figure, HullShape } from './b2/canoe.js';
import { deckInner, deckSpan } from './canoe/deck-parts.ts';
import { buildMends, buildSheets } from './canoe/mends.ts';

interface TierMeshes {
  shape: HullShape;
  group: THREE.Group;
  kit: THREE.Mesh;
  /** The kit shoved up to the thwart, for when someone kneels amidships. Built the first time it is needed. */
  kitCrewed: THREE.Mesh | null;
  bilge: THREE.Mesh;
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
const PULL_SHARE = 0.46;
/** A paddle from grip to blade tip, as the figure's is built. */
const PADDLE_LENGTH = 1.485;
/** A paddler changes sides early in the recovery, with the hands drawn back: this share of the stroke clock. */
const SIDE_CHANGE = [PULL_SHARE, 0.6] as const;
/** A paddle's tip stays this far inside the inner edge of an outrigger's deck (the planks' ends are ragged by 5 cm). */
const DECK_CLEARANCE = 0.08;

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
  stride: number;
  lastX: number;
  lastZ: number;
  /** False until this figure has been placed once, and on the frame it steps out of the canoe: no stride then. */
  afoot: boolean;
  /** True once this figure has sat in the canoe: its first stroke starts on its own side, later ones ease over. */
  seated: boolean;
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
  /** The crew's one stroke clock: everyone paddling is in time. */
  private phase = 0.2;
  /** The side the stern paddler works on. The others alternate from it along the hull. */
  private side = 1;
  private strokes = 0;
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
      member = { figure, seat: null, effort: 0, bailing: 0, asleep: 0, moving: 0, bailPhase: 0.6, side: 1, stride: 0, lastX: 0, lastZ: 0, afoot: false, seated: false };
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
      meshes = { shape, group, kit, kitCrewed: null, bilge };
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
    const ease = (value: number, wanted: number, rate: number): number => (snap ? wanted : value + (wanted - value) * Math.min(1, seconds * rate));
    let working = 0;
    for (const player of players) {
      const member = this.member(player.id);
      member.seat = seatOf(player);
      const aboard = member.seat !== null;
      member.effort = aboard ? ease(member.effort, player.paddling ? 1 : 0, 4) : 0;
      member.bailing = aboard ? ease(member.bailing, player.bailing ? 1 : 0, 5) : 0;
      member.asleep = ease(member.asleep, player.asleep ? 1 : 0, 3);
      if (member.bailing > 0.02) member.bailPhase = (member.bailPhase + seconds * BAIL_RATE) % 1;
      working = Math.max(working, member.effort);
    }

    // One stroke clock for the crew. It runs while anyone paddles.
    const previous = this.phase;
    if (working > 0.3) this.phase += seconds * STROKE_RATE;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.strokes += 1;
    }
    // Steer by paddling on the outside of the turn; otherwise switch every third stroke.
    const turn = seconds > 0 ? Math.atan2(Math.sin(canoe.heading - this.lastHeading), Math.cos(canoe.heading - this.lastHeading)) / seconds : 0;
    if (turn < -0.12) this.side = -1;
    else if (turn > 0.12) this.side = 1;
    else if (this.phase < previous && this.strokes % 3 === 0) this.side = -this.side;
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
    const changing = this.phase >= SIDE_CHANGE[0] && this.phase <= SIDE_CHANGE[1];

    const events: StrokeEvent[] = [];
    const crossed = (mark: number): boolean => previous < mark && this.phase >= mark;
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
        // Counted along the hull from the stern, every second one works (and rests) their paddle on the other side.
        const across = fromStern.indexOf(player) % 2 ? -1 : 1;
        // A paddler changes sides between strokes, early in the recovery, when the hands are drawn back over their
        // own lap. Never across the catch: there the leading hand is furthest forward, over whatever is ahead.
        if (!member.seated || member.effort < 0.05 || changing) member.side = this.side * across;
        const kneel = member.seat >= 2 ? 1 : 0;
        const more = kneel || across < 0 || member.bailing > 0 || member.asleep > 0
          ? { kneel, floor: seat.position[1] + SEAT_LIFT + shape.HULL.draft, bail: member.bailing, bailPhase: member.bailPhase, sleep: member.asleep, restSide: across }
          : null;
        // A kneeler beside a deck brings the blade back through the water the way it went: the pull run backwards,
        // the blade turned edge on. The figure's own recovery swings the blade out wide, under the deck.
        const hemmed = kneel === 1 && anyDeck;
        const back = hemmed && this.phase > PULL_SHARE ? (this.phase - PULL_SHARE) / (1 - PULL_SHARE) : 0;
        // The side eases over a fifth of a second. A figure seated for the first time takes its side at once.
        const stroke = figure.paddle(member.seated ? seconds : 1, back > 0 ? PULL_SHARE * (1 - back) : this.phase, member.effort, member.side, more);
        member.seated = true;
        if (back > 0) figure.paddler.paddle.rotateY(Math.sin(back * Math.PI) * member.effort * (Math.PI / 2));
        if (anyDeck) this.clearOfDecks(figure, decks, wellEdge, deckRuns);
        if (member.effort > 0.6 && seconds > 0) {
          if (crossed(0.03) || crossed(0.44)) events.push({ x: stroke.blade.x, z: stroke.blade.z, strength: 0.95, size: 0.9 });
          if (crossed(0.2)) events.push({ x: stroke.blade.x, z: stroke.blade.z, strength: 0.7, size: 0.6 });
        }
        member.afoot = false;
        member.moving = 0;
      } else {
        if (root.parent !== this.ashore) this.ashore.add(root);
        // The model faces +z; the game's forward is -z turned by the heading. A sleeper is laid on their back.
        root.position.set(player.position.x, player.position.y + LYING_LIFT * member.asleep, player.position.z);
        root.rotation.set((-Math.PI / 2) * member.asleep, Math.PI - player.heading, 0);
        // The walk is this player's own change in position. Stepping out of the canoe, or a new state, is no stride.
        const walked = member.afoot && !snap ? Math.hypot(player.position.x - member.lastX, player.position.z - member.lastZ) : 0;
        if (snap) member.moving = 0;
        else if (seconds > 0) member.moving += ((walked > 0.002 ? 1 : 0) - member.moving) * Math.min(1, seconds * 8);
        if (walked > 0 && walked < 5) member.stride += (walked / STRIDE_METRES) * Math.PI * 2;
        figure.stand(time, member.stride, member.moving, member.asleep);
        member.afoot = true;
      }
      member.lastX = player.position.x;
      member.lastZ = player.position.z;
    }
    // Anyone who has left the game is no longer drawn.
    for (const [playerId, member] of this.members) {
      if (!players.some((player) => player.id === playerId)) member.figure.root.visible = false;
    }
    return events;
  }

  /**
   * A paddle beside an outrigger deck never lies in it. Where its tip would pass the inner ends of the deck's planks
   * (a paddle laid across the gunwales does), it is drawn inboard along its own shaft until the tip is short of
   * them: the hands keep their hold, and it lies between the two decks. Past a deck's ends the pull fades out over
   * a quarter metre, so nothing jumps.
   */
  private clearOfDecks(figure: Figure, decks: { port: boolean; starboard: boolean }, wellEdge: number, deckRuns: { forward: number; aft: number }): void {
    const paddle = figure.paddler.paddle;
    const shaft = this.shaft.set(0, -1, 0).applyQuaternion(paddle.quaternion);
    // The figure sits in the hull's own space: port is +x there, and z runs the other way from canoe space.
    const tipX = figure.root.position.x + paddle.position.x + shaft.x * PADDLE_LENGTH;
    const tipZ = -(figure.root.position.z + paddle.position.z + shaft.z * PADDLE_LENGTH);
    const over = Math.abs(tipX) - wellEdge;
    if (over <= 0 || !(tipX > 0 ? decks.port : decks.starboard)) return;
    // A blade is 9 cm to each side of its shaft.
    const past = Math.min(1, Math.max(0, (Math.max(deckRuns.forward - tipZ, tipZ - deckRuns.aft) - 0.12) / 0.25));
    const beside = 1 - past * past * (3 - 2 * past);
    paddle.position.addScaledVector(shaft, -beside * Math.min(0.4, over / Math.max(0.3, Math.abs(shaft.x))));
  }

  /**
   * How big the canoe is as drawn at the last `sync`: the hull that is shown and everything bolted onto it, as a
   * box in canoe space. The crew are left out. The built view frames the canoe with it.
   */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    target.makeEmpty();
    const shown = this.tiers.get(this.tier);
    if (!shown) return target;
    this.group.updateMatrixWorld(true);
    this.toCanoe.copy(this.group.matrixWorld).invert();
    for (const root of [shown.group, this.attachments]) {
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
