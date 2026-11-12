/**
 * Browser boot. Everything that touches the DOM lives here or in
 * `look/` and `interface/`: it builds the world view, the UI and the sound, hands
 * them to the app, forwards keys and the mouse, and starts the frame loop.
 *
 * The look comes from `createWorldView()` in `look/index.ts` and the menus from
 * `createGameInterface()` in `interface/index.ts`. Both implement the
 * contracts in `client/contracts.ts`. This file never changes for a new look.
 */
import { createAudioEngine } from './audio/index.ts';
import { createApp } from './client/app.ts';
import { createSilentAudio } from './client/contracts.ts';
import type { AudioEngine } from './client/contracts.ts';
import { parseDebugParameters } from './client/debug/parameters.ts';
import { createGameInterface } from './interface/index.ts';
import { createWorldView } from './look/index.ts';
import { setLocalPlayerId } from './look/crew.ts';
import { createFrameLoop } from './client/loop.ts';
import type { FrameLoop } from './client/loop.ts';
import type { SessionStorage } from './client/session.ts';
import { hostTabRoom, joinTabRoom } from './net/index.ts';

/** Storage that forgets. The debug switches play in it, so real saves are never touched. */
function createMemoryStorage(): SessionStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

/** `localStorage`, or memory when the browser blocks it. */
function browserStorage(): SessionStorage {
  try {
    window.localStorage.getItem('portage.probe');
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * This browser's secret for a room and a name: the same one every time, so
 * closing the window and joining again gets the same player back.
 */
function crewKey(room: string, name: string): string {
  const slot = `portage.crew.key.${room}.${name}`;
  try {
    const kept = window.localStorage.getItem(slot);
    if (kept) return kept;
    const made = randomHex(16);
    window.localStorage.setItem(slot, made);
    return made;
  } catch {
    return randomHex(16);
  }
}

/** The real sound engine, or silence if it cannot be built. The game never fails for want of sound. */
function createAudio(): AudioEngine {
  try {
    return createAudioEngine();
  } catch (error) {
    console.error('Portage: sound is off, the audio engine could not start.', error);
    return createSilentAudio();
  }
}

function boot(): void {
  const worldElement = document.querySelector<HTMLElement>('#world');
  const interfaceElement = document.querySelector<HTMLElement>('#interface');
  if (!worldElement || !interfaceElement) throw new Error('index.html is missing #world or #interface');

  const parameters = parseDebugParameters(window.location.search);
  // `?perf=1`: the performance readout. It plays in a storage that forgets, so saves and settings are never touched.
  const perf = new URLSearchParams(window.location.search).get('perf') === '1';
  const worldView = createWorldView();
  const gameInterface = createGameInterface();
  const audio = createAudio();
  let loop: FrameLoop | null = null;

  const app = createApp({
    worldView,
    gameInterface,
    audio,
    storage: parameters.sandbox || perf ? createMemoryStorage() : browserStorage(),
    stats: () => loop?.stats ?? { framesPerSecond: 0, frameMilliseconds: 0, workMilliseconds: 0 },
    forceFrameRate: parameters.showFrameRate,
  });
  const session = app.session;
  // The look draws its camera, prompts and marks for the player this screen plays. A guest learns who that is from the host.
  setLocalPlayerId(session.localPlayerId);
  session.subscribe((signal) => {
    if (signal.type === 'game_started') setLocalPlayerId(session.localPlayerId);
  });

  // `?host=ROOM`: every game this session plays is open to the other tabs of this site.
  if (parameters.host !== null) {
    const roomName = parameters.host;
    let room: { close(): void } | null = null;
    session.playerName = parameters.name;
    session.onShare = (link) => {
      room?.close();
      room = hostTabRoom(roomName, (transport) => link.accept(transport));
    };
  }

  worldView.mount(worldElement);
  gameInterface.mount(interfaceElement, (intent) => session.handleIntent(intent));

  const resize = (): void => worldView.resize(worldElement.clientWidth, worldElement.clientHeight, window.devicePixelRatio || 1);
  new ResizeObserver(resize).observe(worldElement);
  resize();

  // --- Keys -------------------------------------------------------------------
  const typingInControl = (event: KeyboardEvent): boolean =>
    event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;

  window.addEventListener('keydown', (event) => {
    void audio.unlock();
    // Leave browser shortcuts alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const capturing = session.input.capture !== null;
    // A focused slider or picker keeps its own keys, except Esc.
    if (typingInControl(event) && !capturing && event.code !== 'Escape') return;
    if (session.input.handlesKey(event.code)) event.preventDefault();
    session.keyDown(event.code, event.repeat);
  });
  window.addEventListener('keyup', (event) => session.keyUp(event.code));
  window.addEventListener('blur', () => session.blur());
  // A hidden tab gets no display frames. A host goes on for its guests on a worker's tick instead.
  let ticker: Worker | null = null;
  let tickerFallback: number | null = null;
  let lastTick = 0;
  const tickUnseen = (): void => {
    const now = performance.now();
    const seconds = Math.min(Math.max(now - lastTick, 0) / 1000, 0.25);
    lastTick = now;
    if (document.hidden && session.host && session.crewed) app.frameUnseen(seconds);
  };
  const stopTicker = (): void => {
    ticker?.terminate();
    ticker = null;
    if (tickerFallback !== null) window.clearInterval(tickerFallback);
    tickerFallback = null;
  };
  const startTicker = (): void => {
    stopTicker();
    lastTick = performance.now();
    // If the worker cannot start, the page's own timer still ticks, slowly.
    const fallBack = (): void => {
      ticker = null;
      tickerFallback ??= window.setInterval(tickUnseen, 250);
    };
    try {
      ticker = new Worker(new URL('./client/ticker.worker.ts', import.meta.url), { type: 'module' });
      ticker.onmessage = tickUnseen;
      ticker.onerror = fallBack;
    } catch {
      fallBack();
    }
  };
  const followVisibility = (): void => {
    app.setHidden(document.hidden);
    if (document.hidden && session.host) startTicker();
    else stopTicker();
  };
  document.addEventListener('visibilitychange', followVisibility);
  window.addEventListener('pagehide', () => session.pageClosing());

  // --- Mouse: drag on the world to orbit, wheel to zoom ---------------------------
  worldElement.addEventListener('pointerdown', (event) => {
    void audio.unlock();
    worldElement.setPointerCapture(event.pointerId);
    session.input.pointerDown();
  });
  worldElement.addEventListener('pointermove', (event) => session.input.pointerMove(event.movementX, event.movementY));
  const release = (): void => session.input.pointerUp();
  worldElement.addEventListener('pointerup', release);
  worldElement.addEventListener('pointercancel', release);
  worldElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    session.input.wheel(event.deltaY);
  }, { passive: false });
  worldElement.addEventListener('contextmenu', (event) => event.preventDefault());

  // --- Loop -------------------------------------------------------------------
  loop = createFrameLoop({
    clock: {
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      now: () => performance.now(),
    },
    frame: (frameSeconds) => app.frame(frameSeconds),
    frameRateCap: () => session.settings.graphics.fpsCap,
  });

  const start = (): void => {
    // A handle for the console and for browser tests.
    (window as unknown as { portage: unknown }).portage = { app, session, worldView, loop, followVisibility };
    loop?.start();
    if (perf) void import('./client/debug/index.ts').then((debug) => debug.runPerfReadout(app, worldView, loop));
    // `?join=ROOM&name=...`: ask the host tab for a seat. The lobby shows until it answers.
    if (parameters.join !== null) {
      session.joinGame(joinTabRoom(parameters.join, randomHex(8)), { name: parameters.name, key: crewKey(parameters.join, parameters.name) });
    }
  };

  if (parameters.sandbox || parameters.speed !== 1) {
    void import('./client/debug/index.ts').then((debug) => {
      debug.applyDebugParameters(app, parameters);
      start();
    });
  } else {
    start();
  }
}

boot();
