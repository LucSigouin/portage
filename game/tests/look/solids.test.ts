/**
 * Luc's list, line 1: trees, rocks and landmarks are solid. The rules cannot read the look, so they keep their own
 * copy of where things stand. These tests hold that copy to what the look draws: a tree you can see is a tree you
 * bump into, and nothing solid stands where nothing is drawn.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLORA_PRESETS, ISLANDS, ISLANDS_BY_ID, TUNING, floraMixFor, floraPresetFor } from '../../src/data/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { FOOTPRINT_BAND, LANDMARK_FOOTPRINTS, WALK_ON_LANDMARKS } from '../../src/data/footprints.ts';
import { anchorSolids, bufferStopSolids, dressingAnchors, scatterIsland as rulesScatter, terrainHeight } from '../../src/sim/index.ts';
import type { DressingAnchor } from '../../src/sim/index.ts';
import { PRESETS, floraFor, presetIdFor } from '../../src/look/presets.ts';
import { scatterIsland as lookScatter } from '../../src/look/scatter.ts';
import { disposeDressing, dressIsland } from '../../src/look/world/dressing.ts';
import { measureFootprint } from './footprints.ts';

interface Instance {
  mesh: THREE.InstancedMesh;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Every instance the look's dressing draws on an island, where it stands. */
function drawnInstances(group: THREE.Group): Instance[] {
  const found: Instance[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  group.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix);
      matrix.decompose(position, turn, size);
      found.push({ mesh: object, x: position.x, y: position.y, z: position.z, yaw: 2 * Math.atan2(turn.y, turn.w), scale: size.x });
    }
  });
  return found;
}

/** Points on a drawing's surface at body height, every 0.12 m: the instance sits 0.3 m into the ground. */
function surfaceAtBodyHeight(geometry: THREE.BufferGeometry): { x: number; z: number }[] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertex = (at: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(at) : at);
  const points: { x: number; z: number }[] = [];
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const a = vertex(triangle);
    const b = vertex(triangle + 1);
    const c = vertex(triangle + 2);
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / 0.12));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; i + j <= steps; j += 1) {
        const y = a.y + ((b.y - a.y) * i + (c.y - a.y) * j) / steps;
        if (y < 0.6 || y > 2.1) continue;
        points.push({ x: a.x + ((b.x - a.x) * i + (c.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * i + (c.z - a.z) * j) / steps });
      }
    }
  }
  return points;
}

const sameTurn = (a: number, b: number): boolean => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-4;

function matching(instances: Instance[], anchor: DressingAnchor): Instance | undefined {
  return instances.find((instance) => Math.abs(instance.x - anchor.x) < 1e-3 && Math.abs(instance.z - anchor.z) < 1e-3
    && sameTurn(instance.yaw, anchor.yaw) && Math.abs(instance.scale - anchor.scale) < 1e-4);
}

