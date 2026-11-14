/**
 * How the lobby's camera holds the canoe behind the menu (Luc, Round 4: the canoe there is his own, so it can be
 * any hull with anything built on it): whole in the painted part of the sheet, right of the bare paper where the
 * title and the menu sit.
 *
 * The camera circles the canoe as it always did (`lobbyCameraPose` in `camera.ts`). Two things are worked out
 * here: how far left of the canoe it looks, so the canoe sits in the middle of the painting and not of the
 * window; and how far out the circle runs, never nearer than the 13 m it always was, further only when the canoe
 * would not fit.
 *
 * The canoe is taken as a drum standing on the water: as wide as its box is from corner to corner, as tall as its
 * box. The camera circles the drum's own axis, so the answer is the same all the way round, however the canoe is
 * turned: it never swims toward an edge. Plain arithmetic: no drawing, no DOM.
 */
import type { CanoeBounds } from './builtview.ts';

/** The lobby's circle: how far out it runs for a canoe that fits, and how steeply it looks down. Both as they always were. */
export const LOBBY_DISTANCE = 13;
export const LOBBY_PITCH = 0.24;
/** The circle is drawn about this height above the water, metres. */
export const LOBBY_FOCUS_HEIGHT = 1.2;
/** The circle never runs further out than this, metres: a window too narrow to hold the canoe gets a canoe cut by the edge, not a speck. */
export const LOBBY_FURTHEST = 39;

/**
 * The lobby's sheet, as the look paints it (`look/world-view.ts`, `look/b2/post.js`, under "bare paper around
 * the painting"). The left 0.4 of the width is bare paper, and the torn edge of the painting can reach 0.145 of
 * the height further in (0.03 of margin, 0.115 of bristle). On the other three sides the painting stops 0.066 of
 * the height short of the edge at the most (0.03 of margin, 0.036 of roughness). `gap`: the air kept between the
 * canoe and the edge of the painting, a share of the height.
 */
export const LOBBY_SHEET = { bare: 0.4, tear: 0.145, frame: 0.066, gap: 0.02 } as const;

/** The canoe rides the swell and leans a little: this much is added to the drum all round, metres. */
const LOBBY_SWAY = 0.2;

/** How far out the circle runs, metres, and how far left of the canoe the camera looks, radians. */
export interface LobbyFraming { distance: number; turn: number }

/** The lobby with no canoe to measure: the canoe in the middle of the window, 13 m off. As it always was. */
export const LOBBY_UNFRAMED: LobbyFraming = { distance: LOBBY_DISTANCE, turn: 0 };

/**
 * The air round the drum, metres, on the four sides of the painting, for a circle `distance` out and a camera
 * looking `turn` left of the canoe. Negative: the drum crosses that edge.
 */
function airs(canoe: CanoeBounds, fieldOfView: number, distance: number, turn: number): { left: number; right: number; top: number; bottom: number } {
  const aspect = canoe.aspect > 0 ? canoe.aspect : 16 / 9;
  const radius = Math.hypot(Math.max(Math.abs(canoe.min.x), Math.abs(canoe.max.x)), Math.max(Math.abs(canoe.min.z), Math.abs(canoe.max.z))) + LOBBY_SWAY;
  const tall = Math.tan((fieldOfView * Math.PI) / 360);
  const wide = tall * aspect;
  const edge = (LOBBY_SHEET.frame + LOBBY_SHEET.gap) / aspect;
  // The painting's four limits as slopes off the camera's line of sight.
  const left = (2 * (LOBBY_SHEET.bare + (LOBBY_SHEET.tear + LOBBY_SHEET.gap) / aspect) - 1) * wide;
  const right = (1 - 2 * edge) * wide;
  const high = (1 - 2 * (LOBBY_SHEET.frame + LOBBY_SHEET.gap)) * tall;
  const [down, level] = [Math.sin(LOBBY_PITCH), Math.cos(LOBBY_PITCH)];
  const reach = distance * level;
  const eye = LOBBY_FOCUS_HEIGHT + distance * down;
  const across = reach * Math.sin(turn);
  const air = { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity };
  // The drum's two ends, its foot and its top: whatever lies between them is nearer the middle than one of the two.
  for (const height of [canoe.min.y - LOBBY_SWAY, canoe.max.y + LOBBY_SWAY]) {
    const depth = level * reach * Math.cos(turn) + down * (eye - height);
    const up = down * reach * Math.cos(turn) - level * (eye - height);
    air.left = Math.min(air.left, (across - left * depth - radius * Math.hypot(1, left * level)) / Math.hypot(1, left));
    air.right = Math.min(air.right, (right * depth - across - radius * Math.hypot(1, right * level)) / Math.hypot(1, right));
    air.top = Math.min(air.top, (high * depth - up - radius * Math.abs(high * level - down)) / Math.hypot(1, high));
    air.bottom = Math.min(air.bottom, (high * depth + up - radius * Math.abs(high * level + down)) / Math.hypot(1, high));
  }
  return air;
}

/** At this distance: the turn that leaves the drum as much air on its left as on its right, and the least air it then has on any side. */
function centred(canoe: CanoeBounds, fieldOfView: number, distance: number): { turn: number; air: number } {
  // The further left the camera looks, the more air on the canoe's left and the less on its right.
  let [low, high] = [0, 1.2];
  for (let round = 0; round < 28; round += 1) {
    const turn = (low + high) / 2;
    const air = airs(canoe, fieldOfView, distance, turn);
    if (air.left < air.right) low = turn;
    else high = turn;
  }
  const turn = (low + high) / 2;
  const air = airs(canoe, fieldOfView, distance, turn);
  return { turn, air: Math.min(air.left, air.right, air.top, air.bottom) };
}

/**
 * How the lobby's camera holds this canoe whole in the painted part of the sheet. `canoe` is the canoe as the
 * look drew it, with the window's shape. `fieldOfView` is the lens, degrees up and down.
 */
export function lobbyFraming(canoe: CanoeBounds, fieldOfView: number): LobbyFraming {
  const near = centred(canoe, fieldOfView, LOBBY_DISTANCE);
  if (near.air >= 0) return { distance: LOBBY_DISTANCE, turn: near.turn };
  // Too big for the painting at 13 m: the nearest circle that holds it. The air grows with the distance.
  let [fits, tight] = [LOBBY_FURTHEST, LOBBY_DISTANCE];
  for (let round = 0; round < 24; round += 1) {
    const distance = (fits + tight) / 2;
    if (centred(canoe, fieldOfView, distance).air >= 0) fits = distance;
    else tight = distance;
  }
  return { distance: fits, turn: centred(canoe, fieldOfView, fits).turn };
}
