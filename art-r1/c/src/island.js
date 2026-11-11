// The granite knoll: terrain, pines, birch, the drowned cabin roof, loot, and the shore bake for the water.
import * as THREE from 'three';
import { Kit, V, meshFrom } from './kit.js';
import { MAT, PAL, canvasTexture } from './palette.js';
import { ISLAND, localH, onIsland } from './terrain.js';
import { mulberry32, fbm2, noise2, smoothstep, lerp, clamp } from './util.js';

const HALF_PI = Math.PI / 2;
const color = (hex) => new THREE.Color(hex);
const C = {
  granite: color(PAL.granite), pink: color(PAL.granitePink), wet: color(PAL.graniteWet), moss: color(PAL.moss),
  gravel: color(PAL.gravel), pine: color(PAL.pine), pineLit: color(PAL.pineLit), trunk: color(PAL.trunk),
  birch: color(PAL.birch), birchMark: color(PAL.birchMark), birchLeaf: color(PAL.birchLeaf), bush: color(PAL.bush),
  reed: color(PAL.reed), snag: color(PAL.snag), tideLine: color('#b9b8c4'),
};
const _c = new THREE.Color();

function paint(geometry, fn) {
  const position = geometry.attributes.position, colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    fn(position.getX(i), position.getY(i), position.getZ(i), _c, i);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Rock colour by height: dark wet band, pale tide line, then granite with pink feldspar and moss. */
function rockColor(x, y, z, flatness, out) {
  const n = fbm2(x * 0.3 + 9, z * 0.3 - 4), n2 = noise2(x * 1.9, z * 1.9), n3 = fbm2(x * 0.9 - 3, z * 0.9 + 7, 3);
  out.copy(C.granite).lerp(C.pink, smoothstep(0.4, 0.66, n)).multiplyScalar(0.62 + n2 * 0.34 + n3 * 0.42);
  out.multiplyScalar(lerp(0.62, 1.0, smoothstep(0.55, 0.9, flatness))); // steep faces sit in shade
  out.lerp(C.gravel, smoothstep(1.1, 0.45, y) * smoothstep(0.86, 0.97, flatness) * 0.85);
  out.lerp(C.moss, smoothstep(0.82, 0.97, flatness) * smoothstep(1.3, 2.4, y) * smoothstep(0.42, 0.6, n3) * 0.85);
  out.lerp(C.tideLine, smoothstep(0.14, 0.3, y) * smoothstep(0.6, 0.4, y) * 0.6);
  out.lerp(C.wet, smoothstep(0.26, 0.06, y) * 0.94);
  return out;
}

/** Tileable granite grain: speckle, hairline cracks and lichen. Multiplies the vertex colours. */
function graniteTexture() {
  const random = mulberry32(53);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#cfcfd6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = random();
      ctx.fillStyle = v < 0.5 ? `rgba(40,40,58,${0.1 + random() * 0.25})` : `rgba(255,250,246,${0.12 + random() * 0.3})`;
      const r = 0.6 + random() * 2.2;
      ctx.fillRect(random() * w, random() * h, r, r);
    }
    for (let i = 0; i < 26; i++) { // lichen: pale rosettes and a little rust-orange
      const x = random() * w, y = random() * h, r = 6 + random() * 20;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, random() < 0.25 ? 'rgba(226,150,84,0.5)' : 'rgba(232,240,220,0.45)');
      g.addColorStop(1, 'rgba(232,240,220,0)');
      ctx.fillStyle = g;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) ctx.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(18,18,34,0.6)';
    for (let i = 0; i < 16; i++) { // cracks, wrapped across the tile edge
      ctx.lineWidth = 0.8 + random() * 1.6;
      let x = random() * w, y = random() * h, a = random() * Math.PI;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        let px = x + ox, py = y + oy, pa = a;
        const seed = mulberry32(i * 7 + 1);
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let j = 0; j < 14; j++) {
          pa += (seed() - 0.5) * 0.7;
          px += Math.cos(pa) * 16;
          py += Math.sin(pa) * 16;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }, { repeat: true });
}
const GRAIN = 7; // metres per texture tile
const grainUv = (geometry) => {
  const position = geometry.attributes.position, uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / GRAIN + position.getY(i) * 0.05;
    uv[i * 2 + 1] = position.getZ(i) / GRAIN + position.getY(i) * 0.08;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
};

