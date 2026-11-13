/**
 * The crew lobby: whole clients (session, panels, interface model) hosting a
 * room and joining one through the relay's own room logic, in memory. What
 * the lobby shows and says in every state, and what a game built without a
 * relay does not have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { ButtonModel, GameInterface, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { CrewLobby } from '../../src/client/crewlobby.ts';
import type { InterfaceIntent } from '../../src/client/intents.ts';
import { ROOM_CODE_PATTERN, readRoomCode } from '../../src/net/relay.ts';
import { FIXED_STEP } from '../../src/sim/index.ts';
import { FakeStorage } from '../support.ts';
import { ADDRESS, FakeRelay } from '../net/relay-rig.ts';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

interface Client {
  app: App;
  storage: FakeStorage;
  crew: CrewLobby | null;
  model(): InterfaceModel;
  panel<Id extends PanelModel['id']>(id: Id): Extract<PanelModel, { id: Id }>;
  send(intent: InterfaceIntent): void;
  press(button: ButtonModel | null | undefined): void;
  type(field: 'name' | 'code', value: string): void;
  toasts(): string[];
}

const PAGE = 'https://sigouin.net/portage/';
/** Each browser makes its own secrets. */
let browsers = 0;

function client(relay: FakeRelay | null, options: { invite?: string; storage?: FakeStorage; codes?: string[] } = {}): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const storage = options.storage ?? new FakeStorage();
  let seed = 0;
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage, now: () => 5000, randomSeed: () => (seed += 1) });
  let keys = 0;
  const browser = (browsers += 1);
  // Room codes in the order given, then at random. `makeRoomCode` draws six numbers a code.
  const draws = (options.codes ?? []).flatMap((code) => Array.from(code, (letter) => ('FHJKLMQRTWXY34679'.indexOf(letter) + 0.5) / 17));
  const crew = relay ? new CrewLobby({
    session: app.session, address: ADDRESS, pageAddress: PAGE, open: relay.open, storage, invite: options.invite ?? null,
    random: () => draws.shift() ?? Math.random(),
    makeKey: () => `key-${browser}-${(keys += 1).toString().padStart(4, '0')}-0123456789abcdef`,
  }) : null;
  app.session.crew = crew;
  const self: Client = {
    app, storage, crew,
    model: () => {
      app.frame(0);
      return models.at(-1)!;
    },
    panel: (id) => {
      const panel = self.model().panel;
      if (panel?.id !== id) throw new Error(`the open panel is ${panel?.id ?? 'none'}, not ${id}`);
      return panel as Extract<PanelModel, { id: typeof id }>;
    },
    send: (intent) => app.session.handleIntent(intent),
    press: (button) => {
      if (!button) throw new Error('no such button');
      if (!button.enabled) throw new Error(`"${button.label}" is disabled`);
      app.session.handleIntent(button.intent);
    },
    type: (field, value) => app.session.handleIntent({ type: 'crew_field', field, value }),
    toasts: () => self.model().toasts.map((toast) => toast.text),
  };
  return self;
}

/** Frames for every client, with the sockets' timers between them. */
async function run(clients: Client[], seconds: number): Promise<void> {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
    await vi.advanceTimersByTimeAsync(FIXED_STEP * 1000);
    for (const each of clients) each.app.frame(FIXED_STEP);
    await Promise.resolve();
  }
}

const lobbyLabels = (each: Client): string[] => each.model().lobby!.buttons.map((button) => button.label);
const lobbyButton = (each: Client, label: string): ButtonModel => each.model().lobby!.buttons.find((button) => button.label === label)!;

/** A host with an open room and a game under way, named Luc. */
async function hosting(relay: FakeRelay, options: { codes?: string[] } = {}): Promise<{ host: Client; code: string }> {
  const host = client(relay, options);
  host.press(lobbyButton(host, 'Host a crew'));
  host.type('name', 'Luc');
  host.press(host.panel('crew_host').actions[0]);
  await run([host], 0.2);
  const code = readRoomCode(host.panel('crew_host').room!.code)!;
  host.send({ type: 'new_game', slot: 0 });
  return { host, code };
}

async function joining(relay: FakeRelay, code: string, name: string, others: Client[], storage?: FakeStorage): Promise<Client> {
  const guest = client(relay, { invite: code, storage });
  guest.send({ type: 'open_panel', panel: 'crew_join' });
  guest.type('name', name);
  guest.press(guest.panel('crew_join').join);
  await run([...others, guest], 1);
  return guest;
}

