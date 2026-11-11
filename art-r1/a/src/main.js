// Portage art prototype A, "Cutbank". Wiring only: the look lives in palette / water / sky / canoe / island / ui.
import * as THREE from 'three';
import { createSky } from './sky.js';
import { createWater, Wake, waveHeight } from './water.js';
import { createIsland, bakeGround, GROUND_RECT, SPOTS, ISLE, groundHeight } from './island.js';
import { createCanoe } from './canoe.js';
import { createUI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SHOW_FPS = params.has('fps');

// ---- console watch: the fps chip reports anything that warns or throws
const problems = [];
function report(msg) {
  problems.push(msg.slice(0, 160));
  if (!SHOW_FPS) return;
  let box = document.getElementById('problems');
  if (!box) { box = document.createElement('pre'); box.id = 'problems'; box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 10px;background:#a5261f;color:#fff;font:12px/1.4 monospace;max-width:90vw;white-space:pre-wrap'; document.body.append(box); }
  box.textContent = problems.slice(0, 6).join('\n');
}
for (const k of ['warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { report(k + ': ' + a.map(String).join(' ')); orig(...a); };
}
window.addEventListener('error', (e) => report('throw: ' + e.message + ' @' + String(e.filename).split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => report('reject: ' + String(e.reason)));

// ---- renderer + scene
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = 1, shed = 1, shedTry = null, shedLock = false; // shed: resolution given up to hold 60 fps
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4200);
const sky = createSky(scene, renderer);
const island = createIsland(scene);
const water = createWater(scene, { groundTex: bakeGround(), groundRect: GROUND_RECT, sunDir: sky.sunDir, rings: island.rings });
const wake = new Wake(scene);
const canoe = createCanoe();
scene.add(canoe.root);

const PIXEL_BUDGET = 2.7e6; // about 1440p of shaded pixels, whatever the display density
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  dpr = Math.max(Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / (w * h))) * shed, 0.6);
  if (params.has('res')) dpr = +params.get('res'); // dev: force a render scale
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 50 degrees tall on 16:9 and wider; narrower windows keep the 16:9 width and gain sky + water instead
  camera.fov = w / h >= 16 / 9 ? 50 : (2 * Math.atan(0.829 / (w / h)) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- game state
const S = {
  state: 'lobby', paused: false, beached: false,
  x: 0, z: 0, yaw: 0, speed: 0, turn: 0, effort: 0, phase: 0,
  treadmill: 0, // shot mode: paddle on the spot, let the wake slide away
  orbitYaw: 0, orbitPitch: 0, orbitHold: 0,
  fixedCam: null,
};
const keys = new Set();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const fwd = V(0, 0, -1), right = V(1, 0, 0), tmp = V(0, 0, 0), tmp2 = V(0, 0, 0), camPos = V(0, 0, 0), camLook = V(0, 0, 0), focus = V(0, 0, 0);
const hAt = (x, z, t) => waveHeight(x, z, t) * (Math.min(Math.max(-groundHeight(x, z) - 0.1, 0) / 2.9, 1) * 0.85 + 0.15);

const ui = createUI({
  continue: () => startGame('upgraded'),
  new: () => startGame('starter'),
  resume: () => setPaused(false),
  quit: () => enterLobby(),
});

function placeCanoe(x, z, yaw) { S.x = x; S.z = z; S.yaw = yaw; S.speed = 0; S.turn = 0; S.effort = 0; wake.samples.length = 0; }
function seatPaddler() {
  canoe.tilt.add(canoe.paddler.group);
  canoe.paddler.group.position.copy(canoe.seat);
  canoe.paddler.group.rotation.set(0, 0, 0);
  canoe.paddler.setStanding(false);
  S.beached = false;
}
function beach() {
  placeCanoe(SPOTS.landing.x, SPOTS.landing.z, SPOTS.landingYaw);
  S.beached = true;
  scene.add(canoe.paddler.group);
  const p = SPOTS.stand, c = SPOTS.crate;
  canoe.paddler.group.position.set(p.x, groundHeight(p.x, p.z), p.z);
  canoe.paddler.group.rotation.set(0, Math.atan2(-(c.x - p.x), -(c.z - p.z)) + 0.5, 0);
  canoe.paddler.setStanding(true);
}
function enterLobby() {
  S.state = 'lobby'; S.paused = false; S.treadmill = 0;
  seatPaddler();
  canoe.setMode('upgraded');
  placeCanoe(LOBBY.canoe[0], LOBBY.canoe[1], LOBBY.canoe[2]);
  S.fixedCam = LOBBY.cam;
  ui.setState('lobby'); ui.showHud(false); ui.showPause(false); ui.closePanel(); ui.setPrompt(null);
}
function startGame(mode) {
  S.state = 'play'; S.paused = false; S.treadmill = 0; S.fixedCam = null;
  seatPaddler();
  canoe.setMode(mode);
  placeCanoe(0, 0, 0);
  S.orbitYaw = S.orbitPitch = 0;
  snapCam = true;
  ui.setState('play'); ui.showHud(true); ui.showPause(false); ui.closePanel();
}
function setPaused(v) { S.paused = v; ui.showPause(v); if (!v) ui.closePanel(); }

// ---- fixed compositions
const LOBBY = { canoe: [15.5, -99, 1.62], cam: { pos: [26.2, 2.2, -105.5], look: [5.2, 2.9, -89] } };
const SHOTS = {
  lobby: () => enterLobby(),
  settings: () => { enterLobby(); ui.openPanel('settings', 'Graphics'); },
  play: () => { startGame('starter'); S.treadmill = 2.4; },
  pause: () => { startGame('starter'); S.treadmill = 2.4; setPaused(true); },
  upgraded: () => {
    startGame('upgraded'); ui.showHud(false);
    placeCanoe(-38, -72, 1.607); S.treadmill = 2.2;
    S.fixedCam = { pos: [-46.9, 4.7, -67.05], look: [-38.3, 2.35, -72.1] };
  },
  island: () => {
    startGame('starter'); beach(); ui.setPrompt('Land here');
    const l = SPOTS.landing, d = SPOTS.coveDir;
    S.fixedCam = { pos: [l.x + d.x * 5.8 - d.z * 6.6, 2.7, l.z + d.z * 5.8 + d.x * 6.6], look: [l.x - d.x * 4.4 + d.z * 0.9, 0.95, l.z - d.z * 4.4 - d.x * 0.9] };
  },
};

// ---- input
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (ui.overlayOpen) ui.closePanel();
    else if (S.state === 'play') setPaused(!S.paused);
    return;
  }
  if (S.state !== 'play' || S.paused || ui.overlayOpen) return;
  keys.add(k);
  if (k === 'u') { canoe.setMode(canoe.mode === 'starter' ? 'upgraded' : 'starter'); snapCam = false; }
  if (k === 'e') {
    if (S.beached) { seatPaddler(); placeCanoe(SPOTS.landing.x + SPOTS.coveDir.x * 5, SPOTS.landing.z + SPOTS.coveDir.z * 5, SPOTS.landingYaw + Math.PI); }
    else if (nearLanding()) beach();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => { if (S.state === 'play' && !S.paused) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  S.orbitYaw -= (e.clientX - drag.x) * 0.006;
  S.orbitPitch = Math.min(Math.max(S.orbitPitch + (e.clientY - drag.y) * 0.004, -0.32), 0.9);
  drag.x = e.clientX; drag.y = e.clientY; S.orbitHold = 2.5; S.fixedCam = SHOT ? null : S.fixedCam;
});
canvas.addEventListener('pointerup', () => { drag = null; });
const nearLanding = () => Math.hypot(S.x - SPOTS.landing.x - SPOTS.coveDir.x * 3, S.z - SPOTS.landing.z - SPOTS.coveDir.z * 3) < 13;

// ---- per-frame
let snapCam = true;
let lastPhase = 0;
const drift = V(0, 0, 0), stern = V(0, 0, 0);
function simulate(dt, t) {
  const up = canoe.mode === 'upgraded';
  const live = S.state === 'play' && !S.paused && !S.beached && !ui.overlayOpen;
  let thrust = 0, steer = 0;
  if (live) {
    thrust = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  }
  const top = up ? 4.2 : 3.2;
  S.speed += (thrust * top * (thrust < 0 ? 0.5 : 1) - S.speed) * (1 - Math.exp(-dt * 0.9));
  S.turn += (steer - S.turn) * (1 - Math.exp(-dt * 4));
  S.yaw -= S.turn * dt * (0.5 + 0.3 * Math.min(Math.abs(S.speed) / top, 1));
  fwd.set(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
  right.set(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
  S.x += fwd.x * S.speed * dt; S.z += fwd.z * S.speed * dt;

  const going = S.treadmill > 0 ? 1 : thrust !== 0 || steer !== 0 ? 1 : 0;
  S.effort += (going - S.effort) * (1 - Math.exp(-dt * 5));
  if (S.effort > 0.05) S.phase = (S.phase + dt * 0.78 * (thrust < 0 ? -1 : 1) + 1) % 1;
  const apparent = S.treadmill > 0 ? S.treadmill : S.speed;

  // ride the swell
  let y, pitch, roll;
  if (S.beached) { y = 0.1; pitch = 0.075; roll = 0.045; }
  else {
    const hb = hAt(S.x + fwd.x * 2, S.z + fwd.z * 2, t), hs = hAt(S.x - fwd.x * 2, S.z - fwd.z * 2, t);
    const hr = hAt(S.x + right.x * 0.7, S.z + right.z * 0.7, t), hl = hAt(S.x - right.x * 0.7, S.z - right.z * 0.7, t);
    y = (hb + hs + hr + hl) / 4 + (up ? 0.03 : 0);
    pitch = Math.atan2(hb - hs, 4) * (up ? 0.6 : 1) + Math.sin(S.phase * 6.283) * 0.012 * S.effort;
    roll = Math.atan2(hr - hl, 1.4) * (up ? 0.35 : 0.9) + Math.sin(S.phase * 6.283 + 1) * 0.03 * S.effort * (up ? 0.3 : 1) - S.turn * 0.05;
  }
  canoe.root.position.set(S.x, y, S.z);
  canoe.root.rotation.y = S.yaw;
  const kf = 1 - Math.exp(-dt * 8);
  canoe.tilt.rotation.x += (pitch - canoe.tilt.rotation.x) * kf;
  canoe.tilt.rotation.z += (roll - canoe.tilt.rotation.z) * kf;

  canoe.paddler.update(t, S.phase, S.beached ? 0 : S.effort, steer > 0 ? -1 : steer < 0 ? 1 : canoe.paddler.side);
  canoe.update(t, dt, { turn: S.turn });

  // water: hull cut-outs, foam collars, wake
  const u = water.uniforms;
  u.uSpeed.value = Math.min(Math.abs(apparent) / 3, 1.3);
  u.uHull.value[0].set(S.x, S.z, fwd.x, fwd.z);
  u.uHullDim.value[0].set(2.4, 0.5, 1);
  canoe.floats.forEach(([ox, len, wid], i) => {
    u.uHull.value[i + 1].set(S.x + right.x * ox + fwd.x * -0.2, S.z + right.z * ox + fwd.z * -0.2, fwd.x, fwd.z);
    u.uHullDim.value[i + 1].set(len, wid, up ? 0 : -1);
  });
  stern.set(S.x - fwd.x * 2.3, 0, S.z - fwd.z * 2.3);
  drift.set(-fwd.x * S.treadmill, 0, -fwd.z * S.treadmill);
  wake.update(dt, t, stern, fwd, S.beached ? 0 : apparent, drift, hAt);
  // paddle splash on the catch and the exit
  if (S.effort > 0.5 && !S.beached && ((lastPhase > 0.9 && S.phase < 0.1) || (lastPhase < 0.5 && S.phase >= 0.5))) {
    canoe.paddler.bladeTip(tmp); canoe.paddler.group.localToWorld(tmp);
    for (let i = 0; i < 3; i++) wake.spawn(tmp.x + (Math.random() - 0.5) * 0.4, tmp.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.3, 1.3 + Math.random());
  }
  lastPhase = S.phase;
}

function aimCamera(dt, t) {
  if (S.fixedCam) {
    camPos.fromArray(S.fixedCam.pos); camLook.fromArray(S.fixedCam.look);
    if (!SHOT && S.state === 'lobby') { camPos.x += Math.sin(t * 0.11) * 1.2; camPos.y += Math.sin(t * 0.17) * 0.15; }
    camera.position.copy(camPos); camera.lookAt(camLook);
    focus.copy(camLook);
    return;
  }
  const up = canoe.mode === 'upgraded';
  const dist = up ? 13.5 : 8.4, height = up ? 5.6 : 3.5, ahead = up ? 4 : 3.2, lookY = up ? 1.2 : 0.5;
  if (S.orbitHold > 0) S.orbitHold -= dt;
  else if (!drag && Math.abs(S.speed) > 0.4) { const k = 1 - Math.exp(-dt * 1.5); S.orbitYaw -= S.orbitYaw * k; S.orbitPitch -= S.orbitPitch * k; }
  const r = Math.hypot(dist, height), elev = Math.min(Math.max(Math.atan2(height, dist) + S.orbitPitch, 0.06), 1.35), a = S.yaw + S.orbitYaw;
  tmp.set(S.x + Math.sin(a) * Math.cos(elev) * r, Math.max(Math.sin(elev) * r, 0.7), S.z + Math.cos(a) * Math.cos(elev) * r);
  const la = ahead * Math.max(Math.cos(S.orbitYaw), 0);
  tmp2.set(S.x + fwd.x * la, lookY, S.z + fwd.z * la);
  const k = snapCam ? 1 : 1 - Math.exp(-dt * 5);
  camPos.lerp(tmp, k); camLook.lerp(tmp2, k);
  snapCam = false;
  camera.position.copy(camPos); camera.lookAt(camLook);
  focus.set(S.x + fwd.x * 24, 0, S.z + fwd.z * 24);
}

// ---- loop
const px1 = new Uint8Array(4);
let last = performance.now(), t0 = last, frames = 0, acc = 0, slow = 0, fpsShown = 0, gpuMs = 0, readyMs = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = (now - t0) / 1000;
  simulate(dt, t);
  aimCamera(dt, t);
  island.update(t, camera);
  sky.update(focus);
  water.update(t, camera);
  if (S.state === 'play') {
    const heading = (-S.yaw * 180) / Math.PI;
    const bearing = (Math.atan2(ISLE.x - S.x, -(ISLE.z - S.z)) * 180) / Math.PI;
    ui.setCompass(heading, bearing, Math.max(Math.hypot(ISLE.x - S.x, ISLE.z - S.z) - 19, 0));
    if (!SHOT) ui.setPrompt(S.beached ? 'Launch canoe' : nearLanding() ? 'Land here' : null);
  }
  renderer.render(scene, camera);
  if (!readyMs) readyMs = performance.now(); // time from navigation to first frame
  if (SHOW_FPS && frames === 7) { const g = renderer.getContext(), a = performance.now(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px1); gpuMs = performance.now() - a; } // rough GPU cost of one frame

  frames++; acc += dt;
  if (acc >= 0.5) {
    const ms = (acc / frames) * 1000;
    fpsShown = Math.round(1000 / ms);
    // hold 60: shed pixels if the frame budget is blown for a while
    // Hold 60 by shedding pixels, but only if fewer pixels actually buys time back.
    if (t > 4 && !shedLock) {
      if (shedTry) {
        if (--shedTry.wait <= 0) {
          if (ms > shedTry.before * 0.88) { shed = shedTry.prev; shedLock = true; resize(); } // no gain: the GPU is not our bottleneck
          shedTry = null; slow = 0;
        }
      } else if (ms > 19.5 && shed > 0.71) {
        if (++slow >= 6) { shedTry = { prev: shed, before: ms, wait: 4 }; shed -= 0.15; resize(); }
      } else slow = 0;
    }
    if (SHOW_FPS) {
      const i = renderer.info.render;
      ui.setFps(`${fpsShown} fps  ${ms.toFixed(1)} ms  gpu ${gpuMs.toFixed(1)}\n${i.calls} draws  ${(i.triangles / 1000).toFixed(0)}k tris  x${dpr.toFixed(2)}\n${problems.length ? problems.length + ' console: ' + problems[0] : `console clean, ready ${(readyMs / 1000).toFixed(2)} s`}`, problems.length);
    }
    frames = 0; acc = 0;
  }
}

(SHOTS[SHOT] || SHOTS.lobby)();
if (params.has('start')) startGame(params.get('start')); // dev: ?start=starter&hold=w,d drives the canoe hands-free
if (params.has('hold')) params.get('hold').split(',').forEach((k) => keys.add(k));
if (params.has('panel')) ui.openPanel(params.get('panel'), params.get('tab')); // dev: ?panel=settings&tab=Controls
if (params.has('cam')) { const c = params.get('cam').split(',').map(Number); S.fixedCam = { pos: c.slice(0, 3), look: c.slice(3, 6) }; } // dev: ?cam=x,y,z,lx,ly,lz
requestAnimationFrame(frame);