function buildTerrain() {
  const n = 132, size = ISLAND.half * 2 - 4;
  const positions = [], indices = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size, z = (j / n - 0.5) * size;
      positions.push(ISLAND.x + x, localH(x, z), ISLAND.z + z);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const geometry = grainUv(meshFrom(positions, indices));
  const normal = geometry.attributes.normal;
  paint(geometry, (x, y, z, out, i) => rockColor(x, y, z, normal.getY(i), out));
  MAT.terrain.map = graniteTexture();
  return new THREE.Mesh(geometry, MAT.terrain);
}

export function boulder(kit, x, y, z, radius, random) {
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const position = geometry.attributes.position, sx = 0.8 + random() * 0.6, sy = 0.5 + random() * 0.35, sz = 0.8 + random() * 0.6, seed = random() * 50;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i), py = position.getY(i), pz = position.getZ(i);
    const bulge = 0.82 + fbm2(px * 1.3 + seed, pz * 1.3 + py * 1.1, 3) * 0.42;
    position.setXYZ(i, x + px * bulge * radius * sx, y + py * bulge * radius * sy, z + pz * bulge * radius * sz);
  }
  geometry.computeVertexNormals();
  grainUv(geometry);
  const normal = geometry.attributes.normal;
  paint(geometry, (px, py, pz, out, i) => rockColor(px, py, pz, Math.max(normal.getY(i), 0.5), out));
  kit.geo(MAT.terrain, geometry);
}

/**
 * Black spruce as a sculpted form: one smooth, slightly crooked spire with soft drooping skirts and a
 * slow twist of flutes, heavier at the club top. Reads as a conifer by silhouette, not by counting tiers.
 */
export function spruce(kit, x, y, z, height, radius, random) {
  radius *= 0.8;
  const base = height * 0.09, skirts = Math.max(4, Math.round(height / 1.25)), steps = skirts * 5;
  const profile = [new THREE.Vector2(0.02, base)];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, f = (t * skirts) % 1;
    const taper = Math.pow(1 - t, 0.78) * (1 + 0.5 * Math.exp(-Math.pow((t - 0.87) / 0.07, 2)));
    const skirt = 0.62 + 0.38 * Math.pow(1 - f, 1.4); // widest at the hem, tucking in toward the next skirt
    profile.push(new THREE.Vector2(radius * taper * skirt + 0.03, lerp(base, height, t) - (1 - f) * 0.18));
  }
  profile.push(new THREE.Vector2(0.004, height + 0.35));
  const geometry = new THREE.LatheGeometry(profile, 10);
  const position = geometry.attributes.position, seed = random() * 40, bend = (random() - 0.35) * 0.8, tint = 0.8 + random() * 0.35, twist = 0.5 + random() * 0.8;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i), py = position.getY(i), pz = position.getZ(i), angle = Math.atan2(pz, px);
    const flute = 1 + 0.13 * Math.cos(angle * 4 + py * twist + seed) + 0.1 * (noise2(angle * 1.6 + seed, py * 0.9) - 0.5);
    const sway = Math.pow(py / height, 2) * bend;
    position.setXYZ(i, x + px * flute + sway, y + py, z + pz * flute + sway * 0.4);
  }
  geometry.computeVertexNormals();
  paint(geometry, (px, py, pz, out) => {
    const up = clamp((py - y) / height, 0, 1), rim = clamp(Math.hypot(px - x, pz - z) / (radius + 0.1), 0, 1);
    out.copy(C.pine).lerp(C.pineLit, up * 0.4 + rim * 0.4).multiplyScalar(tint);
  });
  kit.geo(MAT.foliage, geometry);
  const trunk = new THREE.CylinderGeometry(0.05, 0.12, base + 0.9, 6);
  trunk.translate(x, y + (base + 0.9) / 2 - 0.25, z);
  kit.geo(MAT.foliage, paint(trunk, (px, py, pz, out) => out.copy(C.trunk)));
}

