/**
 * Luc's list, item 20: "campfire smoke is really bad, just remove it". No fire draws smoke: not the home
 * campfire (every camp's fire is that drawing), not Tink's forge, not the canoe's firebox or its smoker.
 * The fires themselves stay: their ring, their logs and their ember.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AttachmentId, LandmarkKind } from '../../src/data/index.ts';
import { HULL_TIERS } from '../../src/data/index.ts';
import { attachmentTransformForHull } from '../../src/sim/index.ts';
import { buildAttachment } from '../../src/look/attachments.ts';
import { makeHullShape } from '../../src/look/b2/canoe.js';
import { landmarkFarGeometry, landmarkGeometry } from '../../src/look/landmarks.ts';

/** The smoke's own wash, as the drawings had it. */
const SMOKE = '#d6d7cf';

/** Every colour a geometry carries, as hex. */
function coloursOf(geometry: THREE.BufferGeometry): Set<string> {
  const colours = new Set<string>();
  const attribute = geometry.getAttribute('aColor');
  for (let index = 0; index < attribute.count; index += 1) {
    colours.add(`#${new THREE.Color(attribute.getX(index), attribute.getY(index), attribute.getZ(index)).getHexString()}`);
  }
  return colours;
}

/** How many vertices rise more than `height` metres over the drawing's origin. */
function verticesAbove(geometry: THREE.BufferGeometry, height: number): number {
  const position = geometry.getAttribute('position');
  let count = 0;
  for (let index = 0; index < position.count; index += 1) if (position.getY(index) > height) count += 1;
  return count;
}

describe('no fire draws smoke', () => {
  for (const kind of ['campfire', 'forge_hearth'] as LandmarkKind[]) {
    it(`the ${kind}, near and far, carries no smoke wash`, () => {
      for (const geometry of [landmarkGeometry(kind), landmarkFarGeometry(kind)]) {
        expect(coloursOf(geometry).has(SMOKE)).toBe(false);
      }
    });
  }

  it('nothing rises over the campfire: the tallest thing is the pot\'s tripod', () => {
    // The wisp stood 3.6 m over the fire. The tripod's top is 1.55 m.
    expect(verticesAbove(landmarkGeometry('campfire'), 1.7)).toBe(0);
    expect(verticesAbove(landmarkFarGeometry('campfire'), 1.7)).toBe(0);
  });

  it('nothing rises out of the forge\'s stack: its cap is the top', () => {
    // The stack's cap stands 4.31 m up. The smoke went on to 5.2 m.
    expect(verticesAbove(landmarkGeometry('forge_hearth'), 4.45)).toBe(0);
  });

  it('the fires themselves stay: the campfire keeps its ember, the forge its glowing coals', () => {
    // The ember at the heart of the ring is drawn in this flame orange.
    expect(coloursOf(landmarkGeometry('campfire')).has('#f0a04a')).toBe(true);
    expect(coloursOf(landmarkFarGeometry('campfire')).has('#f0a04a')).toBe(true);
    expect(coloursOf(landmarkGeometry('forge_hearth')).size).toBeGreaterThan(5);
  });

  it('the canoe\'s firebox and smoker draw no smoke either', () => {
    const tier = 3;
    const shape = makeHullShape(HULL_TIERS[tier].dimensions);
    for (const attachmentId of ['firebox', 'smoker', 'forge'] as AttachmentId[]) {
      const transform = attachmentTransformForHull(attachmentId, tier);
      const dimensions = HULL_TIERS[tier].dimensions;
      const piece = buildAttachment(attachmentId, {
        hullTier: tier, shape, halfBeam: dimensions.beam / 2, gunwaleY: dimensions.depth - dimensions.draft,
        mount: transform.position, rotation: transform.rotation,
      });
      piece.object.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) expect(coloursOf(mesh.geometry).has(SMOKE), attachmentId).toBe(false);
      });
    }
  });
});
