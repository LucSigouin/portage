import type { Matrix4, Mesh } from 'three';
import type { Triple } from './geo.js';

type Build = (root: Matrix4) => Mesh;
export const mast: Build;
export const rudder: Build;
export const cargoRack: Build;
export const lanternMast: Build;
export function lantern(root: Matrix4, lit?: boolean): Mesh;
export const canopy: Build;
export const cookstove: Build;
export const workbench: Build;
/** only: 0, 1 or 2 builds just that box. */
export function planters(root: Matrix4, only?: number | null): Mesh;
export const fishingRig: Build;
export const rainCatcher: Build;
export const smoker: Build;
export const winch: Build;
export function radio(root: Matrix4, part: 'set' | 'mast'): Mesh;
/** One outrigger in the game's canoe space. side: -1 port, +1 starboard. */
export function outrigger(root: Matrix4, side: number, layout: { floatX: number; halfBeam: number; gunwaleY: number; deckY: number }): Mesh;
/** The point of each B2 piece that goes onto its mount, in B2's hull space. */
export const ANCHORS: Record<
  | 'mast' | 'rudder' | 'cargoRack' | 'lanternMast' | 'lantern' | 'canopy' | 'cookstove' | 'workbench' | 'planter' | 'fishingRig'
  | 'rainCatcher' | 'smoker' | 'winch' | 'radioSet' | 'radioMast' | 'pennant', Triple>;
export function createSail(root: Matrix4): { mesh: Mesh; update(time: number): void };
export function createPennant(root: Matrix4): { mesh: Mesh; update(time: number): void };
