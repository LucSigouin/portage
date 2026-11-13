/**
 * The built view: the payoff for building a piece. When the player builds from the canoe builder, the panel steps
 * aside and the screen holds one still, framed view of the canoe with the new piece on it, for two seconds. Then
 * the screen is given back as it was: the panel, the HUD, the camera.
 *
 * It is a cut both ways. The camera does not travel, shake or fade: one pose is worked out when the view begins
 * and held until it ends. Any key or a click ends it at once. Alone, the builder panel keeps the game frozen
 * behind it, so nothing in the picture moves.
 *
 * Only the player who built gets it, and only from the panel: a crewmate's build, the bot's and a staged game's
 * take nobody's screen.
 *
 * No Three.js and no DOM in here. The session keeps the state (`Session.builtView`), the app asks for the pose.
 */
import { ATTACHMENTS, HULL_TIERS } from '../data/index.ts';
import type { AttachmentId } from '../data/index.ts';
import { attachmentTransformForHull, playerOf } from '../sim/index.ts';
import type { Command, GameState, PlayerId, Vector3 } from '../sim/index.ts';
import { SURFACE_CLEARANCE, orbitPosition } from './camera.ts';
import type { CameraPose, CameraSurface } from './camera.ts';

/** What was built: the hull rebuilt to a tier, or one attachment. */
export type BuiltPiece = { kind: 'hull'; tier: number } | { kind: 'attachment'; attachmentId: AttachmentId };

export interface BuiltView {
  piece: BuiltPiece;
  /** Real seconds until the screen is given back. */
  secondsLeft: number;
}

/** How long the view is held, in real seconds. */
export const BUILT_VIEW_SECONDS = 2;
/** One frame takes at most this much off the clock: a long frame as the view begins must not eat it. */
export const BUILT_VIEW_FRAME_CAP = 0.1;
/** A guest's build is run by the host: this long is waited for the piece to show before the view is given up. */
export const BUILT_VIEW_WAIT_SECONDS = 3;

/** The camera stands off a quarter, this far round from dead astern (radians), looking down at this angle. */
export const BUILT_VIEW_QUARTER = 0.85;
export const BUILT_VIEW_PITCH = 0.3;
/**
 * The view has a lens of its own, longer than the game's (vertical field of view, degrees). Through the game's
 * wide lens a canoe that fills the frame is two metres from the eye: its near end swells and its far end shrinks.
 */
export const BUILT_VIEW_FIELD = 34;
/** The canoe fills at most this share of the frame each way. */
export const BUILT_VIEW_FILL = { width: 0.8, height: 0.58 };
/** And sits this share of the frame's height above the middle: the slip that names the piece is under it. */
export const BUILT_VIEW_RISE = 0.07;
/** Never nearer or further than this, metres. */
export const BUILT_VIEW_DISTANCE = [3.5, 40] as const;
/** A piece mounted nearer the centreline than this is on neither side. */
const CENTRE_HALF_WIDTH = 0.2;

/** A figure by the canoe is framed head to foot: this tall standing, this high over the waterline seated, this wide. */
const STANDING_HEIGHT = 1.95;
const SEATED_HEIGHT = 1.2;
const FIGURE_HALF_WIDTH = 0.35;
/** Someone ashore is in the picture when they stand within this far of the hull's side, and of its ends. */
const BESIDE_THE_CANOE = 3.5;

/**
 * A box in canoe space (origin at the hull's centre on the waterline, bow toward -z, starboard +x), and the
 * frame's width over its height. `lit`: the side of the hull the light falls on, when the look knows it.
 */
export interface CanoeBounds { min: Vector3; max: Vector3; aspect: number; lit?: 'port' | 'starboard' | null }

/** True for the two commands that build onto the canoe. */
export const isBuildCommand = (command: Command): boolean => command.type === 'upgrade_hull' || command.type === 'build_attachment';

/**
 * The piece a build command makes. `done`: the rules have run it, so the state's hull is the new one.
 * Not done (a guest's command, on its way to the host): the hull will be the next tier. Null for any other command.
 */
export function builtPieceOf(command: Command, state: GameState, done: boolean): BuiltPiece | null {
  if (command.type === 'build_attachment') return { kind: 'attachment', attachmentId: command.attachmentId };
  if (command.type !== 'upgrade_hull') return null;
  const tier = state.canoe.hullTier + (done ? 0 : 1);
  return HULL_TIERS[tier] ? { kind: 'hull', tier } : null;
}

