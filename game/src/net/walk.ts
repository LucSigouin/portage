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
 * Walking eases in and out (`TUNING.foot`): the first few steps after the keys come up still move the player while
 * they slow to a stand. Both sides walk those steps (`COAST_STEPS`), and while the host waits for a guest's walk it
 * holds the player exactly as they are (`HOLD_INPUT`), so the speed agrees as well as the place.
 *
 * A jump is part of the walk: the jump key is held over a stretch like any other (`Walk.jump`), and the same on-foot
 * rule runs it on both sides, so a guest's own jump is on its screen at once and the host's answer finds it where it
 * is. A jump goes on after the key is up (the air, the landing): both sides walk those steps too (`LEAP_TAIL_STEPS`).
 *
 * No DOM in here, and nothing here changes the guest's copy of the truth.
 */
import { TUNING } from '../data/index.ts';
import { FIXED_STEP, LEAP_COAST_STEPS, NEUTRAL_INPUT, groundHeight, stepOnFoot } from '../sim/index.ts';
import type { GameState, Leap, PlayerId, PlayerState, StepInput, Vector3 } from '../sim/index.ts';

/** What a player on foot held over a stretch of steps. Standing still is all zeros, whatever the camera did. */
export interface Walk {
  moveX: number;
  moveY: number;
  run: boolean;
  /** The camera bearing the movement is relative to. */
  yaw: number;
  /** The jump key is down. */
  jump: boolean;
}

/** A stretch of a guest's walk: `start` is the first step it covers; it lasts until the next stretch begins. */
export interface WalkRun extends Walk {
  start: number;
}

/** A stretch on the wire: `[start, moveX, moveY, keys, yaw]`. `keys` is 1 for the run key plus 2 for the jump key. */
export type WireRun = [start: number, moveX: number, moveY: number, keys: number, yaw: number];
const RUN_KEY = 1;
const JUMP_KEY = 2;

/** Stretches sent with each input: the newest and the ones before it, so one lost message loses nothing. */
export const WALK_RUNS_SENT = 6;
/** A guest walks at most this many steps ahead of what the host has confirmed (1.5 s). Past that it stands and waits. */
export const WALK_AHEAD_STEPS = 90;
/** The host keeps at most this many unwalked moving steps of a guest's walk (2 s). More is a backlog nobody should watch play out. */
export const WALK_BACKLOG_STEPS = 120;
/** A difference between guess and truth is eased out over about this long. */
export const WALK_EASE_SECONDS = 0.1;
/** A difference bigger than this is not a slip, the rules moved the player: show the new place at once. */
export const WALK_CUT_METRES = 1.5;
/** While walking, easing may take at most this share of a frame's own movement, so the figure never backs up against the keys. */
const EASE_SHARE_OF_MOVEMENT = 0.6;
/**
 * Still steps after a walk that can still move the player: the longest a run takes to slow to a stand. Both sides
 * walk them one by one; only the still steps after them are passed over.
 */
export const COAST_STEPS = Math.ceil(TUNING.foot.runSpeed / (TUNING.foot.braking * FIXED_STEP));
/**
 * Steps after the jump key comes up on which the jump can still change the player: the rest of the air, the landing,
 * and the slowing to a stand after it. Both sides walk them one by one, whatever else is held.
 */
export const LEAP_TAIL_STEPS = LEAP_COAST_STEPS + COAST_STEPS;
/** What the host hands a guest's player while its walk has not arrived: nothing changes, not even the speed. */
export const HOLD_INPUT: Readonly<StepInput> = Object.freeze({ ...NEUTRAL_INPUT, hold: true });
/** Stretches a walk keeps. */
const RUNS_KEPT = 256;

const STILL: Walk = Object.freeze({ moveX: 0, moveY: 0, run: false, yaw: 0, jump: false });
/** A jump on the spot: the jump key and nothing else. */
const HOP: Walk = Object.freeze({ ...STILL, jump: true });

/** Nothing is held: no way to go and no jump. */
export const isStill = (walk: Walk): boolean => walk.moveX === 0 && walk.moveY === 0 && !walk.jump;

const sameWalk = (first: Walk, second: Walk): boolean =>
  first.moveX === second.moveX && first.moveY === second.moveY && first.run === second.run && first.yaw === second.yaw
  && first.jump === second.jump;

/** The walking in an input. Not moving (the rules' own threshold) and not jumping, or not `allowed` to: standing still. */
export function walkOf(input: Pick<StepInput, 'moveX' | 'moveY' | 'run' | 'cameraYaw' | 'jump'>, allowed = true): Walk {
  if (!allowed) return STILL;
  const jump = input.jump === true;
  if (!(Math.hypot(input.moveX, input.moveY) > 0.01)) return jump ? HOP : STILL;
  return { moveX: input.moveX, moveY: input.moveY, run: input.run, yaw: input.cameraYaw, jump };
}

