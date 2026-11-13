/**
 * The Portage relay on Cloudflare: a Worker in front, one Durable Object per
 * room behind it. All it does is pass frames between the sockets of a room
 * (`room.ts`). It reads no game message and logs nothing. On disk it keeps one
 * thing per live room: the idle count, two small values, gone when the room empties.
 *
 * Address: `<anything>/room/<CODE>?role=host|guest`, as a WebSocket. The part
 * before `/room/` is free, so the same Worker answers on its own address and
 * on a route such as `sigouin.net/portage/relay/*`.
 *
 * The door (the Worker) turns away what it can before a room is woken: a page
 * from somewhere else, a bad code, and an address that dials too often
 * (`dial.ts`). Those answers are plain HTTP, and cost no room request.
 *
 * One more address, `<anything>/feedback`, takes a play tester's note and keeps
 * it in a database (`feedback.ts`). It is plain HTTP and has nothing to do with rooms.
 *
 * Sockets are taken with the hibernation API: a room nobody is talking in
 * costs no running time, and comes back from its sockets' attachments. Its
 * memory does not come back: about ten seconds of quiet and it is gone. So
 * the idle count lives in the room's storage and is read on waking.
 */
import { DurableObject } from 'cloudflare:workers';
import { DIAL_WINDOW_SECONDS, TOO_MANY_DIALS, dialKey } from './dial.ts';
import { answerFeedback, isFeedbackPath } from './feedback.ts';
import type { NotesEnv } from './feedback.ts';
import { CLOSE, RELAY_PROTOCOL, ROOM_CODE_PATTERN, RoomLogic, originAllowed } from './room.ts';
import type { IdleCount, SeatRecord, Wire } from './room.ts';

export interface Env extends NotesEnv {
  ROOMS: DurableObjectNamespace<Room>;
  /** Counts dials per address (`dial.ts`). Cloudflare's rate limiting binding: its two numbers are in `wrangler.jsonc`. */
  DIALS?: RateLimit;
  /** Comma-separated origins a connection may come from. `:*` at the end of one allows any port. */
  ALLOWED_ORIGINS: string;
  /** Seconds between looks at a room for the idle cap. */
  IDLE_SWEEP_SECONDS: string;
  /** Which build this is: the commit and when it was uploaded, given by `deploy/deploy-relay.sh`. `local` on this computer. */
  BUILD?: string;
}

