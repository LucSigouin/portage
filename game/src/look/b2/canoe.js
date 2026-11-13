// Ink & Wash — the canoe: lofted hull, starter kit, paddler and paddle.
// Moved from art-r1/b2. The hull is now lofted from the rules engine's dimensions for each tier, in
// B2's own hull space: bow toward +z, y = 0 at the keel amidships. canoe.ts turns it to face -z and
// sinks it by the draft. Attachments live in attachments.js and attachments.ts.
import * as THREE from 'three';
import { Builder, piece, setSpan, nextId, THIN } from './geo.js';
import { PAL } from './palette.js';
import { KIND } from './detail.js';
import { CREW_LAYER } from './post.js';

const B2_LENGTH = 5.6;

// ?floor=N draws the floor you see N metres above the keel. Without it the floor is 5 cm above the waterline.
// It exists for the check that what is aboard below the waterline is drawn (PREFILL in post.js), and to try a
// lower floor: everything that stands on the floor moves with it, and the flat of the floor gets narrower.
const FLOOR_SWITCH = typeof location === 'undefined' ? 0 : Number(new URLSearchParams(location.search).get('floor')) || 0;

// dims: { length, beam, depth, draft } in metres (HULL_TIERS[tier].dimensions)
export function makeHullShape(dims) {
  const k = dims.length / B2_LENGTH;
  const HULL = { L: dims.length, B: dims.beam, D: dims.depth, draft: dims.draft, seatZ: -1.74 * k, bowSeatZ: 1.45 * k, seatY: 0.3 * (dims.depth / 0.4), k, floor: FLOOR_SWITCH > 0 ? FLOOR_SWITCH : dims.draft + 0.05 };
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

// The four hulls. The paddling camera looks down into the boat from astern, so what tells the tiers
// apart is drawn where it shows from there: the planking inside, the rails, the decks, the fittings.
//   0 leaky   faded paint flaking to bare wood, two split seams stuffed with rag, a snapped rail, grey planking
//   1 patched the same boat: birch bark over both seams, pitched down black, the rail splinted and whipped
//   2 ribbed  rebuilt: fresh cedar, a dark rib every third station, stout rails, rub strakes, mount blocks, a mast step
//   3 long    a metre and a half longer: a cream band under the sheer, tin riveted round the bow, closer ribs, floorboards
const PITCH = '#2e2b2d';
const BARK = '#ece5d2';
const CRACK = '#232327';
const flake = (i, j) => (((i * 73 + j * 151 + 7) * 2654435761) >>> 0) / 4294967296;

export function buildHull(shape, tier = 0) {
  const { HULL, HL, hullHW, hullSheer, hullKeel, hullPoint } = shape;
  const b = new Builder(11);
  const old = tier < 2;
  const NS = 36;
  const US = [1, 0.93, 0.82, 0.68, 0.52, 0.36, 0.18, 0]; // rows from sheer to keel
  const S = [...US.map((u) => -u), ...US.slice(0, -1).reverse()];
  const NR = S.length - 1; // 14
  const T = Array.from({ length: NS + 1 }, (_, i) => -0.992 + (1.984 * i) / NS);
  const outer = T.map((t) => S.map((s) => hullPoint(t, s, 0)));
  // The planking you see inside stops at a floor just above the waterline. The game draws the water after the
  // world and the heroes apart, so anything aboard that lies under the waterline is painted over by the water.
  const skin = (t, s, inset) => {
    const p = hullPoint(t, s, inset);
    if (inset > 0.01 && p.y < HULL.floor) p.y = HULL.floor + (inset - 0.024);
    return p;
  };
  const inner = T.map((t) => S.map((s) => skin(t, s, 0.024)));
  const rowOf = (j) => (j < NR / 2 ? j : NR - 1 - j); // 0 = sheer strake … 6 = keel
  const sideOf = (j) => (j < NR / 2 ? 0 : 1);
  const strake = {};
  const sid = (key) => (strake[key] ??= nextId());
  // a pen-weight line lying on the hull's skin, from station i0 to i1 along the vertex row j
  const along = (i0, i1, j, inset, r, color) => {
    const pts = [];
    for (let i = i0; i <= i1; i++) pts.push(skin(T[i], S[j], inset).toArray());
    b.tube(pts, r, color, { steps: (i1 - i0) * 3, id: THIN, flat: true, kind: KIND.PLAIN }, 5);
  };
  const up = (i, j0, j1, inset, r, color) => {
    const pts = [];
    for (let j = j0; j <= j1; j++) pts.push(skin(T[i], S[j], inset).toArray());
    b.tube(pts, r, color, { steps: (j1 - j0) * 3, id: THIN, flat: true, kind: KIND.PLAIN }, 5);
  };
  // the two seams that split: the edge between the third and fourth strakes, one a side
  const seams = [{ side: 0, j: 4, i0: 9, i1: 24 }, { side: 1, j: NR - 4, i0: 10, i1: 25 }];

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
    // birch bark laid over the two split seams, and over two more weeps
    for (const seam of seams) patches.push({ i0: seam.i0, i1: seam.i1 - 1, rows: [3, 4], side: seam.side, color: BARK, bark: true });
    patches.push({ i0: 2, i1: 5, rows: [1, 2], side: 1, color: BARK, bark: true }, { i0: 2, i1: 4, rows: [1, 2], side: 0, color: BARK, bark: true },
      { i0: 29, i1: 31, rows: [2], side: 0, color: BARK, bark: true });
  }
  if (tier >= 2) patches.length = 2; // rebuilt: only the oldest mends are left
  if (tier >= 3) {
    // tin sheathing round the bow
    patches.push({ i0: 30, i1: 35, rows: [2, 3, 4], side: 0, color: PAL.tin, tin: true }, { i0: 30, i1: 35, rows: [2, 3, 4], side: 1, color: PAL.tin, tin: true },
      { i0: 32, i1: 35, rows: [1], side: 0, color: '#9aa3a4', tin: true }, { i0: 32, i1: 35, rows: [1], side: 1, color: '#9aa3a4', tin: true });
  }
  patches.forEach((p) => (p.id = nextId()));
  const patchAt = (i, j) => {
    const r = rowOf(j);
    const side = sideOf(j);
    return patches.find((p) => p.side === side && i >= p.i0 && i <= p.i1 && p.rows.includes(r));
  };
  const paint = tier === 3 ? [PAL.woodLight, '#efe6cf', PAL.rust, '#a04c37', '#874233', '#874233', '#874233']
    : tier === 2 ? [PAL.woodLight, PAL.rust, '#bd5c40', '#a04c37', '#874233', '#874233', '#874233']
      : ['#cfc5ad', '#b9917f', '#ad8776', '#a17f70', '#93786b', '#93786b', '#93786b']; // sun-faded
  // on the old hull the paint has flaked off in places, down to grey wood
  const bare = (i, j) => old && rowOf(j) > 0 && flake(i, j) < 0.42;
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
    (i, j) => patchAt(i, j)?.color ?? (bare(i, j) ? '#a89d8a' : paint[rowOf(j)]),
    (i, j) => {
      const p = patchAt(i, j);
      if (p) return p.id;
      const r = rowOf(j);
      return r >= 4 ? sid('keel') : sid(`${j < NR / 2 ? 'a' : 'b'}${r}`);
    },
    {
      kind: (i, j) => (patchAt(i, j) ? KIND.PATCH : bare(i, j) ? KIND.DRIFT : KIND.PAINT),
      tex: (vi, vj, i, j) => {
        const p = patchAt(i, j);
        return p ? [(vi - p.i0) * CELL, p.girth[vj - p.j0], (p.i1 + 1 - p.i0) * CELL, p.girth[p.girth.length - 1]] : null;
      },
    }
  );
  for (const p of patches) {
    if (p.bark) {
      // pitch run round the edge of every piece of bark
      along(p.i0, p.i1 + 1, p.j0, -0.004, 0.013, PITCH);
      along(p.i0, p.i1 + 1, p.j1, -0.004, 0.013, PITCH);
      up(p.i0, p.j0, p.j1, -0.004, 0.013, PITCH);
      up(p.i1 + 1, p.j0, p.j1, -0.004, 0.013, PITCH);
    }
    if (p.tin) {
      // a row of rivets along the top of each sheet
      const j = p.side === 0 ? p.j0 : p.j1;
      for (let i = p.i0; i <= p.i1; i++) {
        const at = hullPoint((T[i] + T[i + 1]) / 2, S[j] * (p.side === 0 ? 0.985 : 0.985), -0.004);
        b.sphere(0.011, '#6f7678', { pos: at.toArray(), flat: true, kind: KIND.PLAIN }, 6);
      }
    }
  }
  // her name, stencilled on both bows
  for (const sd of [1, -1]) {
    const t0 = sd > 0 ? 0.665 : 0.565;
    const o = hullPoint(t0, sd * 0.775);
    const right = hullPoint(t0 - sd * 0.03, sd * 0.775).sub(o).normalize();
    const upward = hullPoint(t0, sd * 0.86).sub(o).normalize();
    const out = new THREE.Vector3().crossVectors(right, upward).normalize();
    o.addScaledVector(out, 0.004);
    b.stencil('OTTER', o.toArray(), right.toArray(), upward.toArray(), 0.062, old ? '#d8ccae' : '#efe6cf');
  }

  // inside: on the old hull grey planking; rebuilt, fresh cedar with a dark rib at every third station (every second on the long one)
  const ribId = nextId();
  const plankId = nextId();
  const barkIn = seams.map(() => nextId());
  const seamAt = (i, j) => (tier === 1 ? seams.findIndex((seam) => seam.side === sideOf(j) && i >= seam.i0 && i < seam.i1 && rowOf(j) >= 3 && rowOf(j) <= 5) : -1);
  const rib = (i) => (tier >= 3 ? i % 2 === 0 : tier === 2 ? i % 3 === 0 : Math.floor(i / 3) % 2 === 1);
  b.grid(
    inner,
    (i, j) => {
      if (seamAt(i, j) >= 0) return BARK;
      if (tier >= 3) return rib(i) ? '#8f6d47' : '#e6cf9f';
      if (tier === 2) return rib(i) ? '#8f6d47' : '#e2c896';
      return flake(i, j + 40) < 0.16 ? '#8f8370' : rib(i) ? '#a89b86' : '#b8ab95';
    },
    (i, j) => (seamAt(i, j) >= 0 ? barkIn[seamAt(i, j)] : rib(i) ? ribId : plankId),
    { kind: (i, j) => (seamAt(i, j) >= 0 ? KIND.BIRCH : KIND.WOOD) }
  );
  for (const seam of seams) {
    if (tier === 0) {
      // the split: a dark slit through the planking, inside and out, with rag pushed into it
      along(seam.i0, seam.i1, seam.j, -0.003, 0.011, CRACK);
      along(seam.i0, seam.i1, seam.j, 0.028, 0.014, CRACK);
      for (const i of [seam.i0 + 2, seam.i1 - 1]) {
        const at = skin(T[i], S[seam.j], 0.036);
        b.sphere(0.034, '#e3d7b9', { pos: at.toArray(), scale: [1, 0.7, 1.7], kind: KIND.CLOTH }, 7);
      }
    } else if (tier === 1) {
      // the same bark seen from inside, bedded in pitch
      const [j0, j1] = seam.side === 0 ? [seam.j - 1, seam.j + 2] : [seam.j - 2, seam.j + 1];
      along(seam.i0, seam.i1, j0, 0.03, 0.014, PITCH);
      along(seam.i0, seam.i1, j1, 0.03, 0.014, PITCH);
      up(seam.i0, j0, j1, 0.03, 0.014, PITCH);
      up(seam.i1, j0, j1, 0.03, 0.014, PITCH);
    }
  }

  // gunwales, tacked down every hand-span
  const railR = old ? 0.027 : 0.036;
  const railColor = old ? PAL.woodDark : tier >= 3 ? '#efe6cf' : PAL.wood;
  for (const j of [0, NR]) {
    const pts = outer.map((row) => [row[j].x, row[j].y + 0.004, row[j].z]);
    if (old && j === 0) {
      // this rail snapped between two stations
      b.tube(pts.slice(0, 21), railR, railColor, { steps: 40 }, 6);
      b.tube(pts.slice(23), railR, railColor, { steps: 28 }, 6);
      if (tier === 0) {
        // splintered ends
        b.beam(pts[20], [pts[20][0] + 0.03, pts[20][1] + 0.05, pts[20][2] + 0.1], 0.013, '#d8c8a2', { r2: 0.004, kind: KIND.WOOD }, 5);
        b.beam(pts[23], [pts[23][0] + 0.01, pts[23][1] + 0.03, pts[23][2] - 0.09], 0.013, '#d8c8a2', { r2: 0.004, kind: KIND.WOOD }, 5);
      } else {
        // splinted with a batten and whipped with cord
        b.tube(pts.slice(19, 25).map((p) => [p[0], p[1] + 0.012, p[2]]), 0.023, PAL.woodLight, { steps: 12 }, 6);
        for (const i of [19, 20, 23, 24]) {
          for (const d of [0.25, 0.5, 0.75]) {
            const at = [0, 1, 2].map((axis) => pts[i][axis] + (pts[i + 1][axis] - pts[i][axis]) * d);
            b.torus(0.036, 0.009, '#d9c79b', { pos: [at[0], at[1] + 0.008, at[2]], id: 0.71, kind: KIND.ROPE }, 8);
          }
        }
      }
    } else {
      b.tube(pts, railR, railColor, { steps: 72, kind: tier >= 3 ? KIND.PAINT : KIND.WOOD }, 6);
    }
    if (!old) {
      // rebuilt: a rub strake along each side, and blocks on the rail where things bolt on
      const rj = j === 0 ? 2 : NR - 2;
      b.tube(outer.filter((_, i) => i > 2 && i < NS - 2).map((row) => [row[rj].x * 1.02, row[rj].y, row[rj].z]), 0.016, PAL.woodLight, { steps: 60 }, 5);
      for (const i of tier >= 3 ? [5, 9, 14, 18, 22, 27, 31] : [7, 13, 23, 29]) {
        b.box(0.06, 0.05, 0.16, PAL.woodDark, { pos: [outer[i][j].x, outer[i][j].y + 0.03, outer[i][j].z] });
        b.bolt(outer[i][j].x, outer[i][j].y + 0.06, outer[i][j].z, '#2f3038', 0.014);
      }
    }
    for (let i = 2; i < NS - 1; i += 2) {
      if (old && j === 0 && i >= 20 && i <= 23) continue;
      b.tack(outer[i][j].x, outer[i][j].y + 0.033, outer[i][j].z, 0.01, '#c9b78e');
    }
  }
  // stem bands and deck plates. sg = +1 is the bow.
  for (const sg of [-1, 1]) {
    const tinned = tier >= 3 && sg > 0;
    const pts = [];
    for (let t = 0.8; t <= 0.992; t += 0.032) pts.push([0, hullKeel(t) - 0.004, sg * t * HL]);
    pts.push([0, hullKeel(0.992) + 0.02, sg * (0.992 * HL + 0.012)]);
    pts.push([0, hullSheer(0.992) + 0.03, sg * (0.992 * HL + 0.014)]);
    b.tube(pts, 0.022, tinned ? PAL.tin : PAL.woodDark, { steps: 24, kind: tinned ? KIND.METAL : KIND.WOOD }, 6);
    const deck = [];
    for (let q = 0; q <= 5; q++) {
      const t = sg * (0.76 + (0.232 * q) / 5);
      const y = hullSheer(t) + 0.012;
      const w = hullHW(t);
      deck.push([new THREE.Vector3(-w, y, t * HL), new THREE.Vector3(0, y + 0.02, t * HL), new THREE.Vector3(w, y, t * HL)]);
    }
    const did = nextId();
    const mendId = nextId();
    // on the old hull half the stern deck has gone: a hole on the leaky one, a sheet of bark pitched over it once patched
    const gone = (i, j) => old && sg < 0 && i <= 2 && j === 1;
    b.grid(deck, (i, j) => (gone(i, j) ? (tier === 0 ? null : BARK) : tinned ? PAL.tin : old ? '#8f8371' : '#c9a877'), (i, j) => (gone(i, j) ? mendId : did),
      { kind: (i, j) => (gone(i, j) ? KIND.BIRCH : tinned ? KIND.METAL : KIND.WOOD) });
    if (tier === 1 && sg < 0) {
      const lift = (v) => [v.x, v.y + 0.006, v.z];
      b.tube([deck[0][1], deck[1][1], deck[2][1], deck[3][1]].map(lift), 0.013, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN }, 5);
      b.tube([deck[3][1], deck[3][2]].map(lift), 0.013, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN }, 5);
      b.tube([deck[0][1], deck[0][2]].map(lift), 0.013, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN }, 5);
    }
    if (!old) {
      // a coaming across the deck's open edge, and the plate things bolt down to
      const tc = 0.76;
      b.box(hullHW(tc) * 2 - 0.02, 0.05, 0.035, PAL.woodDark, { pos: [0, hullSheer(tc) + 0.03, sg * tc * HL] });
      const tp = 0.8;
      b.box(0.2, 0.012, 0.2, PAL.iron, { pos: [0, hullSheer(tp) + 0.036, sg * tp * HL], kind: KIND.METAL });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bolt(sx * 0.075, hullSheer(tp) + 0.046, sg * tp * HL + sz * 0.075, '#2f3038', 0.012);
    }
    if (tinned) {
      for (let q = 0; q < 5; q++) {
        const t = 0.78 + q * 0.045;
        for (const sx of [-1, 1]) b.tack(sx * (hullHW(t) - 0.03), hullSheer(t) + 0.016, t * HL, 0.009, '#6f7678');
      }
    }
  }
  // thwart + seats
  const frame = old ? PAL.woodDark : PAL.wood;
  const across = (z, depth, y, color, th = 0.03) => {
    const t = z / HL;
    b.box(hullHW(t) * 2 - 0.02, th, depth, color, { pos: [0, y, z] });
  };
  across(0.1, 0.075, HULL.D - 0.02, frame);
  for (const z of [HULL.seatZ, HULL.bowSeatZ]) {
    const t = z / HL;
    const w = hullHW(t) * 2 - 0.03;
    b.box(w, 0.03, 0.05, frame, { pos: [0, HULL.seatY, z - 0.14] });
    b.box(w, 0.03, 0.05, frame, { pos: [0, HULL.seatY, z + 0.14] });
    b.box(w * 0.86, 0.016, 0.25, old ? '#d6c9a8' : '#e4d8ba', { pos: [0, HULL.seatY + 0.004, z], kind: KIND.CANE }); // cane seat
    for (const sx of [-1, 1]) for (const dz of [-0.14, 0.14]) b.bolt((sx * w) / 2 - sx * 0.035, HULL.seatY + 0.018, z + dz, '#3a3b44', 0.012);
  }
  // thwart lashed to the gunwales
  for (const sx of [-1, 1]) {
    for (const dz of [-0.02, 0.02]) b.torus(0.04, 0.009, '#d9c79b', { pos: [sx * (hullHW(0.1 / HL) - 0.03), HULL.D - 0.005, 0.1 + dz], rot: [0, 0, 0], id: 0.71, kind: KIND.ROPE }, 8);
  }
  if (!old) {
    // the mast step: a block on the keelson with an iron collar, waiting for a mast
    const z = 0.4;
    const y = HULL.floor + 0.03;
    b.box(0.2, 0.05, 0.2, PAL.woodDark, { pos: [0, y, z] });
    b.torus(0.062, 0.014, PAL.iron, { pos: [0, y + 0.03, z], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 10);
  }
  if (tier >= 3) {
    // floorboards: slats over the ribs, the middle ones longest
    [-0.21, -0.105, 0, 0.105, 0.21].forEach((x, n) => {
      const reach = (Math.abs(x) > 0.15 ? 0.42 : 0.56) * HL;
      b.box(0.088, 0.016, reach * 2, n % 2 ? '#d6c193' : '#c8b184', { pos: [x, HULL.floor + 0.012, 0], kind: KIND.WOOD, axis: 2 });
    });
    for (const z of [-0.36 * HL, 0, 0.36 * HL]) b.box(0.52, 0.012, 0.05, PAL.woodDark, { pos: [0, HULL.floor + 0.024, z] });
  }
  const mesh = b.mesh();
  // The hero pass (post.js) takes the world's water out from inside this shape: see PREFILL there.
  mesh.userData.hull = { halfLength: HL, halfBeam: HULL.B / 2, depth: HULL.D, scale: HULL.k };
  return mesh;
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
  // B2 laid it out in a 5.6 m hull, on a floor 6 cm up
  b.root = new THREE.Matrix4().makeTranslation(0, shape.HULL.floor - 0.06, 0).multiply(new THREE.Matrix4().makeScale(1, shape.HULL.D / 0.4, shape.HULL.k));
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

  // every piece of a figure is the crew's: the pen draws its edge against anything else as a contour
  root.traverse((object) => object.layers.enable(CREW_LAYER));
  return { root, pose, setPaddle, paddle, L, R };
}

