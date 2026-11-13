/**
 * The arrival card (`client/viewmodels/arrival.ts`): its clock, its three settings, its queue, and the whole road
 * from the rules' event to the model on a host's and a guest's screen. No browser: the app runs with fakes.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import {
  ARRIVAL, ARRIVAL_TOTAL, ArrivalQueue, arrivalFrame, arrivalWords, arrivalsFromEvents, settingsRows, toastsFromEvents,
} from '../../src/client/viewmodels/index.ts';
import type { ArrivalModel } from '../../src/client/viewmodels/index.ts';
import { HULL_TIERS, ISLANDS_BY_ID, NPCS, PLACES, shoreDistance, spotPosition } from '../../src/data/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { SETTINGS_KEY, createDefaultSettings, loadSettings, sanitizeSettings, saveSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, dispatch, drainEvents } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, floatCanoeAt, give, newGame, standOn, teleport } from '../support.ts';

const FRAME = 1 / 60;
const KNOLL = arrivalWords('island:home_knoll')!;
const STEEPLE = arrivalWords('island:steeple_rock')!;

/** Every frame of a queue from now until it shows nothing for a second, at 60 a second. */
function play(queue: ArrivalQueue, cards: 'animated' | 'still' | 'off' = 'animated', limit = 20): (ArrivalModel | null)[] {
  const frames: (ArrivalModel | null)[] = [];
  let empty = 0;
  for (let frame = 0; frame < limit * 60 && empty < 60; frame += 1) {
    queue.update(FRAME, false, cards);
    const model = queue.model();
    frames.push(model);
    empty = model === null && queue.pending === 0 ? empty + 1 : 0;
  }
  return frames;
}

const shown = (frames: (ArrivalModel | null)[]): ArrivalModel[] => frames.filter((frame): frame is ArrivalModel => frame !== null);
const wordsOf = (model: ArrivalModel): string => `${model.placeId}|${model.kicker}|${model.title}|${model.line}`;

describe('the words of a card', () => {
  it('an island: its region over its name, and the world table\'s line under it', () => {
    expect(STEEPLE).toEqual({
      placeId: 'island:steeple_rock', kicker: 'The Reach', title: 'Steeple Rock',
      line: 'The church hill. The steeple still stands, and Wren still rings the hours.',
    });
  });

  it('a landmark: its island over its name', () => {
    expect(arrivalWords('landmark:the_beacon:radio_tower')).toEqual({
      placeId: 'landmark:the_beacon:radio_tower', kicker: 'The Beacon', title: 'The Radio Tower', line: 'Dark on the summit, waiting to be lit.',
    });
  });

  it('every place has a card, and only a place_reached event asks for one', () => {
    for (const place of PLACES) expect(arrivalWords(place.id), place.id).not.toBeNull();
    expect(arrivalWords('island:atlantis')).toBeNull();
    expect(arrivalsFromEvents([
      { type: 'island_discovered', islandId: 'steeple_rock' }, { type: 'landed', islandId: 'steeple_rock', playerId: 0 },
      { type: 'region_entered', regionId: 'reach', playerId: 0 }, { type: 'place_reached', placeId: 'island:steeple_rock' },
      { type: 'place_reached', placeId: 'island:atlantis' },
    ])).toEqual([STEEPLE]);
  });

  it('the old notes stay as they were, and the card adds no note of its own', () => {
    const state = newGame(7);
    const texts = toastsFromEvents([
      { type: 'island_discovered', islandId: 'steeple_rock' }, { type: 'place_reached', placeId: 'island:steeple_rock' },
      { type: 'landed', islandId: 'steeple_rock', playerId: 0 }, { type: 'region_entered', regionId: 'reach', playerId: 0 },
    ], state).map((toast) => toast.text);
    expect(texts).toEqual(['Charted: Steeple Rock', 'Ashore on Steeple Rock', 'Entering The Reach']);
  });
});