describe('the rules stand trees and rocks where the look draws them', () => {
  it('picks the same flora for every island', () => {
    for (const island of ISLANDS) {
      expect(floraPresetFor(island), island.id).toBe(presetIdFor(island));
      expect(floraMixFor(island), island.id).toEqual(floraFor(island));
    }
    for (const [id, preset] of Object.entries(PRESETS)) expect(FLORA_PRESETS[id as keyof typeof FLORA_PRESETS], id).toEqual(preset.flora);
  });

  it('places every tree and boulder where the look does', () => {
    for (const island of ISLANDS) expect(rulesScatter(island, floraMixFor(island)), island.id).toEqual(lookScatter(island, floraFor(island)));
  });

  it('puts a solid at every crag, skerry, snag, heron and the great pine the look draws, and nowhere else', () => {
    let checked = 0;
    for (const island of ISLANDS) {
      const dressing = dressIsland(island);
      const instances = [...drawnInstances(dressing.always), ...drawnInstances(dressing.close)];
      const anchors = dressingAnchors(island);
      for (const kind of ['crag', 'skerry', 'snag', 'heron', 'signal_pine'] as const) {
        expect(anchors.filter((anchor) => anchor.kind === kind).length, `${island.id} ${kind}`).toBe(dressing.counts[kind] ?? 0);
      }
      for (const anchor of anchors) {
        expect(matching(instances, anchor), `${island.id} ${anchor.kind} at ${anchor.x.toFixed(1)},${anchor.z.toFixed(1)}`).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
    disposeDressing();
  });

  it('covers each drawn crag with its blocks, and has no block where no rock is drawn', () => {
    const variants = new Map<number, { geometry: THREE.BufferGeometry; anchor: DressingAnchor; islandId: IslandId }>();
    for (const island of ISLANDS) {
      const instances = drawnInstances(dressIsland(island).always);
      for (const anchor of dressingAnchors(island).filter((candidate) => candidate.kind === 'crag')) {
        if (!variants.has(anchor.variant)) variants.set(anchor.variant, { geometry: matching(instances, anchor)!.mesh.geometry, anchor, islandId: island.id });
      }
    }
    expect([...variants.keys()].sort()).toEqual([0, 1, 2]);
    for (const [variant, { geometry, anchor, islandId }] of variants) {
      // The rules' blocks for this crag, brought back to the drawing's own frame at scale 1.
      const cosine = Math.cos(anchor.yaw);
      const sine = Math.sin(anchor.yaw);
      const blocks = anchorSolids(anchor, islandId).map((circle) => {
        const offsetX = (circle.x - anchor.x) / anchor.scale;
        const offsetZ = (circle.z - anchor.z) / anchor.scale;
        return { x: offsetX * cosine - offsetZ * sine, z: offsetX * sine + offsetZ * cosine, radius: circle.radius / anchor.scale };
      });
      const standing = surfaceAtBodyHeight(geometry);
      expect(standing.length, `crag ${variant} has rock at body height`).toBeGreaterThan(10);
      // A block is a circle round a tilted box: its corners stand out of the circle a little (0.55 m at worst today).
      for (const point of standing) {
        const outside = Math.min(...blocks.map((block) => Math.hypot(point.x - block.x, point.z - block.z) - block.radius));
        expect(outside, `crag ${variant} rock at ${point.x.toFixed(2)},${point.z.toFixed(2)} is near a block`).toBeLessThan(0.6);
      }
      for (const block of blocks) {
        expect(standing.some((point) => Math.hypot(point.x - block.x, point.z - block.z) <= block.radius), `crag ${variant} block has rock in it`).toBe(true);
      }
    }
    disposeDressing();
  });
});

describe('the rules hold every landmark by the outline of its drawing', () => {
  const kinds = [...new Set(ISLANDS.flatMap((island) => island.landmarks.map((landmark) => landmark.kind)))].sort();

  it('has an outline for every landmark that is not walked on', () => {
    for (const kind of kinds) {
      if (WALK_ON_LANDMARKS.includes(kind)) expect(LANDMARK_FOOTPRINTS[kind], kind).toBeUndefined();
      else expect(LANDMARK_FOOTPRINTS[kind], kind).toBeDefined();
    }
  });

  it.each(kinds.filter((kind) => !WALK_ON_LANDMARKS.includes(kind)))('%s: the outline is the drawing\'s', (kind) => {
    expect(LANDMARK_FOOTPRINTS[kind]).toEqual(measureFootprint(kind));
  });
});

describe('the rules hold the buffer stop at the end of the bridge\'s track by its drawing (Luc, Round 4)', () => {
  it('has its circles on the bar the look draws across the rails, and nowhere else', () => {
    const island = ISLANDS_BY_ID.truss_bridge;
    const dressing = dressIsland(island);
    const circles = bufferStopSolids(island);
    expect(circles).toHaveLength(4);
    const end = { x: circles.reduce((sum, circle) => sum + circle.x, 0) / 4, z: circles.reduce((sum, circle) => sum + circle.z, 0) / 4 };
    // The rails are one plain mesh in world metres. Within three metres of the track's north end, what stands at
    // body height over the ground is the buffer stop: the rails themselves lie at the ankle there.
    const standing: { x: number; z: number }[] = [];
    dressing.always.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      const position = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      const count = index ? index.count : position.count;
      const vertex = (at: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(at) : at);
      for (let triangle = 0; triangle + 2 < count; triangle += 3) {
        const a = vertex(triangle);
        const b = vertex(triangle + 1);
        const c = vertex(triangle + 2);
        const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / 0.1));
        for (let i = 0; i <= steps; i += 1) {
          for (let j = 0; i + j <= steps; j += 1) {
            const point = new THREE.Vector3().copy(a).addScaledVector(new THREE.Vector3().subVectors(b, a), i / steps).addScaledVector(new THREE.Vector3().subVectors(c, a), j / steps);
            const above = point.y - terrainHeight(point.x, point.z);
            if (above >= FOOTPRINT_BAND.low && above <= FOOTPRINT_BAND.high && Math.hypot(point.x - end.x, point.z - end.z) <= 3) standing.push({ x: point.x, z: point.z });
          }
        }
      }
    });
    expect(standing.length).toBeGreaterThan(50);
    for (const point of standing) {
      const outside = Math.min(...circles.map((circle) => Math.hypot(point.x - circle.x, point.z - circle.z) - circle.radius));
      expect(outside, `drawn at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}`).toBeLessThan(TUNING.foot.bodyRadius);
    }
    for (const circle of circles) expect(standing.some((point) => Math.hypot(point.x - circle.x, point.z - circle.z) <= circle.radius)).toBe(true);
    disposeDressing();
  });
});