describe('a game built without a relay', () => {
  it('has the lobby it always had: no crew entries, no crew panels, nothing dialled', () => {
    const solo = client(null);
    expect(lobbyLabels(solo)).toEqual(['Continue', 'New Game', 'Settings', 'How to Play', 'Feedback', 'Credits']);
    for (const panel of ['crew_host', 'crew_join'] as const) {
      solo.send({ type: 'open_panel', panel });
      expect(solo.model().panel).toBeNull();
      expect(solo.model().openPanels).toEqual([]);
    }
    for (const intent of [{ type: 'crew_open_room' }, { type: 'crew_join' }, { type: 'crew_stop_hosting' }, { type: 'crew_copied' }] as const) solo.send(intent);
    solo.type('name', 'Luc');
    expect(solo.app.session.onShare).toBeNull();
    expect(solo.app.session.guest).toBeNull();
    solo.send({ type: 'new_game', slot: 0 });
    expect(solo.app.session.host).toBeNull();
    solo.send({ type: 'open_panel', panel: 'pause' });
    expect(solo.panel('pause').buttons.map((button) => button.label)).toEqual(['Resume', 'Settings', 'How to Play', 'Feedback', 'Save and quit to the lobby']);
  });

  it('with a relay, has two more entries, after New Game', () => {
    const relay = new FakeRelay();
    const player = client(relay);
    expect(lobbyLabels(player)).toEqual(['Continue', 'New Game', 'Host a crew', 'Join a crew', 'Settings', 'How to Play', 'Feedback', 'Credits']);
    expect(lobbyButton(player, 'Host a crew').note).toBe('Friends join by a link');
    expect(lobbyButton(player, 'Join a crew').note).toBe('With a code from a friend');
    // Looking at the lobby dials nothing.
    expect(relay.dials).toEqual([]);
  });
});

