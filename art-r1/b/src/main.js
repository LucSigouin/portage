// Portage — art study B: Ink & Wash. Boot, game loop, shots, input.
import * as THREE from 'three';
import '@fontsource/im-fell-english/latin-400.css';
import '@fontsource/im-fell-english/latin-400-italic.css';
import '@fontsource/kalam/latin-400.css';
import '@fontsource/kalam/latin-700.css';
import { GU } from './palette.js';
import { createPost } from './post.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createIsland } from './island.js';
import { createCanoe } from './canoe.js';
import { createUI } from './ui/ui.js';

// ---- any console error or warning is shown on the page: the build must run clean ----
const problems = [];
function report(kind, args) {
  const msg = `${kind}: ${args.map((a) => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
  problems.push(msg);
  let el = document.getElementById('err');
  if (!el) {
    el = document.createElement('div');
    el.id = 'err';
    document.body.appendChild(el);
  }
  el.textContent = problems.slice(-8).join('\n');
}
for (const k of ['error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    orig(...a);
    report(k, a);
  };
}
window.addEventListener('error', (e) => report('error', [e.error || e.message]));
window.addEventListener('unhandledrejection', (e) => report('rejection', [e.reason]));

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
let showFps = params.has('fps');
const BENCH = params.has('bench');
let benchAcc = 0;
let benchN = 0;
const benchPx = new Uint8Array(4);

// ---- renderer + world ----
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.setClearColor(0xe0e2d8, 1);
const scene = new THREE.Scene();
scene.matrixWorldAutoUpdate = true;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 1700);

const post = createPost(renderer, camera);
const sky = createSky();
scene.add(sky.mesh);
const water = createWater(post.reflection, post.resolution);
scene.add(water.mesh);
const island = createIsland();
scene.add(island.group);
water.setShore(island.shore.texture, island.shore.cx, island.shore.cz, island.shore.sx, island.shore.sz);
const canoe = createCanoe();
scene.add(canoe.group);

// ---- state ----
const S = {
  mode: 'lobby', // lobby | play | pause
  rig: 'lobby', // lobby | chase | beauty | island
  t: 0,
  x: 0,
  z: 0,
  h: 0, // heading, 0 = +z ("north")
  v: 0,
  w: 0,
  hCam: 0,
  phase: 0.2,
  effort: 0,
  side: 1,
  strokes: 0,
  tread: 1.0, // treadmill speed for shots and the lobby (canoe paddles in place)
  auto: true, // paddles by itself
  orbitYaw: 0,
  orbitPitch: 0,
  blend: 1, // camera blend from previous rig
  landed: false,
  labels: true,
  hud: false,
};
const keys = {};
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => x * x * (3 - 2 * x);

// ---- UI ----
const ui = createUI({
  onAction(act) {
    if (act === 'new') startGame(false);
    else if (act === 'continue') startGame(true);
    else if (act === 'settings') ui.open('settings', 'Graphics');
    else if (act === 'howto') ui.open('howto');
    else if (act === 'credits') ui.open('credits');
    else if (act === 'resume') resume();
    else if (act === 'quit') toLobby();
  },
  onSetting(k, v, raw) {
    const u = post.uniforms;
    if (k === 'line') u.uLineW.value = 0.5 + v * 1.6;
    else if (k === 'grain') u.uGrain.value = v / 0.6;
    else if (k === 'hatch') u.uHatch.value = v ? 1 : 0;
    else if (k === 'boil' ) u.uBoil.value = v ? 1 : 0;
    else if (k === 'reduce') { if (v) u.uBoil.value = 0; } // reduce motion only ever stills the boil, never turns it on
    else if (k === 'mist') GU.uFogDensity.value = 0.0016 + v * 0.004;
    else if (k === 'fps') {
      showFps = v;
      if (!v) ui.setFps('');
    } else if (k === 'labels') S.labels = v;
    else if (k === 'text') ui.setTextScale(raw / 100);
    else if (k === 'scale') {
      userScale = raw / 100;
      resize();
    }
  },
});
ui.callout('way', island.waypoint.label, true);
for (const l of island.loot) ui.callout(l.key, l.label);

// ---- rigs ----
const camPos = new THREE.Vector3();
const camTgt = new THREE.Vector3();
const prevPos = new THREE.Vector3();
const prevTgt = new THREE.Vector3();
let prevFov = 50;
let fovT = 50;
const v3 = new THREE.Vector3();

function setRig(rig, instant = false) {
  prevPos.copy(camera.position);
  prevTgt.copy(camTgt);
  prevFov = camera.fov;
  S.rig = rig;
  S.blend = instant ? 1 : 0;
}

function placeLobby() {
  S.x = 0;
  S.z = 0;
  S.h = 0;
  S.hCam = 0;
  S.v = 0;
  S.w = 0;
  S.auto = true;
  S.tread = 1.0;
  S.landed = false;
  canoe.sit();
  canoe.setUpgraded(false);
}

function startGame(upgraded) {
  if (S.landed) canoe.sit();
  S.landed = false;
  canoe.setUpgraded(upgraded);
  S.auto = false;
  S.tread = 0;
  S.orbitYaw = 0;
  S.orbitPitch = 0;
  S.mode = 'play';
  S.hud = true;
  ui.setMode('play');
  ui.showHud(true);
  setRig('chase');
}
function pause() {
  if (S.mode !== 'play') return;
  S.mode = 'pause';
  ui.open('pause');
}
function resume() {
  S.mode = 'play';
  ui.close();
}
function toLobby() {
  ui.close();
  S.mode = 'lobby';
  S.hud = false;
  ui.showHud(false);
  ui.showPrompt(false);
  ui.setMode('lobby');
  placeLobby();
  setRig('lobby');
}
function land() {
  const L = island.landing;
  S.landed = true;
  S.x = L.canoe.x;
  S.z = L.canoe.z;
  S.h = L.canoeHeading;
  S.v = 0;
  S.w = 0;
  setRig('island');
}
function pushOff() {
  S.landed = false;
  canoe.sit();
  const L = island.landing;
  S.x = L.approach.x;
  S.z = L.approach.z - 3;
  S.h = Math.PI;
  S.hCam = Math.PI;
  setRig('chase');
}

// ---- shots: deterministic set-ups, animation still running ----
function applyShot(name) {
  placeLobby();
  if (name === 'lobby' || name === 'settings') {
    S.mode = 'lobby';
    ui.setMode('lobby');
    setRig('lobby', true);
    if (name === 'settings') ui.open('settings', params.get('tab') || 'Graphics');
    else if (params.get('panel')) ui.open(params.get('panel'));
  } else if (name === 'play' || name === 'pause') {
    S.mode = 'play';
    S.hud = true;
    S.tread = 1.7;
    ui.setMode('play');
    ui.showHud(true);
    setRig('chase', true);
    if (name === 'pause') pause();
    if (params.has('up')) canoe.setUpgraded(true);
  } else if (name === 'upgraded') {
    S.mode = 'play';
    S.hud = false;
    S.tread = 1.5;
    S.x = 12;
    S.z = 30;
    S.h = 2.18;
    S.hCam = S.h;
    canoe.setUpgraded(true);
    ui.setMode('play');
    setRig('beauty', true);
  } else if (name === 'island') {
    S.mode = 'play';
    S.hud = true;
    S.auto = false;
    S.tread = 0;
    ui.setMode('play');
    ui.showHud(true);
    land();
    S.blend = 1;
    ui.showPrompt(true, 'Land here');
  }
}

// ---- input ----
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (ui.panel === 'pause') resume();
    else if (ui.panel) ui.close();
    else if (S.mode === 'play') pause();
    return;
  }
  if (S.mode !== 'play' || ui.panel) return;
  keys[k] = true;
  if (k === 'u' && !e.repeat) canoe.setUpgraded(!canoe.upgraded);
  if (k === 'e' && !e.repeat) {
    if (S.landed) pushOff();
    else if (nearLanding()) land();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'play') return;
  drag = { x: e.clientX, y: e.clientY };
  canvas.classList.add('drag');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  S.orbitYaw -= (e.clientX - drag.x) * 0.006;
  S.orbitPitch = Math.min(0.75, Math.max(-0.26, S.orbitPitch + (e.clientY - drag.y) * 0.004));
  drag.x = e.clientX;
  drag.y = e.clientY;
});
const endDrag = () => {
  drag = null;
  canvas.classList.remove('drag');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function nearLanding() {
  const a = island.landing.approach;
  return Math.hypot(S.x - a.x, S.z - a.z) < 13;
}

// ---- sizing, with a simple adaptive scale so the frame holds 60 ----
let userScale = 1;
let autoScale = 1;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // at most ~2.8 million drawn pixels: retina sharpness at 720p, a little under 2x at 1080p
  const cap = Math.sqrt(2.8e6 / (w * h));
  const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2, cap) * userScale * autoScale);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(size.x, size.y);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- frame ----
const fwd = new THREE.Vector3();
const bow = new THREE.Vector3();
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let fpsT = 0;
let slow = 0;
let warm = 0;
let prevPhase = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, rawDt);
  S.t += dt;
  const t = S.t;
  GU.uTime.value = t;
  const playing = S.mode === 'play' && !ui.panel;

  // --- canoe: input -> motion ---
  let thrust = 0;
  let turn = 0;
  if (playing && !S.landed && !S.auto) {
    thrust = keys.w ? 1 : keys.s ? -0.6 : 0;
    turn = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  }
  const wantEffort = S.auto ? 1 : thrust !== 0 || turn !== 0 ? 1 : 0;
  S.effort = lerp(S.effort, S.landed ? 0 : wantEffort, Math.min(1, dt * 4));
  const rate = S.auto ? 0.5 + S.tread * 0.12 : 0.78;
  if (S.mode !== 'pause') {
    prevPhase = S.phase;
    S.phase += dt * rate * (S.effort > 0.3 ? 1 : 0);
    if (S.phase >= 1) {
      S.phase -= 1;
      S.strokes++;
    }
    // which side: steer by paddling on the outside; otherwise switch every third stroke
    if (turn > 0) S.side = -1;
    else if (turn < 0) S.side = 1;
    else if (S.phase < prevPhase && S.strokes % 3 === 0) S.side = -S.side;
  }
  const upg = canoe.upgraded;
  fwd.set(Math.sin(S.h), 0, Math.cos(S.h));
  if (!S.landed) canoe.group.position.set(S.x, 0, S.z); // so the blade lands in the right spot
  const stroke = S.landed ? null : canoe.animate(dt, t, S.phase, S.effort, S.side);
  if (S.landed) {
    canoe.stand(scene, island.landing.stand, island.landing.standYaw, t);
    canoe.upgrades.update(dt, t);
  }
  if (playing && !S.landed && !S.auto) {
    const pulse = stroke ? stroke.pull : 0;
    S.v += thrust * pulse * (upg ? 6.2 : 5.4) * dt;
    if (upg && thrust > 0) S.v += 0.5 * dt; // the sail helps
    S.v -= S.v * 0.55 * dt;
    const wT = turn * (0.55 + Math.min(1, Math.abs(S.v)) * 0.35) * (upg ? 0.8 : 1);
    S.w = lerp(S.w, wT, Math.min(1, dt * 2.5));
    S.h += S.w * dt;
    S.x += fwd.x * S.v * dt;
    S.z += fwd.z * S.v * dt;
  }
  const speed = S.tread > 0 ? S.tread : S.v;

  // splashes where the blade enters and leaves
  if (stroke && S.effort > 0.6 && S.mode !== 'pause') {
    if ((prevPhase < 0.03 && S.phase >= 0.03) || (prevPhase < 0.44 && S.phase >= 0.44)) water.ring(stroke.blade.x, stroke.blade.z, 0.95, 0.9);
    if (prevPhase < 0.2 && S.phase >= 0.2) water.ring(stroke.blade.x, stroke.blade.z, 0.7, 0.6);
  }

  // riding the swell
  const g = canoe.group;
  if (S.landed) {
    g.position.set(S.x, -0.02, S.z);
    g.rotation.set(-0.075, S.h, 0.06, 'YXZ');
  } else {
    const sw = (dx, dz) => water.swell(S.x + dx, S.z + dz, t);
    const hb = sw(fwd.x * 2, fwd.z * 2);
    const hs = sw(-fwd.x * 2, -fwd.z * 2);
    const hl = sw(fwd.z * 0.6, -fwd.x * 0.6);
    const hr = sw(-fwd.z * 0.6, fwd.x * 0.6);
    const heave = (hb + hs + hl + hr) / 4;
    const k = upg ? 0.55 : 1;
    const pull = stroke ? stroke.pull : 0;
    g.position.set(S.x, -0.115 + heave * k + (upg ? -0.02 : 0), S.z);
    g.rotation.set(-(hb - hs) / 4 * k - pull * 0.012, S.h, ((hl - hr) / 1.2) * k * 0.6 - S.w * 0.07 + S.side * pull * 0.03 * k, 'YXZ');
  }

  // wake (the treadmill moves the water, not the boat)
  bow.set(S.x + fwd.x * 2.45, 0, S.z + fwd.z * 2.45);
  const dvx = S.tread > 0 ? -fwd.x * S.tread : 0;
  const dvz = S.tread > 0 ? -fwd.z * S.tread : 0;
  if (S.mode !== 'pause') {
    water.uniforms.uDrift.value.x -= dvx * dt;
    water.uniforms.uDrift.value.y -= dvz * dt;
    water.update(dt, bow.x, bow.z, fwd.x, fwd.z, S.landed ? 0 : speed, dvx, dvz, upg ? 3.15 : 0.2);
  }

  // --- camera ---
  S.hCam = lerp(S.hCam, S.h, Math.min(1, dt * 2.2));
  if (S.rig === 'chase') {
    if (!drag && Math.abs(S.v) > 0.4) S.orbitYaw = lerp(S.orbitYaw, 0, Math.min(1, dt * 0.6));
    const d = upg ? 13.5 : 8.9;
    const el = (upg ? 0.33 : 0.255) + S.orbitPitch;
    const az = S.hCam + Math.PI + S.orbitYaw;
    camTgt.set(S.x + Math.sin(S.hCam) * (upg ? 4.5 : 4), upg ? 2.2 : 1.2, S.z + Math.cos(S.hCam) * (upg ? 4.5 : 4));
    camPos.set(S.x + Math.sin(az) * Math.cos(el) * d, 1.0 + Math.sin(el) * d, S.z + Math.cos(az) * Math.cos(el) * d);
    fovT = 50;
  } else if (S.rig === 'lobby') {
    const sway = SHOT ? 0 : Math.sin(t * 0.13);
    camPos.set(-3.3 + sway * 0.5, 1.75 + sway * 0.08, -10.6);
    camTgt.set(3.8, 1.45, 6);
    fovT = 42;
  } else if (S.rig === 'beauty') {
    // set in canoe-local terms: off the +x bow quarter, a little above the gunwales
    const ch = Math.cos(S.h);
    const sh = Math.sin(S.h);
    const loc = (x, y, z, out) => out.set(S.x + x * ch + z * sh, y, S.z - x * sh + z * ch);
    loc(8.9, 5.0, 5.9, camPos);
    loc(0.2, 2.75, -0.2, camTgt);
    fovT = 40;
  } else if (S.rig === 'island') {
    const L = island.landing;
    camPos.set(L.stand.x - 2.3, 2.0, L.stand.z - 8.9);
    camTgt.set(L.stand.x + 1.5, 1.2, L.stand.z + 0.4);
    fovT = 46;
  }
  if (S.blend < 1) {
    S.blend = Math.min(1, S.blend + dt / 1.8);
    const k = ease(S.blend);
    camera.position.lerpVectors(prevPos, camPos, k);
    v3.lerpVectors(prevTgt, camTgt, k);
    camera.fov = lerp(prevFov, fovT, k);
    camera.lookAt(v3);
  } else {
    camera.position.copy(camPos);
    camera.fov = fovT;
    camera.lookAt(camTgt);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  sky.update(camera);
  island.update(t);
  water.follow(camera);

  // --- paper: the lobby leaves the left of the sheet bare; pausing washes the plate back ---
  const u = post.uniforms;
  const inLobby = S.mode === 'lobby';
  const snap = warm < 2;
  const kq = snap ? 1 : Math.min(1, dt * 2.6);
  u.uPaperLeft.value = lerp(u.uPaperLeft.value, inLobby ? 0.4 : 0, kq);
  if (!inLobby && u.uPaperLeft.value < 0.002) u.uPaperLeft.value = 0;
  u.uFrame.value = lerp(u.uFrame.value, inLobby ? 0.03 : 0.013, kq);
  u.uWash.value = lerp(u.uWash.value, ui.panel === 'pause' ? 0.5 : ui.panel ? 0.42 : 0, snap ? 1 : Math.min(1, dt * 5));

  // --- render ---
  const t0 = BENCH ? performance.now() : 0;
  water.renderWake(renderer);
  post.render(scene, camera, water.mesh);
  if (BENCH) {
    // ?bench=1: reading a pixel back blocks until the GPU has finished, so the tag shows the true cost of a frame
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, benchPx);
    benchAcc += performance.now() - t0;
    benchN++;
  }

  // --- HUD bits that track the world ---
  const W = window.innerWidth;
  const H = window.innerHeight;
  const hudOn = S.hud && S.mode !== 'lobby';
  if (hudOn) {
    const wp = island.waypoint.pos;
    ui.setCompass((-S.hCam * 180) / Math.PI, (-Math.atan2(wp.x - S.x, wp.z - S.z) * 180) / Math.PI);
    const near = nearLanding() && !S.landed && S.rig === 'chase';
    if (SHOT !== 'island') ui.showPrompt(near || S.landed, S.landed ? 'Push off' : 'Land here');
  }
  const project = (key, pos, way) => {
    v3.copy(pos).project(camera);
    const dist = camera.position.distanceTo(pos);
    const ok = hudOn && S.labels && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && (way ? dist > 34 && dist < 400 : dist < 130);
    ui.placeCallout(key, (v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H, ok, !way && dist > 30, way ? `${island.waypoint.label} · ${Math.round(Math.max(0, Math.hypot(pos.x - S.x, pos.z - S.z) - 14))} m` : null);
  };
  project('way', island.waypoint.pos, true);
  for (const l of island.loot) project(l.key, l.pos, false);

  // --- frame rate ---
  warm++;
  fpsAcc += rawDt;
  fpsN++;
  fpsT += rawDt;
  if (fpsT > 0.5) {
    const ms = (fpsAcc / fpsN) * 1000;
    if (showFps) ui.setFps(`${Math.round(1000 / ms)} fps · ${ms.toFixed(1)} ms · ${post.resolution.x}×${post.resolution.y}${BENCH ? ` · frame cost ${(benchAcc / Math.max(1, benchN)).toFixed(1)} ms` : ''}`);
    benchAcc = 0;
    benchN = 0;
    if (warm > 180) {
      slow = ms > 20.5 ? slow + 1 : 0;
      if (slow >= 4 && autoScale > 0.72) {
        autoScale -= 0.1;
        slow = 0;
        resize();
      }
    }
    fpsAcc = 0;
    fpsN = 0;
    fpsT = 0;
  }
}

placeLobby();
if (SHOT) applyShot(SHOT);
else {
  ui.setMode('lobby');
  setRig('lobby', true);
}
// ?sim=wa holds those keys from a fresh New Game (handy for checking motion without a keyboard)
if (!SHOT && params.get('sim')) {
  startGame(params.has('up'));
  S.blend = 1;
  for (const c of params.get('sim')) keys[c] = true;
}
if (showFps) ui.setFps('…');
document.fonts?.load('1em "IM Fell English"');
document.fonts?.load('italic 1em "IM Fell English"');
document.fonts?.load('1em "Kalam"');
requestAnimationFrame(frame);
