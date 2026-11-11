// The endgame canoe: fifteen bolted-on attachments. Each one builds into its own Group so the
// game can fit them one at a time. Canoe frame: +x bow, +y up, +z starboard, waterline y = 0.
import * as THREE from 'three';
import { Kit, V, meshFrom } from './kit.js';
import { MAT, PAL, canvasTexture } from './palette.js';
import { FLOAT, halfBeamAt, sheerAt, hullSurface, hullCap, makeLantern } from './canoe.js';
import { mulberry32, lerp } from './util.js';

const BEAM_Y = 0.335; // crossbeam centre
const DECK = 0.405; // top of the deck planks
const FLOAT_Z = 2.3; // pontoon centreline
const MAST_X = 1.15, MAST_TOP = 5.1;
const SAIL_ANGLE = (32 * Math.PI) / 180; // boom swung aft and out to port: a backdrop for the far deck
const BOOM = V(-Math.cos(SAIL_ANGLE), 0, -Math.sin(SAIL_ANGLE));
const HALF_PI = Math.PI / 2;

/** Iron foot plate with two tin bolt heads: the "this is bolted on" tell used at every joint. */
function foot(k, x, z, w = 0.16, d = 0.12, y = DECK) {
  k.box(MAT.iron, w, 0.014, d, x, y + 0.007, z);
  k.bolt(MAT.tin, x - w * 0.32, y + 0.02, z - d * 0.22);
  k.bolt(MAT.tin, x + w * 0.32, y + 0.02, z + d * 0.22);
}

function outriggers(random) {
  const k = new Kit();
  for (const x of [-1.35, 0, 1.35]) {
    k.box(MAT.wood, 0.1, 0.09, 5.0, x, BEAM_Y, 0);
    for (const s of [-1, 1]) {
      const gz = s * halfBeamAt(x), top = sheerAt(x);
      k.box(MAT.woodDark, 0.2, 0.06, 0.11, x, top + 0.03, gz); // chock on the gunwale
      k.box(MAT.iron, 0.16, 0.2, 0.014, x, BEAM_Y - 0.06, gz + s * 0.064); // U-strap down the hull side
      k.box(MAT.iron, 0.16, 0.014, 0.17, x, BEAM_Y + 0.052, gz);
      k.bolt(MAT.tin, x - 0.05, BEAM_Y + 0.066, gz - s * 0.04);
      k.bolt(MAT.tin, x + 0.05, BEAM_Y + 0.066, gz + s * 0.04);
      k.bolt(MAT.tin, x - 0.05, BEAM_Y - 0.11, gz + s * 0.074, 'z');
      k.bolt(MAT.tin, x + 0.05, BEAM_Y - 0.11, gz + s * 0.074, 'z');
      k.box(MAT.woodDark, 0.14, 0.15, 0.14, x, 0.225, s * FLOAT_Z); // post onto the pontoon
      k.box(MAT.iron, 0.17, 0.014, 0.26, x, BEAM_Y + 0.052, s * FLOAT_Z);
      k.bolt(MAT.tin, x, BEAM_Y + 0.066, s * (FLOAT_Z - 0.09), 'y', 0.024);
      k.bolt(MAT.tin, x, BEAM_Y + 0.066, s * (FLOAT_Z + 0.09), 'y', 0.024);
      k.at(MAT.rope, new THREE.TorusGeometry(0.078, 0.013, 5, 10), x, BEAM_Y, s * (FLOAT_Z - 0.2));
      k.at(MAT.rope, new THREE.TorusGeometry(0.078, 0.013, 5, 10), x, BEAM_Y, s * (FLOAT_Z - 0.235));
    }
  }
  const shift = new THREE.Matrix4();
  for (const s of [-1, 1]) {
    shift.makeTranslation(0, 0, s * FLOAT_Z);
    k.geo(s < 0 ? MAT.paintTeal : MAT.woodPale, hullSurface(FLOAT, { nu: 30, ns: 12 }), shift);
    k.geo(MAT.woodDark, hullCap(FLOAT, 0.004, 0.996, 0, 1, 30), shift);
    k.box(MAT.tin, 0.34, 0.012, 0.2, s * 0.9, 0.18, s * FLOAT_Z); // tin sheet nailed over a split
    for (let i = 0; i < 9; i++) {
      const z = s * (0.58 + 0.083 + i * 0.1667);
      const x0 = -1.62 + random() * 0.14, x1 = 1.62 - random() * 0.14;
      k.box(i % 4 === 1 ? MAT.wood : MAT.woodPale, x1 - x0, 0.03, 0.152, (x0 + x1) / 2, DECK - 0.015, z, 0, (random() - 0.5) * 0.012, 0);
      for (const x of [-1.35, 0, 1.35]) k.bolt(MAT.iron, x, DECK, z, 'y', 0.012);
    }
  }
  return k.build('outriggers');
}