describe('hosting a crew', () => {
  it('opens a room, shows its code and its invite link, and shares the game that is started from it', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.press(lobbyButton(host, 'Host a crew'));
    let panel = host.panel('crew_host');
    expect(panel).toMatchObject({ phase: 'idle', room: null, status: '', stop: null });
    expect(panel.name).toMatchObject({ field: 'name', value: '', maxLength: 12, enabled: true });
    expect(panel.actions.map((action) => action.label)).toEqual(['Open a room']);
    host.type('name', 'Luc');
    host.press(panel.actions[0]);

    panel = host.panel('crew_host');
    expect(panel).toMatchObject({ phase: 'connecting', status: 'Connecting to the relay…', room: null });
    expect(panel.name.enabled).toBe(false);
    expect(panel.stop?.label).toBe('Cancel');
    await run([host], 0.2);

    panel = host.panel('crew_host');
    expect(panel).toMatchObject({ phase: 'open', status: 'The room is open. Nobody has come in yet.', statusTone: 'info' });
    const code = readRoomCode(panel.room!.code)!;
    expect(code).toMatch(ROOM_CODE_PATTERN);
    expect(panel.room!.code).toBe(`${code.slice(0, 3)}-${code.slice(3)}`);
    expect(panel.room!.link).toBe(`${PAGE}?invite=${code}`);
    expect(panel.room!.copy).toMatchObject({ label: 'Copy link', note: null });
    expect(panel.stop?.label).toBe('Stop hosting');
    // From the room card: the game to share.
    expect(panel.actions.map((action) => [action.label, action.enabled])).toEqual([['Continue', false], ['New Game', true]]);
    host.press(panel.room!.copy);
    expect(host.panel('crew_host').room!.copy).toMatchObject({ label: 'Copied', note: 'Paste it to your friends' });

    host.press(panel.actions[1]);
    expect(host.model().openPanels).toEqual(['crew_host', 'save_slots']);
    host.send({ type: 'new_game', slot: 0 });
    const session = host.app.session;
    expect(session.screen).toBe('game');
    expect(session.host).not.toBeNull();
    expect(session.game!.players[0]!.name).toBe('Luc');
    // The room card is on the pause menu from here on.
    host.send({ type: 'open_panel', panel: 'pause' });
    const crewButton = host.panel('pause').buttons[1]!;
    expect(crewButton).toMatchObject({ label: 'Crew room', note: `${panel.room!.code}: the code and the invite link` });
    host.press(crewButton);
    expect(host.panel('crew_host')).toMatchObject({ phase: 'open', actions: [], lines: ['Send the link. A friend who opens it boards your canoe.'] });
    expect(host.panel('crew_host').room!.link).toBe(`${PAGE}?invite=${code}`);
  });

  it('opens a room in the middle of a game, from the pause menu', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.send({ type: 'new_game', slot: 0 });
    expect(host.app.session.host).toBeNull();
    host.send({ type: 'open_panel', panel: 'pause' });
    const crewButton = host.panel('pause').buttons[1]!;
    expect(crewButton.label).toBe('Host a crew');
    host.press(crewButton);
    host.type('name', 'Luc');
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 0.2);
    expect(host.app.session.host).not.toBeNull();
    host.send({ type: 'resume' });
    const code = readRoomCode(host.crew!.view().host.code)!;
    const guest = await joining(relay, code, 'Sam', [host]);
    expect(guest.app.session.screen).toBe('game');
    expect(host.app.session.game!.players.map((player) => [player.name, player.connected])).toEqual([['Luc', true], ['Sam', true]]);
  });

  it('takes another code when the first one is somebody else\'s room', async () => {
    const relay = new FakeRelay();
    const first = await hosting(relay, { codes: ['FHJKLM'] });
    expect(first.code).toBe('FHJKLM');
    const second = await hosting(relay, { codes: ['FHJKLM', 'QRTWXY'] });
    expect(second.code).toBe('QRTWXY');
    expect(second.host.crew!.view().host.phase).toBe('open');
    expect(first.host.crew!.view().host.phase).toBe('open');
  });

  it('says so when the relay cannot be reached, and tries again when asked', async () => {
    const relay = new FakeRelay();
    relay.up = false;
    const host = client(relay);
    host.press(lobbyButton(host, 'Host a crew'));
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 4);
    let panel = host.panel('crew_host');
    expect(panel).toMatchObject({
      phase: 'failed', status: 'The relay cannot be reached. Check your connection and try again.', statusTone: 'danger', room: null,
    });
    expect(panel.actions.map((action) => action.label)).toEqual(['Try again']);
    expect(host.app.session.onShare).toBeNull();
    relay.up = true;
    host.press(panel.actions[0]);
    await run([host], 0.2);
    panel = host.panel('crew_host');
    expect(panel.phase).toBe('open');
  });

  it('stops hosting: the guests are told, their players stay, and the lobby is as it was', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const guest = await joining(relay, code, 'Sam', [host]);
    expect(guest.app.session.screen).toBe('game');
    host.send({ type: 'crew_stop_hosting' });
    await run([host, guest], 0.5);
    expect(guest.app.session.screen).toBe('lobby');
    expect(guest.toasts()).toContain('The host closed the game.');
    expect(host.app.session.host).toBeNull();
    expect(host.app.session.game!.players.map((player) => [player.name, player.connected])).toEqual([['Luc', true], ['Sam', false]]);
    expect(host.crew!.view().host.phase).toBe('idle');
    expect(relay.rooms.get(code)!.empty).toBe(true);
  });
});