// The stroke, as keys round one cycle, paddling on the figure's left (+x; the right mirrors it). Each key:
// [phase, grip x, y, z, aim x, y, z, feather, reach]. The blade lies 1.19 m down the shaft from the grip toward
// the aim. The blade goes in ahead of the knees with the paddler leaning in, is drawn back square along the hull
// to the hip, comes out, turns flat and swings forward low over the water, quicker than it was pulled. The hands
// stay on the shaft and the lower one rides above the gunwale; the shaft crosses the gunwale outboard.
// `reach` is 1 at the catch and 0 at the exit: the torso leans and turns with it.
export const STROKE_PULL = 0.64;
const STROKE_KEYS = [
  [0, 0.22, 0.68, 0.22, 0.54, -0.38, 0.66, 0, 1], // the catch: blade buried ahead of the knees
  [0.18, 0.24, 0.72, 0.15, 0.58, -0.4, 0.42, 0, 0.8],
  [0.34, 0.24, 0.73, 0.05, 0.6, -0.4, 0.1, 0, 0.5],
  [0.52, 0.24, 0.71, -0.03, 0.6, -0.41, -0.16, 0, 0.2],
  [STROKE_PULL, 0.24, 0.71, -0.04, 0.68, -0.34, -0.27, 0.4, 0], // the exit, at the hip
  [0.73, 0.12, 0.6, 0, 1, 0.08, -0.2, 1.5, 0.1], // lifted out behind, turned flat
  [0.83, 0.1, 0.6, 0.14, 1.02, 0.12, 0.26, 1.5, 0.5], // carried forward low and wide
  [0.9, 0.17, 0.65, 0.24, 0.82, -0.08, 0.72, 0.5, 0.85], // over the catch, at its furthest forward
  [0.95, 0.2, 0.67, 0.23, 0.62, -0.3, 0.7, 0.1, 0.95], // dropping in
];
// The hull's half beam the keys are drawn for, and the lower hand's place down the shaft from the grip.
const STROKE_BEAM = 0.38;
const STROKE_LOW_HAND = 0.5;
/** The gunwale's height above the figure's seat the keys are drawn for. */
const STROKE_GUNWALE = 0.1;
const strokeKey = new Array(8).fill(0);
// How far behind and ahead of the figure the blade reaches along the stroke, metres.
const STROKE_SPAN = [-0.28, 0.78];
// Beside an outrigger's deck: the grip further out, the lean out over the gunwale, and the paddle's tip from its grip.
const STROKE_WELL_GRIP = 0.1;
const STROKE_WELL_LIFT = 0.02;
const STROKE_WELL_GRIP_AHEAD = 0.08;
const STROKE_WELL_LEAN = 0.24;
const PADDLE_TIP = 1.485;
// Below this effort, on its way to rest across the gunwales, the paddle is left to the canoe view to slide in.
const STROKE_WELL_HOLD = 0.3;
// Changing sides, the lower hand slides this far up the shaft toward the grip, to keep its hold.
const SWITCH_SLIDE = 0.3;
// Halfway through a change of sides: the grip at the chest, the paddle upright, its blade above the head.
const SWITCH_GRIP = new THREE.Vector3(0, 0.5, 0.12);
const SWITCH_AIM = new THREE.Vector3(0, 1.75, 0.05);

