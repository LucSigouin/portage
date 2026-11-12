/**
 * A guest's own walking, answered at once and never guessed twice.
 *
 * The guest counts its own steps of 1/60 s and keeps what it held on each: its
 * walk, a list of stretches ("from step 812: forward, running, camera at
 * 1.3"). It sends the last few stretches with every input.
 *
 * - The host (`WalkTimeline`) walks the guest through that list one step for
 *   each step of its own, through the rules, and never faster. It takes no
 *   position from anyone. With each state it says how many of the guest's
 *   steps it has walked.
 * - The guest (`WalkPredictor`) starts from where the host last had it and
 *   runs the same on-foot rule over the steps the host has not walked yet.
 *   Same start, same steps, same rule: the same place, so there is nothing to
 *   put right when the answer comes. Where the two do differ (a stretch lost
 *   on the line, the host dropping a backlog), the figure is eased onto the
 *   truth; a big difference is a cut.
 *
 * No DOM in here, and nothing here changes the guest's copy of the truth.
 */
import { TUNING } from '../data/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, groundHeight, stepOnFoot } from '../sim/index.ts';
import type { GameState, PlayerId, PlayerState, StepInput, Vector3 } from '../sim/index.ts';

/** What a player on foot held over a stretch of steps. Standing still is all zeros, whatever the camera did. */
export interface Walk {
  moveX: number;
  moveY: number;
  run: boolean;
  /** The camera bearing the movement is relative to. */
  yaw: number;
}

/** A stretch of a guest's walk: `start` is the first step it covers; it lasts until the next stretch begins. */
export interface WalkRun extends Walk {
  start: number;
}

/** A stretch on the wire: `[start, moveX, moveY, run (0 or 1), yaw]`. */
export type WireRun = [start: number, moveX: number, moveY: number, run: number, yaw: number];

/** Stretches sent with each input: the newest and the ones before it, so one lost message loses nothing. */
export const WALK_RUNS_SENT = 6;
/** A guest walks at most this many steps ahead of what the host has confirmed (1.5 s). Past that it stands and waits. */
export const WALK_AHEAD_STEPS = 90;
/** The host keeps at most this many unwalked steps of a guest's walk (2 s). More is a backlog nobody should watch play out. */
export const WALK_BACKLOG_STEPS = 120;
/** A difference between guess and truth is eased out over about this long. */
export const WALK_EASE_SECONDS = 0.1;
/** A difference bigger than this is not a slip, the rules moved the player: show the new place at once. */
export const WALK_CUT_METRES = 1.5;
/** While walking, easing may take at most this share of a frame's own movement, so the figure never backs up against the keys. */
const EASE_SHARE_OF_MOVEMENT = 0.6;
/** Stretches a walk keeps. */
const RUNS_KEPT = 256;

const STILL: Walk = Object.freeze({ moveX: 0, moveY: 0, run: false, yaw: 0 });

export const isStill = (walk: Walk): boolean => walk.moveX === 0 && walk.moveY === 0;

const sameWalk = (first: Walk, second: Walk): boolean =>
  first.moveX === second.moveX && first.moveY === second.moveY && first.run === second.run && first.yaw === second.yaw;

/** The walking in an input. Not moving (the rules' own threshold), or not `allowed` to: standing still. */
export function walkOf(input: Pick<StepInput, 'moveX' | 'moveY' | 'run' | 'cameraYaw'>, allowed = true): Walk {
  if (!allowed || !(Math.hypot(input.moveX, input.moveY) > 0.01)) return STILL;
  return { moveX: input.moveX, moveY: input.moveY, run: input.run, yaw: input.cameraYaw };
}

/** The input the rules are handed for one step of a walk. */
export function inputOfWalk(walk: Walk): StepInput {
  return { ...NEUTRAL_INPUT, moveX: walk.moveX, moveY: walk.moveY, run: walk.run, cameraYaw: walk.yaw };
}

