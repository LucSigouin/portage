import type { Group, Mesh, Object3D, Vector3 } from 'three';

export interface HullDimensions { length: number; beam: number; depth: number; draft: number }

/** A hull lofted from the rules engine's dimensions, in B2's hull space: bow toward +z, y = 0 at the keel. */
export interface HullShape {
  HULL: { L: number; B: number; D: number; draft: number; seatZ: number; bowSeatZ: number; seatY: number; k: number;
    /** The floor you see inside, from the keel: just above the waterline. */
    floor: number };
  HL: number;
  hullPoint(t: number, s: number, inset?: number, out?: Vector3): Vector3;
  /** Half beam and gunwale height at hull-local z. */
  halfBeamAt(z: number): number;
  sheerAt(z: number): number;
}
export function makeHullShape(dimensions: HullDimensions): HullShape;
export function buildHull(shape: HullShape, tier?: number): Mesh;
export function buildBilge(shape: HullShape): Mesh;
/** crewed: someone kneels amidships, so the loose kit is shoved up against the thwart. Left out, B2's layout. */
export function buildStarterKit(shape: HullShape, crewed?: boolean): Mesh;

/** One side of a figure: the arm and leg meshes, and the hand's place. */
export interface Limbs { upper: Mesh; thigh: Mesh; shin: Mesh; knee: Mesh; boot: Mesh; H: Vector3; /** The shoulder and the elbow, in the figure's space. */ S: Vector3; E: Vector3 }

/** What a seated figure does besides paddle. */
export interface SeatedPose {
  /** 1: kneeling on the floor, heels tucked under (the two places between the seats). */
  kneel?: number;
  /** Metres from the figure's origin down to the hull floor, for the knees. */
  floor?: number;
  /** 0..1: bailing with a tin, the paddle laid across the gunwales. `bailPhase` 0..1 is one scoop. */
  bail?: number;
  bailPhase?: number;
  /** 0..1: slumped forward asleep. */
  sleep?: number;
  /** -1 lays the resting paddle with its blade out to the figure's right. Left out, to its left. */
  restSide?: number;
  /** The hull's half beam along the stroke, metres. A wider hull takes the blade further out. Left out, 0.38. */
  beam?: number;
  /** The gunwale's highest above the figure's origin along the stroke, metres. Higher takes the lower hand up the shaft. Left out, 0.1. */
  gunwale?: number;
  /** Beside an outrigger's deck: how far out from the figure's centre the paddle's tip may reach. Left out, no limit. */
  well?: number;
  /** How far behind (negative) and ahead the blade may reach, metres from the figure. Left out, the full stroke. */
  span?: [number, number];
}
/** The share of a stroke the blade is pulled through the water, from the catch; the rest is the recovery. */
export const STROKE_PULL: number;

export interface Crew {
  /** The paddler and paddle. The model faces +z. */
  root: Group;
  /** The limbs, for reading what the figure wears and where its hands are. `H` is the hand, in the figure's space. */
  paddler: { L: Limbs; R: Limbs; paddle: Mesh };
  /** Seated stroke. phase 0..1, effort 0..1 (0 rests the paddle across the gunwales), side +1 or -1. */
  paddle(seconds: number, phase: number, effort: number, side: number, more?: SeatedPose | null): { inWater: boolean; blade: Vector3; pull: number };
  /**
   * Ashore, without the paddle: it stays in the canoe. time: kept for callers, unused (standing still is still).
   * stride: radians of the walk cycle. moving 0..1. lying 0..1: stretched out flat. holding: a tool is in the right hand.
   * jump: how the figure holds itself in a jump (`look/jump-pose.ts`). Left out, or all 0: standing and walking as ever.
   */
  stand(time: number, stride?: number, moving?: number, lying?: number, holding?: boolean, jump?: { trail: number; tuck: number; arms: number; crouch: number } | null): void;
  /** The paddle left in the canoe: laid across the gunwales in `holder`, a group placed as the seated figure would be. */
  leave(holder: Object3D, restSide?: number): void;
}
/** A crew member's colours. Left out, they are B2's paddler: ochre coat, red toque, blue-grey legs. */
export interface Outfit { coat?: string; toque?: string; legs?: string }
export function createCrew(outfit?: Outfit): Crew;