/** Wind-flagged white pine: leaning trunk, flat-bottomed boughs all swept to leeward. */
function windPine(kit, x, y, z, height, lean, random) {
  const s = height / 9;
  const spine = [V(0, -0.4, 0), V(0.2 * lean * s, height * 0.3, 0.05), V(0.75 * lean * s, height * 0.58, 0.14), V(1.55 * lean * s, height * 0.83, 0.12), V(2.3 * lean * s, height, 0.1)];
  const curve = new THREE.CatmullRomCurve3(spine);
  const at = (t) => curve.getPoint(t).add(V(x, y, z));
  const wood = (a, b, r0, r1, sides = 7) => {
    const rod = new Kit();
    rod.rod(MAT.foliage, a, b, r0, sides, r1);
    for (const list of rod.bins.values()) for (const g of list) kit.geo(MAT.foliage, paint(g, (px, py, pz, out) => out.copy(C.trunk)));
  };
  for (let i = 0; i < 9; i++) wood(at(i / 9), at((i + 1) / 9), lerp(0.27, 0.07, i / 9), lerp(0.27, 0.07, (i + 1) / 9));
  const lump = (cx, cy, cz, sx, sy, sz) => {
    const pad = new THREE.SphereGeometry(1, 12, 9);
    const position = pad.attributes.position, seed = random() * 30;
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i), py = position.getY(i), pz = position.getZ(i);
      const swell = 0.78 + noise2(px * 2.4 + seed, pz * 2.4 + py) * 0.5;
      position.setXYZ(i, cx + px * sx * swell + Math.max(py, 0) * 0.35 * lean * sx, cy + (py < 0 ? py * 0.28 : py) * sy * swell, cz + pz * sz * swell);
    }
    pad.computeVertexNormals();
    kit.geo(MAT.foliage, paint(pad, (px, py, pz, out) => out.copy(C.pine).lerp(C.pineLit, smoothstep(-0.2, 0.7, (py - cy) / sy) * 0.8)));
  };
  // [reach to leeward, height along trunk, size, sideways]
  for (const [reach, t, size, side] of [[1.25, 0.46, 1.0, 0.55], [-0.75, 0.56, 0.62, -0.45], [1.75, 0.66, 1.15, -0.35], [0.45, 0.78, 0.85, 0.5], [1.55, 0.88, 1.0, -0.1], [0.5, 1.0, 0.8, 0.1]]) {
    const root = at(Math.min(t, 1)), centre = root.clone().add(V(reach * lean * s, 0.2 + random() * 0.25, side * s));
    wood(root, centre, 0.07 * s, 0.03 * s, 5);
    lump(centre.x, centre.y, centre.z, 1.2 * size * s, 0.52 * size * s, 0.95 * size * s);
    lump(centre.x + lean * 0.8 * size * s, centre.y - 0.08, centre.z + (random() - 0.5) * 0.9 * s, 0.8 * size * s, 0.4 * size * s, 0.7 * size * s);
    lump(centre.x - lean * 0.5 * size * s, centre.y + 0.12, centre.z + (random() - 0.5) * 0.9 * s, 0.6 * size * s, 0.36 * size * s, 0.6 * size * s);
  }
}

function birch(kit, x, y, z, height, random) {
  const lean = (random() - 0.5) * 0.9, leanZ = (random() - 0.5) * 0.6;
  const point = (t) => V(x + lean * t * t, y - 0.2 + (height + 0.2) * t, z + leanZ * t * t);
  for (let i = 0; i < 6; i++) {
    const rod = new Kit();
    rod.rod(MAT.bark, point(i / 6), point((i + 1) / 6), lerp(0.1, 0.035, i / 6), 7, lerp(0.1, 0.035, (i + 1) / 6));
    for (const list of rod.bins.values()) {
      for (const g of list) {
        kit.geo(MAT.bark, paint(g, (px, py, pz, out) => {
          const mark = noise2(py * 5.5 + x * 3, Math.atan2(pz - z, px - x) * 1.3);
          out.copy(C.birch).lerp(C.birchMark, smoothstep(0.66, 0.74, mark) * 0.95);
        }));
      }
    }
  }
  for (let i = 0; i < 40; i++) { // a loose crown of small leaf sprays, densest near the top
    const t = 0.45 + Math.pow(random(), 0.7) * 0.6, c = point(Math.min(t, 1)), a = random() * Math.PI * 2, reach = (0.2 + random() * 1.15) * (1.2 - Math.min(t, 1) * 0.6);
    const cx = c.x + Math.cos(a) * reach, cy = c.y + (t > 1 ? (t - 1) * 1.6 : 0) + (random() - 0.4) * 0.4, cz = c.z + Math.sin(a) * reach;
    const size = 0.17 + random() * 0.2, tint = 0.7 + random() * 0.55;
    const leaf = new THREE.SphereGeometry(size, 6, 4);
    leaf.scale(1.1, 0.85, 1.1);
    leaf.translate(cx, cy, cz);
    kit.geo(MAT.foliage, paint(leaf, (px, py, pz, out) => out.copy(C.birchLeaf).multiplyScalar(tint * (0.6 + 0.6 * smoothstep(-size, size, py - cy)))));
    if (i % 3 === 0) {
      const twig = new Kit();
      twig.rod(MAT.bark, c, V(cx, cy, cz), 0.018, 4, 0.007);
      for (const list of twig.bins.values()) for (const g of list) kit.geo(MAT.bark, paint(g, (px, py, pz, out) => out.copy(C.birch)));
    }
  }
}

