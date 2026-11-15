/**
 * The crew lobby: hosting a room on the relay and joining one, as the session
 * sees it. It holds what the two lobby panels show (a name, a code, how the
 * line is doing) and turns "Host a crew" and "Join a crew" into the session's
 * own doors: `onShare` for a host, `joinGame` for a guest.
 *
 * It only exists when the game was built with a relay address. Without one
 * `Session.crew` stays null: no lobby entries, no sockets, none of this runs.
 *
 * No DOM in here. `main.ts` hands in the socket and the page's address.
 */
import type { CharacterId } from '../data/index.ts';
import { MAXIMUM_NAME_LENGTH, cleanPlayerName } from '../sim/index.ts';
import type { GuestLink, LeaveReason } from '../net/index.ts';
import { RelayGuestWire, RelayHostRoom, makeRoomCode, readRoomCode } from '../net/relay.ts';
import type { OpenSocket, RelayFailure } from '../net/relay.ts';
import type { Session } from './session.ts';
import { HOST_BACK_TEXT } from './viewmodels/crew.ts';

export interface CrewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CrewLobbyOptions {
  session: Session;
  /** The relay, as `ws://` or `wss://` with no slash at the end (`resolveRelayAddress`). */
  address: string;
  /** This page's address without its query, for invite links: `https://sigouin.net/portage/`. */
  pageAddress: string;
  open: OpenSocket;
  /** Where the name and the seat keys are kept between visits. */
  storage: CrewStorage;
  /** The code from an invite link this page was opened with, if any. */
  invite?: string | null;
  /** Numbers between 0 and 1, for room codes. */
  random?: () => number;
  /** A fresh secret: 32 letters and digits. */
  makeKey?: () => string;
}

/** Why joining did not work, beyond what the relay says: what was typed is not a code, or no name was given. */
export type JoinProblem = RelayFailure | 'bad-code' | 'no-name';

export interface CrewView {
  /** The name field, as typed. */
  name: string;
  /** The code field, as typed. */
  code: string;
  /** True while a game is on the screen. */
  inGame: boolean;
  host: {
    /** `idle`: no room. `failed`: the room could not be opened, or was lost. */
    phase: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed';
    code: string;
    link: string;
    /** Friends' windows in the room right now. */
    guests: number;
    failure: RelayFailure | null;
    /** True once the link was copied, until the room changes. */
    copied: boolean;
  };
  join: {
    /** `waiting`: in the room, the host has not answered yet. `failed`: `problem` or `leave` says why. */
    phase: 'idle' | 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'failed';
    problem: JoinProblem | null;
    /** The host's own reason, when it was the host that said no. */
    leave: LeaveReason | null;
    /** True when that reason came to a guest who was already playing in the crew. */
    wasSeated?: boolean;
    /** False while the host's own line is down. */
    hostHere: boolean;
  };
}

const NAME_SLOT = 'portage.crew.name';
const SEATS_SLOT = 'portage.crew.seats';
/** Seat keys kept: the last few rooms this browser sat in. */
const SEATS_KEPT = 8;
/** Codes tried when the first one turns out to be somebody else's room. */
const CODE_TRIES = 4;

const randomKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class CrewLobby {
  private readonly session: Session;
  private readonly options: CrewLobbyOptions;
  private name: string;
  private code: string;
  private room: RelayHostRoom | null = null;
  private hostFailure: RelayFailure | null = null;
  private codeTries = 0;
  private copied = false;
  private wire: RelayGuestWire | null = null;
  /** The guest link made for `wire`. The session may let it go by itself (a new game, a quit). */
  private link: GuestLink | null = null;
  private joinProblem: JoinProblem | null = null;
  private joinLeave: LeaveReason | null = null;
  private joinLeaveWasSeated = false;
  /** What the lines were doing when last looked at, to tell the player when it changes. */
  private told = { host: '', join: '' };

  constructor(options: CrewLobbyOptions) {
    this.options = options;
    this.session = options.session;
    this.name = this.read(NAME_SLOT)?.slice(0, 40) ?? '';
    const invited = options.invite ? readRoomCode(options.invite) : null;
    this.code = invited ? `${invited.slice(0, 3)}-${invited.slice(3)}` : '';
  }

  private read(slot: string): string | null {
    try {
      return this.options.storage.getItem(slot);
    } catch {
      return null;
    }
  }

  private write(slot: string, value: string): void {
    try {
      this.options.storage.setItem(slot, value);
    } catch {
      // A browser that keeps nothing: the name is typed again next time.
    }
  }

  /** The name as it will be played under: cleaned, twelve letters at most. */
  get playerName(): string {
    return cleanPlayerName(this.name);
  }

  get hosting(): boolean {
    return this.room !== null;
  }

  // --- The fields -------------------------------------------------------------

  setField(field: 'name' | 'code', value: string): void {
    if (field === 'name') {
      // As typed, so a space can be typed. Cut to length; cleaned when it is used.
      this.name = Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\s+/, '')).slice(0, MAXIMUM_NAME_LENGTH).join('');
      this.write(NAME_SLOT, this.name);
    } else {
      this.code = value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 9);
      if (this.joinProblem === 'bad-code' || this.joinProblem === 'no-room') this.joinProblem = null;
    }
  }

  // --- Hosting ----------------------------------------------------------------

  /** Open a room on the relay. Every game this session plays from now on is shared in it. */
  openRoom(): void {
    if (this.room || this.session.guest) return;
    this.codeTries = 0;
    this.hostFailure = null;
    this.dialRoom();
    const session = this.session;
    session.playerName = this.playerName;
    session.onShare = (link) => this.room?.setAccept((transport) => link.accept(transport));
    // A game already on the screen is shared from here on.
    session.share();
  }

  private dialRoom(): void {
    this.codeTries += 1;
    this.copied = false;
    const room = new RelayHostRoom({
      address: this.options.address,
      code: makeRoomCode(this.options.random),
      key: (this.options.makeKey ?? randomKey)(),
      open: this.options.open,
      onChange: () => this.hostChanged(room),
    });
    this.room = room;
    const link = this.session.host;
    if (link) room.setAccept((transport) => link.accept(transport));
  }

  private hostChanged(room: RelayHostRoom): void {
    if (room !== this.room) return;
    if (room.phase === 'closed' && room.failure !== null) {
      // Somebody else already hosts under that code: take another.
      if (room.failure === 'taken' && this.codeTries < CODE_TRIES) {
        this.dialRoom();
        return;
      }
      this.hostFailure = room.failure;
      this.closeRoom();
    }
    this.tell();
  }

  private closeRoom(): void {
    const room = this.room;
    this.room = null;
    this.copied = false;
    this.session.onShare = null;
    this.session.stopSharing();
    room?.close();
  }

  /** Close the room: the guests are told, their players stay in the game, away. */
  stopHosting(): void {
    this.hostFailure = null;
    this.closeRoom();
    this.told.host = '';
  }

  /** The invite link was copied. */
  markCopied(): void {
    if (this.room?.phase === 'open') this.copied = true;
  }

  /** The address a friend opens to land in the join panel with the code filled in. */
  inviteLink(code: string): string {
    return `${this.options.pageAddress}?invite=${code}`;
  }

  // --- Joining ----------------------------------------------------------------

  /**
   * Is there a room code and a name to join with? Says why not on the join card, exactly as `join` does. Nothing
   * is dialled and nothing is sent: the session asks this before it shows the pick screen.
   */
  readyToJoin(): boolean {
    if (this.joining || this.room) return false;
    this.joinLeave = null;
    const code = readRoomCode(this.code);
    const name = this.playerName;
    this.joinProblem = code === null ? 'bad-code' : name === '' ? 'no-name' : null;
    return code !== null && name !== '';
  }

  /** Join the room in the code field, under the name in the name field, as `character` (the pick screen's). */
  join(character?: CharacterId): void {
    if (!this.readyToJoin()) return;
    const code = readRoomCode(this.code);
    const name = this.playerName;
    if (code === null || name === '') return;
    const wire = new RelayGuestWire({ address: this.options.address, code, open: this.options.open, onChange: () => this.tell() });
    this.wire = wire;
    // Back after a drop: ask for the seat again at once, with the same key.
    wire.onBack = () => this.session.guest?.knock();
    this.link = this.session.joinGame(wire, { name, key: this.seatKey(code, name), ...(character ? { character } : {}) });
  }

  /** True while the session is this lobby's guest, asking or playing. */
  private get joining(): boolean {
    return this.link !== null && this.session.guest === this.link;
  }

  /** Give up joining, or leave the crew: back to the lobby with nothing said. */
  cancelJoin(): void {
    this.joinProblem = null;
    this.joinLeave = null;
    if (this.joining) this.session.quitToLobby();
    this.wire = this.link = null;
    this.told.join = '';
  }

  /**
   * The session's guest link ended. `reason` is the host's, when the host said
   * anything. Returns what the relay knows of why, or null when it was the host's doing.
   */
  guestEnded(reason: LeaveReason | null, wasSeated = false): RelayFailure | null {
    if (!this.joining) return null;
    const failure = this.wire?.failure ?? null;
    this.joinProblem = failure;
    this.joinLeave = failure === null ? reason : null;
    this.joinLeaveWasSeated = wasSeated;
    this.wire = this.link = null;
    this.told.join = '';
    return failure;
  }

  /**
   * This browser's secret for a room and a name. The same one each time, so
   * a window that was closed gets its player back.
   */
  private seatKey(code: string, name: string): string {
    const slot = `${code}.${name}`;
    let seats: [string, string][] = [];
    try {
      const kept: unknown = JSON.parse(this.read(SEATS_SLOT) ?? '[]');
      if (Array.isArray(kept)) seats = kept.filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string');
    } catch {
      seats = [];
    }
    const found = seats.find((entry) => entry[0] === slot);
    if (found && /^[A-Za-z0-9_-]{8,64}$/.test(found[1])) return found[1];
    const made = (this.options.makeKey ?? randomKey)();
    this.write(SEATS_SLOT, JSON.stringify([...seats.filter((entry) => entry[0] !== slot), [slot, made]].slice(-SEATS_KEPT)));
    return made;
  }

  // --- Telling the player -----------------------------------------------------

  /** A line changed while a game is on the screen: say so once, in a note. The panels say it themselves. */
  private tell(): void {
    const session = this.session;
    const host = this.room?.phase ?? (this.hostFailure ? 'failed' : '');
    if (host !== this.told.host) {
      const before = this.told.host;
      this.told.host = host;
      if (session.game && !session.guest) {
        if (host === 'reconnecting') session.announce('The line to the relay dropped. Trying again.', 'warning');
        else if (host === 'open' && before === 'reconnecting') session.announce('The relay is back. Your crew can carry on.', 'good');
        else if (host === 'failed') session.announce('Your crew room is closed: the relay cannot be reached.', 'danger');
      }
    }
    const wire = this.joining ? this.wire : null;
    const join = wire ? (wire.phase === 'open' && !wire.hostHere ? 'host-away' : wire.phase) : '';
    if (join !== this.told.join) {
      const before = this.told.join;
      this.told.join = join;
      if (session.game && session.guest) {
        if (join === 'reconnecting') session.announce('The line dropped. Trying again.', 'warning');
        else if (join === 'host-away') session.announce('The host dropped. Waiting for them to come back.', 'warning');
        else if (join === 'open' && (before === 'reconnecting' || before === 'host-away')) session.announce(HOST_BACK_TEXT, 'good');
      }
    }
  }

  /** The page is going: the room is closed, so the guests hear it at once. */
  pageClosing(): void {
    this.room?.close();
    this.room = null;
  }

  // --- What the panels draw ----------------------------------------------------

  view(): CrewView {
    const room = this.room;
    const wire = this.joining ? this.wire : null;
    const guest = this.session.guest;
    const hostPhase = room ? (room.phase === 'closed' ? 'failed' : room.phase) : this.hostFailure ? 'failed' : 'idle';
    let joinPhase: CrewView['join']['phase'] = 'idle';
    if (wire && guest) {
      joinPhase = wire.phase === 'connecting' ? 'connecting' : wire.phase === 'reconnecting' ? 'reconnecting'
        : guest.status === 'playing' ? 'playing' : 'waiting';
    } else if (this.joinProblem !== null || this.joinLeave !== null) {
      joinPhase = 'failed';
    }
    return {
      name: this.name,
      code: this.code,
      inGame: this.session.game !== null,
      host: {
        phase: hostPhase,
        code: room?.code ?? '',
        link: room ? this.inviteLink(room.code) : '',
        guests: room?.guests.size ?? 0,
        failure: room ? null : this.hostFailure,
        copied: this.copied,
      },
      join: { phase: joinPhase, problem: this.joinProblem, leave: this.joinLeave, wasSeated: this.joinLeaveWasSeated, hostHere: wire?.hostHere ?? true },
    };
  }
}
