import * as THREE from 'three';
import { it } from 'vitest';
import { ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { boxTouchesTriangle, slabsOf, trianglesOf } from './canoe-geometry.ts';

function fitted(tier = 3, crew = 4) {
  const state = createGame(7, { crew });
  state.canoe.hullTier = tier;
  state.canoe.attachments = ATTACHMENT_IDS.filter((id) => tier >= 3 || (id !== 'winch' && id !== 'radio'));
  state.canoe.position = { x: 0, y: 0, z: 0 };
  state.canoe.heading = 0; state.canoe.pitch = 0; state.canoe.roll = 0; state.canoe.beached = false; state.canoe.sailRaised = true;
  return state;
}
it('probe', () => {
  for (const [tier, crew] of [[3, 4], [2, 4], [2, 3]] as const) {
    const state = fitted(tier, crew);
    console.log(`tier ${tier} crew ${crew} seats`, state.players.map((p) => p.seat));
    for (const paddles of [true, false]) {
      for (const pose of paddles ? ['paddle', 'rest'] : ['rest', 'paddle', 'bail', 'sleep']) {
        const s = fitted(tier, crew);
        for (const p of s.players) { p.paddling = pose === 'paddle'; p.bailing = pose === 'bail'; p.asleep = pose === 'sleep'; }
        const view = new CanoeView();
        view.sync(s, crewOf(s), 0, 0, true, true);
        view.group.updateMatrixWorld(true);
        const holders = (view as any).attachments.children as THREE.Object3D[];
        const parts = holders.map((h, i) => ({ id: s.canoe.attachments[i], triangles: trianglesOf(h) }));
        const found = new Map<string, { n: number; min: THREE.Vector3; max: THREE.Vector3; phases: Set<string> }>();
        const seconds = pose === 'paddle' ? 9 : pose === 'bail' ? 2.6 : 0.4;
        for (let time = 0; time < seconds; time += 1 / 12) {
          view.sync(s, crewOf(s), 1 / 12, time, true, false);
          view.group.updateMatrixWorld(true);
          for (const player of s.players) {
            const figure = (view as any).members.get(player.id).figure;
            figure.root.traverse((child: THREE.Mesh) => {
              if (!child.isMesh || !child.visible || (child === figure.paddler.paddle) !== paddles) return;
              const rail = HULL_TIERS[tier].dimensions.beam / 2 + 0.05;
              for (const box of slabsOf(child, paddles ? 0.05 : 0.1)) {
                if (paddles && Math.min(Math.abs(box.min.x), Math.abs(box.max.x)) < rail) continue;
                for (const part of parts) {
                  if (boxTouchesTriangle(box, part.triangles)) {
                    const key = `${pose} seat ${player.seat} ${part.id}`;
                    const at = box.getCenter(new THREE.Vector3());
                    const e = found.get(key) ?? { n: 0, min: at.clone(), max: at.clone(), phases: new Set<string>() };
                    e.n += 1; e.min.min(at); e.max.max(at); e.phases.add(((view as any).phase as number).toFixed(1));
                    found.set(key, e);
                  }
                }
              }
            });
          }
        }
        for (const [key, e] of found) console.log(`  ${paddles ? 'PADDLE' : 'BODY'} ${key}: n=${e.n} x ${e.min.x.toFixed(2)}..${e.max.x.toFixed(2)} y ${e.min.y.toFixed(2)}..${e.max.y.toFixed(2)} z ${e.min.z.toFixed(2)}..${e.max.z.toFixed(2)} phases ${[...e.phases].sort().join(',')}`);
      }
    }
  }
}, 120000);
