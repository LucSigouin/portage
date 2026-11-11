import type { Group, Mesh, Vector3 } from 'three';

export interface HullDimensions { length: number; beam: number; depth: number; draft: number }

/** A hull lofted from the rules engine's dimensions, in B2's hull space: bow toward +z, y = 0 at the keel. */
export interface HullShape {
  HULL: { L: number; B: number; D: number; draft: number; seatZ: number; bowSeatZ: number; seatY: number; k: number };
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
export interface Limbs { upper: Mesh; thigh: Mesh; shin: Mesh; knee: Mesh; boot: Mesh; H: Vector3 }

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
}

export interface Crew {
  /** The paddler and paddle. The model faces +z. */
  root: Group;
  /** The limbs, for reading what the figure wears and where its hands are. `H` is the hand, in the figure's space. */
  paddler: { L: Limbs; R: Limbs; paddle: Mesh };
  /** Seated stroke. phase 0..1, effort 0..1 (0 rests the paddle across the gunwales), side +1 or -1. */
  paddle(seconds: number, phase: number, effort: number, side: number, more?: SeatedPose | null): { inWater: boolean; blade: Vector3; pull: number };
  /** Ashore. time: seconds, for the idle breath. stride: radians of the walk cycle. moving 0..1. lying 0..1: stretched out flat. */
  stand(time: number, stride?: number, moving?: number, lying?: number): void;
}
/** A crew member's colours. Left out, they are B2's paddler: ochre coat, red toque, blue-grey legs. */
export interface Outfit { coat?: string; toque?: string; legs?: string }
export function createCrew(outfit?: Outfit): Crew;
