/**
 * The three survivors: each has their own drawing, stands on the ground
 * facing -z, and is told from the other two by shape and by what they carry.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { NPC_IDS } from '../../src/data/index.ts';
import type { NpcId } from '../../src/data/index.ts';
import { buildCharacter, registerCharacter } from '../../src/look/characters.ts';
import type { CharacterBuilder } from '../../src/look/characters.ts';

interface Drawn { box: THREE.Box3; ids: Set<number>; colours: THREE.Color[]; vertices: number; eyes: THREE.Vector3[] }

/** A wash is the named colour give or take the builder's small jitter. */
const has = (figure: Drawn, hex: string): boolean => {
  const wanted = new THREE.Color(hex);
  return figure.colours.some((colour) => Math.max(Math.abs(colour.r - wanted.r), Math.abs(colour.g - wanted.g), Math.abs(colour.b - wanted.b)) < 0.035);
};

function drawn(npcId: NpcId): Drawn {
  const geometry = buildCharacter(npcId).geometry;
  geometry.computeBoundingBox();
  const [info, colour, position] = [geometry.getAttribute('aInfo'), geometry.getAttribute('aColor'), geometry.getAttribute('position')];
  const ids = new Set<number>();
  const seen = new Map<string, THREE.Color>();
  const eyes: THREE.Vector3[] = [];
  for (let index = 0; index < info.count; index += 1) {
    ids.add(info.getX(index));
    const hex = `#${new THREE.Color(colour.getX(index), colour.getY(index), colour.getZ(index)).getHexString()}`;
    if (!seen.has(hex)) seen.set(hex, new THREE.Color(hex));
    // The eyes are the only pieces in the pen's own ink (#2a2b33) at head height on a figure's front.
    if (hex === '#2a2b33') eyes.push(new THREE.Vector3().fromBufferAttribute(position, index));
  }
  return { box: geometry.boundingBox!, ids, colours: [...seen.values()], vertices: info.count, eyes };
}

/** What each one carries that nobody else does, by the colours only that thing has. */
const CARRIES: Record<NpcId, string[]> = {
  odile: ['#dcc98f', '#c64732', '#cfcbc0'], // straw hat, apples, grey hair
  wren: ['#6b8396', '#dccfa6', '#c9a14a'], // slate coat, bell rope, brass bell
  tink: ['#8a5f41', '#8d9496', '#b9744f'], // leather apron, steel wrench, copper wire
};

const originals = new Map<NpcId, CharacterBuilder>();
afterEach(() => {
  for (const [npcId, build] of originals) registerCharacter(npcId, build);
  originals.clear();
});

describe('the survivors', () => {
  it('each have their own drawing, feet on the ground, facing -z', () => {
    expect([...NPC_IDS].sort()).toEqual(['odile', 'tink', 'wren']);
    for (const npcId of NPC_IDS) {
      const figure = drawn(npcId);
      // The old stand-in was one shape in three colourways: 11 inked pieces, 3300 vertices.
      expect(figure.ids.size, `${npcId}: inked pieces`).toBeGreaterThanOrEqual(24);
      expect(figure.vertices, `${npcId}: vertices`).toBeGreaterThan(6000);
      expect(figure.box.min.y, `${npcId}: feet`).toBeGreaterThan(-0.01);
      expect(figure.box.min.y, `${npcId}: feet`).toBeLessThan(0.02);
      expect(Math.abs((figure.box.min.x + figure.box.max.x) / 2), `${npcId}: stands over the origin`).toBeLessThan(0.15);
      const height = figure.box.max.y;
      const eyes = figure.eyes.filter((eye) => eye.y > height * 0.6);
      expect(eyes.length, `${npcId}: eyes`).toBeGreaterThan(0);
      for (const eye of eyes) expect(eye.z, `${npcId}: eyes look down -z`).toBeLessThan(-0.08);
    }
  });

  it('carry what makes them who they are, and nobody else\'s', () => {
    for (const npcId of NPC_IDS) {
      const figure = drawn(npcId);
      for (const colour of CARRIES[npcId]) expect(has(figure, colour), `${npcId} has ${colour}`).toBe(true);
      for (const other of NPC_IDS) {
        if (other === npcId) continue;
        const shared = CARRIES[other].filter((colour) => has(figure, colour));
        expect(shared.length, `${npcId} carrying ${other}'s things: ${shared.join(' ')}`).toBeLessThan(CARRIES[other].length);
      }
    }
  });

  it('are told apart by shape: Wren the tall one, Tink the broad one, Odile the small one under a wide hat', () => {
    const [odile, wren, tink] = [drawn('odile'), drawn('wren'), drawn('tink')];
    const size = (figure: Drawn): THREE.Vector3 => figure.box.getSize(new THREE.Vector3());
    /** How wide the figure is at a height: every vertex within `half` of it. */
    const widthAt = (npcId: NpcId, y: number, half = 0.03): number => {
      const position = buildCharacter(npcId).geometry.getAttribute('position');
      let [low, high] = [Infinity, -Infinity];
      for (let index = 0; index < position.count; index += 1) {
        if (Math.abs(position.getY(index) - y) > half) continue;
        low = Math.min(low, position.getX(index));
        high = Math.max(high, position.getX(index));
      }
      return high - low;
    };
    // Heads, not what they hold up: Wren's cap is the highest crown.
    expect(widthAt('wren', 1.82)).toBeGreaterThan(0.1);
    expect(widthAt('odile', 1.82)).toBe(-Infinity);
    expect(widthAt('tink', 1.82)).toBeLessThan(0.1);
    // Tink stands the broadest, Wren the narrowest: across the boots, where nobody is holding anything out.
    expect(widthAt('tink', 0.05, 0.06)).toBeGreaterThan(widthAt('wren', 0.05, 0.06) + 0.05);
    // Odile's hat brim is wider than her shoulders, and her skirt reaches the ground in one piece.
    expect(widthAt('odile', 1.56)).toBeGreaterThan(0.55);
    expect(widthAt('odile', 0.09)).toBeGreaterThan(0.45);
    expect(size(wren).y).toBeGreaterThan(size(odile).y + 0.15);
    expect(size(tink).z).toBeGreaterThan(size(wren).z);
  });

  it('can be swapped out with registerCharacter', () => {
    const before = drawn('wren').vertices;
    originals.set('wren', (builder) => builder.box(0.5, 1.7, 0.3, '#6b8396', { pos: [0, 0.85, 0] }));
    registerCharacter('wren', originals.get('wren')!);
    expect(drawn('wren').vertices).toBeLessThan(100);
    // put the real one back for the tests after this
    originals.clear();
    expect(before).toBeGreaterThan(6000);
  });
});
