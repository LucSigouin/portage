/**
 * One-shot effects on land: a little inked puff where something was gathered,
 * crafted or built. (Splashes are white brush rings on the water: water.js.)
 * They run on the look's paint time, so a paused game holds them still.
 */
import * as THREE from 'three';
import { THIN, piece } from './b2/geo.js';

const MAXIMUM_PUFFS = 14;
const PUFF_SECONDS = 0.9;

interface Puff { mesh: THREE.Mesh; age: number; x: number; y: number; z: number }

export class Effects {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private next = 0;

  constructor() {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    for (let index = 0; index < MAXIMUM_PUFFS; index += 1) {
      // A wash with no pen line round it, like B2's smoke.
      const mesh = piece(geometry, index % 2 ? '#c3cbcd' : '#d9d6c8', 0, THIN);
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, age: PUFF_SECONDS, x: 0, y: 0, z: 0 });
    }
    geometry.dispose();
  }

  /** Three small puffs rising from a point. */
  puff(x: number, y: number, z: number): void {
    for (let index = 0; index < 3; index += 1) {
      const puff = this.puffs[this.next % MAXIMUM_PUFFS];
      this.next += 1;
      puff.age = -index * 0.08;
      puff.x = x + (index - 1) * 0.22;
      puff.y = y;
      puff.z = z + ((index * 7) % 3 - 1) * 0.18;
    }
  }

  update(seconds: number): void {
    for (const puff of this.puffs) {
      if (puff.age >= PUFF_SECONDS) continue;
      puff.age += seconds;
      const share = puff.age / PUFF_SECONDS;
      puff.mesh.visible = share >= 0 && share < 1;
      if (!puff.mesh.visible) continue;
      const size = (0.08 + share * 0.24) * Math.sin(Math.min(1, share * 1.25) * Math.PI) ** 0.6;
      puff.mesh.position.set(puff.x, puff.y + share * 1.1, puff.z);
      puff.mesh.scale.set(size, size * 0.9, size * 1.15);
    }
  }

  dispose(): void {
    for (const puff of this.puffs) puff.mesh.geometry.dispose();
  }
}
