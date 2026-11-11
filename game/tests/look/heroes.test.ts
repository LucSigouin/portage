/**
 * The heroes (the crew and the canoe) are drawn apart from the world, at the
 * window's full size. These tests cover the parts that need no graphics card:
 * where a hero's window is on the screen, who the heroes are, and the two
 * material twins that let the world's passes shade each pixel once.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/sim/index.ts';
import { inkMaterial, wearMaterials } from '../../src/look/b2/palette.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { heroMargin, heroWindow, heroWindows } from '../../src/look/hero-windows.ts';

const WIDTH = 1920;
const HEIGHT = 1080;

function camera(): THREE.PerspectiveCamera {
  const view = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.3, 1700);
  view.position.set(0, 0, 10);
  view.lookAt(0, 0, 0);
  view.updateMatrixWorld();
  return view;
}

function box(x: number, y: number, z: number, size = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  return mesh;
}

describe('hero windows', () => {
  it('put a window round a hero, as many pixels wider as asked', () => {
    // A 1 m box, 10 m away, 60 degrees of view: its near face is 1 / (2 × 9.5 × tan 30°) of the screen's height.
    const tight = heroWindow(box(0, 0, 0), camera(), WIDTH, HEIGHT, 0)!;
    const facePixels = HEIGHT / (2 * 9.5 * Math.tan(Math.PI / 6));
    expect(tight.w).toBeGreaterThanOrEqual(Math.floor(facePixels));
    expect(tight.w).toBeLessThanOrEqual(Math.ceil(facePixels) + 2);
    expect(Math.abs(tight.x + tight.w / 2 - WIDTH / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(tight.y + tight.h / 2 - HEIGHT / 2)).toBeLessThanOrEqual(1);
    const wide = heroWindow(box(0, 0, 0), camera(), WIDTH, HEIGHT, 20)!;
    expect(wide).toEqual({ x: tight.x - 20, y: tight.y - 20, w: tight.w + 40, h: tight.h + 40 });
  });

  it('measure from the bottom left, and stay on the screen', () => {
    const high = heroWindow(box(0, 4, 0), camera(), WIDTH, HEIGHT, 0)!;
    expect(high.y).toBeGreaterThan(HEIGHT / 2);
    const corner = heroWindow(box(-9.6, 5.4, 0, 3), camera(), WIDTH, HEIGHT, 30)!;
    expect(corner.x).toBe(0);
    expect(corner.y + corner.h).toBe(HEIGHT);
  });

  it('give no window to a hero behind the camera, off the screen, or hidden', () => {
    expect(heroWindow(box(0, 0, 20), camera(), WIDTH, HEIGHT, 10)).toBeNull();
    expect(heroWindow(box(40, 0, 0), camera(), WIDTH, HEIGHT, 10)).toBeNull();
    const hidden = box(0, 0, 0);
    hidden.visible = false;
    expect(heroWindow(hidden, camera(), WIDTH, HEIGHT, 10)).toBeNull();
  });

  it('cut a hero the camera is inside of at the near plane, and fill the screen', () => {
    const around = heroWindow(box(0, 0, 10, 6), camera(), WIDTH, HEIGHT, 0)!;
    expect(around).toEqual({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
    // Half behind the camera, to its left: a finite window on the left of the screen.
    const beside = heroWindow(box(-3, 0, 10, 4), camera(), WIDTH, HEIGHT, 0)!;
    expect(beside.x).toBe(0);
    expect(beside.w).toBeLessThan(WIDTH);
    expect(Number.isFinite(beside.w + beside.h)).toBe(true);
  });

  it('follow the parts that move: a child moved inside the hero widens its window', () => {
    const hero = new THREE.Group();
    const arm = box(0, 0, 0, 0.5);
    hero.add(box(0, 0, 0), arm);
    hero.updateMatrixWorld();
    const before = heroWindow(hero, camera(), WIDTH, HEIGHT, 0)!;
    arm.position.x = 2;
    hero.updateMatrixWorld();
    const after = heroWindow(hero, camera(), WIDTH, HEIGHT, 0)!;
    expect(after.x).toBe(before.x);
    expect(after.w).toBeGreaterThan(before.w + 100);
  });

  it('join windows that overlap and keep apart those that do not', () => {
    const apart = heroWindows([box(-4, 0, 0), box(4, 0, 0)], camera(), WIDTH, HEIGHT, 10);
    expect(apart.length).toBe(2);
    const joined = heroWindows([box(-0.4, 0, 0), box(0.4, 0, 0), box(4, 0, 0)], camera(), WIDTH, HEIGHT, 10);
    expect(joined.length).toBe(2);
    const [left, right] = [heroWindow(box(-0.4, 0, 0), camera(), WIDTH, HEIGHT, 10)!, heroWindow(box(0.4, 0, 0), camera(), WIDTH, HEIGHT, 10)!];
    const both = joined.find((window) => window.x === left.x)!;
    expect(both.x + both.w).toBe(right.x + right.w);
    // No pixel belongs to two windows.
    for (const first of joined) for (const second of joined) {
      if (first !== second) expect(first.x + first.w <= second.x || second.x + second.w <= first.x || first.y + first.h <= second.y || second.y + second.h <= first.y).toBe(true);
    }
  });

  it('leave room for the pen: the margin covers its reach twice over, and grows with the window', () => {
    // At 1080p a hero's line or foam reaches under 7 pixels past its outline, and the pen there reads 7 further.
    expect(heroMargin(1080)).toBeGreaterThanOrEqual(14);
    expect(heroMargin(2160)).toBeGreaterThanOrEqual(2 * 14);
    expect(heroMargin(2160)).toBeLessThan(64);
  });
});

describe('who the heroes are', () => {
  // (players are read through crewOf only: the shape of the player state is changing)
  const afloat = createGame(7);
  type Member = ReturnType<typeof crewOf>['local'];
  const aboard: Member = { ...crewOf(afloat).local, mode: 'canoe' };
  const mate = (dx: number): Member => ({ ...aboard, mode: 'foot', position: { x: aboard.position.x + dx, y: 1, z: aboard.position.z } });

  it('the canoe with everyone aboard is one hero, and each person ashore is their own', () => {
    const view = new CanoeView();
    const local = aboard;
    view.sync(afloat, { local, others: [] }, 0, 0, true, true);
    expect(view.heroes()).toEqual([view.group]);
    // Three more aboard: still one hero, four figures in the hull.
    view.sync(afloat, { local, others: [local, local, local] }, 0, 0, true, false);
    expect(view.heroes()).toEqual([view.group]);
    const seated: THREE.Object3D[] = [];
    view.group.traverse((object) => { if (object.parent && object.parent.rotation.y === Math.PI && object.children.length > 10) seated.push(object); });
    expect(seated.length).toBe(4);
    expect(new Set(seated.map((figure) => figure.position.z.toFixed(2))).size).toBe(4);
    // Two of them step ashore: three heroes.
    view.sync(afloat, { local, others: [local, mate(3), mate(6)] }, 0, 0, true, false);
    expect(view.heroes().length).toBe(3);
    expect(view.heroes()[0]).toBe(view.group);
    // The crew shrinks: the spare figures are hidden, so they get no window.
    view.sync(afloat, { local, others: [] }, 0, 0, true, false);
    view.group.updateMatrixWorld();
    view.ashore.updateMatrixWorld();
    const look = camera();
    look.position.set(afloat.canoe.position.x, 6, afloat.canoe.position.z + 8);
    look.lookAt(afloat.canoe.position.x, 0, afloat.canoe.position.z);
    look.updateMatrixWorld();
    const windows = view.heroes().map((hero) => heroWindow(hero, look, WIDTH, HEIGHT, 0));
    expect(windows.filter((window) => window !== null).length).toBe(1);
  });

  it('the local figure is inside the canoe hero when aboard', () => {
    const view = new CanoeView();
    view.sync(afloat, { local: aboard, others: [] }, 0, 0, true, true);
    let inside = false;
    view.group.traverse((object) => { if (object === view.localFigure()) inside = true; });
    expect(inside).toBe(true);
  });
});

describe('material twins', () => {
  it('only the mirror twin can discard, so the colour and ink passes shade each pixel once', () => {
    const mirror = inkMaterial.userData.mirror as THREE.ShaderMaterial;
    expect(inkMaterial.defines.MIRROR).toBeUndefined();
    expect(mirror.defines.MIRROR).toBe(1);
    expect(mirror.uniforms).toBe(inkMaterial.uniforms);
    // Every discard in the surface shader sits inside the mirror's own block.
    const source = inkMaterial.fragmentShader;
    const guarded = source.slice(source.indexOf('#ifdef MIRROR'), source.indexOf('#endif', source.indexOf('#ifdef MIRROR')));
    expect(source.indexOf('#ifdef MIRROR')).toBeGreaterThan(0);
    expect(source.split('discard;').length).toBe(guarded.split('discard;').length);
  });

  it('wearMaterials swaps every mesh to its twin and back', () => {
    const root = new THREE.Group();
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), inkMaterial);
    const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(plain, new THREE.Group().add(other));
    wearMaterials(root, 'mirror');
    expect(plain.material).toBe(inkMaterial.userData.mirror);
    expect(other.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    wearMaterials(root, 'plain');
    expect(plain.material).toBe(inkMaterial);
  });
});
