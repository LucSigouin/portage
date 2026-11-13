/**
 * The valley's drawing kit: the colours and the few shapes every landmark
 * shares (a gable roof, a window, a lattice mast, a ladder),
 * and `siteOf`, which tells a one-of-a-kind landmark the rules' own ground
 * under it, so a dock can run down to the water and a dam can follow its crest.
 *
 * Everything here is built with B2's `Builder`: ground at y = 0, metres, front toward -z.
 */
import * as THREE from 'three';
import { ISLANDS, spotPosition } from '../../data/index.ts';
import type { IslandDefinition, LandmarkDefinition, LandmarkKind } from '../../data/index.ts';
import { terrainHeight } from '../../sim/index.ts';
import { KIND } from '../b2/detail.js';
import { THIN } from '../b2/geo.js';
import type { Builder, PieceOptions, Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';

/** A landmark builder. `detail` is false for the far version: the outline only. */
export type LandmarkBuilder = (builder: Builder, detail: boolean) => void;

/** Colours the valley needs that B2's palette has no name for. Washes in the same key. */
export const TONE = {
  whitewash: '#ebe4d2', trim: '#d6ccb4', glass: '#4c5560', glassDark: '#3d4048',
  concrete: '#bcb9b0', concreteDark: '#a9a69d', concretePale: '#cbc7bc',
  steel: '#59656d', steelPale: '#8d9496', boatBlue: '#7f97a3', door: '#6f5a47',
  shingle: '#8f7d6b', shingleDark: '#7f6f62', board: '#8a6f55', boardDark: '#7c644d',
  brick: '#a9624d', craneYellow: '#c79a34', towerRed: '#a8503e', tyre: '#3a3b44',
  reed: '#8c9c68', reedPale: '#a3a56c', cattail: '#6b4f3a',
  cutStone: '#d6cdc0', cutStonePink: '#d3bcb0', cutStoneGrey: '#c4bdb4',
  apple: '#c64732', berry: '#d8402a', leaf: '#7d9a72', fog: '#cfd5d1',
} as const;

/** A bare pen line: wires, lattice, rungs. Never outlined. */
export const PEN = { id: THIN, flat: true, kind: KIND.PLAIN } as const;
/** A coal or a lamp: the flat colour, whatever the light. */
export const EMBER = { glow: 1, flat: true, kind: KIND.PLAIN } as const;

/** How far the world view sinks a landmark into its ground, metres. */
export const LANDMARK_SUNK = 0.1;

/** Run `draw` with every piece moved by `matrix` (on top of any move already set). */
export function moved(builder: Builder, matrix: THREE.Matrix4, draw: () => void): void {
  const before = builder.base;
  builder.base = before ? before.clone().multiply(matrix) : matrix;
  draw();
  builder.base = before;
}

export const turnY = (angle: number, x = 0, y = 0, z = 0): THREE.Matrix4 =>
  new THREE.Matrix4().makeRotationY(angle).setPosition(x, y, z);

/** A gable roof, ridge along z: two slopes with an overhang and a ridge board. */
export function gable(
  builder: Builder, width: number, depth: number, eaves: number, rise: number, tone: string,
  options: { kind?: PieceOptions['kind']; overhang?: number; ridge?: string; centre?: [number, number] } = {},
): void {
  const overhang = options.overhang ?? 0.3;
  const [x, z] = options.centre ?? [0, 0];
  const slope = Math.hypot(width / 2, rise);
  const angle = Math.atan2(rise, width / 2);
  const reach = (slope + overhang) / 2;
  for (const side of [-1, 1]) {
    builder.box(slope + overhang, 0.12, depth + overhang * 2, tone, {
      pos: [x + side * Math.cos(angle) * reach, eaves + rise - Math.sin(angle) * reach, z],
      rot: [0, 0, -side * angle], kind: options.kind ?? KIND.SHINGLE, axis: 2,
    });
  }
  builder.box(0.3, 0.1, depth + overhang * 2 + 0.1, options.ridge ?? PAL.rustDark, { pos: [x, eaves + rise + 0.05, z] });
}

/** The triangle of wall under a gable, as stacked boards. `z` is the wall's place along the ridge. */
export function gableEnd(builder: Builder, width: number, eaves: number, rise: number, z: number, tone: string, options: PieceOptions & { x?: number; courses?: number } = {}): void {
  const courses = options.courses ?? 4;
  const { x = 0, courses: _courses, ...piece } = options;
  for (let course = 0; course < courses; course += 1) {
    const low = course / courses;
    const half = (width / 2) * (1 - (low + 0.5 / courses));
    builder.box(half * 2, rise / courses + 0.01, 0.16, tone, { pos: [x, eaves + (low + 0.5 / courses) * rise, z], ...piece });
  }
}

/** A window: dark glass, a painted frame and a sill. `turn` is the wall's turn about the vertical. */
export function pane(builder: Builder, position: Triple, width: number, height: number, turn = 0, options: { glass?: string; frame?: string | null; glow?: number; bars?: boolean } = {}): void {
  const frame = options.frame === undefined ? TONE.trim : options.frame;
  moved(builder, turnY(turn, ...position), () => {
    builder.box(width, height, 0.08, options.glass ?? TONE.glass, { pos: [0, 0, 0], flat: true, kind: KIND.PLAIN, glow: options.glow ?? 0 });
    if (!frame) return;
    builder.box(width + 0.24, 0.12, 0.16, frame, { pos: [0, -height / 2 - 0.06, 0.02], kind: KIND.PAINT });
    builder.box(width + 0.16, 0.09, 0.12, frame, { pos: [0, height / 2 + 0.045, 0.02], kind: KIND.PAINT });
    if (options.bars !== false) {
      builder.box(0.05, height, 0.1, frame, { pos: [0, 0, 0.02], kind: KIND.PAINT });
      builder.box(width, 0.05, 0.1, frame, { pos: [0, 0, 0.02], kind: KIND.PAINT });
    }
  });
}

/**
 * A lattice mast: four legs, a ring every bay and one diagonal a bay on each face,
 * all bare pen lines. `tones` lets the bays alternate (a radio mast's red and white).
 */
export function lattice(builder: Builder, height: number, foot: number, top: number, bays: number, tones: string | readonly string[], radius = 0.09, base = 0, diagonals = true): void {
  const tone = (bay: number): string => (typeof tones === 'string' ? tones : tones[bay % tones.length]);
  const leg = (sideX: number, sideZ: number, y: number): Triple => {
    const half = foot + (top - foot) * (y / height);
    return [sideX * half, base + y, sideZ * half];
  };
  for (let bay = 0; bay <= bays; bay += 1) {
    const y = (bay / bays) * height;
    const colour = tone(Math.min(bay, bays - 1));
    builder.beam(leg(-1, -1, y), leg(1, -1, y), radius * 0.7, colour, PEN, 4);
    builder.beam(leg(-1, 1, y), leg(1, 1, y), radius * 0.7, colour, PEN, 4);
    builder.beam(leg(-1, -1, y), leg(-1, 1, y), radius * 0.7, colour, PEN, 4);
    builder.beam(leg(1, -1, y), leg(1, 1, y), radius * 0.7, colour, PEN, 4);
    if (bay === bays) break;
    const next = ((bay + 1) / bays) * height;
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.beam(leg(sideX, sideZ, y), leg(sideX, sideZ, next), radius, colour, PEN, 4);
    if (!diagonals) continue;
    const turn = bay % 2 ? 1 : -1;
    for (const side of [-1, 1]) {
      builder.beam(leg(-turn, side, y), leg(turn, side, next), radius * 0.55, colour, PEN, 4);
      builder.beam(leg(side, -turn, y), leg(side, turn, next), radius * 0.55, colour, PEN, 4);
    }
  }
}

/** A ladder between two points: two rails and rungs, bare pen lines. `across` is the unit direction of the rungs. */
export function ladder(builder: Builder, from: Triple, to: Triple, across: Triple, width: number, tone: string, spacing = 0.4, radius = 0.025): void {
  const half = width / 2;
  const shift = (point: Triple, side: number): Triple => [point[0] + across[0] * half * side, point[1] + across[1] * half * side, point[2] + across[2] * half * side];
  for (const side of [-1, 1]) builder.beam(shift(from, side), shift(to, side), radius, tone, PEN, 4);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const rungs = Math.max(1, Math.floor(length / spacing));
  for (let rung = 1; rung < rungs; rung += 1) {
    const share = rung / rungs;
    const point: Triple = [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share, from[2] + (to[2] - from[2]) * share];
    builder.beam(shift(point, -1), shift(point, 1), radius * 0.8, tone, PEN, 4);
  }
}

/** The ground under a landmark, as its builder sees it. */
export interface Site {
  island: IslandDefinition | null;
  /** Height of the rules' ground at a point in the landmark's own frame, above the landmark's origin. */
  ground(x: number, z: number): number;
  /** Height of the still water in the landmark's own frame. */
  water: number;
}

/** The ground under one landmark of the island table. The numbers are the world view's own: sunk 0.1 m, turned by the bearing and the island's turn. */
export function siteAt(island: IslandDefinition, landmark: LandmarkDefinition): Site {
  const spot = spotPosition(island, landmark.spot);
  const origin = Math.max(0, terrainHeight(spot.x, spot.z)) - LANDMARK_SUNK;
  const turn = -(landmark.bearing + island.rotation);
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);
  return {
    island,
    water: -origin,
    ground: (x, z) => terrainHeight(spot.x + x * cosine + z * sine, spot.z - x * sine + z * cosine) - origin,
  };
}

