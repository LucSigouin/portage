import type { BufferGeometry, Material, Matrix4, Mesh, Vector3 } from 'three';
import type { MaterialKind } from './detail.js';

/** Pieces with this ink id are never outlined: ropes, wires, rods. They are already a pen line. */
export const THIN: number;
/** A fresh ink id. The pen draws a line wherever two ids meet. */
export function nextId(): number;
/** Small deterministic generator, 0 to 1. */
export function rng(seed: number): () => number;

export type Triple = [number, number, number];

export interface PieceOptions {
  pos?: Triple;
  rot?: Triple;
  order?: 'XYZ' | 'YXZ' | 'ZYX';
  scale?: number | Triple;
  matrix?: Matrix4;
  /** Ink id. Give two pieces the same id to draw no line between them. */
  id?: number;
  /** 0 to 1: how much of the flat colour shows through shade and mist. 1 is a lamp. */
  glow?: number;
  /** No colour jitter. */
  flat?: boolean;
  /** Material tag. Guessed from the colour when left out. */
  kind?: MaterialKind;
  /** Which local axis the grain runs along. */
  axis?: 0 | 1 | 2;
  seed?: number;
  /** `beam`: radius at the far end. */
  r2?: number;
  /** `tube`: segments along it. */
  steps?: number;
  /** `plank`: turn about its length. */
  twist?: number;
}

export interface GridOptions {
  kind?: MaterialKind | ((i: number, j: number) => MaterialKind);
  axis?: 0 | 1 | 2;
  seed?: number;
  tex?: (vi: number, vj: number, i: number, j: number) => [number, number, number, number] | null;
}

/** Merges primitives into one mesh. Each piece carries its colour, ink id, material tag and local frame. */
export class Builder {
  constructor(seed?: number);
  rand: () => number;
  /** Applied to every piece added (not to grids). */
  base: Matrix4 | null;
  /** Applied after `base`, grids included. */
  root: Matrix4 | null;
  /** Default material tag for everything added. */
  kind: MaterialKind | null;
  add(geometry: BufferGeometry, color: string, options?: PieceOptions): number;
  box(width: number, height: number, depth: number, color: string, options?: PieceOptions): number;
  cyl(radiusTop: number, radiusBottom: number, height: number, color: string, options?: PieceOptions, segments?: number): number;
  cone(radius: number, height: number, color: string, options?: PieceOptions, segments?: number): number;
  sphere(radius: number, color: string, options?: PieceOptions, segments?: number): number;
  torus(radius: number, tube: number, color: string, options?: PieceOptions, segments?: number): number;
  beam(from: Triple, to: Triple, radius: number, color: string, options?: PieceOptions, segments?: number): number;
  plank(from: Triple, to: Triple, width: number, thickness: number, color: string, options?: PieceOptions): number;
  tube(points: Triple[], radius: number, color: string, options?: PieceOptions, segments?: number): number;
  grid(points: Vector3[][], colorAt: (i: number, j: number) => string | null, idAt: (i: number, j: number) => number, options?: GridOptions): void;
  bolt(x: number, y: number, z: number, color?: string, radius?: number, axis?: 'x' | 'y' | 'z'): number;
  tack(x: number, y: number, z: number, radius?: number, color?: string): number;
  stencil(text: string, origin: Triple, right: Triple, up: Triple, height: number, color?: string): void;
  geometry(): BufferGeometry;
  mesh(material?: Material): Mesh;
}

/** One animated piece (a limb, a puff) as its own mesh. */
export function piece(geometry: BufferGeometry, color: string, glow?: number, id?: number, kind?: MaterialKind): Mesh;
export function cloth(
  cellsU: number, cellsV: number, cellColor: (i: number, j: number) => string, cellId: (i: number, j: number) => number,
  options?: { size?: [number, number]; kind?: MaterialKind; patch?: (i: number, j: number) => [number, number, number, number] | null },
): Mesh;
export function setSpan(mesh: Mesh, from: Vector3, to: Vector3, radius?: number): void;
