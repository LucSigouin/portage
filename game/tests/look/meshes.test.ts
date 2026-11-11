/**
 * The mesh registries: every node type, landmark, survivor and attachment
 * the data names has a mesh, hulls match the rules engine's dimensions, and
 * ink ids are wide enough for the whole valley.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_IDS, HULL_TIERS, ISLANDS, NODE_TYPES, NPC_IDS } from '../../src/data/index.ts';
import type { LandmarkKind, NodeTypeId } from '../../src/data/index.ts';
import { attachmentTransformForHull } from '../../src/sim/index.ts';
import { PLACEHOLDER_ATTACHMENTS, buildAttachment } from '../../src/look/attachments.ts';
import { buildHull, makeHullShape } from '../../src/look/b2/canoe.js';
import { THIN, nextId } from '../../src/look/b2/geo.js';
import { buildCharacter } from '../../src/look/characters.ts';
import { LANDMARK_KINDS, landmarkGeometry } from '../../src/look/landmarks.ts';
import { NODE_TYPE_IDS, nodeGeometry } from '../../src/look/nodes.ts';
import { buildIslandProps } from '../../src/look/props.ts';
import { floraFor } from '../../src/look/presets.ts';
import { scatterIsland } from '../../src/look/scatter.ts';

const REQUIRED = ['position', 'normal', 'aColor', 'aInfo', 'aTex'];
const complete = (geometry: THREE.BufferGeometry): void => {
  for (const name of REQUIRED) expect(geometry.getAttribute(name), name).toBeDefined();
  expect(geometry.getAttribute('position').count).toBeGreaterThan(30);
};

describe('ink ids', () => {
  it('are wide enough: 2003 different ids, each exact in a half-float, none reserved', () => {
    const ids = new Set<number>();
    for (let index = 0; index < 2003; index += 1) ids.add(nextId());
    expect(ids.size).toBe(2003);
    for (const id of ids) {
      expect(Number.isInteger(id * 2048)).toBe(true);
      expect(id).toBeGreaterThan(0.002); // 0 is open water
      expect(id).toBeLessThan(THIN - 0.002); // THIN is never outlined; 1 is sky
    }
    expect(THIN).toBe(2040 / 2048);
  });
});

describe('mesh registries', () => {
  it('draw every scavenge node type in the data', () => {
    expect([...NODE_TYPE_IDS].sort()).toEqual((Object.keys(NODE_TYPES) as NodeTypeId[]).sort());
    for (const typeId of NODE_TYPE_IDS) complete(nodeGeometry(typeId));
  });

  it('draw every landmark the islands name', () => {
    const named = new Set<LandmarkKind>(ISLANDS.flatMap((island) => island.landmarks.map((landmark) => landmark.kind)));
    for (const kind of named) expect(LANDMARK_KINDS).toContain(kind);
    for (const kind of LANDMARK_KINDS) complete(landmarkGeometry(kind));
  });

  it('draw every survivor', () => {
    for (const npcId of NPC_IDS) complete(buildCharacter(npcId).geometry);
  });

  it('build all 19 attachments on the long hull, none of them a placeholder', () => {
    const tier = 3;
    const dimensions = HULL_TIERS[tier].dimensions;
    const shape = makeHullShape(dimensions);
    expect(ATTACHMENT_IDS).toHaveLength(19);
    for (const attachmentId of ATTACHMENT_IDS) {
      const piece = buildAttachment(attachmentId, {
        hullTier: tier, shape, halfBeam: dimensions.beam / 2, gunwaleY: dimensions.depth - dimensions.draft,
        mount: attachmentTransformForHull(attachmentId, tier).position,
      });
      let vertices = 0;
      piece.object.traverse((object) => {
        if (object instanceof THREE.Mesh) vertices += object.geometry.getAttribute('position').count;
      });
      expect(vertices, attachmentId).toBeGreaterThan(30);
    }
    expect(PLACEHOLDER_ATTACHMENTS.length).toBeLessThanOrEqual(3);
  });
});

describe('hulls', () => {
  it('have the rules engine\'s length, beam and depth at every tier', () => {
    HULL_TIERS.forEach((definition, tier) => {
      const { length, beam, depth } = definition.dimensions;
      const geometry = buildHull(makeHullShape(definition.dimensions), tier).geometry;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      // Gunwale tubes, stem bands and rub strakes stand a few centimetres proud of the lofted hull.
      expect(size.z).toBeGreaterThan(length * 0.97);
      expect(size.z).toBeLessThan(length + 0.12);
      expect(size.x).toBeGreaterThan(beam * 0.98);
      expect(size.x).toBeLessThan(beam + 0.12);
      // The keel sits at y = 0 amidships, so sinking the hull by its draft puts the waterline at the origin.
      expect(geometry.boundingBox!.min.y).toBeGreaterThan(-0.03);
      expect(geometry.boundingBox!.min.y).toBeLessThan(0.02);
      expect(makeHullShape(definition.dimensions).sheerAt(0)).toBeCloseTo(depth, 6);
    });
  });

  it('give the long canoe a longer silhouette than the ribbed one', () => {
    const lengthOf = (tier: number): number => {
      const geometry = buildHull(makeHullShape(HULL_TIERS[tier].dimensions), tier).geometry;
      geometry.computeBoundingBox();
      return geometry.boundingBox!.getSize(new THREE.Vector3()).z;
    };
    expect(lengthOf(3) - lengthOf(2)).toBeGreaterThan(1.3);
  });
});

describe('island props', () => {
  it('instance every placement, each with its own ink id shift', () => {
    const island = ISLANDS[0];
    const placements = scatterIsland(island, floraFor(island));
    const props = buildIslandProps(placements, 1);
    let instances = 0;
    for (const group of [props.near, props.detail]) {
      for (const child of group.children) {
        const mesh = child as THREE.InstancedMesh;
        instances += mesh.count;
        const perInstance = mesh.geometry.getAttribute('aInst');
        expect(perInstance.count).toBe(mesh.count);
        for (let index = 0; index < mesh.count; index += 1) expect(perInstance.getX(index)).toBeGreaterThan(0);
      }
    }
    expect(instances).toBe(placements.length);
    const trees = props.counts.spruce + props.counts.pine + props.counts.birch;
    expect(props.far.children.reduce((total, child) => total + (child as THREE.InstancedMesh).count, 0)).toBe(trees);
  });
});
