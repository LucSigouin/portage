// Ink & Wash — the canoe: lofted hull, starter kit, paddler and paddle.
// Moved from art-r1/b2. The hull is now lofted from the rules engine's dimensions for each tier, in
// B2's own hull space: bow toward +z, y = 0 at the keel amidships. canoe.ts turns it to face -z and
// sinks it by the draft. Attachments live in attachments.js and attachments.ts.
import * as THREE from 'three';
import { Builder, piece, setSpan, nextId } from './geo.js';
import { PAL } from './palette.js';
import { KIND } from './detail.js';

const B2_LENGTH = 5.6;

// dims: { length, beam, depth, draft } in metres (HULL_TIERS[tier].dimensions)
export function makeHullShape(dims) {
  const k = dims.length / B2_LENGTH;
  const HULL = { L: dims.length, B: dims.beam, D: dims.depth, draft: dims.draft, seatZ: -1.74 * k, bowSeatZ: 1.45 * k, seatY: 0.3 * (dims.depth / 0.4), k };
  const HL = HULL.L / 2;
  const hullHW = (t) => (HULL.B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.3)), 0.6);
  const hullSheer = (t) => HULL.D + 0.3 * k * Math.pow(Math.abs(t), 2.8);
  const hullKeel = (t) => {
    const a = Math.abs(t);
    const e = Math.max(0, (a - 0.84) / 0.16);
    return 0.05 * a * a + 0.3 * k * e * e;
  };
  function hullPoint(t, s, inset = 0, out = new THREE.Vector3()) {
    const a = Math.abs(t);
    const u = Math.abs(s);
    const ex = 0.65 + 0.75 * a * a;
    const w = Math.max(0.004, hullHW(t) - inset);
    const kl = hullKeel(t) + inset;
    const sh = hullSheer(t);
    const x = Math.sign(s) * w * Math.pow(Math.sin((u * Math.PI) / 2), ex);
    const y = kl + (sh - kl) * (1 - Math.pow(Math.cos((u * Math.PI) / 2), 0.9));
    return out.set(x, y, t * HL);
  }
  // half-beam and gunwale height at hull-local z
  const halfBeamAt = (z) => hullHW(z / HL);
  const sheerAt = (z) => hullSheer(z / HL);
  return { HULL, HL, hullHW, hullSheer, hullKeel, hullPoint, halfBeamAt, sheerAt };
}

