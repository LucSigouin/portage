// Distance: the drowned village steeple, a pylon line, silos, a fire tower, hydro poles and far shores.
// Everything here is silhouette-first: the mist does the colouring.
import * as THREE from 'three';
import { Kit, V, meshFrom } from './kit.js';
import { boulder, spruce, snag } from './island.js';
import { mulberry32, fbm2, lerp } from './util.js';

const HALF_PI = Math.PI / 2;
const far = new THREE.MeshLambertMaterial({ color: '#232941' }); // weathered timber and stone, read through fog
const farDark = new THREE.MeshLambertMaterial({ color: '#1b2036' });
const farPale = new THREE.MeshLambertMaterial({ color: '#5e6788' });
const steel = new THREE.MeshLambertMaterial({ color: '#2a3048' });
const wire = new THREE.LineBasicMaterial({ color: '#1c2238' });
const ridgeMaterial = new THREE.MeshBasicMaterial({ color: '#0b1124', side: THREE.DoubleSide });

export const STEEPLE = new THREE.Vector3(-57.7, 0, -183);

function steeple() {
  const k = new Kit();
  k.box(far, 5.2, 11, 5.2, 0, 3.5, 0); // tower, mostly under water
  k.box(farPale, 5.5, 0.35, 5.5, 0, 9.1, 0);
  k.box(farDark, 4.3, 3.2, 4.3, 0, 10.8, 0); // belfry dark
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(farPale, 0.5, 3.4, 0.5, sx * 2.2, 10.8, sz * 2.2);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { // louvres
    k.box(far, 3.6, 0.14, 0.2, 0, 9.8 + i * 0.6, s * 2.2, 0.5 * s, 0, 0);
    k.box(far, 0.2, 0.14, 3.6, s * 2.2, 9.8 + i * 0.6, 0, 0, 0, -0.5 * s);
  }
  k.box(farPale, 5.3, 0.4, 5.3, 0, 12.55, 0);
  k.cyl(far, 0.06, 3.7, 12.5, 0, 19, 0, 0, Math.PI / 4, 0, 4); // spire
  k.box(farPale, 0.26, 2.7, 0.26, 0, 26.3, 0); // cross
  k.box(farPale, 1.5, 0.26, 0.26, 0, 26.7, 0);
  k.cyl(farPale, 1.1, 1.1, 0.12, 0, 6.6, 2.62, HALF_PI, 0, 0, 16); // clock face, stopped
  // nave roof ridge breaking the surface behind the tower
  const pitch = Math.atan2(4.4, 5);
  for (const s of [-1, 1]) k.box(far, 20, 0.3, 6.9, -12.5, 1.2, s * 2.5, s * pitch, 0, 0);
  k.box(farPale, 20.4, 0.3, 0.5, -12.5, 3.45, 0);
  const group = k.build('steeple');
  group.position.copy(STEEPLE);
  group.rotation.set(0.02, 0.5, 0.045);
  return group;
}

/** Lattice transmission tower. Local +x is across the line. */
function pylon(kit, lines, x, z, turn, tilt, sink = 0) {
  const part = new Kit();
  const H = 31, legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const half = (y) => (y < 21 ? lerp(4.2, 1.15, (y + 3) / 24) : 1.15);
  for (const [sx, sz] of legs) {
    part.rod(steel, V(sx * half(-3), -3, sz * half(-3)), V(sx * 1.15, 21, sz * 1.15), 0.24, 4, 0.16);
    part.rod(steel, V(sx * 1.15, 21, sz * 1.15), V(sx * 0.5, H, sz * 0.5), 0.16, 4, 0.1);
  }
  const brace = [];
  for (let y = -3; y < H - 3; y += 4) { // X bracing on each face
    const a = half(y), b = half(Math.min(y + 4, 21)) * (y + 4 > 21 ? lerp(1, 0.45, (y + 4 - 21) / 10) : 1), a2 = y > 21 ? a * lerp(1, 0.45, (y - 21) / 10) : a;
    for (let f = 0; f < 4; f++) {
      const [x0, z0] = legs[f], [x1, z1] = legs[(f + 1) % 4];
      brace.push(x0 * a2, y, z0 * a2, x1 * b, y + 4, z1 * b, x1 * a2, y, z1 * a2, x0 * b, y + 4, z0 * b, x0 * a2, y, z0 * a2, x1 * a2, y, z1 * a2);
    }
  }
  const arms = [[20.5, 7.4], [25, 5.8], [29.2, 4.2]];
  const tips = [];
  for (const [y, reach] of arms) {
    for (const s of [-1, 1]) {
      part.rod(steel, V(s * 1.0, y + 0.7, 0.6), V(s * reach, y, 0), 0.12, 4, 0.07);
      part.rod(steel, V(s * 1.0, y + 0.7, -0.6), V(s * reach, y, 0), 0.12, 4, 0.07);
      part.rod(steel, V(s * 1.0, y - 0.9, 0), V(s * reach, y, 0), 0.1, 4, 0.07);
      part.rod(steel, V(s * reach, y, 0), V(s * reach, y - 1.5, 0), 0.07, 4); // insulator string
      tips.push(new THREE.Vector3(s * reach, y - 1.5, 0));
    }
  }
  const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, turn, tilt * 0.6)).setPosition(x, -sink, z);
  for (const [material, list] of part.bins) for (const g of list) kit.geo(material, g.applyMatrix4(matrix));
  const p = new THREE.Vector3();
  for (let i = 0; i < brace.length; i += 3) {
    p.set(brace[i], brace[i + 1], brace[i + 2]).applyMatrix4(matrix);
    lines.push(p.x, p.y, p.z);
  }
  return tips.map((tip) => tip.applyMatrix4(matrix));
}

