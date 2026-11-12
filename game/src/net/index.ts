/**
 * Co-op up to the wire. The host's browser runs the one true game
 * (`HostLink`); guests send what they hold and what they ask for and show
 * what the host says (`GuestLink`). Messages cross a `Transport`: the
 * loopback pair in tests, the channel between tabs for `?host=` and `?join=`,
 * a relay later. Nothing in here but `tabs.ts` touches the browser.
 */
export { PROTOCOL_VERSION, readClientMessage, readCommand, readHostMessage, readInput } from './messages.ts';
export type {
  ClientMessage, CommandMessage, EventsMessage, HostMessage, InputMessage, JoinMessage, LeaveReason, PingMessage,
  ResultMessage, StateMessage, WelcomeMessage,
} from './messages.ts';
export { createLoopbackPair } from './transport.ts';
export type { LoopbackConditions, LoopbackPair, LoopbackStats, Transport } from './transport.ts';
export { HostLink, STALE_INPUT_SECONDS } from './host.ts';
export type { HostOptions, HostStats } from './host.ts';
export { GuestLink, HOST_SILENCE_SECONDS, blendStates } from './guest.ts';
export type { CommandOutcome, GuestOptions, GuestStatus } from './guest.ts';
