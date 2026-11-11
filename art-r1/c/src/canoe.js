// The canoe: lofted hull, humble starter fittings, the paddler and the paddle stroke.
import * as THREE from 'three';
import { Kit, V, meshFrom } from './kit.js';
import { MAT } from './palette.js';
import { clamp, lerp, smoothstep, ease, damp } from './util.js';

export const HULL = { L: 4.8, B: 0.94, draft: 0.13, free: 0.24, rise: 0.27, rocker: 0.06 };
export const FLOAT = { L: 4.3, B: 0.5, draft: 0.12, free: 0.17, rise: 0.1, rocker: 0.05 };
export const SEAT = { x: -1.25, y: 0.12 };

const tOf = (u) => Math.abs(2 * u - 1);
const halfBeam = (spec, u) => (spec.B / 2) * Math.pow(1 - Math.pow(Math.min(tOf(u), 0.999), 2.4), 0.8);
const sheer = (spec, u) => spec.free + spec.rise * Math.pow(tOf(u), 3.2);
export const halfBeamAt = (x, spec = HULL) => halfBeam(spec, x / spec.L + 0.5);
export const sheerAt = (x, spec = HULL) => sheer(spec, x / spec.L + 0.5);

/** Point on the hull skin. u: 0 stern .. 1 bow. s: -1 port gunwale, 0 keel, +1 starboard gunwale. */
export function hullPoint(spec, u, s, out = new THREE.Vector3()) {
  const t = tOf(u);
  const top = sheer(spec, u);
  let keel = -spec.draft + spec.rocker * Math.pow(t, 3);
  const stem = smoothstep(0.9, 1, t);
  keel += (top - keel) * stem * stem;
  const a = Math.abs(s);
  return out.set((u - 0.5) * spec.L, keel + (top - keel) * Math.pow(a, 2.6), Math.sign(s) * halfBeam(spec, u) * (1 - Math.pow(1 - a, 2.2)));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
/** Hull point pushed along the outward normal by `offset` metres. */
export function hullFrame(spec, u, s, offset, out = new THREE.Vector3()) {
  hullPoint(spec, u, s, out);
  if (!offset) return out;
  const e = 2e-3, uu = clamp(u, e, 1 - e), ss = clamp(s, -1 + e, 1 - e);
  hullPoint(spec, uu + e, ss, _a).sub(hullPoint(spec, uu - e, ss, _b));
  hullPoint(spec, uu, ss + e, _c).sub(hullPoint(spec, uu, ss - e, _b));
  return out.addScaledVector(_a.cross(_c).normalize(), offset);
}

export function hullSurface(spec, { u0 = 0, u1 = 1, s0 = -1, s1 = 1, nu = 44, ns = 18, offset = 0, flip = false } = {}) {
  const positions = [], uvs = [], indices = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= ns; j++) {
      hullFrame(spec, lerp(u0, u1, i / nu), lerp(s0, s1, j / ns), offset, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / nu, j / ns);
    }
  }
  const row = ns + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < ns; j++) {
      const a = i * row + j, b = a + row, c = a + 1, d = b + 1;
      if (flip) indices.push(a, c, b, c, d, b);
      else indices.push(a, b, c, c, b, d);
    }
  }
  return meshFrom(positions, indices, uvs);
}