function hang(lines, a, b, sag, segments = 14) {
  let previous = a;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments, p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    lines.push(previous.x, previous.y, previous.z, p.x, p.y, p.z);
    previous = p;
  }
}

/** Far shore: a jagged pine-top strip wrapped round the valley at one radius. */
function ridge(kit, radius, from, to, hill, seed) {
  const random = mulberry32(seed);
  const positions = [], indices = [];
  const arc = (to - from) * radius;
  let s = 0, n = 0;
  const push = (distance, height) => {
    const a = from + distance / radius, x = Math.sin(a) * radius, z = -60 - Math.cos(a) * radius;
    positions.push(x, -2, z, x, height, z);
    if (n > 0) {
      const i = (n - 1) * 2;
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
    n++;
  };
  while (s < arc) {
    const ends = Math.min(s, arc - s) / 60; // shoulders fall to the water at both ends
    const ground = hill * Math.min(1, ends) * (0.35 + fbm2(s * 0.004 + seed, seed * 1.7) * 1.2);
    const stand = 0.3 + 1.5 * fbm2(s * 0.018 + seed * 3.1, seed); // tall stands and low scrub alternate along the shore
    const width = 1.5 + random() * 2.6, tall = (3 + random() * random() * 16) * stand * Math.min(1, ends + 0.25);
    push(s, ground);
    push(s + width * (0.4 + random() * 0.2), ground + tall);
    s += width * (0.8 + random() * 0.7); // uneven spacing: a treeline, not a saw blade
  }
  push(arc, 0);
  kit.geo(ridgeMaterial, meshFrom(positions, indices));
}

export function createLandmarks(scene) {
  const random = mulberry32(23);
  const group = new THREE.Group();
  group.add(steeple());

  const k = new Kit();
  const lines = [];

  // transmission line marching off into the mist; the second tower has started to go over
  const start = V(46, 0, -185), step = V(78, 0, -62);
  const turn = Math.atan2(step.x, step.z) + HALF_PI;
  let previous = null;
  for (let i = 0; i < 6; i++) {
    const tips = pylon(k, lines, start.x + step.x * i, start.z + step.z * i, turn, i === 1 ? 0.11 : (random() - 0.5) * 0.02, i === 1 ? 2.5 : 0);
    if (previous) tips.forEach((tip, j) => hang(lines, previous[j], tip, 5.5 + (j % 2)));
    previous = tips;
  }

  // drowned road: hydro poles leading the eye from the knoll to the steeple
  let last = null;
  for (let i = 0; i < 6; i++) {
    const t = i / 5, x = lerp(-27, -52, t), z = lerp(-82, -168, t), lean = (random() - 0.5) * 0.22;
    const top = V(x + lean * 6, 4.6 + random() * 1.2, z + lean * 2.5);
    k.rod(farDark, V(x, -2, z), top, 0.16, 5, 0.11);
    const arm = [V(top.x - 1.1, top.y - 0.5, top.z + 0.3), V(top.x + 1.1, top.y - 0.45, top.z - 0.3)];
    k.rod(farDark, arm[0], arm[1], 0.07, 4);
    if (last) arm.forEach((end, j) => hang(lines, last[j], end, 1.5, 8));
    last = arm;
  }

  // grain silos and the barn ridge beside them
  {
    const x = -250, z = -305;
    for (const [dx, dz, r, h] of [[0, 0, 4.6, 17], [10.5, 2, 4.2, 13.5]]) {
      k.cyl(far, r, r, h + 3, x + dx, h / 2 - 1.5, z + dz, 0, 0, 0, 20);
      k.at(farPale, new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, HALF_PI), x + dx, h, z + dz, 0, 0, 0, 1, 0.55, 1);
      for (let i = 1; i < 5; i++) k.at(farDark, new THREE.TorusGeometry(r + 0.03, 0.09, 4, 24), x + dx, (h * i) / 5, z + dz, HALF_PI);
      k.cyl(farDark, 0.35, 0.35, 0.8, x + dx, h + r * 0.55 + 0.3, z + dz, 0, 0, 0, 8);
    }
    k.rod(farDark, V(x + 1, 19.2, z + 0.4), V(x + 9.5, 15.6, z + 1.8), 0.3, 5); // auger pipe between them
    const pitch = Math.atan2(4, 6);
    for (const s of [-1, 1]) k.box(far, 22, 0.3, 7.4, x - 21, 1.0, z + 6 + s * 3, s * pitch, 0, 0);
    k.box(farPale, 22.3, 0.3, 0.5, x - 21, 3.05, z + 6);
  }

  // fire tower on a far rock
  {
    const x = 214, z = -332;
    boulder(k, x, 0.5, z, 9, random);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.rod(steel, V(x + sx * 3.4, 2, z + sz * 3.4), V(x + sx * 1.5, 24, z + sz * 1.5), 0.16, 4, 0.12);
    for (let y = 4; y < 24; y += 5) for (const [a, b] of [[-1, 1], [1, -1]]) {
      const w0 = lerp(3.4, 1.5, (y - 2) / 22), w1 = lerp(3.4, 1.5, (y + 3) / 22);
      lines.push(x - w0, y, z + a * w0, x + w1, y + 5, z + a * w1, x + a * w0, y, z - w0, x + a * w1, y + 5, z + w1);
    }
    k.box(far, 4.4, 2.6, 4.4, x, 25.3, z);
    k.box(farDark, 4.5, 1.0, 4.5, x, 25.6, z);
    k.cyl(farPale, 0.2, 3.6, 1.6, x, 27.4, z, 0, Math.PI / 4, 0, 4);
    for (const [dx, dz, h] of [[-7, 3, 7], [6, -4, 6], [-3, -7, 8], [8, 5, 5.5]]) spruce(k, x + dx, 1.5, z + dz, h, 1.3, random);
  }

  // a second, smaller rock off to starboard for mid-distance
  {
    const x = 58, z = -128;
    boulder(k, x, -0.6, z, 6.5, random);
    boulder(k, x + 7, -0.8, z + 3, 3.2, random);
    for (const [dx, dz, h] of [[-1, 0, 8.5], [2.2, -1.6, 6.5], [-3.4, 1.5, 6], [0.8, 2.4, 5]]) spruce(k, x + dx, 2.2, z + dz, h, 1.35, random);
  }

  // flooded forest: only the crowns and a few bare snags still stand
  for (const [cx, cz, count, spread] of [[-58, -118, 9, 16], [36, -96, 6, 12], [-22, -148, 10, 22], [96, -190, 12, 26], [-150, -170, 12, 30], [10, -205, 10, 26], [-70, 30, 8, 20], [70, 40, 9, 22], [140, -60, 10, 26], [-120, -40, 9, 24]]) {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()) * spread, h = 3.5 + random() * 5.5;
      if (random() < 0.22) snag(k, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 2 + random() * 3, random);
      else spruce(k, cx + Math.cos(a) * r, -h * 0.45, cz + Math.sin(a) * r, h * 1.5, 1.1 + random() * 0.5, random);
    }
  }

  // far shores in three depth bands
  ridge(k, 330, -2.45, -1.5, 16, 3);
  ridge(k, 330, -1.12, -0.5, 22, 4);
  ridge(k, 345, 0.55, 1.3, 18, 5);
  ridge(k, 320, 1.95, 2.95, 15, 6);
  ridge(k, 520, -3.1, -1.95, 26, 7);
  ridge(k, 540, -1.75, -0.72, 30, 8);
  ridge(k, 520, -0.5, 0.32, 34, 9);
  ridge(k, 530, 0.52, 1.62, 28, 10);
  ridge(k, 520, 2.05, 3.05, 24, 11);
  ridge(k, 800, -Math.PI, Math.PI, 46, 12);

  group.add(k.build('landmarks'));
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  group.add(new THREE.LineSegments(lineGeometry, wire));
  scene.add(group);
  return { group };
}
