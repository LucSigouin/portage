import type { Builder } from './geo.js';

type Random = () => number;
export function spruce(builder: Builder, x: number, y: number, z: number, height: number, random: Random): void;
export function whitePine(builder: Builder, x: number, y: number, z: number, height: number, random: Random): void;
export function birch(builder: Builder, x: number, y: number, z: number, height: number, random: Random): void;
/** A dead, silvered trunk standing in the water. Its foot is 1.5 m under the surface. */
export function snag(builder: Builder, x: number, z: number, height: number, random: Random): void;
export function cabinRoof(builder: Builder): void;
export function steeple(builder: Builder): void;
export function pylon(builder: Builder): void;
