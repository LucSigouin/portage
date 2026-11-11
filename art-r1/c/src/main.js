// Portage, art round one, variant C: Blue Hour. Boot, game loop, input, camera and the shot URLs.
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import './ui/theme.css';

import * as THREE from 'three';
import { installAtmosphere } from './palette.js';
import { createSky, createLights, createMist } from './sky.js';
import { createWater, createWake, waveHeight } from './water.js';
import { createCanoe, SEAT } from './canoe.js';
import { buildAttachments } from './attachments.js';
import { createIsland } from './island.js';
import { createLandmarks, STEEPLE } from './landmarks.js';
import { ISLAND } from './terrain.js';
import { createPost, makeHalo, createMotes, createEmbers, createSmoke } from './fx.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';
import { clamp, damp, lerp } from './util.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const numbers = (name) => (params.get(name) || '').split(',').map(Number).filter((n) => !Number.isNaN(n));

// ---------------------------------------------------------------- problems surface on screen with &debug=1
const problems = [];
const ui = document.getElementById('ui');
const report = (kind, args) => {
  problems.push(`${kind}: ${args.map((a) => (a && a.stack) || (a && a.message) || String(a)).join(' ')}`.slice(0, 600));
  if (!params.has('debug')) return;
  let box = ui.querySelector('.debug');
  if (!box) ui.appendChild((box = Object.assign(document.createElement('div'), { className: 'debug' })));
  box.textContent = problems.slice(-8).join('\n');
};
for (const kind of ['error', 'warn']) {
  const original = console[kind].bind(console);
  console[kind] = (...args) => {
    report(kind, args);
    original(...args);
  };
}
window.addEventListener('error', (event) => report('uncaught', [event.error || event.message]));
window.addEventListener('unhandledrejection', (event) => report('rejection', [event.reason]));

// ---------------------------------------------------------------- renderer and world
installAtmosphere();
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 1); // density is the mist multiplier read by the custom fog chunk
const camera = new THREE.PerspectiveCamera(38, 1, 0.25, 6000);
camera.layers.enable(1);

const sky = createSky(scene);
const lights = createLights(scene);
const mist = createMist(scene);
const island = createIsland(scene);
createLandmarks(scene);
const water = createWater(renderer, scene, island.shore);
const wake = createWake(scene, water.rippleTexture);
const canoe = createCanoe(buildAttachments);
scene.add(canoe.root);
const post = createPost(renderer, scene, camera);

// halos and smoke ride on the lamps and the stovepipe
canoe.lights.lantern.add(makeHalo(2.3, 1.0, 0.52, 0.17, 0.9));
const anchors = canoe.upgrade.anchors;
anchors.lantern.add(makeHalo(1.25, 1.0, 0.52, 0.17, 0.7));
anchors.canopy.add(makeHalo(0.9, 1.0, 0.55, 0.2, 0.28));
anchors.fire.add(makeHalo(1.3, 1.0, 0.36, 0.1, 0.45));
canoe.paddler.lanternAnchor.add(makeHalo(1.5, 1.0, 0.52, 0.17, 0.55));
const embers = createEmbers();
const smoke = createSmoke(9);
anchors.chimney.add(embers.points, smoke.group);
const smokerSmoke = createSmoke(5, [0.36, 0.4, 0.55]);
smokerSmoke.group.position.set(-0.7, 2.07, -1.56);
canoe.upgrade.group.add(smokerSmoke.group);

const motes = createMotes(scene, island.loot, [
  [ISLAND.x - 2.5, 0.3, ISLAND.z + 12.6, 12, 3.5], [ISLAND.x + 10.5, 0.3, ISLAND.z + 10.4, 14, 3.5], [ISLAND.x - 10.5, 0.3, ISLAND.z + 10.8, 10, 3.5],
  [ISLAND.x + 6, 0.8, ISLAND.z + 7.5, 12, 5], [ISLAND.x - 15, 0.6, ISLAND.z + 11, 9, 4], [ISLAND.x + 15, 0.3, ISLAND.z + 1.5, 8, 3],
  [6, 0.5, -12, 8, 9], [-8, 0.5, -26, 7, 9],
]);

