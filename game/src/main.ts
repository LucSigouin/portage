/**
 * Browser boot. Everything that touches the DOM lives here or in
 * `client/greybox/`: it builds the world view, the UI and the sound, hands
 * them to the app, forwards keys and the mouse, and starts the frame loop.
 *
 * To swap in the real look, replace `GreyboxWorldView` and
 * `GreyboxInterface` below with the art round's implementations of the
 * contracts in `client/contracts.ts`.
 */
import { createAudioEngine } from './audio/index.ts';
import { createApp } from './client/app.ts';
import { createSilentAudio } from './client/contracts.ts';
import type { AudioEngine } from './client/contracts.ts';
import { parseDebugParameters } from './client/debug/parameters.ts';
import { GreyboxInterface } from './client/greybox/interface.ts';
import { GreyboxWorldView } from './client/greybox/world-view.ts';
import { createFrameLoop } from './client/loop.ts';
import type { FrameLoop } from './client/loop.ts';
import type { SessionStorage } from './client/session.ts';

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
  const worldView = new GreyboxWorldView();
  const gameInterface = new GreyboxInterface();
  const audio = createAudio();
  let loop: FrameLoop | null = null;

  const app = createApp({
    worldView,
    gameInterface,
    audio,
    storage: parameters.sandbox ? createMemoryStorage() : browserStorage(),
    stats: () => loop?.stats ?? { framesPerSecond: 0, frameMilliseconds: 0, workMilliseconds: 0 },
    forceFrameRate: parameters.showFrameRate,
  });
  const session = app.session;

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
  document.addEventListener('visibilitychange', () => app.setHidden(document.hidden));
  window.addEventListener('pagehide', () => void session.saveNow());

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
    (window as unknown as { portage: unknown }).portage = { app, session, worldView };
    loop?.start();
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
