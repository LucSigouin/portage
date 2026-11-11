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
export function buildStarterKit(shape: HullShape): Mesh;

export interface Crew {
  /** The paddler and paddle. The model faces +z. */
  root: Group;
  /** Seated stroke. phase 0..1, effort 0..1 (0 rests the paddle across the gunwales), side +1 or -1. */
  paddle(seconds: number, phase: number, effort: number, side: number): { inWater: boolean; blade: Vector3; pull: number };
  /** Ashore. time: seconds, for the idle breath. stride: radians of the walk cycle. moving 0..1. */
  stand(time: number, stride?: number, moving?: number): void;
}
/** A crew member's colours. Left out, they are B2's paddler: ochre coat, red toque, blue-grey legs. */
export interface Outfit { coat?: string; toque?: string; legs?: string }
export function createCrew(outfit?: Outfit): Crew;