/** The input the rules are handed for one step of a walk. The jump key is named only when it is down, as the keys name it. */
export function inputOfWalk(walk: Walk): StepInput {
  const input: StepInput = { ...NEUTRAL_INPUT, moveX: walk.moveX, moveY: walk.moveY, run: walk.run, cameraYaw: walk.yaw };
  if (walk.jump) input.jump = true;
  return input;
}

const wireOf = (run: WalkRun): WireRun => [run.start, run.moveX, run.moveY, (run.run ? RUN_KEY : 0) + (run.jump ? JUMP_KEY : 0), run.yaw];

/** A stretch from the wire: five numbers, the axes clamped, standing still made plain. Null when it is anything else. */
export function readWalkRun(raw: unknown): WireRun | null {
  if (!Array.isArray(raw) || raw.length !== 5) return null;
  const [start, moveX, moveY, keys, yaw] = raw as unknown[];
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) return null;
  if (typeof moveX !== 'number' || typeof moveY !== 'number' || typeof yaw !== 'number') return null;
  if (!Number.isFinite(moveX) || !Number.isFinite(moveY) || !Number.isFinite(yaw) || Math.abs(yaw) > 1e6) return null;
  if (keys !== 0 && keys !== RUN_KEY && keys !== JUMP_KEY && keys !== RUN_KEY + JUMP_KEY) return null;
  const clamp = (value: number): number => Math.max(-1, Math.min(1, value));
  const walk = walkOf({ moveX: clamp(moveX), moveY: clamp(moveY), run: (keys & RUN_KEY) !== 0, cameraYaw: yaw, jump: (keys & JUMP_KEY) !== 0 });
  return wireOf({ ...walk, start });
}

/** A walk: stretches in step order. */
export class WalkStream {
  runs: WalkRun[] = [];
  /** After each stretch with the jump key down: the steps on which that jump can still change the player. */
  private tails: { from: number; until: number }[] = [];

  /** What was held on this step. Before the first stretch known: standing still. */
  at(step: number): Walk {
    const index = this.indexAt(step);
    return index < 0 ? STILL : this.runs[index]!;
  }

  /** The stretch this step is in, or -1 before the first one known. */
  private indexAt(step: number): number {
    for (let index = this.runs.length - 1; index >= 0; index -= 1) {
      if (this.runs[index]!.start <= step) return index;
    }
    return -1;
  }

  /**
   * The step after the last one of this still stretch that can move the player (its first `COAST_STEPS`, when a walk
   * came before it, and the steps a jump is still playing out on), or the stretch's start when none can. Only for a
   * step in a still stretch.
   */
  private coastEnd(index: number): number {
    const run = this.runs[index]!;
    let end = index > 0 && !isStill(this.runs[index - 1]!) ? run.start + COAST_STEPS : run.start;
    for (const tail of this.tails) {
      if (tail.from <= run.start && tail.until > end) end = tail.until;
    }
    return end;
  }

  /** True when this step can move the player: something is held, or the player is still slowing from a walk. */
  movesAt(step: number): boolean {
    const index = this.indexAt(step);
    if (index < 0) return false;
    return !isStill(this.runs[index]!) || step < this.coastEnd(index);
  }

  /** The first step after `step` on which something else was held, or `limit` when nothing changes before it. */
  nextChange(step: number, limit: number): number {
    for (const run of this.runs) {
      if (run.start > step) return Math.min(run.start, limit);
    }
    return limit;
  }

  /** True when any step from `from` up to but not `to` moves the player. A still stretch can move them only at its start. */
  movesBetween(from: number, to: number): boolean {
    for (let step = from; step < to; step = this.nextChange(step, to)) {
      if (this.movesAt(step)) return true;
    }
    return false;
  }

  /** How many steps from `from` up to but not `to` can move the player. */
  movingSteps(from: number, to: number): number {
    let count = 0;
    for (let step = from; step < to;) {
      const next = this.nextChange(step, to);
      const index = this.indexAt(step);
      if (index >= 0 && !isStill(this.runs[index]!)) count += next - step;
      else if (index >= 0) count += Math.max(0, Math.min(next, this.coastEnd(index)) - step);
      step = next;
    }
    return count;
  }