describe('joining a crew', () => {
  it('fills the code in from an invite link, takes a name, and lands the guest in the host\'s canoe', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const guest = client(relay, { invite: code });
    guest.send({ type: 'open_panel', panel: 'crew_join' });
    let panel = guest.panel('crew_join');
    expect(panel.code).toMatchObject({ field: 'code', value: `${code.slice(0, 3)}-${code.slice(3)}`, enabled: true });
    expect(panel.name).toMatchObject({ field: 'name', value: '', maxLength: 12 });
    expect(panel.status).toBe('');
    guest.type('name', 'Sam');
    guest.press(panel.join);
    panel = guest.panel('crew_join');
    expect(panel).toMatchObject({ status: 'Connecting to the relay…' });
    expect([panel.code.enabled, panel.name.enabled, panel.join.enabled, panel.cancel?.label]).toEqual([false, false, false, 'Cancel']);
    await run([host, guest], 1);

    expect(guest.app.session.screen).toBe('game');
    expect(guest.model().openPanels).toEqual([]);
    expect(guest.app.session.localPlayerId).toBe(1);
    expect(guest.app.session.game!.players.map((player) => player.name)).toEqual(['Luc', 'Sam']);
    expect(guest.model().hud!.crew.map((row) => [row.label, row.you, row.host])).toEqual([['Luc', false, true], ['Sam', true, false]]);
    expect(host.toasts()).toContain('Sam joined the crew');
    expect(host.panel === undefined).toBe(false);
    // The host's room card counts who is in the room.
    host.send({ type: 'open_panel', panel: 'pause' });
    host.send({ type: 'open_panel', panel: 'crew_host' });
    expect(host.panel('crew_host')).toMatchObject({ status: 'One friend is in the room.', statusTone: 'good' });
  });

  it('waits, in words, for a host who has not started the game', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.press(lobbyButton(host, 'Host a crew'));
    host.type('name', 'Luc');
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 0.2);
    const code = readRoomCode(host.panel('crew_host').room!.code)!;
    const guest = await joining(relay, code, 'Sam', [host]);
    expect(guest.app.session.screen).toBe('lobby');
    expect(guest.panel('crew_join')).toMatchObject({ status: 'Found the crew. Waiting for the host to start the game…', statusTone: 'good' });
    expect(lobbyButton(host, 'Host a crew').note).toBe(`Room ${code.slice(0, 3)}-${code.slice(3)} is open`);
    expect(host.panel('crew_host').status).toBe('One friend is in the room.');
    host.send({ type: 'new_game', slot: 0 });
    await run([host, guest], 1);
    expect(guest.app.session.screen).toBe('game');
    expect(guest.app.session.game!.players.map((player) => player.name)).toEqual(['Luc', 'Sam']);
  });

  it('cuts a name to twelve letters, and keeps it for next time', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const storage = new FakeStorage();
    const guest = client(relay, { invite: code, storage });
    guest.send({ type: 'open_panel', panel: 'crew_join' });
    guest.type('name', '  Samantha the Bold  ');
    expect(guest.panel('crew_join').name.value).toBe('Samantha the');
    guest.press(guest.panel('crew_join').join);
    await run([host, guest], 1);
    const name = host.app.session.game!.players[1]!.name;
    expect(name).toBe('Samantha the');
    expect(Array.from(name).length).toBeLessThanOrEqual(12);
    const next = client(relay, { storage });
    next.send({ type: 'open_panel', panel: 'crew_join' });
    expect(next.panel('crew_join').name.value).toBe('Samantha the');
  });

  it('says what is wrong with what was typed before dialling anything', () => {
    const relay = new FakeRelay();
    const guest = client(relay);
    guest.send({ type: 'open_panel', panel: 'crew_join' });
    guest.type('name', 'Sam');
    for (const typed of ['', 'ABC', 'ABCDEF', 'FHJ-K3', 'FHJK3MM']) {
      guest.type('code', typed);
      guest.press(guest.panel('crew_join').join);
      expect(guest.panel('crew_join')).toMatchObject({
        status: 'That is not a crew code. A code is six letters and digits, like FHJ-K3M.', statusTone: 'warning',
      });
    }
    guest.type('code', 'fhj k3m');
    expect(guest.panel('crew_join').code.value).toBe('FHJ K3M');
    guest.type('name', '   ');
    guest.press(guest.panel('crew_join').join);
    expect(guest.panel('crew_join')).toMatchObject({ status: 'Type a name first.', statusTone: 'warning' });
    expect(relay.dials).toEqual([]);
    expect(guest.app.session.guest).toBeNull();
  });

  it('has a sentence for every way it can fail: no such room, a full crew, a relay that is down, a host who leaves', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);

    // No room with that code.
    const lost = client(relay, { invite: 'QRTWXY' });
    lost.send({ type: 'open_panel', panel: 'crew_join' });
    lost.type('name', 'Sam');
    lost.press(lost.panel('crew_join').join);
    await run([host, lost], 0.5);
    expect(lost.panel('crew_join')).toMatchObject({ status: 'No crew with that code. Check it with whoever sent it.', statusTone: 'danger' });
    expect(lost.panel('crew_join').join.enabled).toBe(true);
    expect(lost.toasts()).toContain('No crew with that code. Check it with whoever sent it.');
    // Fixing the code clears the complaint.
    lost.type('code', code);
    expect(lost.panel('crew_join').status).toBe('');

    // A full crew: three guests are in, the fifth player is turned away.
    const guests: Client[] = [];
    for (const name of ['Ann', 'Bo', 'Cy']) guests.push(await joining(relay, code, name, [host, ...guests]));
    expect(host.app.session.game!.players.map((player) => player.name)).toEqual(['Luc', 'Ann', 'Bo', 'Cy']);
    const fifth = await joining(relay, code, 'Dee', [host, ...guests]);
    expect(fifth.app.session.screen).toBe('lobby');
    expect(fifth.panel('crew_join')).toMatchObject({ status: 'That crew is full.', statusTone: 'danger' });
    expect(host.app.session.game!.players).toHaveLength(4);

    // The host closes the page: everyone is told, and is back in their lobby.
    host.app.session.pageClosing();
    await run(guests, 0.5);
    for (const guest of guests) {
      expect(guest.app.session.screen).toBe('lobby');
      expect(guest.toasts()).toContain('The host closed the game.');
    }

    // A relay that is down.
    relay.up = false;
    const cut = client(relay, { invite: code });
    cut.send({ type: 'open_panel', panel: 'crew_join' });
    cut.type('name', 'Eve');
    cut.press(cut.panel('crew_join').join);
    await run([cut], 4);
    expect(cut.panel('crew_join')).toMatchObject({
      status: 'The relay cannot be reached. Check your connection and try again.', statusTone: 'danger',
    });
  });

  it('tells a guest waiting in a room that the host left', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.press(lobbyButton(host, 'Host a crew'));
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 0.2);
    const code = readRoomCode(host.panel('crew_host').room!.code)!;
    const guest = await joining(relay, code, 'Sam', [host]);
    expect(guest.panel('crew_join').status).toBe('Found the crew. Waiting for the host to start the game…');
    host.press(host.panel('crew_host').stop);
    await run([host, guest], 0.5);
    expect(guest.panel('crew_join')).toMatchObject({ status: 'The host left.', statusTone: 'danger' });
    expect(guest.app.session.guest).toBeNull();
  });

  it('gives a guest who leaves and joins again the same player, with their things', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const storage = new FakeStorage();
    let guest = await joining(relay, code, 'Sam', [host], storage);
    host.app.session.game!.players[1]!.backpack.push({ itemId: 'driftwood', count: 3 });
    const seat = host.app.session.game!.players[1]!.seat;
    // The window is closed.
    guest.app.session.pageClosing();
    await run([host], 0.5);
    expect(host.app.session.game!.players[1]).toMatchObject({ name: 'Sam', connected: false });
    expect(host.toasts()).toContain('Sam is away');
    // The same browser opens the link again.
    guest = await joining(relay, code, 'Sam', [host], storage);
    expect(guest.app.session.localPlayerId).toBe(1);
    expect(host.app.session.game!.players).toHaveLength(2);
    expect(host.app.session.game!.players[1]).toMatchObject({ name: 'Sam', connected: true, seat });
    expect(host.app.session.game!.players[1]!.backpack).toContainEqual({ itemId: 'driftwood', count: 3 });
    // Another browser under the same name is somebody else.
    const stranger = await joining(relay, code, 'Sam', [host, guest]);
    expect(stranger.app.session.localPlayerId).toBe(2);
  });

  it('tells a guest whose line drops, and again when they are back', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const guest = await joining(relay, code, 'Sam', [host]);
    relay.cut(relay.live('guest')[0]!);
    await run([host, guest], 0.1);
    expect(guest.toasts()).toContain('The line dropped. Trying again.');
    expect(host.toasts()).toContain('Sam is away');
    await run([host, guest], 1.5);
    expect(guest.app.session.screen).toBe('game');
    expect(guest.toasts()).toContain('Back with the crew.');
    expect(host.app.session.game!.players[1]).toMatchObject({ name: 'Sam', connected: true });
    // The host's own line: the guest waits, and is told.
    relay.up = false;
    relay.cut(relay.live('host')[0]!);
    await run([host, guest], 0.2);
    expect(host.toasts()).toContain('The line to the relay dropped. Trying again.');
    expect(guest.toasts()).toContain('The host dropped. Waiting for them to come back.');
    relay.up = true;
    await run([host, guest], 2);
    expect(host.toasts()).toContain('The relay is back. Your crew can carry on.');
    expect(guest.app.session.screen).toBe('game');
    expect(host.app.session.game!.players.map((player) => player.connected)).toEqual([true, true]);
  });

  it('will not join while hosting', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.press(lobbyButton(host, 'Host a crew'));
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 0.2);
    host.send({ type: 'close_panel' });
    host.press(lobbyButton(host, 'Join a crew'));
    expect(host.panel('crew_join').join).toMatchObject({ enabled: false, note: 'Stop hosting first' });
  });
});
