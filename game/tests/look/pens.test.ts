/**
 * The pen's samples (round 4). Luc, from the live game: "the outline should be full and not kinda drawn on".
 *
 * The samples are settings of the one pen (`look/b2/pens.js`), switched by `?pen=<name>`. Luc picked C, `bold`, and it
 * is the game's pen. This file holds three things: with no switch the pen is C, with `?pen=today` it is the old pen to
 * the letter, and each sample is what it says it is. No graphics card here:
 * the pen's shader is read off a stand-in renderer, as `outline.test.ts` does.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { DEFAULT_PEN, PENS, PEN_NAMES, penDefines, penFrom, penReach } from '../../src/look/b2/pens.js';
import type { PenName } from '../../src/look/b2/pens.js';
import { terrainMaterialFor } from '../../src/look/b2/palette.js';
import { createPost } from '../../src/look/b2/post.js';
import { CAST_PEN, castPenWidth } from '../../src/look/cast-sketch.ts';

/** The pen's shader on `main` at 2857012, before this round: its SHA-256 and its length (tools/pen-hash.mjs). */
const BEFORE = { sha256: 'bf09ec43d0fba18c8027c020bb93bfb2632ebe7d9a105f0e57b1d3c676697786', length: 12619 };

interface PenMaterial { fragmentShader: string; defines: Record<string, string | number> | undefined }

/**
 * One frame through a renderer that draws nothing: the two pens (the world's, the heroes') as they were handed over.
 * `name`: a pen picked by `setPen` after the start (null: none). `start`: the pen `createPost` is given (none: its own).
 */