// tier 0 leaky (B2's hull: every patch is a leak mended), 1 patched (bark and pitch over the seams),
// 2 ribbed (new rails, rub strakes and mount blocks), 3 long (the same, longer, sheathed in tin at the bow)
export function buildHull(shape, tier = 0) {
  const { HULL, HL, hullHW, hullSheer, hullKeel, hullPoint } = shape;
  const b = new Builder(11);
  const NS = 36;
  const US = [1, 0.93, 0.82, 0.68, 0.52, 0.36, 0.18, 0]; // rows from sheer to keel
  const S = [...US.map((u) => -u), ...US.slice(0, -1).reverse()];
  const NR = S.length - 1; // 14
  const outer = [];
  const inner = [];
  for (let i = 0; i <= NS; i++) {
    const t = -0.992 + (1.984 * i) / NS;
    outer.push(S.map((s) => hullPoint(t, s, 0)));
    inner.push(S.map((s) => hullPoint(t, s, 0.024)));
  }
  const rowOf = (j) => (j < NR / 2 ? j : NR - 1 - j); // 0 = sheer strake … 6 = keel
  const strake = {};
  const sid = (key) => (strake[key] ??= nextId());
  // patches: the hull's history, each its own inked shape
  const patches = [
    { i0: 22, i1: 23, rows: [1, 2], side: 1, color: '#e3d7b9' }, // canvas
    { i0: 12, i1: 14, rows: [2], side: 1, color: PAL.sage },
    { i0: 27, i1: 28, rows: [3], side: 1, color: '#3f3d40' }, // tar
    { i0: 13, i1: 14, rows: [1, 2], side: 0, color: '#e3d7b9' },
    { i0: 24, i1: 26, rows: [2], side: 0, color: PAL.tin },
    { i0: 7, i1: 8, rows: [1], side: 0, color: PAL.sage },
    { i0: 6, i1: 7, rows: [2, 3], side: 1, color: PAL.tin },
  ];
  if (tier === 1) {
    // birch bark laid over the two split seams, pitched down
    patches.push(
      { i0: 15, i1: 20, rows: [3], side: 1, color: '#ece5d2' }, { i0: 16, i1: 21, rows: [3], side: 0, color: '#ece5d2' },
      { i0: 9, i1: 11, rows: [1], side: 1, color: '#ece5d2' }, { i0: 29, i1: 31, rows: [2], side: 0, color: '#ece5d2' },
      { i0: 18, i1: 19, rows: [1], side: 0, color: '#3f3d40' }, { i0: 31, i1: 32, rows: [2], side: 1, color: '#3f3d40' },
    );
  }
  if (tier >= 2) patches.length = 2; // rebuilt: only the oldest mends are left
  if (tier >= 3) {
    // tin sheathing over the bow
    patches.push({ i0: 30, i1: 35, rows: [2, 3], side: 0, color: PAL.tin }, { i0: 30, i1: 35, rows: [2, 3], side: 1, color: PAL.tin },
      { i0: 32, i1: 35, rows: [1], side: 0, color: '#9aa3a4' }, { i0: 32, i1: 35, rows: [1], side: 1, color: '#9aa3a4' });
  }
  patches.forEach((p) => (p.id = nextId()));
  const patchAt = (i, j) => {
    const r = rowOf(j);
    const side = j < NR / 2 ? 0 : 1;
    return patches.find((p) => p.side === side && i >= p.i0 && i <= p.i1 && p.rows.includes(r));
  };
  const rust = [tier >= 2 ? PAL.woodLight : '#efe6cf', PAL.rust, '#bd5c40', '#a04c37', '#874233', '#874233', '#874233'];
  // each patch carries its own frame (metres along the hull, metres up the strakes) for its row of stitches
  const CELL = (1.984 * HL) / NS;
  for (const p of patches) {
    const js = p.rows.map((r) => (p.side === 0 ? r : NR - 1 - r));
    p.j0 = Math.min(...js);
    p.j1 = Math.max(...js) + 1;
    const mid = outer[Math.round((p.i0 + p.i1 + 1) / 2)];
    p.girth = [0];
    for (let q = p.j0; q < p.j1; q++) p.girth.push(p.girth[p.girth.length - 1] + mid[q].distanceTo(mid[q + 1]));
  }
  b.grid(
    outer,
    (i, j) => patchAt(i, j)?.color ?? rust[rowOf(j)],
    (i, j) => {
      const p = patchAt(i, j);
      if (p) return p.id;
      const r = rowOf(j);
      return r >= 4 ? sid('keel') : sid(`${j < NR / 2 ? 'a' : 'b'}${r}`);
    },
    {
      kind: (i, j) => (patchAt(i, j) ? KIND.PATCH : KIND.PAINT),
      tex: (vi, vj, i, j) => {
        const p = patchAt(i, j);
        return p ? [(vi - p.i0) * CELL, p.girth[vj - p.j0], (p.i1 + 1 - p.i0) * CELL, p.girth[p.girth.length - 1]] : null;
      },
    }
  );
  // her name, stencilled on both bows
  for (const sd of [1, -1]) {
    const t0 = sd > 0 ? 0.665 : 0.565;
    const o = hullPoint(t0, sd * 0.775);
    const along = hullPoint(t0 - sd * 0.03, sd * 0.775).sub(o).normalize();
    const up = hullPoint(t0, sd * 0.86).sub(o).normalize();
    const out = new THREE.Vector3().crossVectors(along, up).normalize();
    o.addScaledVector(out, 0.004);
    b.stencil('OTTER', o.toArray(), along.toArray(), up.toArray(), 0.062, '#efe6cf');
  }
  // inside: cedar planking with darker ribs
  const ribId = nextId();
  const plankId = nextId();
  b.grid(
    inner,
    (i) => (tier >= 2 ? (i % 3 === 0 ? '#a98658' : '#dcc091') : Math.floor(i / 3) % 2 ? '#d0b07f' : '#d9bc8d'),
    (i) => ((tier >= 2 ? i % 3 === 0 : Math.floor(i / 3) % 2) ? ribId : plankId)
  );
  // gunwales, tacked down every hand-span
  for (const j of [0, NR]) {
    const pts = outer.map((row) => [row[j].x * 1.0, row[j].y + 0.004, row[j].z]);
    b.tube(pts, tier >= 2 ? 0.036 : 0.027, tier >= 2 ? PAL.wood : PAL.woodDark, { steps: 72 }, 6);
    if (tier >= 2) {
      // ribbed: a rub strake along each side, and blocks on the rail where things bolt on
      const rj = j === 0 ? 2 : NR - 2;
      b.tube(outer.filter((_, i) => i > 2 && i < NS - 2).map((row) => [row[rj].x * 1.02, row[rj].y, row[rj].z]), 0.016, PAL.woodLight, { steps: 60 }, 5);
      for (const i of [7, 13, 23, 29]) {
        b.box(0.06, 0.05, 0.16, PAL.woodDark, { pos: [outer[i][j].x, outer[i][j].y + 0.03, outer[i][j].z] });
        b.bolt(outer[i][j].x, outer[i][j].y + 0.06, outer[i][j].z, '#2f3038', 0.014);
      }
    }
    for (let i = 2; i < NS - 1; i += 2) b.tack(outer[i][j].x, outer[i][j].y + 0.033, outer[i][j].z, 0.01, '#c9b78e');
  }
  // stem bands
  for (const sg of [-1, 1]) {
    const pts = [];
    for (let t = 0.8; t <= 0.992; t += 0.032) pts.push([0, hullKeel(t) - 0.004, sg * t * HL]);
    pts.push([0, hullKeel(0.992) + 0.02, sg * (0.992 * HL + 0.012)]);
    pts.push([0, hullSheer(0.992) + 0.03, sg * (0.992 * HL + 0.014)]);
    b.tube(pts, 0.022, PAL.woodDark, { steps: 24 }, 6);
    // deck plate
    const deck = [];
    for (let q = 0; q <= 5; q++) {
      const t = sg * (0.76 + (0.232 * q) / 5);
      const y = hullSheer(t) + 0.012;
      const w = hullHW(t);
      deck.push([new THREE.Vector3(-w, y, t * HL), new THREE.Vector3(0, y + 0.02, t * HL), new THREE.Vector3(w, y, t * HL)]);
    }
    const did = nextId();
    b.grid(deck, () => '#8a6748', () => did);
  }
  // thwart + seats
  const across = (z, depth, y, color, th = 0.03) => {
    const t = z / HL;
    b.box(hullHW(t) * 2 - 0.02, th, depth, color, { pos: [0, y, z] });
  };
  across(0.1, 0.075, HULL.D - 0.02, PAL.woodDark);
  for (const z of [HULL.seatZ, HULL.bowSeatZ]) {
    const t = z / HL;
    const w = hullHW(t) * 2 - 0.03;
    b.box(w, 0.03, 0.05, PAL.woodDark, { pos: [0, HULL.seatY, z - 0.14] });
    b.box(w, 0.03, 0.05, PAL.woodDark, { pos: [0, HULL.seatY, z + 0.14] });
    b.box(w * 0.86, 0.016, 0.25, '#e4d8ba', { pos: [0, HULL.seatY + 0.004, z], kind: KIND.CANE }); // cane seat
    for (const sx of [-1, 1]) for (const dz of [-0.14, 0.14]) b.bolt((sx * w) / 2 - sx * 0.035, HULL.seatY + 0.018, z + dz, '#3a3b44', 0.012);
  }
  // thwart lashed to the gunwales
  for (const sx of [-1, 1]) {
    for (const dz of [-0.02, 0.02]) b.torus(0.04, 0.009, '#d9c79b', { pos: [sx * (hullHW(0.1 / HL) - 0.03), HULL.D - 0.005, 0.1 + dz], rot: [0, 0, 0], id: 0.71, kind: KIND.ROPE }, 8);
  }
  return b.mesh();
}

