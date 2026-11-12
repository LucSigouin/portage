import * as THREE from 'three';
import { it } from 'vitest';
import { ATTACHMENT_IDS } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { boxTouchesTriangle, slabsOf, trianglesOf } from './canoe-geometry.ts';

it('probe2', () => {
  const s = createGame(7, { crew: 4 });
  s.canoe.hullTier = 3; s.canoe.attachments = [...ATTACHMENT_IDS];
  s.canoe.position = { x: 0, y: 0, z: 0 }; s.canoe.heading = 0; s.canoe.pitch = 0; s.canoe.roll = 0; s.canoe.beached = false; s.canoe.sailRaised = true;
  for (const p of s.players) p.paddling = true;
  const view = new CanoeView();
  view.sync(s, crewOf(s), 0, 0, true, true);
  view.group.updateMatrixWorld(true);
  const holders = (view as any).attachments.children as THREE.Object3D[];
  const fire = trianglesOf(holders[s.canoe.attachments.indexOf('firebox')]);
  const fb = new THREE.Box3().setFromObject(holders[s.canoe.attachments.indexOf('firebox')]);
  console.log('firebox box', fb.min.toArray().map((n) => n.toFixed(2)), fb.max.toArray().map((n) => n.toFixed(2)));
  const p3 = s.players.find((p) => p.seat === 3)!;
  const figure = (view as any).members.get(p3.id).figure;
  const names = new Map<THREE.Object3D, string>();
  for (const [sn, side] of [['L', figure.paddler.L], ['R', figure.paddler.R]] as const) for (const k of ['upper', 'fore', 'elbow', 'mitt', 'thigh', 'shin', 'knee', 'boot']) names.set(side[k], `${sn}.${k}`);
  const seen = new Map<string, string>();
  const reach = { minZ: 9, mitts: [] as string[] };
  for (let time = 0; time < 10.4; time += 1 / 24) {
    for (const p of s.players) p.paddling = Math.floor(time / 1.3) % 2 === 0;
    view.sync(s, crewOf(s), 1 / 24, time, true, false);
    view.group.updateMatrixWorld(true);
    const ph = (view as any).phase as number;
    for (const side of [figure.paddler.L, figure.paddler.R]) {
      const w = side.mitt.getWorldPosition(new THREE.Vector3());
      if (w.z < reach.minZ) reach.minZ = w.z;
      if (false) reach.mitts.push(`${ph.toFixed(2)}:${names.get(side.mitt)}(${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)})`);
    }
    figure.root.traverse((child: THREE.Mesh) => {
      if (!child.isMesh || !child.visible || child === figure.paddler.paddle) return;
      for (const box of slabsOf(child, 0.1)) {
        if (boxTouchesTriangle(box, fire)) {
          const m = (view as any).members.get(p3.id); const key = `${names.get(child) ?? 'torso'} side ${m.side} t ${time.toFixed(2)} effort ${m.effort.toFixed(2)}`;
          if (!seen.has(key)) seen.set(key, `phase ${ph.toFixed(2)} box x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
        }
      }
    });
  }
  for (const [k, v] of seen) console.log(k, v);
  console.log('min mitt z', reach.minZ.toFixed(3));
  console.log(reach.mitts.join(' '));
}, 120000);
