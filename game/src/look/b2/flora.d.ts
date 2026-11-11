import type { Builder } from './geo.js';

type Random = () => number;
export function spruce(builder: Builder, x: number, y: number, z: number, height: number, random: Random, coarse?: boolean): void;
export function whitePine(builder: Builder, x: number, y: number, z: number, height: number, random: Random, coarse?: boolean): void;
/** `coarse`: the same tree with about half the triangles, for a few hundred metres off. */
export function birch(builder: Builder, x: number, y: number, z: number, height: number, random: Random, coarse?: boolean): void;
/** A dead, silvered trunk standing in the water. Its foot is 1.5 m under the surface. */
export function snag(builder: Builder, x: number, z: number, height: number, random: Random): void;
/** `plain`: the same roof without the single shakes and trim, for far off. */
export function cabinRoof(builder: Builder, plain?: boolean): void;
export function steeple(builder: Builder, bare?: boolean): void;
export function pylon(builder: Builder): void;