describe('an animated card', () => {
  const queue = new ArrivalQueue();
  queue.add(STEEPLE);
  const frames = shown(play(queue));

  it('arrives in 1.3 s (the limit is 1.5), holds 2 s, leaves in 0.5 s: 3.8 s in all, once', () => {
    expect(ARRIVAL.arrive).toBeLessThanOrEqual(1.5);
    expect([ARRIVAL.arrive, ARRIVAL.hold, ARRIVAL.leave]).toEqual([1.3, 2, 0.5]);
    expect(ARRIVAL_TOTAL).toBeCloseTo(3.8, 9);
    const seconds = (phase: ArrivalModel['phase']): number => frames.filter((frame) => frame.phase === phase).length / 60;
    expect(seconds('arriving')).toBeCloseTo(1.3, 1);
    expect(seconds('holding')).toBeCloseTo(2, 1);
    expect(seconds('leaving')).toBeCloseTo(0.5, 1);
    expect(frames.length / 60).toBeCloseTo(3.8, 1);
    // It came once: the phases run arriving, holding, leaving and never turn back.
    const order = frames.map((frame) => frame.phase).filter((phase, index, all) => phase !== all[index - 1]);
    expect(order).toEqual(['arriving', 'holding', 'leaving']);
  });

  it('carries the same words, whole, in every frame from the first to the last', () => {
    expect(frames[0]).toMatchObject({ ...STEEPLE, ink: 0, lift: 0, seal: 0, phase: 'arriving' });
    expect(new Set(frames.map(wordsOf)).size).toBe(1);
    expect(wordsOf(frames.at(-1)!)).toBe(wordsOf(frames[0]));
  });

  it('moves only its ink, one way: the stroke is drawn, then the seal is pressed, then the stroke is lifted', () => {
    for (let index = 1; index < frames.length; index += 1) {
      const [before, now] = [frames[index - 1], frames[index]];
      expect(now.ink).toBeGreaterThanOrEqual(before.ink);
      expect(now.seal).toBeGreaterThanOrEqual(before.seal);
      expect(now.lift).toBeGreaterThanOrEqual(before.lift);
      // No frame jumps: at 60 frames a second the stroke moves 4% of its length at most, the seal takes 6% of its ink.
      expect(now.ink - before.ink).toBeLessThan(0.04);
      expect(now.lift - before.lift).toBeLessThan(0.07);
      expect(now.seal - before.seal).toBeLessThan(0.06);
    }
    // The seal waits for the stroke.
    for (const frame of frames) if (frame.seal > 0) expect(frame.ink).toBe(1);
    // Through the hold nothing changes at all.
    const holding = frames.filter((frame) => frame.phase === 'holding');
    for (const frame of holding) expect(frame).toEqual({ ...STEEPLE, motion: 'animated', phase: 'holding', ink: 1, lift: 0, seal: 1 });
    // It leaves by the stroke alone: the seal and the words stay to the last frame.
    for (const frame of frames.filter((entry) => entry.phase === 'leaving')) expect([frame.ink, frame.seal]).toEqual([1, 1]);
    expect(frames.at(-1)!.lift).toBeGreaterThan(0.9);
  });

  it('a long frame as it begins does not eat its ink', () => {
    const slow = new ArrivalQueue();
    slow.add(STEEPLE);
    slow.update(FRAME, false, 'animated');
    slow.update(2, false, 'animated');
    expect(slow.model()).toMatchObject({ phase: 'arriving', ink: 0 });
  });
});

describe('a still card', () => {
  it('changes nothing between the frame it appears and the frame it leaves', () => {
    const queue = new ArrivalQueue();
    queue.add(STEEPLE);
    const frames = shown(play(queue, 'still'));
    expect(frames.length / 60).toBeCloseTo(ARRIVAL.still, 1);
    for (const frame of frames) expect(frame).toEqual({ ...STEEPLE, motion: 'still', phase: 'holding', ink: 1, lift: 0, seal: 1 });
    expect(arrivalFrame(STEEPLE, 'still', 0)).toEqual(arrivalFrame(STEEPLE, 'still', ARRIVAL.still - 0.001));
    expect(arrivalFrame(STEEPLE, 'still', ARRIVAL.still)).toBeNull();
  });
});