/** Flat lid between the gunwales (deck plates, pontoon tops, the water mask). */
export function hullCap(spec, u0, u1, lift = 0, inset = 1, n = 30) {
  const positions = [], indices = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = lerp(u0, u1, i / n);
    for (const s of [-inset, inset]) {
      hullPoint(spec, u, s, p);
      positions.push(p.x, p.y + lift, p.z);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return meshFrom(positions, indices);
}

/** Hull shell with gunwales, stems, ribs, thwarts, seats and end decks. Shared by both canoes. */
function buildHull(kit) {
  kit.geo(MAT.hull, hullSurface(HULL));
  kit.geo(MAT.hullIn, hullSurface(HULL, { offset: -0.014, flip: true, u0: 0.012, u1: 0.988 }));
  for (const side of [-1, 1]) {
    const rail = [];
    for (let i = 0; i <= 40; i++) rail.push(hullPoint(HULL, i / 40, side).add(V(0, 0.012, 0)));
    kit.tube(MAT.wood, rail, 0.026, 6, 90);
  }
  for (const end of [0, 1]) {
    const stem = [];
    for (let i = 0; i <= 8; i++) stem.push(hullPoint(HULL, end ? 0.9 + 0.1 * (i / 8) : 0.1 - 0.1 * (i / 8), 0));
    kit.tube(MAT.wood, stem, 0.021, 6, 24);
    kit.geo(MAT.wood, hullCap(HULL, end ? 0.925 : 0.002, end ? 0.998 : 0.075, 0.02, 1, 6));
  }
  for (let i = 0; i < 13; i++) {
    const u = 0.14 + (0.72 * i) / 12, rib = [];
    for (let j = 0; j <= 10; j++) rib.push(hullFrame(HULL, u, -0.95 + (1.9 * j) / 10, -0.024));
    kit.tube(MAT.woodDark, rib, 0.011, 4, 20);
  }
  for (const u of [0.345, 0.5, 0.685]) {
    const x = (u - 0.5) * HULL.L;
    kit.box(MAT.wood, 0.07, 0.024, halfBeam(HULL, u) * 2, x, sheer(HULL, u) - 0.03, 0);
  }
  for (const u of [0.24, 0.775]) {
    const x = (u - 0.5) * HULL.L, w = halfBeam(HULL, u) * 2 - 0.05;
    kit.box(MAT.woodPale, 0.27, 0.022, w, x, SEAT.y - 0.012, 0);
    kit.box(MAT.woodDark, 0.03, 0.03, w + 0.03, x - 0.12, SEAT.y - 0.03, 0);
    kit.box(MAT.woodDark, 0.03, 0.03, w + 0.03, x + 0.12, SEAT.y - 0.03, 0);
  }
}

/** Hand-made repairs. They stay on the hull for life, so the showpiece is visibly the same boat. */
function buildPatches(kit) {
  const patch = (material, u0, u1, s0, s1, border = true) => {
    if (border) kit.geo(MAT.patchTar, hullSurface(HULL, { u0: u0 - 0.008, u1: u1 + 0.008, s0: s0 - 0.03, s1: s1 + 0.03, nu: 6, ns: 6, offset: 0.004 }));
    kit.geo(material, hullSurface(HULL, { u0, u1, s0, s1, nu: 6, ns: 6, offset: 0.009 }));
  };
  patch(MAT.patchBark, 0.6, 0.7, 0.45, 0.88);
  patch(MAT.patchBark, 0.13, 0.2, -0.86, -0.5);
  patch(MAT.tin, 0.4, 0.47, -0.92, -0.55);
  patch(MAT.tin, 0.82, 0.87, 0.4, 0.8);
  patch(MAT.patchTar, 0.25, 0.31, 0.38, 0.7, false);
  const rivet = new THREE.Vector3();
  for (const [u, s] of [[0.405, -0.9], [0.465, -0.9], [0.405, -0.57], [0.465, -0.57], [0.435, -0.9], [0.435, -0.57], [0.825, 0.42], [0.865, 0.42], [0.825, 0.78], [0.865, 0.78]]) {
    hullFrame(HULL, u, s, 0.012, rivet);
    kit.ball(MAT.iron, 0.011, rivet.x, rivet.y, rivet.z, 1, 1, 1, 6);
  }
  kit.box(MAT.woodPale, 0.5, 0.012, 0.16, 0.15, -0.095, 0.04, 0, 0.12, 0); // sister plank over a cracked rib
}

/** Oil lantern. The glass is an emitter mesh; the caller parents a halo sprite and a point light to `anchor`. */
export function makeLantern(scale = 1) {
  const group = new THREE.Group();
  const kit = new Kit();
  kit.cyl(MAT.iron, 0.062, 0.07, 0.03, 0, -0.105, 0);
  kit.cyl(MAT.iron, 0.03, 0.075, 0.055, 0, 0.075, 0);
  kit.cyl(MAT.iron, 0.022, 0.022, 0.03, 0, 0.115, 0, 0, 0, 0, 8);
  kit.at(MAT.iron, new THREE.TorusGeometry(0.05, 0.007, 5, 14, Math.PI), 0, 0.12, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    kit.rod(MAT.iron, V(Math.cos(a) * 0.06, -0.09, Math.sin(a) * 0.06), V(Math.cos(a) * 0.06, 0.05, Math.sin(a) * 0.06), 0.005, 4);
  }
  kit.cyl(MAT.lampGlass, 0.04, 0.047, 0.13, 0, -0.022, 0);
  group.add(kit.build('lantern'));
  group.scale.setScalar(scale);
  const anchor = new THREE.Object3D();
  anchor.position.y = -0.02;
  group.add(anchor);
  return { group, anchor };
}

// ---------------------------------------------------------------- paddler

const UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(1, 0, 0);
const _d = new THREE.Vector3(), _perp = new THREE.Vector3();

function limbMesh(material, radius) {
  const geometry = new THREE.CylinderGeometry(radius * 0.9, radius, 1, 8);
  geometry.translate(0, 0.5, 0);
  return new THREE.Mesh(geometry, material);
}
function placeLimb(mesh, from, to) {
  _d.subVectors(to, from);
  const length = _d.length();
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
  mesh.scale.set(1, length, 1);
}
function solveElbow(shoulder, hand, pole, upper, fore, out) {
  _d.subVectors(hand, shoulder);
  const reach = Math.min(_d.length(), upper + fore - 0.004);
  _d.normalize();
  const along = (upper * upper - fore * fore + reach * reach) / (2 * reach);
  const lift = Math.sqrt(Math.max(upper * upper - along * along, 0));
  _perp.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  return out.copy(shoulder).addScaledVector(_d, along).addScaledVector(_perp, lift);
}

/**
 * The traveller: mustard coat, red toque, cream scarf. Seated with a paddle, or standing with a hand lantern.
 * Local frame: +x forward, +z right, origin at the hips.
 */
export function createPaddler() {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);

  const body = new Kit();
  body.at(MAT.coat, new THREE.CapsuleGeometry(0.15, 0.27, 6, 14), 0, 0.3, 0, 0, 0, 0, 0.84, 1, 1.14);
  body.cyl(MAT.coat, 0.15, 0.19, 0.16, 0, 0.05, 0, 0, 0, 0, 14);
  body.at(MAT.scarf, new THREE.TorusGeometry(0.086, 0.037, 8, 14), 0, 0.575, 0, Math.PI / 2);
  body.box(MAT.scarf, 0.035, 0.21, 0.085, -0.115, 0.46, 0.05, 0, 0, 0.14);
  body.ball(MAT.skin, 0.1, 0.012, 0.705, 0, 1, 1.05, 0.98, 14);
  body.at(MAT.toque, new THREE.SphereGeometry(0.109, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), 0.004, 0.728, 0);
  body.at(MAT.scarf, new THREE.TorusGeometry(0.101, 0.024, 8, 16), 0.004, 0.727, 0, Math.PI / 2);
  body.ball(MAT.scarf, 0.038, -0.006, 0.848, 0, 1, 1, 1, 8);
  torso.add(body.build('paddler-torso'));

  const seatedKit = new Kit(), standingKit = new Kit();
  for (const side of [-1, 1]) {
    seatedKit.rod(MAT.trousers, V(0.02, 0.03, side * 0.09), V(0.36, 0.1, side * 0.13), 0.068, 8, 0.058);
    seatedKit.rod(MAT.trousers, V(0.36, 0.1, side * 0.13), V(0.5, -0.15, side * 0.12), 0.056, 8, 0.048);
    seatedKit.ball(MAT.trousers, 0.062, 0.36, 0.1, side * 0.13, 1, 1, 1, 8);
    seatedKit.box(MAT.boot, 0.21, 0.085, 0.095, 0.56, -0.185, side * 0.12, 0, 0, 0.15);
    standingKit.rod(MAT.trousers, V(0, 0.02, side * 0.085), V(0.012, -0.4, side * 0.09), 0.072, 8, 0.06);
    standingKit.rod(MAT.trousers, V(0.012, -0.4, side * 0.09), V(0, -0.75, side * 0.09), 0.058, 8, 0.05);
    standingKit.box(MAT.boot, 0.24, 0.1, 0.105, 0.045, -0.765, side * 0.09);
  }
  const seatedLegs = seatedKit.build('legs-seated'), standingLegs = standingKit.build('legs-standing');
  standingLegs.visible = false;
  root.add(seatedLegs, standingLegs);

  const UPPER = 0.3, FORE = 0.28;
  const arms = [-1, 1].map((side) => {
    const arm = {
      side,
      upper: limbMesh(MAT.coat, 0.052),
      fore: limbMesh(MAT.coat, 0.046),
      joints: [0.062, 0.05, 0.052].map((radius, i) => new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), i === 2 ? MAT.toque : MAT.coat)),
      shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), hand: new THREE.Vector3(), pole: new THREE.Vector3(),
    };
    root.add(arm.upper, arm.fore, ...arm.joints);
    return arm;
  });
  const poseArm = (arm, hand) => {
    arm.shoulder.set(0.02, 0.5, arm.side * 0.2).applyMatrix4(torso.matrix);
    arm.hand.copy(hand);
    arm.pole.set(-0.25, -0.75, arm.side * 0.6);
    solveElbow(arm.shoulder, arm.hand, arm.pole, UPPER, FORE, arm.elbow);
    placeLimb(arm.upper, arm.shoulder, arm.elbow);
    placeLimb(arm.fore, arm.elbow, arm.hand);
    arm.joints[0].position.copy(arm.shoulder);
    arm.joints[1].position.copy(arm.elbow);
    arm.joints[2].position.copy(arm.hand);
  };

  // paddle: grip at local origin, shaft along +y, blade width along x
  const paddleKit = new Kit();
  paddleKit.cyl(MAT.woodPale, 0.015, 0.016, 0.94, 0, 0.5, 0, 0, 0, 0, 7);
  paddleKit.box(MAT.woodPale, 0.1, 0.032, 0.03, 0, 0.012, 0);
  const blade = new THREE.Shape();
  blade.moveTo(-0.022, 0.92);
  blade.bezierCurveTo(-0.07, 1.0, -0.095, 1.2, -0.085, 1.34);
  blade.bezierCurveTo(-0.075, 1.44, -0.03, 1.47, 0, 1.47);
  blade.bezierCurveTo(0.03, 1.47, 0.075, 1.44, 0.085, 1.34);
  blade.bezierCurveTo(0.095, 1.2, 0.07, 1.0, 0.022, 0.92);
  paddleKit.at(MAT.wood, new THREE.ExtrudeGeometry(blade, { depth: 0.014, bevelEnabled: false, curveSegments: 8 }), 0, 0, -0.007);
  const paddle = paddleKit.build('paddle');
  paddle.matrixAutoUpdate = false;
  root.add(paddle);
  const PADDLE_LENGTH = 1.47, LOWER_GRIP = 0.6;

  const handLantern = makeLantern(1.15);
  handLantern.group.visible = false;
  root.add(handLantern.group);

  const state = { phase: 0.2, effort: 0, side: 1, sideTarget: 1, standing: false, tip: new THREE.Vector3() };
  const grip = new THREE.Vector3(), tip = new THREE.Vector3(), lower = new THREE.Vector3(), shaft = new THREE.Vector3();
  const wide = new THREE.Vector3(), face = new THREE.Vector3(), idleGrip = new THREE.Vector3(), idleTip = new THREE.Vector3();

  function seatedPose(time) {
    const s = state.side, e = ease(state.effort), p = state.phase;
    let twist = 0, lean;
    if (p < 0.55) {
      const q = ease(p / 0.55), arc = Math.sin(Math.PI * q);
      grip.set(lerp(0.42, 0.14, q), 0.78 - 0.04 * arc, 0.1 * s);
      tip.set(lerp(0.78, -0.42, q), -0.42 - 0.08 * arc, 0.6 * s);
      lean = lerp(0.26, -0.05, q);
    } else {
      const q = ease((p - 0.55) / 0.45), arc = Math.sin(Math.PI * q);
      grip.set(lerp(0.14, 0.42, q), 0.78 - 0.22 * arc, (0.1 - 0.1 * arc) * s);
      tip.set(lerp(-0.42, 0.78, q), -0.42 + 0.62 * arc, (0.6 + 0.45 * arc) * s);
      lean = lerp(-0.05, 0.26, q);
      twist = arc * 1.35;
    }
    const breathe = Math.sin(time * 1.3) * 0.006;
    idleGrip.set(0.4, 0.21 + breathe, -0.5 * s);
    idleTip.set(0.47, 0.17 + breathe, 0.95 * s);
    grip.lerpVectors(idleGrip, grip, e);
    tip.lerpVectors(idleTip, tip, e);

    torso.rotation.set(0, s * 0.16 * e * (0.5 - p), -lean * e - 0.03);
    torso.updateMatrix();

    shaft.subVectors(tip, grip).normalize();
    wide.crossVectors(shaft, FORWARD);
    if (wide.lengthSq() < 1e-4) wide.set(0, 0, 1);
    wide.normalize().applyAxisAngle(shaft, twist * e + (1 - e) * 1.2);
    face.crossVectors(wide, shaft);
    paddle.matrix.makeBasis(wide, shaft, face).setPosition(grip);
    state.tip.copy(grip).addScaledVector(shaft, PADDLE_LENGTH);
    lower.copy(grip).addScaledVector(shaft, LOWER_GRIP);
    const paddleSide = s >= 0 ? 1 : 0;
    poseArm(arms[paddleSide], lower);
    poseArm(arms[1 - paddleSide], grip);
  }

  function standingPose(time) {
    const sway = Math.sin(time * 1.1) * 0.012;
    torso.rotation.set(0, 0.12, -0.05 + sway);
    torso.updateMatrix();
    grip.set(0.46, 0.34 + sway, 0.3); // lantern hand, held out toward the find
    poseArm(arms[1], grip);
    lower.set(0.03, 0.02, -0.25);
    poseArm(arms[0], lower);
    handLantern.group.position.set(grip.x + 0.01, grip.y - 0.2, grip.z);
    handLantern.group.rotation.z = Math.sin(time * 1.6) * 0.07;
  }

  return {
    group: root,
    state,
    lanternAnchor: handLantern.anchor,
    setStanding(standing) {
      state.standing = standing;
      seatedLegs.visible = paddle.visible = !standing;
      standingLegs.visible = handLantern.group.visible = standing;
    },
    /** drive: { thrust -1..1, steer -1..1 }. Returns 'catch' | 'exit' when the blade breaks the surface. */
    update(dt, time, drive) {
      if (state.standing) {
        standingPose(time);
        return null;
      }
      const working = Math.abs(drive.thrust) > 0.05 || Math.abs(drive.steer) > 0.05;
      state.effort += ((working ? 1 : 0) - state.effort) * damp(5, dt);
      if (drive.steer < -0.05) state.sideTarget = 1;
      else if (drive.steer > 0.05) state.sideTarget = -1;
      state.side += (state.sideTarget - state.side) * damp(8, dt);
      const before = state.phase;
      if (working) state.phase = (state.phase + dt * 0.7 * (drive.thrust < -0.05 ? -1 : 1) + 1) % 1;
      seatedPose(time);
      if (!working) return null;
      if (before < 0.08 && state.phase >= 0.08) return 'catch';
      if (before < 0.5 && state.phase >= 0.5) return 'exit';
      return null;
    },
  };
}