export function snag(kit, x, z, height, random) {
  const lean = (random() - 0.5) * 0.5, top = V(x + lean, height, z + (random() - 0.5) * 0.4);
  const add = (a, b, r0, r1) => {
    const rod = new Kit();
    rod.rod(MAT.bark, a, b, r0, 6, r1);
    for (const list of rod.bins.values()) for (const g of list) kit.geo(MAT.bark, paint(g, (px, py, pz, out) => out.copy(C.snag).multiplyScalar(0.55 + smoothstep(0, 1.2, py) * 0.5)));
  };
  add(V(x, -1, z), top, 0.14, 0.04);
  for (let i = 0; i < 3; i++) {
    const t = 0.45 + i * 0.17 + random() * 0.08, root = V(x, -1, z).lerp(top, t), a = random() * Math.PI * 2, length = 0.5 + random() * 0.8;
    add(root, V(root.x + Math.cos(a) * length, root.y + length * 0.45, root.z + Math.sin(a) * length), 0.04, 0.012);
  }
}

function reeds(kit, x, z, count, spread, random) {
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random()) * spread, height = 0.7 + random() * 0.9;
    const blade = new THREE.ConeGeometry(0.022, height, 4);
    blade.rotateZ((random() - 0.5) * 0.3);
    blade.translate(x + Math.cos(a) * r, height / 2 - 0.15, z + Math.sin(a) * r);
    const tint = 0.7 + random() * 0.5;
    kit.geo(MAT.foliage, paint(blade, (px, py, pz, out) => out.copy(C.reed).multiplyScalar(tint * (0.5 + smoothstep(0, 1.2, py) * 0.7))));
  }
}

function roofTexture() {
  const random = mulberry32(31);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#566070';
    ctx.fillRect(0, 0, w, h);
    const rows = 26, rh = h / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * rh;
      for (let x = (row % 2) * -9; x < w; x += 18) {
        const shade = 0.82 + random() * 0.36, moss = random() < 0.08 + (row / rows) * 0.2;
        ctx.fillStyle = moss ? `rgb(${78 * shade},${104 * shade},${86 * shade})` : `rgb(${92 * shade},${100 * shade},${118 * shade})`;
        ctx.fillRect(x, y, 17.4, rh);
      }
      const lip = ctx.createLinearGradient(0, y, 0, y + rh);
      lip.addColorStop(0, 'rgba(8,10,22,0.5)'); // shadow under the course above
      lip.addColorStop(0.3, 'rgba(8,10,22,0)');
      lip.addColorStop(1, 'rgba(230,236,255,0.1)');
      ctx.fillStyle = lip;
      ctx.fillRect(0, y, w, rh);
    }
    for (let i = 0; i < 4; i++) { // slipped shingles leave ragged black gaps
      const x = random() * (w - 110), y = random() * (h - 90);
      ctx.fillStyle = 'rgba(6,7,14,0.94)';
      for (let j = 0; j < 4; j++) ctx.fillRect(x + (random() - 0.5) * 30, y + j * rh, 36 + random() * 54, rh + 1);
    }
    const streak = ctx.createLinearGradient(0, 0, 0, h);
    streak.addColorStop(0, 'rgba(0,0,0,0)');
    streak.addColorStop(1, 'rgba(10,30,26,0.5)'); // algae toward the waterline
    ctx.fillStyle = streak;
    ctx.fillRect(0, 0, w, h);
  });
}