function pens(name: PenName | null, start?: PenName): { world: PenMaterial; hero: PenMaterial; state: string } {
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
  const post = start === undefined ? createPost(renderer as unknown as THREE.WebGLRenderer, camera) : createPost(renderer as unknown as THREE.WebGLRenderer, camera, start);
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
const withoutSamples = (text: string): string => text.replace(/#ifdef PEN_(FULL|FAR)\n[\s\S]*?#endif\n/g, '');

describe('with no switch the pen is C, Luc\'s pick', () => {
  it('the game\'s pen is bold, and both pens start with it: the world\'s and the heroes\'', () => {
    expect(DEFAULT_PEN).toBe('bold');
    const { world, hero, state } = pens(null);
    expect(state).toBe('bold');
    expect(sampleDefines(world)).toEqual(penDefines('bold'));
    expect(sampleDefines(hero)).toEqual(penDefines('bold'));
    expect(hero.defines).toEqual({ HERO: 1, ...penDefines('bold') });
    expect(penDefines('bold')).toMatchObject({ PEN_FULL: 1, PEN_WIDTH: '1.6', PEN_SEAM: '0.8' });
  });

  it('the address with no pen, or one it does not know, is C too', () => {
    expect(parseDebugParameters('').pen).toBe('bold');
    expect(parseDebugParameters('?pen=nonsense').pen).toBe('bold');
    expect(penFrom(null)).toBe('bold');
  });
});

/**
 * C (`bold`, the live pen) on `main` at e032290, as the graphics card is handed it: its defines as `#define` lines, then
 * the shader's text. SHA-256 and length, world pass and hero pass (worked out from `main`'s own post.js, run 4).
 */
const BOLD_ON_MAIN = {
  world: { sha256: '4bad77d9d1d073e32b22a5ba42558ffe806e14de7f2b372c0ffbddef5bd1b07b', length: 17293 },
  hero: { sha256: '14d24fb8452894f35ffdf61280e2cb1e8055057f94d88c90716afcbcef6ae0ae', length: 17308 },
};

/** What the chip compiles: the `#ifdef PEN_FAR` blocks of the pen-far samples are dropped unless PEN_FAR is defined. */
const compiled = (material: PenMaterial): string => {
  const head = Object.entries(material.defines ?? {}).map(([key, value]) => `#define ${key} ${value}\n`).join('');
  const text = material.defines?.PEN_FAR === undefined ? material.fragmentShader.replace(/#ifdef PEN_FAR\n[\s\S]*?#endif\n/g, '') : material.fragmentShader;
  return head + text;
};
const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

describe('C, the live pen, is compiled as it is on main, to the letter (review fault 3)', () => {
  it('world and hero pass: the same defines and the same text as main gives', async () => {
    const { world, hero } = pens('bold');
    expect(world.defines?.PEN_FAR).toBeUndefined();
    for (const [pass, material] of [['world', world], ['hero', hero]] as const) {
      const text = compiled(material);
      expect(text.length, pass).toBe(BOLD_ON_MAIN[pass].length);
      expect(await sha256(text), pass).toBe(BOLD_ON_MAIN[pass].sha256);
    }
  });

  it('the pen-far samples\' lines sit in their own blocks, none inside another', () => {
    const text = pens(null).world.fragmentShader;
    const blocks = text.match(/#ifdef PEN_FAR\n[\s\S]*?#endif\n/g) ?? [];
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) expect(block.match(/#if|#else/g)).toHaveLength(1);
  });
});

describe('?pen=today is the old pen, to the letter', () => {
  it('nothing is defined, so none of the samples\' blocks is compiled', () => {
    for (const [name, start] of [[null, 'today'], ['today', undefined]] as const) {
      const { world, hero, state } = pens(name, start);
      expect(state).toBe('today');
      expect(sampleDefines(world)).toEqual({});
      expect(sampleDefines(hero)).toEqual({});
      expect(hero.defines).toEqual({ HERO: 1 });
      expect(world.defines ?? {}).toEqual({});
    }
    expect(parseDebugParameters('?pen=today').pen).toBe('today');
    expect(parseDebugParameters('?pen=a').pen).toBe('today');
  });

  it('and what is left of the shader is the text before this round, to the letter', async () => {
    const { world, hero } = pens(null, 'today');
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

  it('under C a thing thinner than the full pen keeps today\'s line, on it and beside it; under ?pen=today nothing of it is compiled', () => {
    const { world } = pens(null);
    const blocks = world.fragmentShader.match(/#ifdef PEN_FULL\n[\s\S]*?#endif\n/g) ?? [];
    const slim = blocks.find((block) => block.includes('float slim'));
    expect(slim).toBeDefined();
    // the reach it measures is the full pen's own width, and where it finds a slim thing the full pen is off
    expect(slim).toContain('PEN_WIDTH');
    expect(slim).toMatch(/gFull \*= 1\. - slim;/);
    // both cases: the pen on the thing (gone on both sides), the pen beside it (the pixel's own ground back at twice the reach)
    expect(slim).toMatch(/abs\(ip - aux\.a\) > \.0003 && abs\(im - aux\.a\) > \.0003/);
    expect(slim).toMatch(/abs\(ip2 - aux\.a\) <= \.0003/);
    expect(withoutSamples(pens(null, 'today').world.fragmentShader)).not.toContain('slim');
  });

  it('the slim probe runs only where the full pen is on: its reads sit inside a gFull > 0. branch (review r5, finding 1)', () => {
    const text = pens(null).world.fragmentShader;
    const start = text.indexOf('float slim = 0.;');
    const end = text.indexOf('gFull *= 1. - slim;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const probe = text.slice(start, end);
    const branch = probe.indexOf('if (gFull > 0.) {');
    expect(branch).toBeGreaterThan(-1);
    expect(probe.indexOf('for (int i = 0; i < 4; i++)')).toBeGreaterThan(branch);
    // every read of the id texture in the probe comes after the branch opens, and the branch closes before gFull is cut
    const reads = [...probe.matchAll(/textureLod\(tAux/g)].map((match) => match.index ?? 0);
    expect(reads).toHaveLength(4);
    expect(Math.min(...reads)).toBeGreaterThan(branch);
    let depth = 0;
    for (const character of probe.slice(branch)) depth += character === '{' ? 1 : character === '}' ? -1 : 0;
    expect(depth).toBe(0);
  });

  it('picking today\'s pen after C leaves nothing defined, and C again puts it back', () => {
    const { world, state } = pens('today');
    expect(state).toBe('today');
    expect(sampleDefines(world)).toEqual({});
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const post = createPost({} as unknown as THREE.WebGLRenderer, camera, 'today');
    post.setPen('bold');
    expect(post.state.pen).toBe('bold');
    post.setPen('today');
    expect(post.state.pen).toBe('today');
    expect(penDefines('today')).toEqual({});
  });
});

describe('the pick screen\'s cards draw with the game\'s pen', () => {
  it('under C a card\'s line is the game\'s width; under ?pen=today the old cards\' own', () => {
    expect(castPenWidth('bold')).toBe(1);
    expect(castPenWidth(DEFAULT_PEN)).toBe(1);
    expect(castPenWidth('today')).toBe(CAST_PEN.width);
    expect(CAST_PEN).toEqual({ wobble: 0, weight: 1, width: 0.8 });
  });
});

describe('one switch: ?pen=<name>', () => {
  it('reads a name or its letter, in any case', () => {
    expect(PEN_NAMES).toEqual(['today', 'full', 'bold', 'near', 'soon', 'calm', 'fine', 'calm-keel', 'calm-hull']);
    for (const name of PEN_NAMES) expect(penFrom(name)).toBe(name);
    expect(['a', 'b', 'c', 'd'].map(penFrom)).toEqual(['today', 'full', 'bold', 'near']);
    expect(penFrom(' Bold ')).toBe('bold');
    expect(penFrom('C')).toBe('bold');
  });

  it('anything else, or nothing, is the game\'s pen: C', () => {
    for (const text of [null, undefined, '', 'e', 'thick', '1', 'full;bold', 'constructor', '__proto__', 'toString']) expect(penFrom(text), String(text)).toBe('bold');
  });

  it('the address parameter hands it over, and replaces no game: saves stay in use', () => {
    expect(parseDebugParameters('').pen).toBe('bold');
    expect(parseDebugParameters('?pen=today')).toMatchObject({ pen: 'today', sandbox: false, shot: null });
    expect(parseDebugParameters('?shot=island&pen=d')).toMatchObject({ pen: 'near', shot: 'island', sandbox: true });
    expect(parseDebugParameters('?pen=nonsense').pen).toBe('bold');
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
      const far = PENS[name]!.hero !== undefined;
      const base = ['PEN_FROM', 'PEN_FULL', 'PEN_SEAM', 'PEN_TO', 'PEN_WEIGHT', 'PEN_WIDTH'];
      const farKeys = ['PEN_CALM', 'PEN_FAR', 'PEN_HFALL', 'PEN_HFLOOR', 'PEN_HSTART', 'PEN_KEEL', 'PEN_KEELW'];
      expect(Object.keys(defines).sort(), name).toEqual((far ? [...base, ...farKeys] : base).sort());
      for (const key of ['PEN_FROM', 'PEN_SEAM', 'PEN_TO', 'PEN_WEIGHT', 'PEN_WIDTH', ...(far ? ['PEN_HFALL', 'PEN_HFLOOR', 'PEN_HSTART'] : [])]) {
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

describe('the waterline line (calm-keel, calm-hull)', () => {
  it('calm-keel inks every waterline, calm-hull only a hero\'s: the same pen otherwise', () => {
    expect(penDefines('calm-keel')).toMatchObject({ PEN_KEEL: '1.', PEN_KEELW: '1.' });
    expect(penDefines('calm-hull')).toMatchObject({ PEN_KEEL: '1.', PEN_KEELW: '0.' });
    const { PEN_KEELW: _hull, ...hull } = penDefines('calm-hull');
    const { PEN_KEELW: _keel, ...keel } = penDefines('calm-keel');
    expect(hull).toEqual(keel);
    expect(penDefines('calm')).toMatchObject({ PEN_KEEL: '0.' });
  });

  it('the line is gated on a hero texel on either side of the edge, scaled by PEN_KEELW elsewhere', () => {
    const text = pens(null).world.fragmentShader;
    expect(text).toContain('inkS += PEN_KEEL * mix(PEN_KEELW, 1., min(heroAt(t) + heroAt(aux), 1.));');
  });
});

describe('the samples tell the ground from the things that stand on it', () => {
  // The ink buffer is half-float: 10 bits after the leading one. A chip stores a number it cannot hold as the one
  // below it or as the nearest one (both are allowed, and both are out there).
  const halfStep = (value: number): number => 2 ** (Math.floor(Math.log2(value)) - 10);
  const below = (value: number): number => Math.floor(Math.fround(value) / halfStep(value)) * halfStep(value);
  const above = (value: number): number => below(value) + halfStep(value);

  /** The terrain's three ink ids, read off its own shader (rock, moss, sand). */
  function terrainIds(): number[] {
    const found = /id = mix\(mix\(([\d.]+), ([\d.]+), mossM\), ([\d.]+), sand\);/.exec(terrainMaterialFor().fragmentShader);
    expect(found, 'the terrain\'s ink ids').not.toBeNull();
    return found!.slice(1, 4).map(Number);
  }

  /** The pen's `groundAt`, read off its shader and worked out here as the chip works it out. */
  function groundAt(): (id: number) => number {
    const text = /float groundAt\(float id\)\{\n\s*return ([^;]+);/.exec(pens(null).world.fragmentShader);
    expect(text, 'groundAt in the pen\'s shader').not.toBeNull();
    const terms = [...text![1].matchAll(/step\(abs\(id \* (\d+)\. - ([\d.]+)\), ([\d.]+)\)/g)].map((term) => term.slice(1, 4).map(Number));
    expect(terms).toHaveLength(3);
    expect(text![1].replace(/step\(abs\(id \* \d+\. - [\d.]+\), [\d.]+\)/g, 'T')).toBe('T + T + T');
    return (id) => terms.reduce((sum, [scale, centre, reach]) => sum + (Math.abs(Math.fround(id) * scale - centre) <= reach ? 1 : 0), 0);
  }

  it('each of the ground\'s three washes is ground, whichever way the chip rounded its id', () => {
    const ground = groundAt();
    const ids = terrainIds();
    expect(ids).toEqual([0.11, 0.35, 0.52]);
    for (const id of ids) {
      expect(below(id), `${id} cannot be held as it is`).not.toBe(id);
      expect(ground(below(id)), `${id} rounded down`).toBe(1);
      expect(ground(above(id)), `${id} rounded up`).toBe(1);
      // and no wider than that
      expect(ground(below(id) - halfStep(id)), `${id}, one step under both`).toBe(0);
      expect(ground(above(id) + halfStep(id)), `${id}, one step over both`).toBe(0);
    }
  });

  it('water, sky, a rope and all but three of the 2003 piece ids are not', () => {
    const ground = groundAt();
    expect(ground(0)).toBe(0);
    expect(ground(1)).toBe(0);
    expect(ground(2040 / 2048)).toBe(0);
    // geo.js hands pieces the ids 16 to 2018 of 2048. The three that fall on a wash's id keep a seam at their foot, as today.
    const taken: number[] = [];
    for (let piece = 16; piece <= 2018; piece += 1) if (ground(piece / 2048) > 0) taken.push(piece);
    expect(taken).toEqual([717, 1064, 1065]);
  });
});