const text = (body: string, status: number, more: Record<string, string> = {}): Response =>
  new Response(`${body}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...more } });

/** The build's name as plain text, whatever was handed in. */
const buildName = (env: Env): string => (env.BUILD ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'unknown';

/**
 * True when this address may dial once more. Asking is a look at a count kept
 * beside the Worker: it wakes no room and is no request to one. If the count
 * cannot be asked (the binding is missing, or it fails), the dial is let in:
 * a relay with no limit is better than no relay.
 */
async function mayDial(env: Env, key: string): Promise<boolean> {
  if (!env.DIALS) return true;
  try {
    return (await env.DIALS.limit({ key })).success;
  } catch {
    return true;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // The second line says which build answers, so a deploy can tell the new relay from the old one.
    if (request.method === 'GET' && /(^|\/)health$/.test(url.pathname)) return text(`portage relay: ok\nbuild ${buildName(env)}`, 200);
    // Feedback: a play tester's note, kept for Luc (`feedback.ts`). It wakes no room.
    if (isFeedbackPath(url.pathname)) return answerFeedback(request, env);
    const match = /(?:^|\/)room\/([^/]+)$/.exec(url.pathname);
    if (!match) return text('not found', 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return text('this address takes WebSockets only', 426);
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return text('this page may not use the relay', 403);
    const code = match[1]!;
    if (!ROOM_CODE_PATTERN.test(code)) return text('not a room code', 400);
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((entry) => entry.trim());
    if (!offered.includes(RELAY_PROTOCOL)) return text('this relay speaks another protocol', 400);
    // The dial limit, last at the door: only a dial that would wake a room is counted, and one over the limit
    // wakes none. Cloudflare sets this header itself: a script cannot choose it.
    const key = dialKey(request.headers.get('CF-Connecting-IP'));
    if (key !== null && !(await mayDial(env, key))) return text(TOO_MANY_DIALS, 429, { 'retry-after': String(DIAL_WINDOW_SECONDS) });
    // One object per code: everyone who dials the same code meets in the same room.
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Where the idle count is kept in the room's storage. */
const IDLE_SLOT = 'idle';
const NO_COUNT: IdleCount = { quietSweeps: 0, sawFrame: false };

export class Room extends DurableObject<Env> {
  private readonly logic = new RoomLogic();
  private readonly wires = new Map<WebSocket, Wire>();
  /** The idle count as the storage has it, so it is written only when it changes. */
  private kept: IdleCount = NO_COUNT;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Waking from sleep: the sockets are still open. Each carries what the room knew about it.
    const now = Date.now();
    const sockets = ctx.getWebSockets();
    for (const socket of sockets) {
      const record = socket.deserializeAttachment() as SeatRecord | null;
      if (record) this.logic.restore(this.wire(socket), record, now);
    }
    // The idle count is not on any socket: it is read back from storage before anything else runs here.
    // A room kept only in memory counted from nothing at every look, and a silent one was never closed.
    if (sockets.length > 0) {
      void ctx.blockConcurrencyWhile(async () => {
        const kept = await ctx.storage.get<IdleCount>(IDLE_SLOT);
        if (!kept) return;
        this.logic.restoreIdle(kept);
        this.kept = this.logic.idle;
      });
    }
  }

  /** Write the idle count down, if it is not what the storage already holds. */
  private async keepIdle(): Promise<void> {
    const idle = this.logic.idle;
    if (idle.quietSweeps === this.kept.quietSweeps && idle.sawFrame === this.kept.sawFrame) return;
    this.kept = idle;
    await this.ctx.storage.put(IDLE_SLOT, idle);
  }

  private wire(socket: WebSocket): Wire {
    let wire = this.wires.get(socket);
    if (!wire) {
      wire = {
        send: (frame) => {
          try {
            socket.send(frame);
          } catch {
            // The socket went between two frames. Its close is on its way.
          }
        },
        close: (code, reason) => {
          this.wires.delete(socket);
          try {
            socket.close(code, reason);
          } catch {
            // Already closed.
          }
        },
      };
      this.wires.set(socket, wire);
    }
    return wire;
  }

  private get sweepMilliseconds(): number {
    const seconds = Number(this.env.IDLE_SWEEP_SECONDS);
    return (Number.isFinite(seconds) && seconds > 0 ? seconds : 600) * 1000;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((entry) => entry.trim());
    const key = offered.find((entry) => entry.startsWith('k.'))?.slice(2) ?? null;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const wasEmpty = this.logic.empty;
    // A socket that is turned away is still opened first: a browser can only read the reason from a close.
    const record = this.logic.connect(this.wire(server), url.searchParams.get('role'), key, Date.now());
    if (record) {
      server.serializeAttachment(record);
      if (wasEmpty) {
        // A new room starts with nothing kept: a count left by an earlier one under this code is not its own.
        this.kept = NO_COUNT;
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.setAlarm(Date.now() + this.sweepMilliseconds);
      }
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': RELAY_PROTOCOL } });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      this.gone(socket);
      socket.close(CLOSE.badRequest, 'text-only');
      return;
    }
    this.logic.message(this.wire(socket), message, Date.now());
    // The first frame since the last look is written down, once: the room may sleep before the next look,
    // and a room that forgot the frame would count that look as a quiet one.
    if (!this.logic.empty) await this.keepIdle();
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    this.gone(socket);
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // The runtime had already answered the close.
    }
    await this.rest();
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    this.gone(socket);
    await this.rest();
  }

  private gone(socket: WebSocket): void {
    const wire = this.wires.get(socket);
    if (wire) this.logic.disconnect(wire);
    this.wires.delete(socket);
  }

  /** The last socket left: leave nothing behind, not the count and not even the alarm. */
  private async rest(): Promise<void> {
    if (!this.logic.empty) return;
    this.kept = NO_COUNT;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  override async alarm(): Promise<void> {
    if (!this.logic.sweep()) {
      await this.rest();
      return;
    }
    // The count goes to storage before the room can sleep again: the next look may be a new waking.
    await this.keepIdle();
    await this.ctx.storage.setAlarm(Date.now() + this.sweepMilliseconds);
  }
}