/** A stretch from the wire: five numbers, the axes clamped, standing still made plain. Null when it is anything else. */
export function readWalkRun(raw: unknown): WireRun | null {
  if (!Array.isArray(raw) || raw.length !== 5) return null;
  const [start, moveX, moveY, run, yaw] = raw as unknown[];
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) return null;
  if (typeof moveX !== 'number' || typeof moveY !== 'number' || typeof yaw !== 'number') return null;
  if (!Number.isFinite(moveX) || !Number.isFinite(moveY) || !Number.isFinite(yaw) || Math.abs(yaw) > 1e6) return null;
  if (run !== 0 && run !== 1) return null;
  const clamp = (value: number): number => Math.max(-1, Math.min(1, value));
  const walk = walkOf({ moveX: clamp(moveX), moveY: clamp(moveY), run: run === 1, cameraYaw: yaw });
  return [start, walk.moveX, walk.moveY, walk.run ? 1 : 0, walk.yaw];
}

/** A walk: stretches in step order. */
export class WalkStream {
  runs: WalkRun[] = [];

  /** What was held on this step. Before the first stretch known: standing still. */
  at(step: number): Walk {
    for (let index = this.runs.length - 1; index >= 0; index -= 1) {
      if (this.runs[index]!.start <= step) return this.runs[index]!;
    }
    return STILL;
  }

  /** The first step after `step` on which something else was held, or `limit` when nothing changes before it. */
  nextChange(step: number, limit: number): number {
    for (const run of this.runs) {
      if (run.start > step) return Math.min(run.start, limit);
    }
    return limit;
  }

  /** True when any step from `from` up to but not `to` moves the player. */
  movesBetween(from: number, to: number): boolean {
    for (let step = from; step < to; step = this.nextChange(step, to)) {
      if (!isStill(this.at(step))) return true;
    }
    return false;
  }

  /** Keep a stretch. One that begins where a stretch already begins is not taken: what was said first stands. */
  add(run: WalkRun): void {
    let index = this.runs.length;
    while (index > 0 && this.runs[index - 1]!.start > run.start) index -= 1;
    if (index > 0 && this.runs[index - 1]!.start === run.start) return;
    this.runs.splice(index, 0, run);
    if (this.runs.length > RUNS_KEPT) this.runs.shift();
  }

  /** Forget the stretches that ended before `step`. */
  dropBefore(step: number): void {
    while (this.runs.length > 1 && this.runs[1]!.start <= step) this.runs.shift();
  }
}

// --- The host's side ---------------------------------------------------------

/**
 * One guest's walk as the host follows it. The host steps the rules; this
 * says what the guest held on the next step of its walk, and counts the steps
 * walked. A guest gets one step of its walk for each step of the host, so it
 * cannot walk faster than the rules; where its walk has not arrived yet it
 * stands, and steps it stood still on are passed over to catch up.
 */
export class WalkTimeline {
  /** The guest's steps the host has walked. */
  walked = 0;
  /** The guest's walk is known for every step below this. */
  known = 0;
  /** Steps of backlog thrown away, ever. Stays 0 on a line that works. */
  dropped = 0;
  private readonly stream = new WalkStream();
  private following = false;
  private tickSeen = 0;

  constructor(tick = 0) {
    this.tickSeen = tick;
  }

  /** An input arrived: the guest has taken `step` steps, and these are its last few stretches. */
  heard(step: number, runs: readonly WireRun[]): void {
    for (const [start, moveX, moveY, run, yaw] of runs) this.stream.add({ start, moveX, moveY, run: run === 1, yaw });
    if (step > this.known) this.known = step;
  }

  /** Count the steps the rules ran since the last look. Call before reading `walked`. */
  account(tick: number): void {
    const ran = tick - this.tickSeen;
    this.tickSeen = tick;
    if (this.following && ran > 0) this.walked += ran;
  }

  /** True when the guest's walk has nothing left to do before its step `at`: every moving step up to it is walked. */
  reached(at: number): boolean {
    return this.walked >= at || (this.known >= at && !this.stream.movesBetween(this.walked, at));
  }