const CABIN = { x: -20, z: 13.5, turn: 1.12, ridge: 1.95, half: 2.7, eave: -0.6, length: 6.8 };

function buildCabin() {
  const group = new THREE.Group();
  const { ridge, half, eave, length } = CABIN;
  const slope = Math.hypot(half, ridge - eave) + 0.2, pitch = Math.atan2(ridge - eave, half);
  const shingles = new THREE.MeshLambertMaterial({ map: roofTexture() });
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, slope), shingles);
    slab.position.set(0, (ridge + eave) / 2 + 0.03, s * half * 0.5);
    slab.rotation.x = s * pitch;
    group.add(slab);
  }
  const k = new Kit();
  k.box(MAT.tin, length + 0.1, 0.06, 0.3, 0, ridge + 0.07, 0); // ridge cap
  for (const s of [-1, 1]) {
    const x = s * (length / 2 - 0.25);
    k.geo(MAT.woodDark, meshFrom([x, eave, -half, x, eave, half, x, ridge - 0.03, 0], s > 0 ? [0, 2, 1] : [0, 1, 2]));
    k.box(MAT.woodPale, 0.05, 0.72, 0.72, x + s * 0.02, 0.62, 0); // attic window frame
    k.box(MAT.patchTar, 0.06, 0.58, 0.58, x + s * 0.03, 0.62, 0);
    k.box(MAT.woodPale, 0.065, 0.58, 0.04, x + s * 0.035, 0.62, 0);
    k.box(MAT.woodPale, 0.065, 0.04, 0.58, x + s * 0.035, 0.62, 0);
    for (let i = 0; i < 5; i++) k.box(MAT.wood, 0.03, 0.03, (half - 0.35) * 2 * (1 - (i + 0.5) / 5.6), x + s * 0.012, eave + 0.5 + i * 0.42, 0); // siding seams
  }
  k.box(MAT.stone, 0.72, 2.3, 0.72, -1.7, 1.75, 0.7); // chimney stack
  k.box(MAT.stone, 0.86, 0.12, 0.86, -1.7, 2.92, 0.7);
  k.cyl(MAT.iron, 0.1, 0.12, 0.3, -1.7, 3.1, 0.7, 0, 0, 0, 8);
  // a bent TV aerial still strapped to the stack
  k.rod(MAT.tin, V(-1.4, 2.2, 0.98), V(-1.28, 4.3, 1.04), 0.02, 5);
  for (const [y, len] of [[3.5, 1.0], [3.82, 0.78], [4.14, 0.56]]) k.rod(MAT.tin, V(-1.3, y, 1.03 - len / 2), V(-1.3, y + 0.06, 1.03 + len / 2), 0.012, 4);
  group.add(k.build('cabin-roof'));
  group.position.set(ISLAND.x + CABIN.x, 0, ISLAND.z + CABIN.z);
  group.rotation.set(-0.045, CABIN.turn, 0.075);
  return group;
}

