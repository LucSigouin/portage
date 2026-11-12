/**
 * Co-op up to the wire. The host's browser runs the one true game
 * (`HostLink`); guests send what they hold and what they ask for and show
 * what the host says (`GuestLink`). Messages cross a `Transport`: the
 * loopback pair in tests, the channel between tabs for `?host=` and `?join=`,
 * and the relay on the internet (`relay.ts`, imported by name where it is
 * used, so a build without a relay carries none of it). Nothing in here but
 * `tabs.ts` touches the browser.
 */
export { PROTOCOL_VERSION, readClientMessage, readCommand, readHostMessage, readInput } from './messages.ts';
export type {
  ClientMessage, CommandMessage, EventsMessage, HostMessage, InputMessage, JoinMessage, LeaveReason, PingMessage,
  ResultMessage, StateMessage, WelcomeMessage,
} from './messages.ts';
export { createLoopbackPair } from './transport.ts';
export type { LoopbackConditions, LoopbackPair, LoopbackStats, Transport } from './transport.ts';
export { COMMAND_WAIT_SECONDS, HostLink, STALE_INPUT_SECONDS } from './host.ts';
export type { HostOptions, HostStats } from './host.ts';
export { ROOM_PATTERN, hostTabRoom, joinTabRoom } from './tabs.ts';
export type { ChannelLike } from './tabs.ts';
export { GuestLink, HOST_SILENCE_SECONDS, blendStates } from './guest.ts';
export type { CommandOutcome, GuestOptions, GuestStatus } from './guest.ts';
export {
  WALK_AHEAD_STEPS, WALK_BACKLOG_STEPS, WALK_CUT_METRES, WALK_EASE_SECONDS, WALK_RUNS_SENT, WalkPredictor, WalkStream, WalkTimeline,
  readWalkRun, walkOf,
} from './walk.ts';
export type { Walk, WalkRun, WalkShown, WireRun } from './walk.ts';