function sailTexture() {
  const random = mulberry32(19);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = PAL.canvas;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${random() < 0.5 ? '90,70,40' : '255,250,235'},${0.03 + random() * 0.05})`;
      ctx.fillRect(random() * w, random() * h, 2 + random() * 26, 1 + random() * 2);
    }
    ctx.strokeStyle = 'rgba(92,72,48,0.5)';
    ctx.lineWidth = 2.5;
    for (let x = 64; x < w; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, h);
      ctx.stroke();
    }
    const patch = (x, y, pw, ph, color, angle) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, pw, ph);
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(240,232,210,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(5, 5, pw - 10, ph - 10);
      ctx.restore();
    };
    patch(96, 150, 120, 92, '#4d6a86', 0.08); // denim
    patch(300, 300, 94, 130, '#a5503f', -0.1); // blanket red
    patch(210, 60, 70, 60, '#8b8470', 0.2);
    patch(380, 120, 80, 56, '#c79a3a', -0.05);
    ctx.fillStyle = 'rgba(70,52,34,0.5)'; // reef points
    for (let x = 30; x < w; x += 44) ctx.fillRect(x, 410, 4, 26);
    const stain = ctx.createLinearGradient(0, 0, 0, h);
    stain.addColorStop(0, 'rgba(40,30,40,0.0)');
    stain.addColorStop(1, 'rgba(40,30,40,0.28)');
    ctx.fillStyle = stain;
    ctx.fillRect(0, 0, w, h);
  });
}

function mastAndSail() {
  const group = new THREE.Group();
  const k = new Kit();
  const half = halfBeamAt(MAST_X), top = sheerAt(MAST_X);
  k.rod(MAT.woodPale, V(MAST_X, -0.08, 0), V(MAST_X, MAST_TOP, 0), 0.058, 10, 0.03);
  k.box(MAT.wood, 0.17, 0.065, half * 2 + 0.2, MAST_X, top + 0.055, 0); // mast partner across the gunwales
  k.cyl(MAT.iron, 0.09, 0.09, 0.075, MAST_X, top + 0.11, 0, 0, 0, 0, 10);
  for (let i = 0; i < 4; i++) k.bolt(MAT.tin, MAST_X + Math.cos(i * HALF_PI + 0.78) * 0.12, top + 0.095, Math.sin(i * HALF_PI + 0.78) * 0.12);
  for (const s of [-1, 1]) {
    k.box(MAT.iron, 0.19, 0.16, 0.014, MAST_X, top + 0.01, s * (half + 0.105));
    k.bolt(MAT.tin, MAST_X - 0.055, top - 0.03, s * (half + 0.116), 'z');
    k.bolt(MAT.tin, MAST_X + 0.055, top - 0.03, s * (half + 0.116), 'z');
  }
  k.cyl(MAT.tin, 0.02, 0.04, 0.07, MAST_X, MAST_TOP + 0.03, 0, 0, 0, 0, 8);
  // standing rigging: forestay to the rack, shrouds to the outer beam ends
  k.rod(MAT.rope, V(MAST_X, MAST_TOP - 0.25, 0), V(2.36, 0.53, 0), 0.008, 4);
  for (const s of [-1, 1]) k.rod(MAT.rope, V(MAST_X, MAST_TOP - 0.5, 0), V(0, BEAM_Y + 0.06, s * 2.42), 0.008, 4);
  group.add(k.build('mast'));

  // lug sail on a pivot at the mast so it can breathe
  const pivot = new THREE.Group();
  pivot.position.set(MAST_X, 0, 0);
  const at = (d, y) => V(BOOM.x * d, y, BOOM.z * d);
  const tack = at(-0.3, 1.78), clew = at(2.35, 1.95), peak = at(1.8, 4.95), throat = at(-0.45, 3.85);
  const belly = V(Math.sin(SAIL_ANGLE), 0, -Math.cos(SAIL_ANGLE));
  const positions = [], uvs = [], indices = [];
  const nu = 12, nv = 14, low = new THREE.Vector3(), high = new THREE.Vector3(), p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      low.lerpVectors(tack, clew, u);
      high.lerpVectors(throat, peak, u);
      p.lerpVectors(low, high, v).addScaledVector(belly, 0.34 * Math.pow(Math.sin(Math.PI * u), 0.8) * Math.pow(Math.sin(Math.PI * v), 0.6));
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      indices.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const sail = new THREE.Mesh(meshFrom(positions, indices, uvs), new THREE.MeshLambertMaterial({ map: sailTexture(), side: THREE.DoubleSide }));
  const spars = new Kit();
  spars.rod(MAT.wood, at(-0.45, 1.75), at(2.5, 1.95), 0.032, 7, 0.026); // boom
  spars.rod(MAT.wood, at(-0.6, 3.76), at(1.95, 5.06), 0.03, 7, 0.022); // yard
  spars.at(MAT.rope, new THREE.TorusGeometry(0.075, 0.016, 5, 12), 0, 1.78, 0, HALF_PI);
  spars.at(MAT.rope, new THREE.TorusGeometry(0.06, 0.016, 5, 12), 0, 3.95, 0, HALF_PI);
  pivot.add(sail, spars.build('spars'));
  // sheet from the boom end down to a cleat on the port deck
  const sheet = new Kit();
  sheet.rod(MAT.rope, V(MAST_X, 0, 0).add(at(2.4, 1.93)), V(-1.52, DECK + 0.03, -0.72), 0.008, 4);
  sheet.box(MAT.iron, 0.12, 0.03, 0.04, -1.52, DECK + 0.02, -0.72);
  group.add(pivot, sheet.build('sheet'));
  return { group, pivot };
}

const RACK_Y = 0.62, RACK_AFT = -3.02;

/** Hung on the cargo rack's aft beam, right at the tail of the whole rig, with a long tiller forward. */
function rudder() {
  const group = new THREE.Group();
  const fixed = new Kit();
  for (const y of [RACK_Y - 0.02, RACK_Y + 0.32]) { // gudgeon straps bolted to the rack post
    fixed.box(MAT.iron, 0.16, 0.045, 0.1, RACK_AFT - 0.03, y, 0);
    fixed.bolt(MAT.tin, RACK_AFT + 0.02, y, 0.06, 'z');
    fixed.bolt(MAT.tin, RACK_AFT + 0.02, y, -0.06, 'z');
    fixed.cyl(MAT.iron, 0.018, 0.018, 0.11, RACK_AFT - 0.11, y, 0, 0, 0, 0, 6);
  }
  fixed.box(MAT.woodDark, 0.08, 0.62, 0.08, RACK_AFT + 0.02, RACK_Y + 0.2, 0); // the post they bolt to
  group.add(fixed.build('gudgeons'));
  const pivot = new THREE.Group();
  pivot.position.set(RACK_AFT - 0.11, 0, 0);
  const k = new Kit();
  k.box(MAT.wood, 0.1, 1.75, 0.045, -0.07, 0.32, 0); // stock
  k.box(MAT.woodPale, 0.5, 0.72, 0.032, -0.27, -0.3, 0); // blade
  k.box(MAT.iron, 0.54, 0.04, 0.05, -0.27, 0.08, 0);
  k.box(MAT.iron, 0.54, 0.04, 0.05, -0.27, -0.3, 0);
  for (const dx of [-0.08, -0.26, -0.44]) k.bolt(MAT.tin, dx, 0.08, 0.032, 'z');
  k.box(MAT.iron, 0.14, 0.05, 0.07, -0.07, 1.14, 0);
  k.rod(MAT.wood, V(-0.07, 1.14, 0), V(1.38, 0.99, 0.2), 0.024, 6, 0.018); // tiller, forward over the cargo to the paddler
  k.ball(MAT.woodDark, 0.038, 1.38, 0.99, 0.2, 1, 1, 1, 8);
  pivot.add(k.build('rudder-blade'));
  group.add(pivot);
  return { group, pivot };
}

/** Stern overhang rack: keeps the bow clean so the canoe still reads as a canoe. */
function cargoRack() {
  const k = new Kit();
  const Y = RACK_Y, X0 = -1.86, X1 = RACK_AFT;
  for (const s of [-1, 1]) {
    k.bar(MAT.wood, V(X0 + 0.04, Y, s * 0.4), V(X1, Y, s * 0.4), 0.06);
    const gz = s * halfBeamAt(X0), top = sheerAt(X0);
    k.bar(MAT.woodDark, V(X0, top, gz), V(X0, Y, s * 0.4), 0.055); // post up from the gunwale
    k.box(MAT.iron, 0.12, 0.13, 0.014, X0, top + 0.02, gz + s * 0.04);
    k.bolt(MAT.tin, X0 - 0.03, top, gz + s * 0.05, 'z');
    k.bolt(MAT.tin, X0 + 0.03, top + 0.04, gz + s * 0.05, 'z');
    k.bar(MAT.woodDark, V(-2.2, sheerAt(-2.2) + 0.02, s * halfBeamAt(-2.2)), V(X1 + 0.06, Y - 0.02, s * 0.4), 0.045); // diagonal brace
    for (const x of [X0 + 0.04, X1 + 0.02]) k.rod(MAT.woodDark, V(x, Y, s * 0.4), V(x, Y + 0.3, s * 0.4), 0.02, 6);
    k.rod(MAT.rope, V(X0 + 0.04, Y + 0.27, s * 0.4), V(X1 + 0.02, Y + 0.27, s * 0.4), 0.009, 4);
  }
  for (const x of [X0 + 0.06, -2.44, X1 + 0.02]) {
    k.bar(MAT.wood, V(x, Y, -0.46), V(x, Y, 0.46), 0.055);
    k.bolt(MAT.tin, x, Y + 0.035, 0.4);
    k.bolt(MAT.tin, x, Y + 0.035, -0.4);
  }
  for (let i = 0; i < 5; i++) k.box(i % 2 ? MAT.wood : MAT.woodPale, X0 - X1 - 0.02, 0.022, 0.14, (X0 + X1) / 2, Y + 0.04, -0.32 + i * 0.16);
  const top = Y + 0.052;
  // low cargo, so the tiller clears it and the paddler still sees aft
  k.box(MAT.woodPale, 0.44, 0.3, 0.38, -2.2, top + 0.15, 0.2, 0, 0.1, 0); // crate
  for (const y of [0.06, 0.16, 0.26]) k.box(MAT.woodDark, 0.455, 0.022, 0.395, -2.2, top + y, 0.2, 0, 0.1, 0);
  k.cyl(MAT.flagRed, 0.09, 0.09, 0.42, -2.14, top + 0.09, -0.24, 0, 0, Math.PI / 2, 10); // bedroll
  k.at(MAT.rope, new THREE.TorusGeometry(0.094, 0.012, 5, 12), -2.02, top + 0.09, -0.24, 0, HALF_PI, 0);
  k.at(MAT.rope, new THREE.TorusGeometry(0.094, 0.012, 5, 12), -2.26, top + 0.09, -0.24, 0, HALF_PI, 0);
  k.cyl(MAT.wood, 0.16, 0.18, 0.42, -2.72, top + 0.21, -0.25, 0, 0, 0, 14); // barrel
  k.cyl(MAT.wood, 0.18, 0.16, 0.02, -2.72, top + 0.43, -0.25, 0, 0, 0, 14);
  for (const y of [0.06, 0.21, 0.36]) k.at(MAT.iron, new THREE.TorusGeometry(0.182, 0.012, 5, 18), -2.72, top + y, -0.25, HALF_PI);
  k.box(MAT.tin, 0.16, 0.27, 0.22, -2.74, top + 0.135, 0.27, 0, -0.2, 0); // jerry can
  k.cyl(MAT.tin, 0.028, 0.028, 0.05, -2.76, top + 0.295, 0.32, 0, 0, 0, 8);
  return k.build('cargo-rack');
}

/** Shepherd's-crook lantern mast on the bow deck: the starter's lamp-on-a-stick, grown up. */
function lanternMast() {
  const group = new THREE.Group();
  const k = new Kit();
  const BX = 2.08, BY = 0.47;
  k.tube(MAT.woodDark, [V(BX, BY, 0), V(BX + 0.1, 1.3, 0), V(BX + 0.26, 2.0, 0), V(BX + 0.52, 2.36, 0), V(BX + 0.8, 2.36, 0), V(BX + 0.9, 2.26, 0)], 0.028, 7, 40);
  k.cyl(MAT.iron, 0.055, 0.055, 0.1, BX + 0.005, BY + 0.06, 0, 0, 0, 0, 8);
  k.box(MAT.iron, 0.22, 0.014, 0.2, BX, BY + 0.012, 0);
  for (const [dx, dz] of [[-0.08, -0.07], [0.08, -0.07], [-0.08, 0.07], [0.08, 0.07]]) k.bolt(MAT.tin, BX + dx, BY + 0.03, dz);
  for (const s of [-1, 1]) { // knee braces off the gunwales
    const gx = 1.72;
    k.rod(MAT.woodDark, V(gx, sheerAt(gx) + 0.03, s * halfBeamAt(gx)), V(BX + 0.07, 1.12, 0), 0.016, 5);
    k.box(MAT.iron, 0.09, 0.014, 0.09, gx, sheerAt(gx) + 0.045, s * halfBeamAt(gx));
    k.bolt(MAT.tin, gx, sheerAt(gx) + 0.062, s * halfBeamAt(gx), 'y', 0.016);
  }
  k.cyl(MAT.iron, 0.034, 0.034, 0.05, BX + 0.07, 1.12, 0, 0, 0, 0, 8);
  k.rod(MAT.iron, V(BX + 0.9, 2.26, 0), V(BX + 0.9, 2.16, 0), 0.006, 4);
  group.add(k.build('lantern-mast'));
  const hang = new THREE.Group();
  hang.position.set(BX + 0.9, 2.16, 0);
  const lantern = makeLantern(1.9);
  lantern.group.position.y = -0.25;
  hang.add(lantern.group);
  group.add(hang);
  return { group, hang, anchor: lantern.anchor };
}

function canopy() {
  const group = new THREE.Group();
  const k = new Kit();
  const X0 = -0.72, X1 = 0.62, HALF = 0.67, RISE = 1.12;
  const arc = (x, a, scale = 1) => V(x, DECK + RISE * scale * Math.pow(Math.sin(a), 0.85), -HALF * Math.cos(a) * (0.5 + 0.5 * scale));
  for (const x of [X0, (X0 + X1) / 2, X1]) {
    const hoop = [];
    for (let i = 0; i <= 14; i++) hoop.push(arc(x, (Math.PI * i) / 14));
    k.tube(MAT.woodDark, hoop, 0.022, 6, 42);
    for (const s of [-1, 1]) foot(k, x, s * HALF, 0.14, 0.12);
  }
  k.rod(MAT.woodDark, arc(X0 - 0.08, HALF_PI).add(V(0, 0.03, 0)), arc(X1 + 0.08, HALF_PI).add(V(0, 0.03, 0)), 0.018, 6); // ridge pole
  const positions = [], indices = [], nx = 12, na = 18;
  for (let i = 0; i <= nx; i++) {
    const fx = i / nx, x = lerp(X0 - 0.05, X1 + 0.05, fx);
    const sag = 1 - 0.035 * Math.pow(Math.sin(Math.PI * fx * 2), 2);
    for (let j = 0; j <= na; j++) {
      const p = arc(x, Math.PI * lerp(0.13, 0.87, j / na), sag * 1.015);
      positions.push(p.x, p.y + 0.012, p.z);
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j;
      indices.push(a, a + na + 1, a + 1, a + 1, a + na + 1, a + na + 2);
    }
  }
  k.geo(MAT.canvas, meshFrom(positions, indices));
  // two patches stitched over the cover, and tie-downs
  const patch = (x0, x1, a0, a1, material) => {
    const pp = [], ii = [];
    for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) {
      const p = arc(lerp(x0, x1, i / 3), Math.PI * lerp(a0, a1, j / 3), 1.03);
      pp.push(p.x, p.y + 0.018, p.z);
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const a = i * 4 + j;
      ii.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
    k.geo(material, meshFrom(pp, ii));
  };
  patch(-0.5, -0.22, 0.56, 0.72, MAT.flagTeal);
  patch(0.1, 0.42, 0.26, 0.4, MAT.canvasShade);
  for (const x of [X0, X1]) for (const s of [-1, 1]) k.rod(MAT.rope, arc(x, s > 0 ? Math.PI * 0.86 : Math.PI * 0.14), V(x + (x < 0 ? -0.2 : 0.2), DECK, s * 0.9), 0.007, 4);
  // under cover: bedroll and a stores box
  k.cyl(MAT.flagMustard, 0.1, 0.1, 0.56, 0.25, 0.02, 0, HALF_PI, 0, 0, 10);
  k.box(MAT.woodPale, 0.36, 0.26, 0.36, -0.42, 0.04, 0.02, 0, 0.2, 0);
  group.add(k.build('canopy'));
  const lamp = makeLantern(1.0);
  lamp.group.position.set(-0.05, DECK + RISE - 0.26, 0);
  group.add(lamp.group);
  return { group, anchor: lamp.anchor };
}

function rainCatcher() {
  const k = new Kit();
  const CX = 0.95, CZ = -1.36, R = 0.5;
  const heights = [1.3, 1.12, 1.36, 1.18];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b], i) => V(CX + a * R, DECK + heights[i], CZ + b * R));
  corners.forEach((c) => {
    k.rod(MAT.woodDark, V(c.x, DECK, c.z), V(c.x, c.y + 0.06, c.z), 0.024, 6, 0.018);
    foot(k, c.x, c.z, 0.13, 0.11);
    k.at(MAT.rope, new THREE.TorusGeometry(0.03, 0.01, 4, 8), c.x, c.y - 0.01, c.z, HALF_PI);
  });
  const positions = [], indices = [], n = 10;
  const edge = (a, b) => {
    const top = lerp(lerp(corners[0].y, corners[1].y, a), lerp(corners[3].y, corners[2].y, a), b);
    const m = Math.max(Math.abs(a * 2 - 1), Math.abs(b * 2 - 1));
    return top - 0.5 * (1 - Math.pow(m, 1.5));
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(CX + (i / n * 2 - 1) * R, edge(i / n, j / n), CZ + (j / n * 2 - 1) * R);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i;
    indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
  }
  k.geo(MAT.tarp, meshFrom(positions, indices));
  const low = edge(0.5, 0.5);
  k.cyl(MAT.copper, 0.05, 0.028, 0.1, CX, low - 0.03, CZ, 0, 0, 0, 10); // funnel throat
  k.cyl(MAT.copper, 0.022, 0.022, low - DECK - 0.6, CX, (low + DECK + 0.52) / 2, CZ, 0, 0, 0, 8);
  k.cyl(MAT.tin, 0.21, 0.21, 0.52, CX, DECK + 0.26, CZ, 0, 0, 0, 16); // the drum it fills
  for (const y of [0.02, 0.18, 0.34, 0.5]) k.at(MAT.iron, new THREE.TorusGeometry(0.213, 0.011, 5, 18), CX, DECK + y, CZ, HALF_PI);
  k.cyl(MAT.copper, 0.014, 0.014, 0.1, CX, DECK + 0.12, CZ + 0.24, HALF_PI, 0, 0, 6); // tap
  k.box(MAT.copper, 0.05, 0.012, 0.02, CX, DECK + 0.145, CZ + 0.28);
  return k.build('rain-catcher');
}

function antenna(beaconMaterial) {
  const k = new Kit();
  const X = -1.46, Z = 1.94, TOP = DECK + 4.3;
  k.rod(MAT.tin, V(X, DECK, Z), V(X, TOP, Z), 0.026, 6, 0.012);
  foot(k, X, Z, 0.18, 0.18);
  k.cyl(MAT.iron, 0.04, 0.04, 0.12, X, DECK + 0.07, Z, 0, 0, 0, 8);
  const lengths = [1.0, 0.78, 0.58, 0.4];
  lengths.forEach((length, i) => {
    const y = DECK + 3.0 + i * 0.3;
    k.rod(MAT.tin, V(X - length / 2, y, Z), V(X + length / 2, y, Z), 0.011, 4);
  });
  k.rod(MAT.tin, V(X, DECK + 2.3, Z), V(X + 0.34, DECK + 2.3, Z - 0.0), 0.007, 4); // dipole stub
  k.at(MAT.tin, new THREE.TorusGeometry(0.11, 0.007, 4, 14), X + 0.34, DECK + 2.3, Z);
  for (const [dx, dz] of [[1.0, -0.2], [0.1, -1.1], [0.0, 0.1]]) k.rod(MAT.rope, V(X, DECK + 2.7, Z), V(X + dx, DECK + 0.02, Z + dz), 0.004, 3);
  // the radio: tin box, glowing dial, coil of feed wire
  k.box(MAT.tin, 0.34, 0.24, 0.22, X + 0.34, DECK + 0.12, Z - 0.02);
  k.box(MAT.iron, 0.2, 0.1, 0.012, X + 0.3, DECK + 0.14, Z + 0.092);
  k.cyl(MAT.dial, 0.035, 0.035, 0.015, X + 0.44, DECK + 0.15, Z + 0.095, HALF_PI, 0, 0, 10);
  k.at(MAT.rope, new THREE.TorusGeometry(0.08, 0.012, 5, 12), X + 0.1, DECK + 0.02, Z - 0.28, HALF_PI);
  k.rod(MAT.rope, V(X + 0.3, DECK + 0.24, Z - 0.02), V(X, DECK + 0.8, Z), 0.005, 3);
  const group = k.build('radio-antenna');
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), beaconMaterial);
  beacon.position.set(X, TOP + 0.03, Z);
  group.add(beacon);
  return group;
}

function smoker() {
  const k = new Kit();
  const X = -0.62, Z = -1.48, W = 0.46, H = 1.12;
  k.box(MAT.woodDark, W, H, W, X, DECK + H / 2 + 0.06, Z);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.box(MAT.wood, 0.05, H + 0.06, 0.05, X + dx * W / 2, DECK + H / 2 + 0.03, Z + dz * W / 2);
    foot(k, X + dx * (W / 2 + 0.03), Z + dz * (W / 2 + 0.03), 0.1, 0.1);
  }
  for (let i = 0; i < 5; i++) k.box(MAT.wood, 0.02, 0.012, W - 0.08, X + W / 2 + 0.004, DECK + 0.2 + i * 0.21, Z); // plank seams, bow face
  k.box(MAT.tin, W + 0.18, 0.02, W + 0.2, X, DECK + H + 0.11, Z, 0.16, 0, 0); // tin roof
  k.cyl(MAT.iron, 0.04, 0.04, 0.42, X - 0.08, DECK + H + 0.3, Z - 0.08, 0, 0, 0, 8);
  k.cyl(MAT.iron, 0.07, 0.02, 0.06, X - 0.08, DECK + H + 0.54, Z - 0.08, 0, 0, 0, 8);
  // door on the inboard face, strap hinges, latch, and the ember slit at its foot
  k.box(MAT.wood, W - 0.1, H - 0.22, 0.02, X, DECK + H / 2 + 0.1, Z + W / 2 + 0.008);
  for (const y of [0.3, 0.92]) {
    k.box(MAT.iron, 0.2, 0.03, 0.012, X - 0.1, DECK + y, Z + W / 2 + 0.022);
    k.bolt(MAT.tin, X - 0.17, DECK + y, Z + W / 2 + 0.03, 'z', 0.014);
    k.bolt(MAT.tin, X - 0.06, DECK + y, Z + W / 2 + 0.03, 'z', 0.014);
  }
  k.box(MAT.iron, 0.03, 0.09, 0.02, X + 0.14, DECK + 0.62, Z + W / 2 + 0.024);
  k.box(MAT.emberGlow, W - 0.14, 0.035, 0.012, X, DECK + 0.115, Z + W / 2 + 0.006);
  // drying rack with the day's catch
  k.rod(MAT.woodDark, V(X + W / 2, DECK + 1.0, Z - 0.1), V(X + W / 2 + 0.52, DECK + 1.0, Z - 0.1), 0.014, 5);
  k.rod(MAT.woodDark, V(X + W / 2 + 0.5, DECK, Z - 0.1), V(X + W / 2 + 0.5, DECK + 1.02, Z - 0.1), 0.016, 5);
  for (let i = 0; i < 3; i++) {
    const fx = X + W / 2 + 0.12 + i * 0.13;
    k.rod(MAT.rope, V(fx, DECK + 1.0, Z - 0.1), V(fx, DECK + 0.9, Z - 0.1), 0.004, 3);
    k.ball(MAT.fish, 0.06, fx, DECK + 0.76 - (i % 2) * 0.02, Z - 0.1, 0.42, 2.3, 1, 8);
    k.at(MAT.fish, new THREE.ConeGeometry(0.045, 0.07, 4), fx, DECK + 0.61 - (i % 2) * 0.02, Z - 0.1, Math.PI, 0, 0, 0.4, 1, 1);
  }
  return k.build('smoker');
}

function winch() {
  const k = new Kit();
  const X = -1.3, Z = -1.55;
  // drum on a bolted timber cradle, with a crank
  for (const dx of [-0.2, 0.2]) {
    k.box(MAT.wood, 0.07, 0.34, 0.3, X + dx, DECK + 0.17, Z);
    foot(k, X + dx, Z - 0.19, 0.11, 0.1);
    foot(k, X + dx, Z + 0.19, 0.11, 0.1);
    k.cyl(MAT.iron, 0.15, 0.15, 0.02, X + dx * 0.72, DECK + 0.27, Z, 0, 0, HALF_PI, 14);
  }
  k.cyl(MAT.woodDark, 0.09, 0.09, 0.3, X, DECK + 0.27, Z, 0, 0, HALF_PI, 12);
  k.cyl(MAT.rope, 0.115, 0.115, 0.2, X, DECK + 0.27, Z, 0, 0, HALF_PI, 12);
  k.rod(MAT.iron, V(X + 0.2, DECK + 0.27, Z), V(X + 0.34, DECK + 0.27, Z), 0.014, 5);
  k.rod(MAT.iron, V(X + 0.33, DECK + 0.27, Z), V(X + 0.33, DECK + 0.47, Z + 0.06), 0.012, 5);
  k.cyl(MAT.woodPale, 0.022, 0.022, 0.11, X + 0.385, DECK + 0.47, Z + 0.06, 0, 0, HALF_PI, 6);
  // A-frame boom leaning out over the port float
  const head = V(X, DECK + 1.95, Z - 1.3);
  for (const dx of [-0.3, 0.3]) {
    k.bar(MAT.wood, V(X + dx, DECK, Z - 0.3), head, 0.06);
    foot(k, X + dx, Z - 0.3, 0.14, 0.12);
  }
  k.bar(MAT.wood, V(X - 0.2, DECK + 0.6, Z - 0.61), V(X + 0.2, DECK + 0.6, Z - 0.61), 0.045);
  k.box(MAT.iron, 0.1, 0.12, 0.1, head.x, head.y, head.z);
  k.bolt(MAT.tin, head.x + 0.055, head.y, head.z, 'x', 0.022);
  k.cyl(MAT.iron, 0.07, 0.07, 0.035, head.x, head.y - 0.1, head.z - 0.03, 0, 0, HALF_PI, 12); // sheave
  k.rod(MAT.rope, head, V(X, DECK + 0.02, Z + 0.75), 0.008, 4); // backstay
  k.box(MAT.iron, 0.12, 0.03, 0.05, X, DECK + 0.02, Z + 0.75);
  k.rod(MAT.rope, V(X, DECK + 0.38, Z - 0.02), V(head.x, head.y - 0.05, head.z + 0.02), 0.008, 4); // fall, drum to sheave
  const hookY = 0.95;
  k.rod(MAT.rope, V(head.x, head.y - 0.14, head.z - 0.06), V(head.x, hookY, head.z - 0.06), 0.008, 4);
  k.at(MAT.iron, new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI * 1.4), head.x, hookY - 0.05, head.z - 0.06, 0, HALF_PI, 0.6);
  // today's salvage: a tyre, dripping
  k.at(MAT.patchTar, new THREE.TorusGeometry(0.25, 0.095, 8, 18), head.x, hookY - 0.38, head.z - 0.06, 0, HALF_PI + 0.3, 0.1);
  return k.build('salvage-winch');
}

function fishingRig() {
  const k = new Kit();
  const X = 1.42, Z = 1.96;
  foot(k, X, Z, 0.18, 0.14);
  k.rod(MAT.iron, V(X, DECK, Z), V(X + 0.1, DECK + 0.34, Z + 0.17), 0.03, 7);
  const tipPoint = V(X + 1.0, DECK + 1.72, Z + 1.85);
  k.tube(MAT.woodDark, [V(X + 0.03, DECK + 0.1, Z + 0.05), V(X + 0.26, DECK + 0.9, Z + 0.46), V(X + 0.58, DECK + 1.52, Z + 1.06), V(X + 0.86, DECK + 1.76, Z + 1.56), tipPoint], 0.011, 5, 30);
  k.cyl(MAT.tin, 0.04, 0.04, 0.035, X + 0.13, DECK + 0.46, Z + 0.24, 0, 0, HALF_PI, 10); // reel
  const bobber = V(X + 1.08, 0.04, Z + 2.0);
  k.rod(MAT.canvas, tipPoint, bobber, 0.0035, 3);
  k.ball(MAT.tomato, 0.05, bobber.x, bobber.y, bobber.z, 1, 1, 1, 8);
  k.ball(MAT.canvas, 0.035, bobber.x, bobber.y + 0.045, bobber.z, 1, 1, 1, 8);
  // tackle box, creel and a landing net
  k.box(MAT.tin, 0.3, 0.13, 0.18, X - 0.42, DECK + 0.065, Z - 0.1, 0, 0.3, 0);
  k.box(MAT.iron, 0.1, 0.015, 0.03, X - 0.42, DECK + 0.14, Z - 0.1, 0, 0.3, 0);
  k.cyl(MAT.rope, 0.11, 0.13, 0.2, X - 0.02, DECK + 0.1, Z - 0.42, 0, 0, 0, 12);
  k.cyl(MAT.woodDark, 0.115, 0.115, 0.02, X - 0.02, DECK + 0.21, Z - 0.42, 0, 0, 0, 12);
  k.rod(MAT.woodPale, V(X - 0.8, DECK, Z + 0.06), V(X - 0.72, DECK + 0.95, Z - 0.05), 0.013, 5);
  k.at(MAT.rope, new THREE.TorusGeometry(0.15, 0.01, 4, 14), X - 0.7, DECK + 1.1, Z - 0.07, 0, HALF_PI, 0.2);
  return k.build('fishing-rig');
}

function workbench() {
  const k = new Kit();
  const X = 0.78, Z = 1.02, TOP = DECK + 0.56;
  k.box(MAT.woodPale, 1.02, 0.055, 0.46, X, TOP, Z);
  for (const dx of [-0.45, 0.45]) for (const dz of [-0.18, 0.18]) {
    k.box(MAT.wood, 0.055, 0.54, 0.055, X + dx, DECK + 0.27, Z + dz);
    foot(k, X + dx, Z + dz, 0.11, 0.11);
  }
  k.box(MAT.wood, 0.95, 0.03, 0.4, X, DECK + 0.17, Z); // lower shelf
  k.box(MAT.wood, 0.95, 0.07, 0.025, X, TOP - 0.06, Z + 0.215); // apron
  k.box(MAT.flagRed, 0.36, 0.16, 0.2, X - 0.2, DECK + 0.265, Z, 0, 0.1, 0); // toolbox
  k.box(MAT.iron, 0.14, 0.014, 0.02, X - 0.2, DECK + 0.355, Z, 0, 0.1, 0);
  // vise bolted to the bow end
  k.box(MAT.iron, 0.12, 0.1, 0.14, X + 0.43, TOP + 0.075, Z - 0.08);
  k.box(MAT.iron, 0.03, 0.1, 0.14, X + 0.53, TOP + 0.075, Z - 0.08);
  k.rod(MAT.tin, V(X + 0.52, TOP + 0.06, Z - 0.16), V(X + 0.52, TOP + 0.06, Z + 0.03), 0.008, 4);
  k.bolt(MAT.tin, X + 0.4, TOP + 0.03, Z - 0.13);
  k.bolt(MAT.tin, X + 0.4, TOP + 0.03, Z - 0.03);
  // hammer, a plank on the go, and the saw hung on the apron
  k.rod(MAT.woodPale, V(X - 0.3, TOP + 0.045, Z - 0.1), V(X - 0.05, TOP + 0.045, Z + 0.02), 0.014, 5);
  k.box(MAT.iron, 0.05, 0.05, 0.12, X - 0.05, TOP + 0.05, Z + 0.02, 0, 0.45, 0);
  k.box(MAT.drift, 0.7, 0.025, 0.12, X + 0.05, TOP + 0.04, Z + 0.12, 0, -0.08, 0);
  k.box(MAT.tin, 0.44, 0.1, 0.006, X + 0.12, TOP - 0.17, Z + 0.232, 0, 0, -0.1);
  k.box(MAT.woodDark, 0.1, 0.12, 0.022, X - 0.14, TOP - 0.14, Z + 0.236);
  k.box(MAT.woodPale, 0.035, 0.9, 0.14, X - 0.6, DECK + 0.45, Z + 0.1, 0, 0, 0.18); // offcuts leaning on the end
  k.box(MAT.wood, 0.035, 0.7, 0.12, X - 0.64, DECK + 0.35, Z - 0.05, 0, 0, 0.24);
  return k.build('workbench');
}

function planters(random) {
  const k = new Kit();
  const Z = 1.93;
  for (const [cx, kind] of [[-0.42, 'greens'], [0.3, 'tomato']]) {
    const L = 0.64, W = 0.25, H = 0.2;
    k.box(MAT.wood, L, H, 0.022, cx, DECK + H / 2, Z - W / 2);
    k.box(MAT.wood, L, H, 0.022, cx, DECK + H / 2, Z + W / 2);
    k.box(MAT.woodDark, 0.022, H, W, cx - L / 2, DECK + H / 2, Z);
    k.box(MAT.woodDark, 0.022, H, W, cx + L / 2, DECK + H / 2, Z);
    k.box(MAT.soil, L - 0.03, 0.02, W - 0.03, cx, DECK + H - 0.03, Z);
    for (const sx of [-1, 1]) {
      k.box(MAT.iron, 0.014, H * 0.8, 0.06, cx + sx * (L / 2 + 0.012), DECK + H / 2, Z - W / 2 + 0.03);
      k.bolt(MAT.tin, cx + sx * (L / 2 + 0.022), DECK + H * 0.7, Z - W / 2 + 0.03, 'x', 0.014);
      k.bolt(MAT.tin, cx + sx * (L / 2 + 0.022), DECK + H * 0.3, Z - W / 2 + 0.03, 'x', 0.014);
      foot(k, cx + sx * (L / 2 - 0.08), Z - W / 2 - 0.05, 0.1, 0.08);
    }
    if (kind === 'greens') {
      for (let i = 0; i < 7; i++) {
        const px = cx - 0.25 + i * 0.083, pz = Z + (random() - 0.5) * 0.1, size = 0.07 + random() * 0.05;
        k.ball(MAT.leaf, size, px, DECK + H + size * 0.7, pz, 1, 1.25, 1, 7);
        k.ball(MAT.leaf, size * 0.7, px + 0.03, DECK + H + size * 1.4, pz - 0.02, 1, 1.2, 1, 6);
      }
    } else {
      for (const dx of [-0.17, 0.15]) {
        k.rod(MAT.woodPale, V(cx + dx, DECK + H - 0.02, Z), V(cx + dx, DECK + H + 0.62, Z), 0.008, 4);
        for (let i = 0; i < 5; i++) {
          const y = DECK + H + 0.08 + i * 0.11, a = i * 2.2 + dx * 9;
          k.ball(MAT.leaf, 0.075 - i * 0.006, cx + dx + Math.cos(a) * 0.05, y, Z + Math.sin(a) * 0.05, 1.2, 0.8, 1.2, 7);
          if (i % 2 === 0) k.ball(MAT.tomato, 0.03, cx + dx + Math.cos(a + 1.6) * 0.085, y - 0.03, Z + Math.sin(a + 1.6) * 0.085, 1, 1, 1, 7);
        }
      }
    }
  }
  return k.build('planter-boxes');
}

function firebox() {
  const part = new Kit();
  part.box(MAT.stone, 0.82, 0.05, 0.66, 0, 0.025, 0); // heat slab
  for (const [dx, dz] of [[-0.36, -0.28], [0.36, -0.28], [0.36, 0.28], [-0.36, 0.28]]) part.bolt(MAT.tin, dx, 0.055, dz, 'y', 0.022);
  for (const [dx, dz] of [[-0.2, -0.14], [0.2, -0.14], [0.2, 0.14], [-0.2, 0.14]]) part.box(MAT.iron, 0.04, 0.12, 0.04, dx, 0.11, dz);
  part.box(MAT.iron, 0.52, 0.36, 0.38, 0, 0.35, 0); // firebox
  part.box(MAT.iron, 0.58, 0.03, 0.44, 0, 0.545, 0); // cook top
  part.box(MAT.emberGlow, 0.012, 0.19, 0.24, 0.262, 0.33, 0); // fire seen through the door grate
  for (const dz of [-0.08, 0, 0.08]) part.box(MAT.iron, 0.02, 0.2, 0.022, 0.27, 0.33, dz);
  part.box(MAT.iron, 0.02, 0.03, 0.3, 0.272, 0.44, 0);
  part.box(MAT.iron, 0.02, 0.03, 0.3, 0.272, 0.22, 0);
  part.box(MAT.emberGlow, 0.012, 0.03, 0.2, 0.262, 0.16, 0); // ash vent
  part.cyl(MAT.iron, 0.058, 0.058, 1.05, -0.16, 1.085, -0.06, 0, 0, 0, 10); // stovepipe
  part.cyl(MAT.iron, 0.058, 0.058, 0.5, -0.16, 1.82, 0.01, 0.3, 0, 0, 10);
  part.cyl(MAT.iron, 0.13, 0.04, 0.09, -0.16, 2.1, 0.09, 0, 0, 0, 10);
  part.cyl(MAT.iron, 0.065, 0.065, 0.03, -0.16, 0.57, -0.06, 0, 0, 0, 10);
  part.cyl(MAT.iron, 0.12, 0.105, 0.13, 0.1, 0.625, 0.04, 0, 0, 0, 12); // stew pot
  part.at(MAT.iron, new THREE.TorusGeometry(0.11, 0.008, 4, 12, Math.PI), 0.1, 0.69, 0.04);
  part.ball(MAT.tin, 0.075, 0.12, 0.62, -0.14, 1, 0.85, 1, 10); // kettle
  part.rod(MAT.tin, V(0.17, 0.63, -0.14), V(0.26, 0.69, -0.14), 0.014, 5, 0.009);
  for (let i = 0; i < 7; i++) { // split wood, stacked aft of the slab
    const row = i < 4 ? 0 : 1, col = row ? i - 4 : i;
    part.cyl(i % 3 ? MAT.wood : MAT.woodPale, 0.05, 0.05, 0.4, -0.56, 0.05 + row * 0.095, -0.2 + col * 0.105 + row * 0.05, 0, 0, HALF_PI, 7);
  }
  const group = part.build('firebox');
  group.position.set(-0.55, DECK, 1.05);
  group.rotation.y = Math.PI + 0.55; // door looks aft and outboard: the paddler's back gets the warmth
  const fire = new THREE.Object3D(), chimney = new THREE.Object3D();
  fire.position.set(0.5, 0.36, 0);
  chimney.position.set(-0.16, 2.16, 0.09);
  group.add(fire, chimney);
  return { group, fire, chimney };
}

function flags(random) {
  const group = new THREE.Group();
  const k = new Kit();
  // stern post carries the backstay bunting
  const post = V(RACK_AFT - 0.04, 2.1, 0.4);
  k.rod(MAT.woodDark, V(RACK_AFT + 0.02, RACK_Y, 0.4), post, 0.022, 6, 0.016);
  k.box(MAT.iron, 0.1, 0.1, 0.014, RACK_AFT + 0.02, RACK_Y + 0.1, 0.44);
  k.bolt(MAT.tin, RACK_AFT + 0.02, RACK_Y + 0.13, 0.452, 'z', 0.016);
  k.bolt(MAT.tin, RACK_AFT + 0.02, RACK_Y + 0.07, 0.452, 'z', 0.016);
  const from = V(MAST_X, MAST_TOP - 0.12, 0);
  const cloths = [MAT.flagRed, MAT.flagCream, MAT.flagTeal, MAT.flagMustard];
  const line = [];
  const n = 11, along = new THREE.Vector3().subVectors(post, from).normalize();
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = new THREE.Vector3().lerpVectors(from, post, t);
    p.y -= Math.sin(Math.PI * t) * 0.34; // slack
    line.push(p);
    if (i > 0 && i < n) {
      const lean = (random() - 0.5) * 0.5, drop = 0.3 + random() * 0.06;
      k.geo(cloths[i % 4], meshFrom([p.x - along.x * 0.12, p.y - along.y * 0.12, p.z, p.x + along.x * 0.12, p.y + along.y * 0.12, p.z, p.x + lean * 0.1, p.y - drop, p.z + lean * 0.22], [0, 1, 2]));
    }
  }
  k.tube(MAT.rope, line, 0.007, 4, 30);
  // festoon bulbs from the masthead to the lantern crook
  const bulbFrom = V(MAST_X, MAST_TOP - 0.3, 0), bulbTo = V(2.56, 2.36, 0), wire = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, p = new THREE.Vector3().lerpVectors(bulbFrom, bulbTo, t);
    p.y -= Math.sin(Math.PI * t) * 0.28;
    wire.push(p);
    if (i > 0 && i < 8) {
      k.rod(MAT.iron, p, V(p.x, p.y - 0.05, p.z), 0.006, 3);
      k.ball(MAT.bulb, 0.036, p.x, p.y - 0.08, p.z, 1, 1.2, 1, 8);
    }
  }
  k.tube(MAT.iron, wire, 0.005, 3, 24);
  group.add(k.build('flags'));

  // masthead pennant, waved on the CPU
  const geometry = new THREE.PlaneGeometry(0.86, 0.46, 12, 4);
  geometry.translate(0.43, 0, 0);
  const rest = geometry.attributes.position.array.slice();
  const pennant = new THREE.Mesh(geometry, MAT.flagMustard);
  pennant.position.set(MAST_X, MAST_TOP + 0.36, 0);
  pennant.rotation.y = Math.PI - SAIL_ANGLE;
  const staff = new Kit();
  staff.rod(MAT.woodPale, V(MAST_X, MAST_TOP, 0), V(MAST_X, MAST_TOP + 0.64, 0), 0.014, 5);
  group.add(pennant, staff.build('staff'));
  const wave = (time) => {
    const array = geometry.attributes.position.array;
    for (let i = 0; i < array.length; i += 3) {
      const x = rest[i], y = rest[i + 1], reach = x / 0.86;
      array[i + 2] = (Math.sin(x * 8.5 - time * 6.5) * 0.075 + Math.sin(x * 3.1 - time * 2.8) * 0.06) * reach;
      array[i + 1] = y - reach * reach * 0.12 + Math.sin(x * 6 - time * 5) * 0.02 * reach;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  return { group, wave };
}

export function buildAttachments() {
  const random = mulberry32(5);
  const group = new THREE.Group();
  const parts = {};
  const add = (name, object) => {
    parts[name] = object;
    group.add(object);
  };
  const beaconMaterial = MAT.beacon.clone();
  const sail = mastAndSail(), helm = rudder(), lamp = lanternMast(), tent = canopy(), stove = firebox(), bunting = flags(random);
  add('outriggers', outriggers(random));
  add('mastAndSail', sail.group);
  add('rudder', helm.group);
  add('cargoRack', cargoRack());
  add('lanternMast', lamp.group);
  add('canopyTent', tent.group);
  add('rainCatcher', rainCatcher());
  add('radioAntenna', antenna(beaconMaterial));
  add('smoker', smoker());
  add('salvageWinch', winch());
  add('fishingRig', fishingRig());
  add('workbench', workbench());
  add('planterBoxes', planters(random));
  add('firebox', stove.group);
  add('flags', bunting.group);

  let rudderAngle = 0;
  return {
    group,
    parts,
    anchors: { lantern: lamp.anchor, fire: stove.fire, canopy: tent.anchor, chimney: stove.chimney },
    update(dt, time, drive, speed, swing) {
      lamp.hang.rotation.z = swing * 1.3;
      rudderAngle += (-drive.steer * 0.5 - rudderAngle) * Math.min(1, dt * 5);
      helm.pivot.rotation.y = rudderAngle;
      sail.pivot.rotation.y = Math.sin(time * 0.45) * 0.035 + Math.sin(time * 1.1) * 0.01;
      bunting.wave(time);
      const blink = Math.sin(time * 2.1) > 0.82 ? 1 : 0.06;
      beaconMaterial.color.setRGB(4.2 * blink, 0.4 * blink, 0.28 * blink);
    },
  };
}