/** The stroke at `phase` 0..1: the keys joined by a smooth curve round the cycle (Catmull-Rom, by phase). */
function strokeAt(phase) {
  const count = STROKE_KEYS.length;
  const u = ((phase % 1) + 1) % 1;
  let index = 0;
  while (index < count - 1 && STROKE_KEYS[index + 1][0] <= u) index += 1;
  const at = (offset) => {
    const whole = index + offset;
    const wrapped = ((whole % count) + count) % count;
    return [STROKE_KEYS[wrapped], STROKE_KEYS[wrapped][0] + Math.floor(whole / count)];
  };
  const [k0, t0] = at(-1);
  const [k1, t1] = at(0);
  const [k2, t2] = at(1);
  const [k3, t3] = at(2);
  const span = t2 - t1;
  const t = (u - t1) / span;
  const t2t = t * t;
  const t3t = t2t * t;
  const h00 = 2 * t3t - 3 * t2t + 1;
  const h10 = t3t - 2 * t2t + t;
  const h01 = -2 * t3t + 3 * t2t;
  const h11 = t3t - t2t;
  for (let value = 1; value < 9; value += 1) {
    const m1 = ((k2[value] - k0[value]) / (t2 - t0)) * span;
    const m2 = ((k3[value] - k1[value]) / (t3 - t1)) * span;
    strokeKey[value - 1] = h00 * k1[value] + h10 * m1 + h01 * k2[value] + h11 * m2;
  }
  return strokeKey;
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
      tin.layers.enable(CREW_LAYER);
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
      // Back aboard, the paddle is in the hands again, wherever it was left.
      if (paddler.paddle.parent !== paddler.root) paddler.root.add(paddler.paddle);
      paddler.paddle.visible = true;
      const kneel = more?.kneel ?? 0;
      const bail = more?.bail ?? 0;
      const doze = more?.sleep ?? 0;
      state.sideS += (side - state.sideS) * Math.min(1, dt * 5);
      const s = state.sideS;
      const pull = phase < STROKE_PULL;
      // stroke pose (paddler-local), from the keys round the cycle: grip, aim, feather, reach
      const key = strokeAt(phase);
      // A wider hull puts the blade further out, so the shaft still crosses the gunwale above it.
      const wider = (more?.beam ?? STROKE_BEAM) - STROKE_BEAM;
      // A higher gunwale takes the lower hand up the shaft, so it and its forearm stay above it.
      const higher = Math.max(0, (more?.gunwale ?? STROKE_GUNWALE) - STROKE_GUNWALE);
      // The stroke keeps its reach outboard until the paddle is well up, on its way over to the other side.
      const out = Math.sign(s) * Math.min(1, Math.abs(s) * 1.5);
      G.set(out * (key[0] + wider * 0.3), key[1], key[2]);
      A.set(out * (key[3] + wider * 1.8), key[4], key[5]);
      // Short of an outrigger's deck ahead or behind, the stroke is drawn in to keep the blade off its end.
      const [nearest, furthest] = more?.span ?? STROKE_SPAN;
      const fore = Math.min(1, furthest / STROKE_SPAN[1]);
      const aft = Math.min(1, nearest / STROKE_SPAN[0]);
      G.z *= G.z > 0 ? fore : aft;
      A.z *= A.z > 0 ? fore : aft;
      // Changing sides, the paddle is lifted up and over, blade high above the head, never swung through the hull.
      const over = 1 - s * s;
      G.lerp(SWITCH_GRIP, over);
      // The blade rises first, then the grip comes in: the shaft never lies low across the gunwale.
      A.lerp(SWITCH_AIM, 1 - (1 - over) * (1 - over));
      // Beside an outrigger's deck the blade works in the well: the grip goes out over the gunwale and the shaft
      // stands nearly upright, its tip short of the deck's inner edge (`well`, out from the figure's centre). Changing
      // sides there, the paddle goes straight up and over, never out across the deck.
      const well = more?.well ?? 0;
      if (well > 0) {
        G.x += out * STROKE_WELL_GRIP;
        G.y += STROKE_WELL_LIFT;
        // The hands stay ahead of the shoulders, so the elbows keep off whatever stands behind the kneeler.
        G.z = Math.max(G.z, STROKE_WELL_GRIP_AHEAD);
      }
      // rest pose: paddle across the gunwales, blade out to the figure's left (restSide -1: to its right)
      const rs = more?.restSide ?? 1;
      Gi.set(-0.5 * rs, 0.14, 0.4);
      Ai.set(0.95 * rs, 0.12, 0.44);
      // At rest it is the rest pose exactly, whatever the crew's stroke clock is doing.
      if (effort > 0) {
        G.lerp(Gi, 1 - effort);
        A.lerp(Ai, 1 - effort);
      } else {
        G.copy(Gi);
        A.copy(Ai);
      }
      // In an outrigger's well the paddle's tip stays short of the deck's inner edge, paddling and while it is laid
      // down or taken up: the shaft is turned nearer upright. Laid across the gunwales, the canoe view slides it in.
      if (well > 0 && effort > 0) {
        _v.subVectors(A, G).normalize();
        const room = (well - Math.sign(_v.x) * G.x) / PADDLE_TIP;
        if (room > 0 && Math.abs(_v.x) > room) {
          // Turned toward upright, never further fore or aft: the stroke stays between the spars.
          _v.set(Math.sign(_v.x) * room, (_v.y < 0 ? -1 : 1) * Math.sqrt(Math.max(0, 1 - room * room - _v.z * _v.z)), _v.z);
          _h.copy(G).addScaledVector(_v, 1.19);
          A.lerp(_h, smooth(0, STROKE_WELL_HOLD, effort));
        }
      }
      const feather = key[6] * effort + (1 - effort) * 1.5;
      paddler.setPaddle(G, A, feather);
      // hands: top hand on the grip, lower hand down the shaft, above the gunwale
      _v.subVectors(A, G).normalize();
      const top = G;
      const low = _n.copy(G).addScaledVector(_v, STROKE_LOW_HAND - higher - 0.1 * (1 - effort) - SWITCH_SLIDE * over);
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
      const reach = key[7];
      let lean = 0.1 + effort * (0.06 + 0.16 * reach);
      let twist = -s * effort * (0.34 * (reach - 0.5));
      // Working in an outrigger's well, the kneeler leans out over the gunwale.
      let tilt = -s * effort * (well > 0 ? 0.05 + STROKE_WELL_LEAN : 0.05);
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
      return { inWater: pull && effort > 0.5, blade: bladeWorld, pull: effort * (pull ? Math.sin((phase / STROKE_PULL) * Math.PI) : 0) };
    },
    // Left in the canoe while its paddler is ashore: laid across the gunwales as it rests aboard, in `holder`, a
    // group placed where the paddler sits. restSide -1 lays the blade out to the seat's right.
    leave(holder, restSide = 1) {
      if (paddler.paddle.parent !== holder) holder.add(paddler.paddle);
      paddler.paddle.visible = true;
      Gi.set(-0.5 * restSide, 0.14, 0.4);
      Ai.set(0.95 * restSide, 0.12, 0.44);
      paddler.setPaddle(Gi, Ai, 1.5);
    },
    // ashore, empty-handed or with a tool in the right hand: the paddle stays in the canoe. Standing still is
    // still: no breath, no turn of the shoulders. t: kept for callers, unused. stride: radians of the walk cycle,
    // moving 0..1. lying 0..1: stretched out flat, for a sleeper (the caller lays the figure down). holding: a tool
    // is in the right hand, carried a little forward and up. jump: { trail, tuck, arms, crouch }, each 0..1 (see
    // look/jump-pose.ts): the legs trailing from the push, the knees drawn up, the arms thrown up, and the knees
    // giving over planted feet on landing. Left out, or all 0: the figure stands and walks exactly as it did.
    stand(t, stride = 0, moving = 0, lying = 0, holding = false, jump = null) {
      if (tin) tin.visible = false;
      if (paddler.paddle.parent === paddler.root) paddler.paddle.visible = false;
      const up = 1 - lying;
      const trail = jump ? jump.trail * up : 0;
      const tuck = jump ? jump.tuck * up : 0;
      const arms = jump ? jump.arms * up : 0;
      const crouch = jump ? jump.crouch * up : 0;
      // Off the ground the stride is held where it was, a little closed: a running jump keeps one leg ahead.
      const swing = Math.sin(stride) * 0.2 * moving * (1 - 0.4 * tuck);
      const liftL = Math.max(0, Math.cos(stride)) * 0.07 * moving;
      const liftR = Math.max(0, -Math.cos(stride)) * 0.07 * moving;
      const carry = holding ? up : 0;
      // The arms swing against the legs; a hand with a tool in it swings less, and is thrown up less in a jump.
      const armR = arms * (1 - 0.45 * carry);
      handR.set(-0.27 + 0.01 * carry - 0.05 * armR, 0.74 + 0.08 * carry + 0.6 * armR - 0.17 * crouch, 0.06 * up + 0.12 * carry - 0.08 * lying + swing * (0.6 - 0.3 * carry) + 0.2 * armR + 0.16 * crouch);
      handL.set(0.27 + 0.05 * arms, 0.74 + 0.6 * arms - 0.17 * crouch, 0.06 * up - 0.08 * lying - swing * 0.6 + 0.2 * arms + 0.16 * crouch);
      // The legs: trailing behind from the push, drawn up under the body, or bent over planted feet.
      const kneeY = 0.03 * trail + 0.16 * tuck - 0.06 * crouch;
      const kneeZ = -0.07 * trail + 0.22 * tuck + 0.2 * crouch;
      const footY = 0.12 * trail + 0.22 * tuck;
      const footZ = -0.24 * trail + 0.05 * tuck;
      paddler.pose({
        hipY: 0.8 - 0.012 * moving * Math.abs(Math.cos(stride)) - 0.17 * crouch,
        lean: (0.03 + 0.05 * moving) * up + 0.16 * trail - 0.04 * tuck + 0.26 * crouch,
        twist: 0.06 * (1 - moving) * up,
        tilt: 0,
        handL,
        handR,
        kneeL: sKneeL.set(0.1, 0.43 + liftL * 0.5 + kneeY, 0.03 * up - 0.07 * lying + swing * 0.55 + 0.05 * moving + kneeZ),
        kneeR: sKneeR.set(-0.1, 0.43 + liftR * 0.5 + kneeY, 0.05 * up - 0.07 * lying - swing * 0.55 + 0.05 * moving + kneeZ),
        footL: sFootL.set(0.11, 0.06 + liftL + footY, swing - 0.1 * lying + footZ),
        footR: sFootR.set(-0.12, 0.06 + liftR + footY, 0.06 * (1 - moving) * up - 0.1 * lying - swing + footZ),
        footYaw: 0,
      });
    },
  };
}