// ---------------------------------------------------------------- interface
const vignette = Object.assign(document.createElement('div'), { className: 'vignette' });
ui.appendChild(vignette);
const hud = createHud(ui);
const fpsBox = Object.assign(document.createElement('div'), { className: 'fps caps', hidden: params.get('fps') !== '1' });
ui.appendChild(fpsBox);
const boot = Object.assign(document.createElement('div'), { className: 'boot' });

const settings = { resolution: 1, fov: 38 };
const menus = createMenus(ui, {
  onAction(action) {
    game.shot = null; // a click takes over from a staged shot
    if (action === 'continue') startPlay(true);
    else if (action === 'new') startPlay(false);
    else if (action === 'resume') setPaused(false);
    else if (action === 'quit') enterLobby();
  },
  onSetting(key, value) {
    if (key === 'fog') scene.fog.density = water.uniforms.uFog.value = wake.material.uniforms.uFog.value = value / 100;
    else if (key === 'reflections') water.uniforms.uReflOn.value = value ? 1 : 0;
    else if (key === 'bloom') post.bloom.strength = (value / 100) * 0.7;
    else if (key === 'motes') motes.points.visible = embers.points.visible = value;
    else if (key === 'fps') fpsBox.hidden = !value;
    else if (key === 'fov') settings.fov = value;
    else if (key === 'resolution') { settings.resolution = value / 100; resize(); }
    else if (key === 'uiScale') document.documentElement.style.setProperty('--ui-scale', value / 100);
    else if (key === 'night') renderer.toneMappingExposure = 1.02 * (value / 100);
  },
});
ui.appendChild(boot);

// ---------------------------------------------------------------- game state
const game = {
  mode: 'lobby', paused: false, ashore: false, shot: null,
  x: 0, z: 0, heading: Math.PI / 2, speed: 0, yawRate: 0,
  orbitYaw: 0, orbitPitch: 0, dragging: false, snapCamera: true,
  cruise: 0, loopAfter: 0, travelled: 0,
  camera: 'chase', // 'chase' | 'fixed' | 'rel'
  fixed: { position: new THREE.Vector3(), look: new THREE.Vector3(), fov: 38 },
  rel: [-8.5, 4.8, 8.1, 0.5, 2.2, -0.15, 35], // forward, up, starboard offsets, then look offsets, fov
};
const keys = new Set();
const LOBBY = { canoe: [19.3, -25.5, 62], camera: [26.5, 1.25, -17.2], look: [-2, 2.4, -45], fov: 34 };
const BEACH = { x: ISLAND.x + 4.9, z: ISLAND.z + 13.15, heading: 97 };

function placeCanoe(x, z, headingDegrees) {
  game.x = x;
  game.z = z;
  game.heading = (headingDegrees * Math.PI) / 180;
  game.speed = game.yawRate = 0;
  wake.clear();
}
function setFixedCamera(position, look, fov) {
  game.camera = 'fixed';
  game.fixed.position.fromArray(position);
  game.fixed.look.fromArray(look);
  game.fixed.fov = fov;
  game.snapCamera = true;
}
function setAshore(ashore) {
  game.ashore = ashore;
  const paddler = canoe.paddler;
  paddler.setStanding(ashore);
  if (ashore) {
    placeCanoe(BEACH.x, BEACH.z, BEACH.heading);
    const spot = island.spots.stand, crate = island.spots.crate;
    scene.add(paddler.group);
    paddler.group.position.set(spot.x, spot.y + 0.815, spot.z);
    paddler.group.rotation.set(0, Math.atan2(-(crate.z - spot.z), crate.x - spot.x), 0);
    setFixedCamera([ISLAND.x + 12.6, 2.05, ISLAND.z + 14.4], [ISLAND.x + 3.4, 0.95, ISLAND.z + 6.6], 42);
  } else {
    canoe.body.add(paddler.group);
    paddler.group.position.set(SEAT.x, SEAT.y, 0);
    paddler.group.rotation.set(0, 0, 0);
    game.camera = 'chase';
  }
}
function setPaused(paused) {
  game.paused = paused;
  menus.close();
  menus.showPause(paused);
  hud.setVisible(!paused && game.mode === 'play' && game.shot !== 'upgraded');
}
function enterLobby() {
  game.mode = 'lobby';
  if (game.ashore) setAshore(false);
  setPaused(false);
  canoe.setUpgraded(false);
  placeCanoe(...LOBBY.canoe);
  game.cruise = 0;
  setFixedCamera(LOBBY.camera, LOBBY.look, LOBBY.fov);
  menus.showLobby(true);
  hud.setVisible(false);
}
function startPlay(upgraded) {
  game.mode = 'play';
  if (game.ashore) setAshore(false);
  canoe.setUpgraded(upgraded);
  placeCanoe(0, 0, 90);
  game.cruise = 0;
  game.camera = 'chase';
  game.orbitYaw = game.orbitPitch = 0;
  menus.close();
  menus.showLobby(false);
  hud.setVisible(true);
}