/** True once the state shows the piece. */
export function showsPiece(state: GameState, piece: BuiltPiece): boolean {
  return piece.kind === 'hull' ? state.canoe.hullTier >= piece.tier : state.canoe.attachments.includes(piece.attachmentId);
}

/** The words for the slip under the canoe: what it was, its name, and the builder's own line about it. */
export function builtWords(piece: BuiltPiece): { kicker: string; title: string; text: string } {
  if (piece.kind === 'hull') return { kicker: 'Hull rebuilt', title: HULL_TIERS[piece.tier].name, text: HULL_TIERS[piece.tier].description };
  return { kicker: 'Built', title: ATTACHMENTS[piece.attachmentId].name, text: ATTACHMENTS[piece.attachmentId].description };
}

/** The hull alone, with headroom: what is framed when the look cannot say how big the fitted canoe is. */
export function hullBounds(state: GameState, aspect = 16 / 9): CanoeBounds {
  const { length, beam, depth, draft } = HULL_TIERS[state.canoe.hullTier].dimensions;
  return { min: { x: -beam / 2, y: -draft, z: -length / 2 }, max: { x: beam / 2, y: depth - draft + 0.5, z: length / 2 }, aspect };
}

/**
 * Which quarter the camera stands off: +1 the port quarter (it then sees the port side), -1 the starboard.
 * A piece on one side is looked at from that side. Otherwise from the side the light falls on (`lit`), so the
 * hull is seen in its own colours and not in shade. Otherwise from the side the player is not standing on, so
 * they are not between the eye and the hull. Failing all that, port.
 */
export function builtViewSide(state: GameState, piece: BuiltPiece, playerId: PlayerId = 0, lit: 'port' | 'starboard' | null = null): 1 | -1 {
  if (piece.kind === 'attachment') {
    const across = attachmentTransformForHull(piece.attachmentId, state.canoe.hullTier).position[0];
    if (Math.abs(across) > CENTRE_HALF_WIDTH) return across > 0 ? -1 : 1;
  }
  if (lit) return lit === 'port' ? 1 : -1;
  const player = playerOf(state, playerId);
  if (player.mode !== 'foot') return 1;
  // How far to starboard of the keel the player stands.
  const { heading, position } = state.canoe;
  const across = (player.position.x - position.x) * Math.cos(heading) + (player.position.z - position.z) * Math.sin(heading);
  return across < -CENTRE_HALF_WIDTH ? -1 : 1;
}

/** The eight corners of a box. */
function cornersOf(min: Vector3, max: Vector3): Vector3[] {
  const corners: Vector3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push({ x, y, z });
  return corners;
}

/**
 * The points the view frames, in canoe space: the corners of the canoe's box, and of a box round each one who is
 * aboard or stands beside it, head to foot. A figure cut off by the edge of the frame would be the first thing
 * the eye went to. Someone far up the island is not in the picture.
 */
export function framedPoints(state: GameState, box: CanoeBounds): Vector3[] {
  const { heading, position } = state.canoe;
  const points = cornersOf(box.min, box.max);
  let aboard = false;
  for (const player of state.players) {
    if (player.mode === 'canoe') {
      aboard = true;
      continue;
    }
    // Where they stand, in canoe space.
    const [east, south] = [player.position.x - position.x, player.position.z - position.z];
    const across = east * Math.cos(heading) + south * Math.sin(heading);
    const along = -east * Math.sin(heading) + south * Math.cos(heading);
    if (across < box.min.x - BESIDE_THE_CANOE || across > box.max.x + BESIDE_THE_CANOE || along < box.min.z - BESIDE_THE_CANOE || along > box.max.z + BESIDE_THE_CANOE) continue;
    const feet = player.position.y - position.y;
    points.push(...cornersOf(
      { x: across - FIGURE_HALF_WIDTH, y: feet, z: along - FIGURE_HALF_WIDTH }, { x: across + FIGURE_HALF_WIDTH, y: feet + STANDING_HEIGHT, z: along + FIGURE_HALF_WIDTH },
    ));
  }
  // Heads over the rail, anywhere along the hull.
  if (aboard) points.push(...cornersOf({ x: box.min.x, y: SEATED_HEIGHT, z: box.min.z }, { x: box.max.x, y: SEATED_HEIGHT, z: box.max.z }).slice(0, 8));
  return points;
}