  /**
   * What the guest's player is handed for the host's next step. On foot: the
   * next step of its walk, or undefined (standing) while that has not arrived.
   * Aboard, the walk is not used: it is counted as walked, and `null` says to
   * use the guest's newest input as it is.
   */
  next(onFoot: boolean): StepInput | undefined | null {
    if (!onFoot) {
      this.following = false;
      if (this.known > this.walked) this.walked = this.known;
      return null;
    }
    // Steps the guest stood still on move nobody: pass them over, and the walk is that much less behind.
    while (this.walked < this.known && isStill(this.stream.at(this.walked))) this.walked = this.stream.nextChange(this.walked, this.known);
    if (this.known - this.walked > WALK_BACKLOG_STEPS) {
      this.dropped += this.known - this.walked - WALK_BACKLOG_STEPS;
      this.walked = this.known - WALK_BACKLOG_STEPS;
    }
    this.stream.dropBefore(this.walked);
    this.following = this.walked < this.known;
    return this.following ? inputOfWalk(this.stream.at(this.walked)) : undefined;
  }
}

// --- The guest's side --------------------------------------------------------

/** Where the guest's own figure is drawn. */
export interface WalkShown {
  position: Vector3;
  heading: number;
  running: boolean;
  exerting: boolean;
}

const mayWalk = (player: PlayerState): boolean => player.connected && !player.asleep && player.dialogue === null;

export class WalkPredictor {
  /** Steps taken in this sitting. */
  step = 0;
  /** Where to draw the guest's own figure, or null before it has ever been on foot. Held as it was while the player is aboard. */
  shown: WalkShown | null = null;
  /** Metres the easing moved the figure in the last frame, on top of its own walking. 0 when guess and truth agree. */
  eased = 0;
  /** Metres between the guess and the host's answer the last time an answer came: what there was to put right. */
  slip = 0;
  /** Times the figure was put straight on the host's place, as a cut. */
  cuts = 0;
  readonly stream = new WalkStream();
  private carry = 0;
  /** The guest's player as guessed, after every step taken. Null while the truth has it aboard. */
  private guess: PlayerState | null = null;
  private truth: GameState | null = null;
  private walked = 0;
  /** The rules count the distance walked on the state: the guess counts it on this instead, so the truth is not touched. */
  private sink: GameState | null = null;
  private offsetX = 0;
  private offsetZ = 0;

  /** A new sitting: the count starts over. */
  reset(): void {
    this.step = 0;
    this.stream.runs = [];
    this.carry = 0;
    this.guess = null;
    this.truth = null;
    this.walked = 0;
    this.shown = null;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.eased = 0;
    this.slip = 0;
  }

  /** The last stretches of the walk, for the wire: from the one the host is on, the newest `WALK_RUNS_SENT` at most. */
  wireRuns(): WireRun[] {
    const runs = this.stream.runs;
    let first = Math.max(0, runs.length - WALK_RUNS_SENT);
    while (first < runs.length - 1 && runs[first + 1]!.start <= this.walked) first += 1;
    return runs.slice(first).map((run): WireRun => [run.start, run.moveX, run.moveY, run.run ? 1 : 0, run.yaw]);
  }

  /** True when the newest stretch began at or after `step`: there is something the host has not been sent. */
  changedSince(step: number): boolean {
    const newest = this.stream.runs.at(-1);
    return newest !== undefined && newest.start >= step;
  }

  /** One step of the walk on a player, by the rules' own on-foot step. */
  private walkOne(player: PlayerState, walk: Walk): void {
    if (isStill(walk) || !mayWalk(player)) {
      player.running = false;
      player.exerting = false;
      return;
    }
    stepOnFoot(this.sink!, player, inputOfWalk(walk), FIXED_STEP);
  }