// The leak: water lying in the bilge. world-view lifts it with canoe.waterLevel.
export function buildBilge(shape) {
  const { HL, hullHW } = shape;
  const b = new Builder(29);
  const pud = [];
  for (let q = 0; q <= 10; q++) {
    const t = -0.42 + (0.8 * q) / 10;
    const w = hullHW(t) * 0.6 * Math.sin(Math.PI * (0.12 + (0.76 * q) / 10)) ** 0.5;
    pud.push([new THREE.Vector3(-w, 0, t * HL), new THREE.Vector3(0, 0, t * HL), new THREE.Vector3(w, 0, t * HL)]);
  }
  const pid = nextId();
  b.grid(pud, () => '#86a5b3', () => pid, { kind: KIND.PLAIN });
  return b.mesh();
}

// Everything a broke paddler owns. crewed: someone kneels amidships (seats 2 and 3 of the rules engine), so the
// loose kit is shoved up against the thwart, out of their way. Left out, it is B2's layout exactly.
export function buildStarterKit(shape, crewed = false) {
  const b = new Builder(23);
  b.root = new THREE.Matrix4().makeScale(1, shape.HULL.D / 0.4, shape.HULL.k); // B2 laid it out in a 5.6 m hull
  const tinZ = crewed ? -0.2 : -0.72;
  const packZ = crewed ? 0.34 : 0.72;
  const gumZ = crewed ? -0.06 : -0.35;
  const patchZ = crewed ? 0.02 : 0.2;
  const cordZ = crewed ? 0.1 : 0.3;
  // bailing tin
  b.cyl(0.07, 0.065, 0.13, PAL.tin, { pos: [0.16, 0.16, tinZ], rot: [0.5, 0.3, 0.9] }, 9);
  // rope coil in the bow
  b.torus(0.13, 0.03, '#d9c79b', { pos: [0, 0.16, 1.95], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 14);
  b.torus(0.1, 0.028, '#cdb98a', { pos: [0.01, 0.2, 1.95], rot: [Math.PI / 2, 0, 0.6], kind: KIND.ROPE }, 14);
  b.torus(0.075, 0.026, '#d9c79b', { pos: [0.005, 0.24, 1.955], rot: [Math.PI / 2, 0, 1.4], kind: KIND.ROPE }, 12);
  // pack and bedroll amidships
  b.box(0.42, 0.3, 0.3, PAL.canvasSage, { pos: [0, 0.27, packZ], rot: [0, 0.15, 0], kind: KIND.CLOTH });
  for (const sx of [-0.1, 0.1]) b.box(0.035, 0.31, 0.31, PAL.woodDark, { pos: [sx, 0.27, packZ + sx * -0.15], rot: [0, 0.15, 0], kind: KIND.PLAIN }); // pack straps
  b.box(0.44, 0.05, 0.1, PAL.woodDark, { pos: [0, 0.34, packZ], rot: [0, 0.15, 0] });
  b.cyl(0.1, 0.1, 0.5, PAL.cream, { pos: [0, 0.48, packZ], rot: [0, 0.15, Math.PI / 2] }, 9);
  for (const sx of [-0.14, 0.14]) b.cyl(0.104, 0.104, 0.04, PAL.rust, { pos: [sx, 0.48, packZ + sx * -0.15], rot: [0, 0.15, Math.PI / 2] }, 9);
  // spruce-gum tin and a stick, lying about
  b.cyl(0.045, 0.045, 0.06, PAL.ochre, { pos: [-0.15, 0.13, gumZ] }, 8);
  // the painter line trailing off the bow
  b.tube(
    [
      [0, 0.69, 2.74],
      [0.05, 0.62, 2.83],
      [0.09, 0.3, 2.86],
      [0.1, 0.02, 2.8],
    ],
    0.014,
    '#d9c79b',
    { steps: 10, kind: KIND.ROPE },
    5
  );
  // a tin patch kit and a twist of spare cord
  b.box(0.13, 0.05, 0.09, PAL.tin, { pos: [0.14, 0.125, patchZ], rot: [0, 0.5, 0] });
  b.torus(0.05, 0.013, '#cdb98a', { pos: [-0.17, 0.115, cordZ], rot: [Math.PI / 2, 0, 0.3], kind: KIND.ROPE }, 10);
  return b.mesh();
}

function buildPaddle() {
  const b = new Builder(3);
  const id = nextId();
  b.cyl(0.018, 0.018, 0.98, PAL.woodLight, { pos: [0, -0.49, 0], id }, 6);
  b.box(0.11, 0.035, 0.035, PAL.woodLight, { pos: [0, -0.01, 0], id });
  b.sphere(1, PAL.woodLight, { pos: [0, -1.19, 0], scale: [0.088, 0.29, 0.012], id }, 10);
  b.sphere(1, PAL.rust, { pos: [0, -1.4, 0], scale: [0.07, 0.085, 0.014] }, 10);
  return b.mesh();
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _h = new THREE.Vector3();
function ik(a, c, l1, l2, hint, elbow, hand) {
  _n.subVectors(c, a);
  const dist = _n.length();
  const d = Math.min(Math.max(dist, 0.05), l1 + l2 - 0.002);
  _n.divideScalar(dist || 1);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _h.copy(hint).addScaledVector(_n, -hint.dot(_n));
  if (_h.lengthSq() < 1e-6) _h.set(0, -1, 0);
  _h.normalize();
  elbow.copy(a).addScaledVector(_n, x).addScaledVector(_h, h);
  hand.copy(a).addScaledVector(_n, d);
}

// outfit: { coat, toque, legs } colours, so each of a crew of four reads as their own person
export function createPaddler({ coat: coatColor = PAL.ochre, toque = '#a9483a', legs = '#57697b' } = {}) {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const tb = new Builder(5);
  tb.kind = KIND.CLOTH; // wool coat, scarf and toque
  const coat = nextId();
  tb.cyl(0.135, 0.195, 0.5, coatColor, { pos: [0, 0.25, 0], id: coat, flat: true }, 10);
  tb.sphere(0.16, coatColor, { pos: [0, 0.46, 0], scale: [1.3, 0.5, 0.92], id: coat, flat: true }, 10);
  tb.box(0.012, 0.36, 0.01, '#a57f2e', { pos: [0, 0.27, 0.172], rot: [0.12, 0, 0], flat: true }); // button placket
  tb.torus(0.1, 0.036, PAL.rust, { pos: [0, 0.525, 0], rot: [Math.PI / 2, 0, 0] }, 10);
  tb.box(0.07, 0.2, 0.03, PAL.rust, { pos: [0.07, 0.43, -0.14], rot: [0.25, 0, -0.15] });
  // storybook proportions: a big head under a toque
  const head = tb.sphere(0.135, PAL.skin, { pos: [0, 0.69, 0.008], flat: true, kind: KIND.PLAIN }, 12);
  tb.sphere(0.143, toque, { pos: [0, 0.772, -0.014], scale: [1, 0.8, 1], flat: true }, 12);
  tb.torus(0.136, 0.034, PAL.cream, { pos: [0, 0.758, -0.012], rot: [Math.PI / 2 + 0.16, 0, 0] }, 12);
  tb.sphere(0.05, PAL.cream, { pos: [0, 0.905, -0.03] }, 8);
  for (const sx of [-0.052, 0.052]) tb.sphere(0.02, PAL.ink, { pos: [sx, 0.675, 0.128], id: head, flat: true, kind: KIND.PLAIN }, 6);
  for (const y of [0.16, 0.26, 0.36]) tb.sphere(0.014, '#6b4f1e', { pos: [0.012, y, 0.176 - (y - 0.27) * 0.12], id: coat, flat: true, kind: KIND.PLAIN }, 6); // coat buttons
  torso.add(tb.mesh());

  const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const ballGeo = new THREE.SphereGeometry(1, 8, 6);
  const bootGeo = new THREE.BoxGeometry(0.1, 0.09, 0.21);
  const mk = (geo, color, id) => {
    const m = piece(geo, color, 0, id);
    root.add(m);
    return m;
  };
  const side = (color, legColor) => {
    const aid = nextId();
    const lid = nextId();
    return {
      upper: mk(limbGeo, color, aid),
      fore: mk(limbGeo, color, aid),
      elbow: mk(ballGeo, color, aid),
      mitt: mk(ballGeo, '#454d5c'),
      thigh: mk(limbGeo, legColor, lid),
      shin: mk(limbGeo, legColor, lid),
      knee: mk(ballGeo, legColor, lid),
      boot: mk(bootGeo, '#5a4538'),
      S: new THREE.Vector3(),
      E: new THREE.Vector3(),
      H: new THREE.Vector3(),
      hip: new THREE.Vector3(),
    };
  };
  const L = side(coatColor, legs);
  const R = side(coatColor, legs);

  const paddle = buildPaddle();
  root.add(paddle);
  const pm = new THREE.Matrix4();
  const px = new THREE.Vector3();
  const py = new THREE.Vector3();
  const pz = new THREE.Vector3();
  const hint = new THREE.Vector3();

  // pose: { hipY, lean, twist, tilt, handL, handR, kneeL, kneeR, footL, footR, footYaw }
  function pose(p) {
    torso.position.set(0, p.hipY, 0);
    torso.rotation.set(p.lean, p.twist, p.tilt || 0, 'YXZ');
    torso.updateMatrix();
    for (const [s, sg, hand, knee, foot] of [
      [L, 1, p.handL, p.kneeL, p.footL],
      [R, -1, p.handR, p.kneeR, p.footR],
    ]) {
      s.S.set(sg * 0.2, 0.43, 0).applyMatrix4(torso.matrix);
      hint.set(sg * 0.5, -1, -0.45);
      ik(s.S, hand, 0.28, 0.27, hint, s.E, s.H);
      setSpan(s.upper, s.S, s.E, 0.058);
      setSpan(s.fore, s.E, s.H, 0.05);
      s.elbow.position.copy(s.E);
      s.elbow.scale.setScalar(0.058);
      s.mitt.position.copy(s.H);
      s.mitt.scale.setScalar(0.062);
      s.hip.set(sg * 0.09, p.hipY + 0.03, 0);
      setSpan(s.thigh, s.hip, knee, 0.075);
      setSpan(s.shin, knee, foot, 0.062);
      s.knee.position.copy(knee);
      s.knee.scale.setScalar(0.075);
      s.boot.position.set(foot.x, foot.y - 0.01, foot.z + 0.045 * Math.cos(p.footYaw || 0));
      s.boot.rotation.set(0, p.footYaw || 0, 0);
    }
  }

  // paddle: grip point G, blade aimed at A, blade face turned by `feather` (0 = square to travel)
  function setPaddle(G, A, feather = 0) {
    py.subVectors(G, A).normalize(); // local +Y points from blade to grip
    pz.set(Math.sin(feather) * 0.0, Math.sin(feather), Math.cos(feather));
    pz.addScaledVector(py, -pz.dot(py)).normalize();
    px.crossVectors(py, pz).normalize();
    pm.makeBasis(px, py, pz);
    paddle.quaternion.setFromRotationMatrix(pm);
    paddle.position.copy(G);
  }

  return { root, pose, setPaddle, paddle, L, R };
}

// The paddler and the paddle, posed for the canoe or for the shore. The model faces +z.
export function createCrew(outfit) {
  const paddler = createPaddler(outfit);

  // working vectors for the stroke
  const G = new THREE.Vector3();
  const A = new THREE.Vector3();
  const Gi = new THREE.Vector3();
  const Ai = new THREE.Vector3();
  const handL = new THREE.Vector3();
  const handR = new THREE.Vector3();
  const kneeL = new THREE.Vector3(0.15, 0.06, 0.37);
  const kneeR = new THREE.Vector3(-0.15, 0.06, 0.37);
  const footL = new THREE.Vector3(0.13, -0.2, 0.62);
  const footR = new THREE.Vector3(-0.13, -0.2, 0.62);
  const sKneeL = new THREE.Vector3();
  const sKneeR = new THREE.Vector3();
  const sFootL = new THREE.Vector3();
  const sFootR = new THREE.Vector3();
  const bladeWorld = new THREE.Vector3();
  const state = { sideS: 1 };
  // kneeling, bailing and sleeping
  const kKneeL = new THREE.Vector3();
  const kKneeR = new THREE.Vector3();
  const kFootL = new THREE.Vector3();
  const kFootR = new THREE.Vector3();
  const scoop = new THREE.Vector3();
  const toss = new THREE.Vector3();
  const tinAt = new THREE.Vector3();
  const brace = new THREE.Vector3();
  let tin = null; // the bailing tin in hand: built the first time this one bails
  const bailingTin = () => {
    if (!tin) {
      const b = new Builder(31);
      b.cyl(0.07, 0.065, 0.13, PAL.tin, { pos: [0, 0, 0] }, 9);
      tin = b.mesh();
      paddler.root.add(tin);
    }
    return tin;
  };

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  return {
    root: paddler.root,
    paddler,
    // seated: phase 0..1 of one stroke, effort 0..1 (0 = paddle resting across the gunwales), side ±1
    // more: { kneel: 0|1 (knees on the floor, heels tucked under: the two places between the seats),
    //         floor: metres from the figure's origin down to the hull floor,
    //         bail: 0..1 with bailPhase 0..1 (scooping the bilge over the side with a tin, paddle laid down),
    //         sleep: 0..1 (slumped forward, hands in the lap),
    //         restSide: -1 lays the resting paddle with its blade out to the right, so a crew's blades alternate }
    // returns { inWater, blade: world position of the blade, pull } for splashes
    paddle(dt, phase, effort, side, more = null) {
      const kneel = more?.kneel ?? 0;
      const bail = more?.bail ?? 0;
      const doze = more?.sleep ?? 0;
      state.sideS += (side - state.sideS) * Math.min(1, dt * 5);
      const s = state.sideS;
      const pull = phase < 0.46;
      const q = pull ? phase / 0.46 : (phase - 0.46) / 0.54; // progress within pull / recovery
      const e = smooth(0, 1, q);
      // stroke pose (paddler-local): top hand high, blade swept back through the water
      let az;
      let ay;
      let ax;
      if (pull) {
        az = 0.78 - 1.32 * e;
        ay = -0.5 - 0.06 * Math.sin(q * Math.PI);
        ax = 0.6;
      } else {
        az = -0.54 + 1.32 * e;
        ay = -0.5 + 0.42 * Math.sin(q * Math.PI);
        ax = 0.6 + 0.3 * Math.sin(q * Math.PI);
      }
      A.set(s * ax, ay, az);
      G.set(s * (0.2 - (pull ? 0.06 * e : 0.06 * (1 - e))), 0.6 + (pull ? 0.03 * Math.sin(q * Math.PI) : -0.1 * Math.sin(q * Math.PI)), 0.3 + az * 0.22);
      // rest pose: paddle across the gunwales, blade out to the figure's left (restSide -1: to its right)
      const rs = more?.restSide ?? 1;
      Gi.set(-0.5 * rs, 0.14, 0.4);
      Ai.set(0.95 * rs, 0.12, 0.44);
      G.lerp(Gi, 1 - effort);
      A.lerp(Ai, 1 - effort);
      const feather = (pull ? 0 : Math.sin(q * Math.PI) * 1.2) * effort + (1 - effort) * 1.5;
      paddler.setPaddle(G, A, feather);
      // hands: top hand on the grip, lower hand down the shaft
      _v.subVectors(A, G).normalize();
      const top = G;
      const low = _n.copy(G).addScaledVector(_v, 0.62 - 0.1 * (1 - effort));
      if (s >= 0) {
        handR.copy(top);
        handL.copy(low);
      } else {
        handL.copy(top);
        handR.copy(low);
      }
      // resting: both hands simply hold the shaft
      if (effort < 0.5) {
        handR.copy(G).addScaledVector(_v, 0.22);
        handL.copy(G).addScaledVector(_v, 0.78);
      }
      const reach = pull ? 1 - e : e;
      let lean = 0.1 + effort * (0.06 + 0.16 * reach);
      let twist = -s * effort * (0.34 * (reach - 0.5));
      let tilt = -s * effort * 0.05;
      if (bail > 0) {
        // dip the tin between the knees, lift it, tip it over the side; the other hand braces on the far gunwale
        const u = more.bailPhase ?? 0;
        const up = u < 0.45 ? 1 - smooth(0, 0.35, u) : smooth(0.45, 0.8, u); // 0 in the bilge, 1 over the side
        scoop.set(-s * 0.02, -0.1, 0.42);
        toss.set(s * 0.5, 0.2, 0.26);
        tinAt.lerpVectors(scoop, toss, up);
        tinAt.y += 0.1 * Math.sin(up * Math.PI);
        brace.set(-s * 0.4, 0.1, 0.3);
        (s >= 0 ? handL : handR).lerp(tinAt, bail);
        (s >= 0 ? handR : handL).lerp(brace, bail);
        lean += (0.5 - 0.34 * up - lean) * bail;
        twist += (s * 0.3 * up - twist) * bail;
        tilt *= 1 - bail;
      }
      if (doze > 0) {
        handL.lerp(_h.set(0.13, 0.1, 0.3), doze);
        handR.lerp(_h.set(-0.13, 0.1, 0.3), doze);
        lean += (0.46 - lean) * doze;
        twist *= 1 - doze;
        tilt += (0.1 - tilt) * doze;
      }
      if (kneel > 0) {
        // knees down on the floor ahead, heels tucked under: thigh and shin keep their standing lengths
        const down = Math.max(-0.3, 0.085 - (more.floor ?? 0.3));
        kKneeL.set(0.15, down, 0.27);
        kKneeR.set(-0.15, down, 0.27);
        kFootL.set(0.13, down + 0.02, -0.06);
        kFootR.set(-0.13, down + 0.02, -0.06);
      }
      paddler.pose({
        hipY: 0.02,
        lean,
        twist,
        tilt,
        handL,
        handR,
        kneeL: kneel > 0 ? kKneeL : kneeL,
        kneeR: kneel > 0 ? kKneeR : kneeR,
        footL: kneel > 0 ? kFootL : footL,
        footR: kneel > 0 ? kFootR : footR,
      });
      if (bail > 0.02) {
        // the tin rides in the hand that holds it, and tips outward at the top of the lift
        const held = (s >= 0 ? paddler.L : paddler.R).H;
        const tipped = smooth(0.74, 0.9, more.bailPhase ?? 0) * (1 - smooth(0.94, 1, more.bailPhase ?? 0));
        const mesh = bailingTin();
        mesh.visible = true;
        mesh.position.set(held.x, held.y - 0.04, held.z);
        mesh.rotation.set(0, 0, -s * 1.9 * tipped * bail);
      } else if (tin) {
        tin.visible = false;
      }
      // blade tip in world space
      bladeWorld.copy(G).addScaledVector(_v, 1.3);
      paddler.root.localToWorld(bladeWorld);
      return { inWater: pull && effort > 0.5, blade: bladeWorld, pull: effort * (pull ? Math.sin(q * Math.PI) : 0) };
    },
    // ashore: paddle carried like a staff. t: seconds (idle breath), stride: radians of the walk cycle, moving 0..1
    // lying 0..1: stretched out flat with the paddle alongside, for a sleeper (the caller lays the figure down)
    stand(t, stride = 0, moving = 0, lying = 0) {
      if (tin) tin.visible = false;
      const up = 1 - lying;
      const br = Math.sin(t * 1.3) * 0.006 * (1 - moving);
      const swing = Math.sin(stride) * 0.2 * moving;
      const liftL = Math.max(0, Math.cos(stride)) * 0.07 * moving;
      const liftR = Math.max(0, -Math.cos(stride)) * 0.07 * moving;
      G.set(-0.44, 0.02 + 0.05 * moving, 0.14 * up - 0.1 * lying - swing * 0.5);
      A.set(-0.47, 1.5, 0.1 * up - 0.12 * lying - swing * 0.2);
      paddler.setPaddle(G, A, 0);
      handR.set(-0.445 + 0.165 * lying, 1.02 - 0.28 * lying + br, 0.13 * up - 0.08 * lying - swing * 0.4);
      handL.set(0.27, 0.74 + br, 0.06 * up - 0.08 * lying - swing * 0.6);
      paddler.pose({
        hipY: 0.8 + br - 0.012 * moving * Math.abs(Math.cos(stride)),
        lean: (0.03 + 0.05 * moving) * up,
        twist: (0.12 + Math.sin(t * 0.4) * 0.08) * (1 - moving) * up,
        tilt: 0,
        handL,
        handR,
        kneeL: sKneeL.set(0.1, 0.43 + liftL * 0.5, 0.03 * up - 0.07 * lying + swing * 0.55 + 0.05 * moving),
        kneeR: sKneeR.set(-0.1, 0.43 + liftR * 0.5, 0.05 * up - 0.07 * lying - swing * 0.55 + 0.05 * moving),
        footL: sFootL.set(0.11, 0.06 + liftL, swing - 0.1 * lying),
        footR: sFootR.set(-0.12, 0.06 + liftR, 0.06 * (1 - moving) * up - 0.1 * lying - swing),
        footYaw: 0,
      });
    },
  };
}