/** Things you can take. Each returns the point its amber glint floats at. */
function buildLoot(random) {
  const k = new Kit();
  const loot = [];
  const mark = (id, label, x, y, z) => loot.push({ id, label, position: new THREE.Vector3(x, y, z) });

  // supply crate, washed up with its lid sprung
  {
    const [x, y, z] = onIsland(7.3, 8.5);
    const part = new Kit();
    part.box(MAT.woodPale, 0.78, 0.5, 0.56, 0, 0.25, 0);
    for (const h of [0.08, 0.25, 0.42]) part.box(MAT.wood, 0.8, 0.035, 0.58, 0, h, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part.box(MAT.woodDark, 0.05, 0.52, 0.05, sx * 0.38, 0.26, sz * 0.27);
    part.box(MAT.flagMustard, 0.3, 0.2, 0.012, 0, 0.26, 0.293); // stencilled supply mark
    part.box(MAT.woodPale, 0.8, 0.035, 0.58, -0.06, 0.56, -0.03, 0, 0.18, 0.2); // lid, ajar
    part.at(MAT.rope, new THREE.TorusGeometry(0.09, 0.014, 5, 10, Math.PI), 0.4, 0.3, 0, 0, HALF_PI, Math.PI);
    part.box(MAT.iron, 0.07, 0.07, 0.014, 0.2, 0.44, 0.293);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.06, 0.5, -0.07)).setPosition(x, y - 0.06, z);
    for (const [material, list] of part.bins) for (const g of list) k.geo(material, g.applyMatrix4(m));
    mark('crate', 'Supply crate', x, y + 1.15, z);
  }
  // driftwood pile at the waterline
  {
    const [x, y, z] = onIsland(2.4, 10.7);
    for (let i = 0; i < 9; i++) {
      const length = 1.2 + random() * 1.7, a = 0.3 + (random() - 0.5) * 1.3, lift = i < 5 ? 0.08 : 0.28;
      const cx = x + (random() - 0.5) * 1.3, cz = z + (random() - 0.5) * 0.9;
      const dx = Math.cos(a) * length / 2, dz = Math.sin(a) * length / 2, tilt = (random() - 0.5) * 0.25;
      k.rod(MAT.drift, V(cx - dx, y + lift - tilt, cz - dz), V(cx + dx, y + lift + tilt, cz + dz), 0.07 + random() * 0.06, 7, 0.035 + random() * 0.04);
      if (i % 2 === 0) k.rod(MAT.drift, V(cx + dx * 0.3, y + lift, cz + dz * 0.3), V(cx + dx * 0.3 + (random() - 0.5) * 0.5, y + lift + 0.4 + random() * 0.3, cz + dz * 0.3 + (random() - 0.5) * 0.5), 0.03, 5, 0.012);
    }
    mark('driftwood', 'Driftwood', x, y + 1.05, z);
  }
  // berry bush
  {
    const [x, y, z] = onIsland(8.9, 5.6);
    const lumps = [[0, 0.42, 0, 0.62], [0.45, 0.34, 0.2, 0.46], [-0.42, 0.36, 0.15, 0.48], [0.1, 0.3, -0.42, 0.44], [-0.1, 0.66, 0.05, 0.42]];
    for (const [dx, dy, dz, r] of lumps) {
      const leaf = new THREE.SphereGeometry(r, 10, 8);
      leaf.translate(x + dx, y + dy, z + dz);
      k.geo(MAT.foliage, paint(leaf, (px, py, pz, out) => out.copy(C.bush).multiplyScalar(0.7 + smoothstep(0, 1, py - y) * 0.7)));
      for (let i = 0; i < 9; i++) {
        const a = random() * Math.PI * 2, e = random() * 1.2;
        k.ball(MAT.berry, 0.038, x + dx + Math.cos(a) * Math.sin(e) * r, y + dy + Math.cos(e) * r, z + dz + Math.sin(a) * Math.sin(e) * r, 1, 1, 1, 6);
      }
    }
    mark('berries', 'Bunchberries', x, y + 1.5, z);
  }
  return { group: k.build('loot'), loot, mark };
}

/** Extra shoreline occluders (cabin roof, boulders) folded into the baked height so they get foam too. */
function bakeShore(extra) {
  const size = 256, data = new Uint16Array(size * size);
  const cos = Math.cos(-CABIN.turn), sin = Math.sin(-CABIN.turn);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.5) * ISLAND.half * 2, z = ((j + 0.5) / size - 0.5) * ISLAND.half * 2;
      let h = localH(x, z);
      const dx = x - CABIN.x, dz = z - CABIN.z;
      const lx = dx * cos + dz * sin, lz = -dx * sin + dz * cos;
      if (Math.abs(lx) < CABIN.length / 2 + 0.1) h = Math.max(h, CABIN.ridge - Math.abs(lz) * ((CABIN.ridge - CABIN.eave) / CABIN.half) + lx * 0.075);
      for (const [bx, bz, br, bh] of extra) h = Math.max(h, bh - (Math.hypot(x - bx, z - bz) / br) ** 2 * (bh + 0.6));
      data[j * size + i] = THREE.DataUtils.toHalfFloat(clamp(h, -8, 12));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, x: ISLAND.x, z: ISLAND.z, half: ISLAND.half };
}