  /**
   * One frame. `truth` is the newest state the host sent and `walked` how many
   * of this guest's steps it had walked by then. `input` is what the keys hold;
   * `allowed` false makes this frame's steps stand still (a talk asked for, the
   * host too far behind). Takes the frame's steps and places the figure.
   */
  advance(frameSeconds: number, input: StepInput, allowed: boolean, truth: GameState, playerId: PlayerId, walked: number): void {
    const me = truth.players.find((player) => player.id === playerId);
    const onFoot = me !== undefined && me.mode === 'foot';
    this.eased = 0;

    // The host's answer: start again from where it has this player, over the steps it has not walked.
    if (truth !== this.truth) {
      this.truth = truth;
      this.walked = Math.max(this.walked, walked);
      this.stream.dropBefore(this.walked);
      const before = this.guess;
      this.guess = null;
      if (onFoot) {
        this.sink = { ...truth, statistics: { ...truth.statistics } };
        const fresh: PlayerState = { ...me, position: { ...me.position } };
        for (let step = this.walked; step < this.step; step += 1) this.walkOne(fresh, this.stream.at(step));
        this.guess = fresh;
        if (before) {
          // Keep the figure where it is drawn, and let the easing below take the difference out.
          const slipX = fresh.position.x - before.position.x;
          const slipZ = fresh.position.z - before.position.z;
          this.slip = Math.hypot(slipX, slipZ);
          this.offsetX -= slipX;
          this.offsetZ -= slipZ;
          if (this.slip > WALK_CUT_METRES || Math.hypot(this.offsetX, this.offsetZ) > WALK_CUT_METRES) {
            this.offsetX = 0;
            this.offsetZ = 0;
            this.cuts += 1;
          }
        } else {
          this.offsetX = 0;
          this.offsetZ = 0;
        }
      }
    }

    // This frame's steps, on whole steps of 1/60 s as the rules take them.
    const free = me !== undefined && me.mode === 'foot' && mayWalk(me);
    const walk = walkOf(input, allowed && free && this.step - this.walked < WALK_AHEAD_STEPS);
    const guess = this.guess;
    const fromX = guess?.position.x ?? 0;
    const fromZ = guess?.position.z ?? 0;
    this.carry += Math.min(frameSeconds, TUNING.maximumFrameSeconds);
    while (this.carry >= FIXED_STEP - 1e-9) {
      this.carry -= FIXED_STEP;
      const newest = this.stream.runs.at(-1);
      if (!newest || !sameWalk(newest, walk)) this.stream.add({ ...walk, start: this.step });
      if (guess && this.step >= this.walked) this.walkOne(guess, walk);
      this.step += 1;
    }
    if (this.carry < 0) this.carry = 0;
    if (!guess) return;

    // Ease out what is left of a difference: quickly when standing, and when walking never by more than a share of the step itself.
    if (this.offsetX !== 0 || this.offsetZ !== 0) {
      const share = 1 - Math.exp(-frameSeconds / WALK_EASE_SECONDS);
      let easeX = this.offsetX * share;
      let easeZ = this.offsetZ * share;
      const movedX = guess.position.x - fromX;
      const movedZ = guess.position.z - fromZ;
      const moved = Math.hypot(movedX, movedZ);
      if (moved > 1e-9) {
        const against = (easeX * movedX + easeZ * movedZ) / moved;
        if (against > EASE_SHARE_OF_MOVEMENT * moved) {
          const scale = EASE_SHARE_OF_MOVEMENT * moved / against;
          easeX *= scale;
          easeZ *= scale;
        }
      }
      // The last half millimetre is not worth a frame.
      if (Math.hypot(this.offsetX - easeX, this.offsetZ - easeZ) < 0.0005) {
        easeX = this.offsetX;
        easeZ = this.offsetZ;
      }
      this.offsetX -= easeX;
      this.offsetZ -= easeZ;
      this.eased = Math.hypot(easeX, easeZ);
    }
    const x = guess.position.x + this.offsetX;
    const z = guess.position.z + this.offsetZ;
    const y = this.offsetX === 0 && this.offsetZ === 0 ? guess.position.y : groundHeight(x, z);
    this.shown = { position: { x, y, z }, heading: guess.heading, running: guess.running, exerting: guess.exerting };
  }
}
