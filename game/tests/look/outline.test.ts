/**
 * The character's outline (Luc's list, item 10: "the artwork is fantastic but I have the crappy outline on the
 * character"). The pen drew a figure's edge as a full line only where the depth stepped hard behind it: against
 * water and sky. Against the ground it stands on and the hull it sits in, the step is small, and the edge was drawn
 * as an interior seam: lighter, broken, and fainter still far off (a fifth of its ink past 70 m).
 *
 * Now every piece of a figure is on the crew's render layer; the hero pass draws the crew a second time into its
 * ink buffer, marking their texels; and the pen draws the edge between a figure and anything else as a contour.
 * No graphics card here: the passes are read off a stand-in renderer, the pen's rule off the hero pen's own shader.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { GU, inkMaterial } from '../../src/look/b2/palette.js';
import { CREW_LAYER, createPost } from '../../src/look/b2/post.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { THIN } from '../../src/look/b2/geo.js';
import { MIXED, SAME, castAs } from './cast-lineups.ts';
import type { Lineup } from './cast-lineups.ts';

/** The pen's shared switches, as the passes set them. */
const PEN = GU as unknown as Record<'uHero' | 'uPass', THREE.IUniform<number>>;

const figureOf = (view: CanoeView, playerId: number): Figure =>
  (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(playerId)!.figure;

function run(view: CanoeView, state: GameState, seconds: number): void {
  for (let time = 0; time < seconds; time += 1 / 60) view.sync(state, crewOf(state), 1 / 60, time, true, false);
}

/** One draw the stand-in renderer was asked for, and what the pen's switches were then. */
interface Draw { what: THREE.Object3D; target: unknown; layers: number; hero: number; pass: number }

/** A renderer that draws nothing and remembers every draw. */
function standIn(): { renderer: THREE.WebGLRenderer; draws: Draw[] } {
  const draws: Draw[] = [];
  let target: unknown = null;
  const renderer = {
    clear: () => {},
    setRenderTarget: (next: unknown) => { target = next; },
    render: (what: THREE.Object3D, camera: THREE.Camera) => {
      draws.push({ what, target, layers: camera.layers.mask, hero: PEN.uHero.value, pass: PEN.uPass.value });
    },
    getClearColor: (colour: THREE.Color) => colour.set(0xffffff),
    getClearAlpha: () => 1,
    setClearColor: () => {},
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws };
}

/** The world and the heroes as the world view hands them over: a canoe with a crew of four, one of them ashore. */
function staged(lineup: Lineup = MIXED[0]): { view: CanoeView; state: GameState; scene: THREE.Scene; heroes: THREE.Group; water: THREE.Mesh } {
  const state = castAs(createGame(7, { crew: 4 }), lineup);
  state.players[1].bailing = true;
  Object.assign(state.players[3], { mode: 'foot', seat: null, selectedTool: 'hatchet', position: { x: state.canoe.position.x + 4, y: 1, z: state.canoe.position.z } });
  const view = new CanoeView();
  run(view, state, 1);
  const scene = new THREE.Scene();
  const heroes = new THREE.Group();
  heroes.add(view.group, view.ashore);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), inkMaterial);
  scene.add(water, heroes);
  return { view, state, scene, heroes, water };
}