describe('cards switched off', () => {
  it('show nothing, and keep nothing for later', () => {
    const queue = new ArrivalQueue();
    queue.add(STEEPLE);
    queue.add(KNOLL);
    expect(shown(play(queue, 'off', 5))).toEqual([]);
    expect(queue.pending).toBe(0);
    // Switched back on: the places already reached are not brought up again.
    expect(shown(play(queue, 'animated', 5))).toEqual([]);
  });

  it('take a card off the screen at once when switched off part way', () => {
    const queue = new ArrivalQueue();
    queue.add(STEEPLE);
    for (let frame = 0; frame < 30; frame += 1) queue.update(FRAME, false, 'animated');
    expect(queue.model()).not.toBeNull();
    queue.update(FRAME, false, 'off');
    expect(queue.model()).toBeNull();
  });
});

describe('two places at once', () => {
  it('are shown one after the other, never together, with a breath between', () => {
    const queue = new ArrivalQueue();
    queue.addAll([STEEPLE, KNOLL, STEEPLE]);
    expect(queue.pending).toBe(2);
    const frames = play(queue);
    const titles = frames.map((frame) => frame?.title ?? null);
    const runs = titles.filter((title, index) => title !== titles[index - 1]);
    expect(runs).toEqual(['Steeple Rock', null, 'Home Knoll', null]);
    const firstEnd = titles.lastIndexOf('Steeple Rock');
    const secondStart = titles.indexOf('Home Knoll');
    expect((secondStart - firstEnd - 1) / 60).toBeCloseTo(ARRIVAL.gap, 1);
    // The second card is whole too: it starts from no ink.
    expect(frames[secondStart]).toMatchObject({ ink: 0, seal: 0, phase: 'arriving' });
  });
});

describe('something has the screen', () => {
  it('a card waits for as long as it lasts, then takes a breath and begins', () => {
    const queue = new ArrivalQueue();
    queue.add(STEEPLE);
    for (let frame = 0; frame < 600; frame += 1) {
      queue.update(FRAME, true, 'animated');
      expect(queue.model()).toBeNull();
    }
    expect(queue.pending).toBe(1);
    const frames = play(queue);
    expect(frames.findIndex((frame) => frame !== null) / 60).toBeCloseTo(ARRIVAL.gap, 1);
    expect(shown(frames).length / 60).toBeCloseTo(ARRIVAL_TOTAL, 1);
  });

  it('a card cut short while its ink was being drawn is shown again, whole, from the start', () => {
    const queue = new ArrivalQueue();
    queue.add(STEEPLE);
    for (let frame = 0; frame < 40; frame += 1) queue.update(FRAME, false, 'animated');
    expect(queue.model()).toMatchObject({ phase: 'arriving' });
    queue.update(FRAME, true, 'animated');
    expect(queue.model()).toBeNull();
    const again = shown(play(queue));
    expect(again[0]).toMatchObject({ title: 'Steeple Rock', ink: 0, phase: 'arriving' });
    expect(again.length / 60).toBeCloseTo(ARRIVAL_TOTAL, 1);
  });

  it('a card cut short after it was finished has been read: it is gone, and the next one follows', () => {
    const queue = new ArrivalQueue();
    queue.addAll([STEEPLE, KNOLL]);
    for (let frame = 0; frame < 120; frame += 1) queue.update(FRAME, false, 'animated');
    expect(queue.model()).toMatchObject({ title: 'Steeple Rock', phase: 'holding' });
    queue.update(FRAME, true, 'animated');
    expect(queue.model()).toBeNull();
    expect(new Set(shown(play(queue)).map((frame) => frame.title))).toEqual(new Set(['Home Knoll']));
  });
});