  /** Keep a stretch. One that begins where a stretch already begins is not taken: what was said first stands. */
  add(run: WalkRun): void {
    let index = this.runs.length;
    while (index > 0 && this.runs[index - 1]!.start > run.start) index -= 1;
    if (index > 0 && this.runs[index - 1]!.start === run.start) return;
    this.runs.splice(index, 0, run);
    // Where the jump key came up, the jump itself plays on: over this stretch and, it may be, the ones after it.
    const before = this.runs[index - 1];
    const after = this.runs[index + 1];
    if (before?.jump && !run.jump) this.tails.push({ from: run.start, until: run.start + LEAP_TAIL_STEPS });
    if (run.jump && after && !after.jump) this.tails.push({ from: after.start, until: after.start + LEAP_TAIL_STEPS });
    if (this.runs.length > RUNS_KEPT) this.runs.shift();
  }

  /** Forget the stretches that ended before `step`, all but the last of them: it says whether a still stretch follows a walk. */
  dropBefore(step: number): void {
    while (this.runs.length > 2 && this.runs[2]!.start <= step) this.runs.shift();
    if (this.tails.length > 0) this.tails = this.tails.filter((tail) => tail.until > step);
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
    for (const [start, moveX, moveY, keys, yaw] of runs) {
      this.stream.add({ start, moveX, moveY, run: (keys & RUN_KEY) !== 0, yaw, jump: (keys & JUMP_KEY) !== 0 });
    }
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

  /** Pass over the still steps that move nobody: not the first ones after a walk, while the player slows to a stand. */
  private passStill(): void {
    while (this.walked < this.known && !this.stream.movesAt(this.walked)) this.walked = this.stream.nextChange(this.walked, this.known);
  }

  /**
   * What the guest's player is handed for the host's next step. On foot: the
   * next step of its walk, or `HOLD_INPUT` (exactly as they are) while that has
   * not arrived. Aboard, the walk is not used: it is counted as walked, and
   * `null` says to use the guest's newest input as it is.
   */
  next(onFoot: boolean): StepInput | null {
    if (!onFoot) {
      this.following = false;
      if (this.known > this.walked) this.walked = this.known;
      return null;
    }
    // Steps the guest stood still on move nobody: pass them over, and the walk is that much less behind.
    this.passStill();
    // More walking owed than anyone should watch play out: the oldest of it is let go. The guest's screen is put right by the next state.
    for (let owed = this.stream.movingSteps(this.walked, this.known) - WALK_BACKLOG_STEPS; owed > 0;) {
      const cut = Math.min(owed, this.stream.nextChange(this.walked, this.known) - this.walked);
      this.walked += cut;
      this.dropped += cut;
      owed -= cut;
      this.passStill();
    }
    this.stream.dropBefore(this.walked);
    this.following = this.walked < this.known;
    return this.following ? inputOfWalk(this.stream.at(this.walked)) : HOLD_INPUT;
  }
}

// --- The guest's side --------------------------------------------------------

/** Where the guest's own figure is drawn. */
export interface WalkShown {
  position: Vector3;
  heading: number;
  running: boolean;
  exerting: boolean;
  /** The figure's own jump, as its own walk has it. Absent on the ground. */
  leap?: Leap;
}

const mayWalk = (player: PlayerState): boolean => player.connected && !player.asleep && player.dialogue === null;

export class WalkPredictor {
  /** Steps taken in this sitting. */
  step = 0;
  /** Where to draw the guest's own figure, or null before it has ever been on foot. Held as it was while the player is aboard. */
  shown: WalkShown | null = null;
  /** Metres the easing moved the figure in the last frame, on top of its own walking. 0 when guess and truth agree. */
  eased = 0;
  /** The guess's own walking in the last frame, metres east and south, before any easing: the way the figure is going. */
  readonly walkedLastFrame = { x: 0, z: 0 };
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
    return runs.slice(first).map(wireOf);
  }

  /** True when the newest stretch began at or after `step`: there is something the host has not been sent. */
  changedSince(step: number): boolean {
    const newest = this.stream.runs.at(-1);
    return newest !== undefined && newest.start >= step;
  }

  /**
   * One step of the walk on a player, by the rules' own on-foot step, as the rules hand it: a talk or a bed lets go of
   * the keys, and an away player is not stepped at all. A still step still slows a player who was walking.
   */
  private walkOne(player: PlayerState, walk: Walk): void {
    if (!player.connected) return;
    stepOnFoot(this.sink!, player, mayWalk(player) ? inputOfWalk(walk) : NEUTRAL_INPUT, FIXED_STEP);
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
    this.walkedLastFrame.x = 0;
    this.walkedLastFrame.z = 0;

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
    this.walkedLastFrame.x = guess.position.x - fromX;
    this.walkedLastFrame.z = guess.position.z - fromZ;

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
    if (guess.leap) this.shown.leap = guess.leap;
  }
}