/**
 * The one pose the built view holds: off a stern quarter, looking down a little, through its own lens, placed so
 * the whole canoe and all it carries (`bounds`, or the bare hull), with whoever is by it, sits in the middle of
 * the frame and fills it to `BUILT_VIEW_FILL`. The canoe is beached bow first, so astern is open water: nothing
 * stands between the eye and the hull.
 */
export function builtViewPose(state: GameState, piece: BuiltPiece, bounds: CanoeBounds | null, surface: CameraSurface, playerId: PlayerId = 0): CameraPose {
  const fieldOfView = BUILT_VIEW_FIELD;
  const box = bounds ?? hullBounds(state);
  const { heading, position } = state.canoe;
  const yaw = heading + builtViewSide(state, piece, playerId, box.lit ?? null) * BUILT_VIEW_QUARTER;
  const pitch = BUILT_VIEW_PITCH;
  // The camera's own axes, in the world: where it looks, its right, its up.
  const forward = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const right = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const up = { x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: -Math.cos(yaw) * Math.sin(pitch) };
  // Canoe space into the world: turned by the heading, set down at the canoe.
  const world = (x: number, y: number, z: number): Vector3 => ({
    x: position.x + x * Math.cos(heading) - z * Math.sin(heading),
    y: position.y + y,
    z: position.z + x * Math.sin(heading) + z * Math.cos(heading),
  });
  const corners = framedPoints(state, box).map((point) => world(point.x, point.y, point.z));
  const tanHalfHeight = Math.tan((fieldOfView * Math.PI) / 360);
  const tanHalfWidth = tanHalfHeight * box.aspect;
  // Start looking at the box's middle from a hull length away, then settle: the near end of the canoe looks bigger
  // than the far end, so the picture of the box is put in the middle of the frame and sized to it, a few times over.
  let target = world((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
  let distance = Math.max(BUILT_VIEW_DISTANCE[0], box.max.z - box.min.z);
  for (let pass = 0; pass < 8; pass += 1) {
    const eye = { x: target.x - forward.x * distance, y: target.y - forward.y * distance, z: target.z - forward.z * distance };
    let [left, rightmost, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const corner of corners) {
      const offset = { x: corner.x - eye.x, y: corner.y - eye.y, z: corner.z - eye.z };
      // Never nearer than this: a corner beside the eye would throw the sum.
      const depth = Math.max(0.5, offset.x * forward.x + offset.y * forward.y + offset.z * forward.z);
      const across = (offset.x * right.x + offset.y * right.y + offset.z * right.z) / (depth * tanHalfWidth);
      const above = (offset.x * up.x + offset.y * up.y + offset.z * up.z) / (depth * tanHalfHeight);
      left = Math.min(left, across);
      rightmost = Math.max(rightmost, across);
      bottom = Math.min(bottom, above);
      top = Math.max(top, above);
    }
    // The frame runs from -1 to 1 each way. The canoe's picture goes a little above the middle: the slip is under it.
    const slideAcross = ((left + rightmost) / 2) * tanHalfWidth * distance;
    const slideUp = ((bottom + top) / 2 - 2 * BUILT_VIEW_RISE) * tanHalfHeight * distance;
    target = { x: target.x + right.x * slideAcross + up.x * slideUp, y: target.y + right.y * slideAcross + up.y * slideUp, z: target.z + right.z * slideAcross + up.z * slideUp };
    const fills = Math.max((rightmost - left) / (2 * BUILT_VIEW_FILL.width), (top - bottom) / (2 * BUILT_VIEW_FILL.height));
    distance = Math.max(BUILT_VIEW_DISTANCE[0], Math.min(BUILT_VIEW_DISTANCE[1], distance * fills));
  }
  // The eye itself stays clear of the water and the ground. Its line of sight ends at the waterline by design,
  // so the chase camera's rule (keep the whole line clear) is not this view's.
  const eye = orbitPosition(target, yaw, pitch, distance);
  const floor = Math.max(surface.ground(eye.x, eye.z), surface.water(eye.x, eye.z)) + SURFACE_CLEARANCE;
  return { position: { x: eye.x, y: Math.max(eye.y, floor), z: eye.z }, target, fieldOfView };
}