export function createIsland(scene) {
  const random = mulberry32(11);
  const group = new THREE.Group();
  group.add(buildTerrain());

  const k = new Kit();
  const place = (fn, x, z, ...rest) => {
    const [wx, wy, wz] = onIsland(x, z);
    fn(k, wx, wy, wz, ...rest);
  };
  // spruce on the knoll and the west shoulder
  for (const [x, z, h, r] of [[-4.5, -6, 9.5, 1.5], [0.5, -8.5, 8, 1.3], [-7.5, -2.5, 10.5, 1.6], [3.5, -5, 7, 1.25], [-5.5, -10.5, 7.5, 1.3], [2, -11.5, 6.5, 1.2], [-9.5, -7.5, 8.5, 1.4], [5.8, -1.5, 6, 1.1], [-12.5, 0.5, 7.5, 1.3], [-10, 4.6, 6, 1.15], [-14.5, 3.5, 5.5, 1.05], [-3.2, 0.8, 6.5, 1.2]]) {
    place(spruce, x, z, h * (0.9 + random() * 0.2), r, random);
  }
  place(windPine, -1.2, -3.6, 9.5, 1, random);
  place(windPine, -11.6, 2.2, 7, 1, random);
  for (const [x, z, h] of [[10.6, 2.4, 6.2], [12.1, 0, 5.4], [9.3, 0.6, 7], [11.4, -2.6, 5.8]]) place(birch, x, z, h, random);

  const rocks = [[-6.5, -0.5, 1.15], [2.6, -2.2, 0.95], [-9.5, -4.6, 1.25], [6.2, 1.8, 0.8], [0.2, 4.2, 0.75], [12.6, 8.2, 1.3], [-4.5, 13.4, 1.0], [15.6, -3.4, 1.5], [-18, -2.5, 1.7], [0.4, 13.6, 0.7], [-8.5, 9.6, 1.2], [6.8, 12.9, 0.55], [17, 4, 0.9], [-20, 6.5, 1.1], [3, -19.5, 1.6], [-13, -14, 1.3]];
  const occluders = [];
  for (const [x, z, r] of rocks) {
    const y = Math.max(localH(x, z), -0.9) + r * 0.12;
    boulder(k, ISLAND.x + x, y, ISLAND.z + z, r, random);
    occluders.push([x, z, r * 1.05, y + r * 0.5]);
  }
  for (const [x, z, h] of [[-14, 9.5, 3.6], [-26.5, 16, 2.6], [16.5, 10.5, 3.1], [-7, 16.5, 2.2], [20.5, 1, 2.8], [-24.5, 8.5, 4.2]]) snag(k, ISLAND.x + x, ISLAND.z + z, h, random);
  for (const [x, z, count] of [[-3.5, 12.8, 26], [14.5, 6.5, 26], [-10.5, 10.8, 22], [15.5, 0.5, 20], [-16.5, 7.5, 18], [-24, 12, 16]]) reeds(k, ISLAND.x + x, ISLAND.z + z, count, 1.5, random);
  group.add(k.build('growth'));

  group.add(buildCabin());
  const { group: lootGroup, loot } = buildLoot(random);
  group.add(lootGroup);
  // quest materials growing on the island
  const [bx, by, bz] = onIsland(9.3, 0.6);
  loot.push({ id: 'bark', label: 'Birch bark', position: new THREE.Vector3(bx + 0.2, by + 2.1, bz + 0.4) });
  const [sx, sy, sz] = onIsland(-3.2, 0.8);
  loot.push({ id: 'gum', label: 'Spruce gum', position: new THREE.Vector3(sx + 0.5, sy + 2.2, sz + 0.9) });

  scene.add(group);
  return {
    group,
    loot,
    shore: bakeShore(occluders),
    /** Named spots the shots and the landing prompt use (world space). */
    spots: {
      landing: new THREE.Vector3(...onIsland(4.6, 11.9)),
      stand: new THREE.Vector3(...onIsland(5.7, 9.5)),
      crate: new THREE.Vector3(...onIsland(7.3, 8.5)),
    },
  };
}