describe('a picture of a card', () => {
  it('pin holds one moment of one card until it is cleared', () => {
    const queue = new ArrivalQueue();
    queue.pin('island:steeple_rock', 0.5);
    const held = queue.model();
    expect(held).toEqual(arrivalFrame(STEEPLE, 'animated', 0.5));
    for (let frame = 0; frame < 300; frame += 1) queue.update(FRAME, frame % 2 === 0, 'animated');
    expect(queue.model()).toEqual(held);
    queue.clear();
    expect(queue.model()).toBeNull();
  });
});

// --- The whole road: rules, app, model ---------------------------------------------------------------------------

interface Client { app: App; models: InterfaceModel[] }

function client(storage = new FakeStorage(), reducedMotion = false): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, canoeBounds: () => null, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage, now: () => 5000, randomSeed: () => 42, reducedMotion });
  return { app, models };
}

const run = (app: App, seconds: number): void => {
  for (let passed = 0; passed < seconds - 1e-9; passed += FIXED_STEP) app.frame(FIXED_STEP);
};

const cardsShown = (models: InterfaceModel[]): string[] =>
  models.map((model) => model.arrival?.title ?? null).filter((title, index, all): title is string => title !== null && title !== all[index - 1]);

/** A point this many metres off an island's shore, due north of its middle. */
function offShore(islandId: keyof typeof ISLANDS_BY_ID, metres: number): { x: number; z: number } {
  const island = ISLANDS_BY_ID[islandId];
  let z = island.center.z;
  while (shoreDistance(island, island.center.x, z) < metres) z -= 0.5;
  return { x: island.center.x, z };
}

/** A new game afloat 10 m off Cabin Roofs: the next look at the surroundings reaches it. */
function offCabinRoofs(crew = 1): GameState {
  const game = newGame(7, { crew });
  const near = offShore('cabin_roofs', 10);
  floatCanoeAt(game, near.x, near.z, 0);
  for (const player of game.players) player.position = { x: near.x, y: 0, z: near.z };
  drainEvents(game);
  return game;
}

