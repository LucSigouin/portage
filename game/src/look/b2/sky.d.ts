import type { Camera, Mesh } from 'three';

export function createSky(): { mesh: Mesh; update(camera: Camera): void };
