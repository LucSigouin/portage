/**
 * A tick about 60 times a second, from a worker. A hidden tab gets no display
 * frames and its own timers are held back to one a second; a worker's are
 * not. A host uses this to keep the game going for its guests while its tab
 * is in the background. Nothing else runs in here.
 */
setInterval(() => (globalThis as unknown as { postMessage(message: number): void }).postMessage(0), 1000 / 60);