// ---------------------------------------------------------------- canoe

export function createCanoe(buildAttachments) {
  const root = new THREE.Group(); // world position + heading
  const body = new THREE.Group(); // bob, pitch, roll
  root.add(body);

  const hullKit = new Kit();
  buildHull(hullKit);
  buildPatches(hullKit);
  body.add(hullKit.build('hull'));

  // Depth-only lid so the lake never shows through the open hull.
  const mask = new THREE.Mesh(hullCap(HULL, 0.004, 0.996, -0.012, 0.985, 40), new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  mask.renderOrder = 1;
  mask.layers.set(1);
  body.add(mask);

  // --- starter fittings: a lantern on a bent stick, a pack, a bailing can, and water in the bilge
  const starter = new THREE.Group();
  const kit = new Kit();
  kit.tube(MAT.woodDark, [V(2.02, 0.45, 0), V(2.1, 0.8, 0.02), V(2.2, 1.06, 0), V(2.42, 1.1, -0.01), V(2.5, 1.06, 0)], 0.017, 6, 24);
  kit.at(MAT.rope, new THREE.TorusGeometry(0.035, 0.012, 5, 10), 2.03, 0.5, 0, Math.PI / 2);
  kit.at(MAT.rope, new THREE.TorusGeometry(0.03, 0.01, 5, 10), 2.09, 0.74, 0.015, Math.PI / 2);
  kit.ball(MAT.canvasShade, 0.2, 1.42, 0.2, 0.02, 1.15, 0.85, 1, 10); // pack on the bow seat
  kit.at(MAT.rope, new THREE.TorusGeometry(0.105, 0.012, 5, 14), 1.42, 0.3, 0.02, Math.PI / 2);
  kit.cyl(MAT.flagRed, 0.07, 0.07, 0.4, 1.36, 0.38, 0.0, Math.PI / 2, 0, 0, 10); // rolled blanket
  kit.cyl(MAT.tin, 0.062, 0.055, 0.13, -0.42, -0.02, 0.12, 0, 0, 1.2, 10); // bailing can, lying where it fell
  kit.at(MAT.rope, new THREE.TorusGeometry(0.12, 0.016, 5, 16), 0.55, -0.075, -0.04, Math.PI / 2);
  kit.at(MAT.rope, new THREE.TorusGeometry(0.1, 0.016, 5, 16), 0.56, -0.05, -0.03, Math.PI / 2);
  starter.add(kit.build('starter-fittings'));

  const bilgePositions = [], bilgeIndices = [];
  const level = -0.035, stations = 24;
  for (let i = 0; i <= stations; i++) {
    const u = 0.17 + (0.66 * i) / stations, t = tOf(u);
    const top = sheer(HULL, u), keel = -HULL.draft + HULL.rocker * Math.pow(t, 3);
    const a = Math.pow(clamp((level - keel) / (top - keel), 0, 1), 1 / 2.6);
    const z = Math.max(halfBeam(HULL, u) * (1 - Math.pow(1 - a, 2.2)) - 0.02, 0);
    bilgePositions.push((u - 0.5) * HULL.L, level, -z, (u - 0.5) * HULL.L, level, z);
    if (i < stations) bilgeIndices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const bilge = new THREE.Mesh(meshFrom(bilgePositions, bilgeIndices), MAT.bilge);
  starter.add(bilge);

  const starterLantern = makeLantern(1.25);
  const starterHang = new THREE.Group();
  starterHang.position.set(2.5, 1.04, 0);
  starterLantern.group.position.y = -0.2;
  starterHang.add(starterLantern.group);
  starter.add(starterHang);
  body.add(starter);

  const upgrade = buildAttachments();
  upgrade.group.visible = false;
  body.add(upgrade.group);

  const paddler = createPaddler();
  paddler.group.position.set(SEAT.x, SEAT.y, 0);
  body.add(paddler.group);

  const canoe = {
    root, body, paddler, upgrade,
    upgraded: false,
    /** Objects whose world positions drive the three warm point lights. */
    lights: { lantern: starterLantern.anchor, fire: null, canopy: null },
    halfBeam: 0.47,
    setUpgraded(on) {
      canoe.upgraded = on;
      upgrade.group.visible = on;
      starterHang.visible = !on;
      bilge.visible = !on;
      canoe.lights.lantern = on ? upgrade.anchors.lantern : starterLantern.anchor;
      canoe.lights.fire = on ? upgrade.anchors.fire : null;
      canoe.lights.canopy = on ? upgrade.anchors.canopy : null;
      canoe.halfBeam = on ? 2.55 : 0.47;
    },
    update(dt, time, drive, speed) {
      const swing = Math.sin(time * 1.9) * 0.05 + Math.sin(time * 0.83) * 0.035 - speed * 0.03;
      starterHang.rotation.z = swing;
      bilge.position.y = Math.sin(time * 1.4) * 0.004;
      bilge.rotation.x = Math.sin(time * 1.1) * 0.012;
      if (canoe.upgraded) upgrade.update(dt, time, drive, speed, swing);
      return paddler.update(dt, time, drive);
    },
  };
  return canoe;
}