describe('on the screen', () => {
  it('first arrival: the card comes up once, in the model, and is gone 3.8 s later', () => {
    const { app, models } = client();
    app.session.adoptGame(offCabinRoofs());
    run(app, 6);
    expect(cardsShown(models)).toEqual(['Cabin Roofs']);
    const frames = models.filter((model) => model.arrival);
    expect(frames[0].arrival).toMatchObject({ kicker: 'The Shallows', title: 'Cabin Roofs', motion: 'animated', ink: 0 });
    expect(frames.length * FIXED_STEP).toBeCloseTo(ARRIVAL_TOTAL, 1);
    expect(models.at(-1)!.arrival).toBeNull();
    // Second arrival: paddle off and come back. Nothing.
    const game = app.session.game!;
    floatCanoeAt(game, 150, 900, 0);
    run(app, 1);
    const near = offShore('cabin_roofs', 10);
    floatCanoeAt(game, near.x, near.z, 0);
    run(app, 6);
    expect(cardsShown(models)).toEqual(['Cabin Roofs']);
  });

  it('never over an open panel: it waits for the panel to close', () => {
    const { app, models } = client();
    app.session.adoptGame(offCabinRoofs());
    app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    // Alone, a panel freezes the game: the place is reached on the first step after it closes. With a crew the world runs on.
    run(app, 3);
    expect(cardsShown(models)).toEqual([]);
    app.session.handleIntent({ type: 'close_panel' });
    run(app, 6);
    expect(cardsShown(models)).toEqual(['Cabin Roofs']);
    for (const model of models) if (model.arrival) expect(model.openPanels).toEqual([]);
  });

  it('never over a panel while the world runs on (a crew): reached with the map open, shown when it closes', () => {
    const { app, models } = client();
    const game = offCabinRoofs(2);
    app.session.adoptGame(game);
    app.session.handleIntent({ type: 'open_panel', panel: 'map' });
    run(app, 3);
    expect(game.reachedPlaces).toContain('island:cabin_roofs');
    expect(cardsShown(models)).toEqual([]);
    app.session.handleIntent({ type: 'close_panel' });
    run(app, 6);
    expect(cardsShown(models)).toEqual(['Cabin Roofs']);
  });

  it('never over a conversation', () => {
    const { app, models } = client();
    const game = newGame(7);
    game.reachedPlaces = PLACES.map((place) => place.id).filter((id) => id !== 'landmark:orchard_hill:farmhouse');
    standOn(game, 'orchard_hill');
    const odile = spotPosition(ISLANDS_BY_ID.orchard_hill, NPCS.odile.spot);
    teleport(game, 'orchard_hill', odile.x + 1.2, odile.z);
    drainEvents(game);
    app.session.adoptGame(game);
    expect(dispatch(game, { type: 'talk', npcId: 'odile' }, 0).ok).toBe(true);
    run(app, 3);
    expect(game.reachedPlaces).toContain('landmark:orchard_hill:farmhouse');
    expect(app.session.panels.stack).toEqual(['dialogue']);
    expect(cardsShown(models)).toEqual([]);
    app.session.handleIntent({ type: 'close_panel' });
    run(app, 6);
    expect(cardsShown(models)).toEqual(['The Farmhouse']);
  });

  it('never over the built view: reached while the canoe is held on the screen, shown once the screen is free', () => {
    const { app, models } = client();
    // Two aboard a beached canoe at Home Knoll, with what the patched hull costs. A crew: the world runs on under the panel.
    const game = newGame(7, { crew: 2 });
    game.reachedPlaces = ['island:home_knoll'];
    standOn(game, 'home_knoll');
    for (const { itemId, count } of HULL_TIERS[1].cost) give(game, itemId, count, 'cargo');
    drainEvents(game);
    app.session.adoptGame(game);
    app.frame(FIXED_STEP);
    app.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' });
    app.frame(FIXED_STEP);
    app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    app.frame(FIXED_STEP);
    expect(app.session.builtView).not.toBeNull();
    // The crewmate walks up to Cabin Roofs meanwhile.
    const near = offShore('cabin_roofs', 5);
    Object.assign(game.players[1], { mode: 'foot', seat: null, position: { x: near.x, y: 0, z: near.z } });
    run(app, 1);
    expect(game.reachedPlaces).toContain('island:cabin_roofs');
    expect(models.at(-1)!.built).not.toBeNull();
    run(app, 4);
    // The view is over and the builder is back: still not over a panel.
    expect(app.session.builtView).toBeNull();
    expect(cardsShown(models)).toEqual([]);
    app.session.handleIntent({ type: 'close_panel' });
    run(app, 6);
    expect(cardsShown(models)).toEqual(['Cabin Roofs']);
    for (const model of models) if (model.arrival) expect([model.built, model.openPanels]).toEqual([null, []]);
  });

  it('a guest sees it too, once, when the host is the first to get there', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = newGame(7);
    floatCanoeAt(game, 150, 900, 0);
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({ delay: 0.1 });
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    expect(guest.app.session.screen).toBe('game');
    expect(cardsShown(guest.models)).toEqual([]);
    const near = offShore('cabin_roofs', 10);
    floatCanoeAt(game, near.x, near.z, 0);
    tick(6);
    expect(cardsShown(host.models)).toEqual(['Cabin Roofs']);
    expect(cardsShown(guest.models)).toEqual(['Cabin Roofs']);
    // And the guest's copy of the game knows the place: joining again later would not replay it.
    expect(guest.app.session.game!.reachedPlaces).toContain('island:cabin_roofs');
  });

  it('back in the lobby, a card that was waiting is forgotten', () => {
    const { app, models } = client();
    app.session.adoptGame(offCabinRoofs());
    app.session.handleIntent({ type: 'open_panel', panel: 'pause' });
    run(app, 0.5);
    app.arrivals.add(STEEPLE);
    expect(app.arrivals.pending).toBe(1);
    app.session.handleIntent({ type: 'quit_to_lobby' });
    app.session.handleIntent({ type: 'answer_confirm', accepted: true });
    run(app, 6);
    expect(app.session.screen).toBe('lobby');
    expect(app.arrivals.pending).toBe(0);
    expect(cardsShown(models)).toEqual([]);
  });
});