// The crew as it was (four voyageurs), four of each of the others, and one of each.
for (const lineup of [...SAME, MIXED[0]]) {
describe(`${lineup.name}: the crew is on its own layer`, () => {
  it('every piece of every figure: its body, its paddle, the tin and the tool in its hands', () => {
    const { view } = staged(lineup);
    let pieces = 0;
    for (const id of [0, 1, 2, 3]) {
      const figure = figureOf(view, id);
      const meshes: THREE.Object3D[] = [figure.paddler.paddle];
      figure.root.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object); });
      for (const mesh of meshes) {
        expect(mesh.layers.isEnabled(CREW_LAYER), `player ${id}: ${mesh.name || mesh.type}`).toBe(true);
        // and still drawn with the world's camera everywhere else
        expect(mesh.layers.isEnabled(0)).toBe(true);
        pieces += 1;
      }
    }
    // The bailer's tin and the hatchet ashore are among them.
    const names: string[] = [];
    figureOf(view, 3).root.traverse((object) => names.push(object.name));
    expect(names).toContain('tool:hatchet');
    // Four bodies of eighteen pieces and more each (torso, sixteen limb pieces, paddle), the tin and the hatchet.
    expect(pieces).toBeGreaterThanOrEqual(4 * 18 + 2);
  });

  it('nothing else: the hull, the kit and what is bolted on stay on the world\'s layer alone', () => {
    const { view } = staged(lineup);
    const crew = new Set<THREE.Object3D>();
    for (const id of [0, 1, 2, 3]) {
      const figure = figureOf(view, id);
      figure.root.traverse((object) => crew.add(object));
      crew.add(figure.paddler.paddle);
    }
    let others = 0;
    view.group.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh || crew.has(object)) return;
      expect(object.layers.isEnabled(CREW_LAYER), object.name || object.type).toBe(false);
      others += 1;
    });
    expect(others).toBeGreaterThan(3);
  });
  it('every piece that makes a figure\'s outline has an ink id the pen can outline: none is drawn as a bare line', () => {
    const { view } = staged(lineup);
    for (const id of [0, 1, 2, 3]) {
      const figure = figureOf(view, id);
      figure.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        // A tool may carry a true line (a fishing line, a wire bail): the figure itself and its paddle never.
        if (!mesh.isMesh || mesh.name.startsWith('tool:')) return;
        const info = mesh.geometry.getAttribute('aInfo');
        for (let index = 0; index < info.count; index += 1) {
          const ink = Math.round(info.getX(index) * 2048);
          expect(ink, `player ${id} (${view.figures()[id].character})`).not.toBe(Math.round(THIN * 2048));
          // Solid, in the pen's own range: the shared counter's ids, 16 to 2018 of 2048.
          expect(ink >= 16 && ink <= 2018, `player ${id}: ink ${ink}`).toBe(true);
        }
      });
    }
  });
});
}

describe('the hero pass marks the crew in its ink buffer', () => {
  it('draws the heroes, then the crew alone again with the crew mark, then puts the camera and the mark back', () => {
    const { scene, heroes, water } = staged();
    const { renderer, draws } = standIn();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const post = createPost(renderer, camera);
    post.setSize(640, 360);
    post.render(scene, camera, water, null, false, null, heroes, [{ x: 100, y: 50, w: 300, h: 250 }]);
    const inkDraws = draws.filter((draw) => draw.what === heroes && draw.pass === 1);
    expect(inkDraws.map((draw) => [draw.layers, draw.hero])).toEqual([[1, 1], [1 << CREW_LAYER, 2]]);
    // Both into the same buffer: the hero ink buffer.
    expect(inkDraws[1].target).toBe(inkDraws[0].target);
    expect(camera.layers.mask).toBe(1);
    expect(PEN.uHero.value).toBe(0);
  });

  it('the ink shader marks a texel 2 higher per step of the mark, and the hero pen reads 4 higher as the crew\'s', () => {
    const { scene, heroes, water } = staged();
    const { renderer, draws } = standIn();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const post = createPost(renderer, camera);
    post.setSize(640, 360);
    post.render(scene, camera, water, null, false, null, heroes, [{ x: 100, y: 50, w: 300, h: 250 }]);
    expect(inkMaterial.fragmentShader).toContain('vn.x * .5 + .5 + uHero * 2.');
    // The hero pen is the composite drawn last over each hero window.
    const pen = draws.map((draw) => (draw.what.children[0] as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined)
      .find((material) => material?.defines?.HERO === 1);
    expect(pen).toBeDefined();
    const source = pen!.fragmentShader;
    expect(source).toContain('float crewAt(vec4 t){ return step(3.5, t.x); }');
    // Inside the branch for two solid texels: a crew edge counts as a contour, not as an interior seam.
    const branch = source.slice(source.indexOf('} else if (!skyC && !thin) {'), source.indexOf('// the white line where things sit in the water'));
    expect(branch).toContain('float edge = max(de[i], abs(crewAt(t) - crewAt(aux)));');
    expect(branch).toContain('inkS += edge;');
    expect(branch).toContain('inkI += max(ne, ie) * (1. - edge);');
  });
});