/** The one landmark being drawn on its own site now, if any (`onSite`). */
let drawing: { kind: LandmarkKind; site: Site } | null = null;

/** Run `draw` with `siteOf(kind)` answering for this site: how a kind the table has several times is fitted to each one's ground. */
export function onSite<Drawn>(kind: LandmarkKind, site: Site, draw: () => Drawn): Drawn {
  const before = drawing;
  drawing = { kind, site };
  try {
    return draw();
  } finally {
    drawing = before;
  }
}

/**
 * Where a landmark of a kind stands: the one being drawn on its own site (`onSite`), else the first the island
 * table has. For a kind the table has once (the dock, the dam, the quarry cut, the orchard, the grove) that is
 * the very ground it will be drawn on, so it can be fitted to it.
 */
export function siteOf(kind: LandmarkKind): Site {
  if (drawing?.kind === kind) return drawing.site;
  for (const island of ISLANDS) {
    for (const landmark of island.landmarks) {
      if (landmark.kind === kind) return siteAt(island, landmark);
    }
  }
  return { island: null, water: -3, ground: () => LANDMARK_SUNK };
}

/** How many times the island table has a landmark kind. */
export function countOf(kind: LandmarkKind): number {
  return ISLANDS.reduce((total, island) => total + island.landmarks.filter((landmark) => landmark.kind === kind).length, 0);
}
