/**
 * The pen's samples (round 4). Luc, from the live game: "the outline should be full and not kinda drawn on".
 *
 * The samples are settings of the one pen (`look/b2/pens.js`), switched by `?pen=<name>`. This file holds two things:
 * with no switch the pen is today's to the letter, and each sample is what it says it is. No graphics card here:
 * the pen's shader is read off a stand-in renderer, as `outline.test.ts` does.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { DEFAULT_PEN, PENS, PEN_NAMES, penDefines, penFrom, penReach } from '../../src/look/b2/pens.js';
import type { PenName } from '../../src/look/b2/pens.js';
import { createPost } from '../../src/look/b2/post.js';

/** The pen's shader on `main` at 2857012, before this round: its SHA-256 and its length (tools/pen-hash.mjs). */
const BEFORE = { sha256: 'bf09ec43d0fba18c8027c020bb93bfb2632ebe7d9a105f0e57b1d3c676697786', length: 12619 };

interface PenMaterial { fragmentShader: string; defines: Record<string, string | number> | undefined }

/** One frame through a renderer that draws nothing: the two pens (the world's, the heroes') as they were handed over. */
function pens(name: PenName | null): { world: PenMaterial; hero: PenMaterial; state: string } {
  const seen: PenMaterial[] = [];
  const renderer = {
    clear: () => {},
    setRenderTarget: () => {},
    render: (what: THREE.Object3D) => {
      const material = (what.children[0] as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
      if (material?.fragmentShader?.includes('penAt')) seen.push(material as unknown as PenMaterial);
    },
    getClearColor: (colour: THREE.Color) => colour.set(0xffffff),
    getClearAlpha: () => 1,
    setClearColor: () => {},
  };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  const post = createPost(renderer as unknown as THREE.WebGLRenderer, camera);
  post.setSize(640, 360);
  if (name !== null) post.setPen(name);
  const scene = new THREE.Scene();
  const water = new THREE.Mesh();
  const heroes = new THREE.Group();
  scene.add(water, heroes);
  post.render(scene, camera, water, null, false, null, heroes, [{ x: 100, y: 50, w: 300, h: 250 }]);
  expect(seen).toHaveLength(2);
  const hero = seen.find((material) => material.defines?.HERO !== undefined)!;
  const world = seen.find((material) => material !== hero)!;
  return { world, hero, state: post.state.pen };
}

/** The settings a pen is compiled with that are the samples' own. */
const sampleDefines = (material: PenMaterial): Record<string, string | number> =>
  Object.fromEntries(Object.entries(material.defines ?? {}).filter(([key]) => key.startsWith('PEN_')));

/** The shader with every block of the samples taken out: what the graphics card compiles with no sample picked. */
const withoutSamples = (text: string): string => text.replace(/#ifdef PEN_FULL\n[\s\S]*?#endif\n/g, '');

describe('with no switch the pen is today\'s', () => {
  it('nothing is defined, so none of the samples\' blocks is compiled', () => {
    const { world, hero, state } = pens(null);
    expect(state).toBe('today');
    expect(sampleDefines(world)).toEqual({});
    expect(sampleDefines(hero)).toEqual({});
    expect(hero.defines).toEqual({ HERO: 1 });
  });

  it('and what is left of the shader is the text before this round, to the letter', async () => {
    const { world, hero } = pens(null);
    expect(hero.fragmentShader).toBe(world.fragmentShader);
    const left = withoutSamples(world.fragmentShader);
    expect(left).not.toContain('PEN_');
    expect(left.length).toBe(BEFORE.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(left)));
    expect([...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(BEFORE.sha256);
    // every line of the samples sits inside a block: no stray #else, and no block inside a block
    const blocks = world.fragmentShader.match(/#ifdef PEN_FULL\n[\s\S]*?#endif\n/g) ?? [];
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) expect(block.match(/#if|#else/g)).toHaveLength(1);
  });

  it('picking today\'s pen again after a sample leaves nothing defined', () => {
    const seenFull = pens('full');
    expect(sampleDefines(seenFull.world).PEN_FULL).toBe(1);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const post = createPost({} as unknown as THREE.WebGLRenderer, camera);
    post.setPen('bold');
    post.setPen('today');
    expect(post.state.pen).toBe('today');
    expect(penDefines('today')).toEqual({});
  });
});

describe('one switch: ?pen=<name>', () => {
  it('reads a name or its letter, in any case', () => {
    expect(PEN_NAMES).toEqual(['today', 'full', 'bold', 'near']);
    expect(DEFAULT_PEN).toBe('today');
    for (const name of PEN_NAMES) expect(penFrom(name)).toBe(name);
    expect(['a', 'b', 'c', 'd'].map(penFrom)).toEqual(['today', 'full', 'bold', 'near']);
    expect(penFrom(' Bold ')).toBe('bold');
    expect(penFrom('C')).toBe('bold');
  });

  it('anything else, or nothing, is today\'s pen', () => {
    for (const text of [null, undefined, '', 'e', 'thick', '1', 'full;bold', 'constructor', '__proto__', 'toString']) expect(penFrom(text), String(text)).toBe('today');
  });

  it('the address parameter hands it over, and replaces no game: saves stay in use', () => {
    expect(parseDebugParameters('').pen).toBe('today');
    expect(parseDebugParameters('?pen=bold')).toMatchObject({ pen: 'bold', sandbox: false, shot: null });
    expect(parseDebugParameters('?shot=island&pen=d')).toMatchObject({ pen: 'near', shot: 'island', sandbox: true });
    expect(parseDebugParameters('?pen=nonsense').pen).toBe('today');
  });
});

describe('the samples', () => {
  const samples = PEN_NAMES.filter((name) => name !== 'today');

  it('both pens are compiled with the same settings: one pen, so no seam where a figure\'s window meets the world', () => {
    for (const name of samples) {
      const { world, hero, state } = pens(name);
      expect(state).toBe(name);
      expect(sampleDefines(world), name).toEqual(penDefines(name));
      expect(sampleDefines(hero), name).toEqual(penDefines(name));
      expect(hero.defines?.HERO, name).toBe(1);
      expect(world.defines?.HERO, name).toBeUndefined();
      // the text itself never changes: a sample is settings alone
      expect(world.fragmentShader).toBe(pens(null).world.fragmentShader);
    }
  });

  it('every setting reaches the shader as a number it can read (a float, never a bare integer)', () => {
    for (const name of samples) {
      const defines = penDefines(name);
      expect(Object.keys(defines).sort()).toEqual(['PEN_FROM', 'PEN_FULL', 'PEN_SEAM', 'PEN_TO', 'PEN_WEIGHT', 'PEN_WIDTH']);
      for (const key of ['PEN_FROM', 'PEN_SEAM', 'PEN_TO', 'PEN_WEIGHT', 'PEN_WIDTH']) {
        expect(String(defines[key]), `${name} ${key}`).toMatch(/^\d*\.\d*$/);
        expect(Number(defines[key])).toBeGreaterThan(0);
      }
      expect(Number(defines.PEN_FROM)).toBeLessThan(Number(defines.PEN_TO));
    }
  });

  it('a full line is full ink: the one weight it keeps is the middle of today\'s, where a stroke is neither dry nor swollen', () => {
    for (const name of samples) {
      const pen = PENS[name]!;
      // post.js: dry = .8 + .4 * weight. Under 1 the line is thinned with paper showing through.
      expect(0.8 + 0.4 * pen.weight, name).toBeGreaterThanOrEqual(1);
      expect(pen.seam, name).toBeGreaterThanOrEqual(0.64);
      expect(pen.seam, name).toBeLessThanOrEqual(1);
    }
  });

  it('they differ: bold is wider than full and its seams darker, near is full up close and today\'s far off', () => {
    expect(PENS.today).toBeNull();
    expect(PENS.bold!.width).toBeGreaterThanOrEqual(PENS.full!.width * 1.5);
    expect(PENS.bold!.seam).toBeGreaterThan(PENS.full!.seam);
    expect(PENS.full!.from).toBeNull();
    expect(PENS.bold!.from).toBeNull();
    expect(PENS.near).toMatchObject({ width: PENS.full!.width, weight: PENS.full!.weight });
    // past the canoe and the crew at every play distance (the walking camera fully out is 18 m), short of the far shore
    expect(PENS.near!.from!).toBeGreaterThanOrEqual(18);
    expect(PENS.near!.to!).toBeGreaterThan(PENS.near!.from! * 2);
  });

  it('no sample\'s ink lies further from its edge than today\'s: the probe finds it and no hero window cuts it', () => {
    expect(penReach('today')).toBe(1);
    for (const name of samples) {
      expect(penReach(name), name).toBeLessThanOrEqual(1);
      expect(penReach(name), name).toBeGreaterThan(0.3);
    }
    expect(penReach('near')).toBe(1);
    expect(penReach('bold')).toBeGreaterThan(penReach('full'));
  });
});