const SHOTS = {
  lobby() { enterLobby(); },
  settings() { enterLobby(); menus.open('settings', 'Graphics'); },
  play() { startPlay(false); cruise(1.55, 9); },
  upgraded() {
    startPlay(true);
    hud.setVisible(false);
    placeCanoe(-2, -12, 60);
    game.camera = 'rel';
    cruise(1.25, 9);
  },
  island() { startPlay(false); setAshore(true); },
  pause() {
    startPlay(false);
    cruise(1.55, 9);
    for (let i = 0; i < 50; i++) simulate(1 / 60, i / 60); // freeze mid-stroke, not in the rest pose
    setPaused(true);
  },
};
function cruise(speed, seconds) {
  game.cruise = speed;
  game.speed = speed;
  game.loopAfter = speed * seconds;
  game.travelled = 0;
  game.snapCamera = true;
  wake.setWidth(canoe.upgraded ? 2.45 : 0.36);
  wake.prewarm(game.x + Math.cos(game.heading) * 1.3, game.z - Math.sin(game.heading) * 1.3, game.heading, speed, 0);
}

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey) return;
  if (menus.key(event)) return;
  const key = event.key.toLowerCase();
  if (key === 'escape' && game.mode === 'play') return setPaused(!game.paused);
  if (game.mode !== 'play' || game.paused || event.repeat) return keys.add(key);
  if (key === 'u' && !game.ashore) {
    canoe.setUpgraded(!canoe.upgraded);
    wake.clear();
  }
  if (key === 'e' && !game.shot) {
    const near = Math.hypot(game.x - BEACH.x, game.z - BEACH.z) < 18;
    if (game.ashore) {
      setAshore(false);
      placeCanoe(BEACH.x + 0.5, BEACH.z + 4, -83);
    } else if (near) setAshore(true);
  }
  return keys.add(key);
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', (event) => {
  if (game.mode !== 'play' || game.paused || game.camera !== 'chase') return;
  game.dragging = true;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!game.dragging) return;
  game.orbitYaw -= event.movementX * 0.0052;
  game.orbitPitch = clamp(game.orbitPitch + event.movementY * 0.004, -0.2, 0.75);
});
const endDrag = () => { game.dragging = false; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
const held = (...names) => names.some((name) => keys.has(name));

// ---------------------------------------------------------------- sizing
let pixelRatio = 1, autoScale = 1, failedAt = 2;
const FIXED_RATIO = Number(params.get('res')) || 0, LOAD = Number(params.get('load')) || 1; // dev: pin resolution, multiply GPU work
function resize() {
  const width = window.innerWidth, height = window.innerHeight;
  // internal resolution: up to 1.25x CSS pixels, never more than ~1200 lines (the DOM HUD stays native-sharp)
  const base = Math.min(window.devicePixelRatio || 1, 1.25, Math.max(1150 / height, 1));
  pixelRatio = FIXED_RATIO || Math.max(base * settings.resolution * autoScale, 0.6);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  post.setSize(width, height, pixelRatio);
  water.setSize(width * pixelRatio, height * pixelRatio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- per-frame
const forward = new THREE.Vector3(), right = new THREE.Vector3(), cameraGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3(), look = new THREE.Vector3();
const scratch = new THREE.Vector3(), drive = { thrust: 0, steer: 0 }, smokeDrift = new THREE.Vector3();
const LAMP = [1.0, 0.56, 0.2], FIRE = [1.0, 0.36, 0.1];
let bowRing = 0;

function simulate(dt, time) {
  drive.thrust = drive.steer = 0;
  if (game.mode === 'play' && !game.ashore) {
    if (game.cruise) {
      drive.thrust = 1;
      game.speed = game.cruise;
    } else {
      drive.thrust = (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0);
      drive.steer = (held('d', 'arrowright') ? 1 : 0) - (held('a', 'arrowleft') ? 1 : 0);
      const top = (canoe.upgraded ? 3.1 : 2.5) * (drive.thrust < 0 ? 0.5 : 1);
      game.speed += (drive.thrust * top - game.speed) * damp(drive.thrust ? 0.85 : 0.4, dt);
      game.yawRate += (-drive.steer * (0.42 + 0.14 * Math.abs(game.speed)) - game.yawRate) * damp(3, dt);
      game.heading += game.yawRate * dt;
      if (!game.dragging && Math.abs(game.speed) > 0.3) game.orbitYaw *= 1 - damp(0.5, dt);
    }
    const step = game.speed * dt;
    game.x += Math.cos(game.heading) * step;
    game.z -= Math.sin(game.heading) * step;
    if (game.cruise) {
      game.travelled += step;
      if (game.travelled > game.loopAfter) { // shot loop: slide canoe and wake back together
        const dx = -Math.cos(game.heading) * game.travelled, dz = Math.sin(game.heading) * game.travelled;
        game.x += dx;
        game.z += dz;
        wake.shift(dx, dz);
        game.travelled = 0;
        game.snapCamera = true;
      }
    }
  }
  const stroke = canoe.update(dt, time, drive, game.speed);
  if (stroke) {
    scratch.copy(canoe.paddler.state.tip);
    canoe.paddler.group.localToWorld(scratch);
    water.addRing(scratch.x, scratch.z, stroke === 'catch' ? 1 : 0.6);
  }
  bowRing -= dt * Math.abs(game.speed);
  if (bowRing < 0 && Math.abs(game.speed) > 0.4) {
    bowRing = 1.5;
    water.addRing(game.x + forward.x * 2.2, game.z + forward.z * 2.2, 0.35);
  }
}

function poseCanoe(time) {
  forward.set(Math.cos(game.heading), 0, -Math.sin(game.heading));
  right.set(Math.sin(game.heading), 0, Math.cos(game.heading));
  canoe.root.position.set(game.x, 0, game.z);
  canoe.root.rotation.y = game.heading;
  if (game.ashore) {
    canoe.body.position.y = 0.05;
    canoe.body.rotation.set(0.1, 0, 0.055);
    return;
  }
  const reach = 1.9, beam = canoe.upgraded ? 2.2 : 0.8;
  const bow = waveHeight(game.x + forward.x * reach, game.z + forward.z * reach, time), stern = waveHeight(game.x - forward.x * reach, game.z - forward.z * reach, time);
  const star = waveHeight(game.x + right.x * beam, game.z + right.z * beam, time), port = waveHeight(game.x - right.x * beam, game.z - right.z * beam, time);
  const stroke = canoe.paddler.state, lean = Math.sin(stroke.phase * Math.PI * 2) * 0.022 * stroke.effort * stroke.side;
  canoe.body.position.y = (bow + stern + star + port) / 4 - (canoe.upgraded ? 0.01 : 0.045);
  canoe.body.rotation.set(-Math.atan2(star - port, beam * 2) * 0.9 + (canoe.upgraded ? lean * 0.3 : lean + 0.03), 0, Math.atan2(bow - stern, reach * 2) * 0.9 + game.speed * 0.006);
}

function poseCamera(dt) {
  let fov = settings.fov;
  if (game.camera === 'fixed') {
    cameraGoal.copy(game.fixed.position);
    lookGoal.copy(game.fixed.look);
    fov = game.fixed.fov;
  } else if (game.camera === 'rel') {
    const [f, u, r, lf, lu, lr, relFov] = game.rel;
    cameraGoal.set(game.x, u, game.z).addScaledVector(forward, f).addScaledVector(right, r);
    lookGoal.set(game.x, lu, game.z).addScaledVector(forward, lf).addScaledVector(right, lr);
    fov = relFov;
  } else {
    const distance = canoe.upgraded ? 14 : 9, pitch = clamp((canoe.upgraded ? 0.3 : 0.27) + game.orbitPitch, 0.06, 1.0);
    const yaw = game.heading + game.orbitYaw;
    scratch.set(-Math.cos(yaw), 0, Math.sin(yaw)); // from canoe toward the camera
    cameraGoal.set(game.x, 0.1 + distance * Math.tan(pitch), game.z).addScaledVector(scratch, distance);
    lookGoal.set(game.x, 0, game.z).addScaledVector(scratch, -(canoe.upgraded ? 13 : 9.2));
  }
  const cam = numbers('cam');
  if (cam.length >= 6) {
    cameraGoal.set(cam[0], cam[1], cam[2]);
    lookGoal.set(cam[3], cam[4], cam[5]);
    fov = cam[6] || fov;
  }
  const blend = game.snapCamera ? 1 : damp(game.camera === 'chase' ? 5 : 2.2, dt);
  camera.position.lerp(cameraGoal, blend);
  look.lerp(lookGoal, blend);
  game.snapCamera = false;
  camera.position.y = Math.max(camera.position.y, 0.45);
  camera.lookAt(look);
  // Shots are framed for 16:9. In a narrower window keep the horizontal view and let the frame grow taller.
  if (camera.aspect < 16 / 9) fov = (Math.atan((Math.tan((fov * Math.PI) / 360) * (16 / 9)) / camera.aspect) * 360) / Math.PI;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = lerp(camera.fov, fov, blend);
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

function poseLights(time) {
  const flicker = 1 + Math.sin(time * 13.7) * 0.05 + Math.sin(time * 7.3 + 1) * 0.04 + Math.sin(time * 23.1) * 0.025;
  const slots = [
    [canoe.lights.lantern, LAMP, canoe.upgraded ? 10 : 11],
    game.ashore ? [canoe.paddler.lanternAnchor, LAMP, 4.2] : [canoe.lights.fire, FIRE, 7],
    [canoe.lights.canopy, LAMP, 1.8],
  ];
  slots.forEach(([anchor, tint, power], i) => {
    const light = lights.points[i], colour = water.uniforms.uLightCol.value[i];
    if (!anchor) {
      light.intensity = 0;
      colour.set(0, 0, 0);
      return;
    }
    anchor.getWorldPosition(light.position);
    const wobble = i === 1 && !game.ashore ? 1 + (flicker - 1) * 2.4 : flicker;
    light.intensity = power * wobble;
    light.color.setRGB(tint[0], tint[1], tint[2]);
    water.uniforms.uLightPos.value[i].copy(light.position);
    colour.set(tint[0], tint[1], tint[2]).multiplyScalar(power * wobble * 0.08);
  });
  wake.material.uniforms.uLamp.value.copy(lights.points[0].position);
  wake.material.uniforms.uWarm.value.copy(water.uniforms.uLightCol.value[0]);
}

const projected = new THREE.Vector3();
function poseHud() {
  camera.getWorldDirection(scratch);
  const heading = (Math.atan2(scratch.x, -scratch.z) * 180) / Math.PI;
  const bearing = (x, z) => ({ bearing: (Math.atan2(x - game.x, -(z - game.z)) * 180) / Math.PI, distance: Math.hypot(x - game.x, z - game.z) });
  hud.setCompass(heading, game.ashore ? null : bearing(island.spots.landing.x, island.spots.landing.z), bearing(STEEPLE.x, STEEPLE.z));
  const offShore = Math.hypot(game.x - BEACH.x, game.z - BEACH.z);
  hud.setPrompt(game.ashore ? (game.shot ? 'Land here' : 'Push off') : offShore < 18 && !game.cruise ? 'Land here' : '');
  const tags = [];
  if (game.ashore) {
    const width = window.innerWidth, height = window.innerHeight;
    for (const item of island.loot) {
      projected.copy(item.position).project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 0.94 || projected.y > 0.62 || item.position.distanceTo(camera.position) > 15) continue;
      tags.push({ id: item.id, label: item.label, x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height - 14 });
    }
  }
  hud.setTags(tags);
}

let firstFrameAt = 0;
let last = performance.now(), time = 0, simTime = 0, frames = 0, slow = 0, steady = 0, fpsSmooth = 60, cpuSmooth = 0, fpsClock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  const dt = Math.min(rawDt, 0.05);
  last = now;
  time += dt;
  frames++;

  if (!game.paused) {
    simTime += dt;
    simulate(dt, time);
  }
  poseCanoe(time);
  poseCamera(dt);
  poseLights(time);

  sky.update(time);
  mist.update(time);
  water.update(time, dt, camera);
  water.uniforms.uCanoe.value.set(game.x, game.z, Math.cos(game.heading), Math.sin(game.heading));
  water.uniforms.uHull.value.set(2.45, 0.5, canoe.upgraded ? 2.3 : 0, game.ashore ? 0 : Math.abs(game.speed));
  wake.setWidth(canoe.upgraded ? 2.45 : 0.36);
  wake.update(simTime, game.x + forward.x * 1.3, game.z + forward.z * 1.3, game.heading, game.speed, (x, z) => waveHeight(x, z, time));

  const pixels = (window.innerHeight * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  motes.uniforms.uTime.value = embers.uniforms.uTime.value = time;
  motes.uniforms.uPixels.value = embers.uniforms.uPixels.value = pixels;
  if (canoe.upgraded) {
    smokeDrift.set(-0.14 - game.speed * 0.1, 0, -0.07);
    smoke.update(time, smokeDrift);
    smokerSmoke.update(time + 3, smokeDrift);
  }
  if (game.mode === 'play') poseHud();

  renderer.info.reset();
  for (let pass = 0; pass < LOAD; pass++) {
    if (water.uniforms.uReflOn.value) {
      motes.uniforms.uMirror.value = 1;
      water.renderReflection(camera);
      motes.uniforms.uMirror.value = 0;
    }
    post.composer.render();
  }
  cpuSmooth = lerp(cpuSmooth, performance.now() - now, 0.05);

  // frame pacing: report, and shed resolution if a machine cannot hold 60
  if (frames === 3) {
    boot.classList.add('gone');
    firstFrameAt = performance.now();
  }
  if (frames === 80) boot.remove();
  fpsSmooth = lerp(fpsSmooth, 1 / Math.max(rawDt, 1e-4), 0.05);
  fpsClock += rawDt;
  if (fpsClock > 0.5 && !fpsBox.hidden) {
    fpsClock = 0;
    const info = renderer.info.render;
    fpsBox.textContent = `${Math.round(fpsSmooth)} fps  ·  ${(1000 / fpsSmooth).toFixed(1)} ms  ·  ${pixelRatio.toFixed(2)}x${params.has('debug') ? `  ·  js ${cpuSmooth.toFixed(1)} ms  ·  ${info.calls} calls  ·  ${Math.round(info.triangles / 1000)}k tris  ·  first frame ${(firstFrameAt / 1000).toFixed(2)} s` : ''}`;
  }
  // Resolution governor. Ignores warm-up and hidden-tab gaps; steps down after a sustained second of
  // missed frames, and creeps back up once things have been smooth for a while.
  if (time > 4 && rawDt < 0.1 && !FIXED_RATIO) {
    if (rawDt > 0.0205) {
      slow += 1;
      steady = 0;
    } else {
      slow = Math.max(slow - 0.25, 0);
      steady += 1;
    }
    if (slow > 45 && autoScale > 0.56) {
      failedAt = autoScale;
      autoScale -= 0.15;
      slow = steady = 0;
      resize();
    } else if (steady > 420 && autoScale < 1 && autoScale + 0.15 < failedAt) {
      autoScale += 0.15;
      slow = steady = 0;
      resize();
    }
  }
}

// ---------------------------------------------------------------- go
resize();
canoe.update(0.001, 0, drive, 0); // pose the paddler once so nothing is ever drawn unposed
game.shot = SHOTS[shotName] ? shotName : null;
(SHOTS[shotName] || SHOTS.lobby)();
// dev: ?do=howto|credits|controls|gameplay|accessibility|audio|upgrade opens a state that otherwise needs a click or key
const todo = params.get('do');
if (todo === 'howto' || todo === 'credits') menus.open(todo);
else if (todo === 'upgrade') canoe.setUpgraded(true);
else if (todo === 'flow') { // smoke test: walk every state change once
  startPlay(true);
  setPaused(true);
  menus.open('settings', 'Controls');
  setPaused(false);
  setAshore(true);
  setAshore(false);
  canoe.setUpgraded(false);
  enterLobby();
  startPlay(false);
}
else if (todo) menus.open('settings', todo[0].toUpperCase() + todo.slice(1));
const rel = numbers('rel');
if (rel.length >= 6) game.rel = rel.length >= 7 ? rel : [...rel, 38];
requestAnimationFrame(frame);