describe('the setting', () => {
  it('is Animated by default, on the Accessibility tab, with Still and Off beside it', () => {
    const settings = createDefaultSettings();
    expect(settings.accessibility.arrivalCards).toBe('animated');
    const row = settingsRows(settings, 'accessibility').find((entry) => entry.setting === 'accessibility.arrivalCards');
    expect(row).toMatchObject({ kind: 'choice', label: 'Arrival cards', value: 'animated', valueText: 'Animated' });
    expect(row?.kind === 'choice' ? row.options.map((option) => option.label) : []).toEqual(['Animated', 'Still', 'Off']);
  });

  it('a browser that asks for less motion starts on Still, until the player picks', () => {
    const fresh = new FakeStorage();
    expect(loadSettings(fresh).accessibility.arrivalCards).toBe('animated');
    expect(loadSettings(fresh, { reducedMotion: true }).accessibility.arrivalCards).toBe('still');
    // Settings stored before the cards existed carry no choice: Still there too.
    const old = new FakeStorage();
    const before = createDefaultSettings() as unknown as { accessibility: Record<string, unknown> };
    delete before.accessibility.arrivalCards;
    old.setItem(SETTINGS_KEY, JSON.stringify(before));
    expect(loadSettings(old, { reducedMotion: true }).accessibility.arrivalCards).toBe('still');
    expect(loadSettings(old).accessibility.arrivalCards).toBe('animated');
    // The player's own choice wins, either way.
    for (const choice of ['animated', 'off', 'still'] as const) {
      const chosen = new FakeStorage();
      const settings = createDefaultSettings();
      settings.accessibility.arrivalCards = choice;
      saveSettings(chosen, settings);
      expect(loadSettings(chosen, { reducedMotion: true }).accessibility.arrivalCards).toBe(choice);
      expect(loadSettings(chosen).accessibility.arrivalCards).toBe(choice);
    }
    // Junk is not a choice.
    expect(sanitizeSettings({ accessibility: { arrivalCards: 'spinning' } }).accessibility.arrivalCards).toBe('animated');
  });

  it('Still on the screen: the card stands with not one value changing. Off: no card', () => {
    const still = client(new FakeStorage(), true);
    expect(still.app.session.settings.accessibility.arrivalCards).toBe('still');
    still.app.session.adoptGame(offCabinRoofs());
    run(still.app, 6);
    const frames = still.models.filter((model) => model.arrival).map((model) => model.arrival);
    expect(frames.length * FIXED_STEP).toBeCloseTo(ARRIVAL.still, 1);
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(1);
    expect(frames[0]).toMatchObject({ title: 'Cabin Roofs', motion: 'still', ink: 1, lift: 0, seal: 1 });

    const off = client();
    off.app.session.handleIntent({ type: 'change_setting', setting: 'accessibility.arrivalCards', value: 'off' });
    expect(off.app.session.settings.accessibility.arrivalCards).toBe('off');
    const game = offCabinRoofs();
    off.app.session.adoptGame(game);
    run(off.app, 6);
    expect(game.reachedPlaces).toContain('island:cabin_roofs');
    expect(cardsShown(off.models)).toEqual([]);
  });
});
