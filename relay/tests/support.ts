/** Runs the real Worker locally (wrangler's local mode, workerd) and dials it with real WebSockets. */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { RELAY_PROTOCOL } from '../src/room.ts';

const RELAY_FOLDER = `${import.meta.dirname}/../`;

export interface LocalRelay {
  port: number;
  stop(): Promise<void>;
}

/** Start `wrangler dev` on a port of its own. Not detached: it dies with the test run. */
export async function startRelay(port: number, vars: Record<string, string> = {}): Promise<LocalRelay> {
  const args = [
    'dev', '--cwd', RELAY_FOLDER, '--port', String(port), '--inspector-port', String(port + 500), '--show-interactive-dev-session=false',
    '--persist-to', `${RELAY_FOLDER}.wrangler/test-${port}`,
    ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
  ];
  const child: ChildProcess = spawn(`${RELAY_FOLDER}node_modules/.bin/wrangler`, args, {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`wrangler dev stopped early:\n${output}`);
    try {
      const answer = await fetch(`http://localhost:${port}/health`);
      if (answer.ok) return { port, stop };
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`wrangler dev did not answer on ${port}:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export interface Dialed {
  socket: WebSocket;
  /** Every frame received, parsed. */
  frames: unknown[];
  /** Resolves when the socket is open, or rejects if the handshake was refused. */
  opened: Promise<void>;
  /** Resolves with the close code and reason. A refused handshake closes with 1006. */
  closed: Promise<{ code: number; reason: string }>;
  send(frame: unknown): void;
  /** Wait until `count` frames have arrived. */
  until(count: number, milliseconds?: number): Promise<void>;
  /** Wait for the relay to let this socket go, and give its reason. */
  letGo(milliseconds?: number): Promise<{ code: number; reason: string }>;
}

export interface DialOptions {
  key?: string;
  origin?: string | null;
  path?: string;
  protocols?: string[];
}

export function dial(port: number, code: string, role: string, options: DialOptions = {}): Dialed {
  const protocols = options.protocols ?? [RELAY_PROTOCOL, ...(options.key ? [`k.${options.key}`] : [])];
  const origin = options.origin === undefined ? 'http://localhost:5222' : options.origin;
  // Node's WebSocket takes headers beside the protocols: a browser sets Origin by itself.
  const init = { protocols, headers: origin === null ? {} : { Origin: origin } };
  const socket = new WebSocket(`ws://localhost:${port}${options.path ?? ''}/room/${code}?role=${role}`, init as unknown as string[]);
  const frames: unknown[] = [];
  const waiting: (() => void)[] = [];
  socket.addEventListener('message', (event) => {
    frames.push(JSON.parse(String(event.data)));
    for (const wake of waiting.splice(0)) wake();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }));
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('the handshake was refused')));
  });
  opened.catch(() => {});
  const waitFor = async (met: () => boolean, milliseconds: number, what: string): Promise<void> => {
    const deadline = Date.now() + milliseconds;
    while (!met()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`waited for ${what}, got ${frames.length} frames: ${JSON.stringify(frames).slice(0, 400)}`);
      await Promise.race([new Promise<void>((resolve) => waiting.push(resolve)), new Promise((resolve) => setTimeout(resolve, left))]);
    }
  };
  const bye = (): { code: number; reason: string } | undefined =>
    frames.find((frame) => (frame as { relay?: unknown }).relay === 'bye') as { code: number; reason: string } | undefined;
  return {
    socket, frames, opened, closed,
    send: (frame) => socket.send(typeof frame === 'string' ? frame : JSON.stringify(frame)),
    until: (count, milliseconds = 5000) => waitFor(() => frames.length >= count, milliseconds, `${count} frames`),
    async letGo(milliseconds = 5000): Promise<{ code: number; reason: string }> {
      await waitFor(() => bye() !== undefined, milliseconds, 'the relay to let go');
      const { code, reason } = bye()!;
      socket.close();
      return { code, reason };
    },
  };
}

export const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** A room code nobody else in this run uses. */
let codeCount = 0;
export function freshCode(): string {
  const alphabet = 'FHJKLMQRTWXY34679';
  let number = (Date.now() % 1_000_000) * 100 + (codeCount += 1);
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[number % alphabet.length];
    number = Math.floor(number / alphabet.length);
  }
  return code;
}
