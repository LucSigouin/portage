/**
 * Luc, Round 4: "also the fire you cant interact with it?", then "f at fire should open cooking yes". On whole
 * clients: F at a camp's fire says "Cook at the fire" and opens the menu that holds the fire's recipes.
 *
 * For whoever merges this with the round's crafting change (C lists hand crafts only, a station has its own menu):
 * the key must open the menu of the station the rules name (`interactable.station`), not always the bench's. The
 * last check of each test is the one that goes red if it does not: the open panel shows what a fire cooks.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { CAMP_LAYOUTS, RECIPES, RECIPE_IDS } from '../../src/data/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, approachTo, drainEvents, terrainHeight } from '../../src/sim/index.ts';
import type { GameState, PlayerState } from '../../src/sim/index.ts';
import { FakeStorage, newGame, standOn } from '../support.ts';

interface Client { app: App; models: InterfaceModel[] }

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  return { app, models };
}

function frames(app: App, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) app.frame(FIXED_STEP);
}

/** The canoe on the island's beach, the first quest done, a sky that holds. */
function ashoreGame(islandId: IslandId): GameState {
  const game = newGame(7);
  standOn(game, islandId);
  game.weather.secondsRemaining = 99999;
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  drainEvents(game);
  return game;
}

/** At the fire's edge: the nearest clear ground to its middle, where a walker is held. */
function standAtFire(player: PlayerState, islandId: IslandId, kind: 'campfire' | 'forge_hearth'): void {
  const fire = CAMP_LAYOUTS[islandId]!.landmarks.find((landmark) => landmark.kind === kind)!;
  const { x, z } = approachTo(fire.x, fire.z);
  Object.assign(player, { mode: 'foot', seat: null, islandId, position: { x, y: terrainHeight(x, z), z } });
}

const recipesOf = (station: 'fire' | 'forge'): string[] => RECIPE_IDS.filter((recipeId) => RECIPES[recipeId].station === station).map((recipeId) => RECIPES[recipeId].name);

/** Every recipe name the open panel shows, wherever in it. */
function shown(models: InterfaceModel[]): string {
  const panel = models.at(-1)!.panel;
  expect(panel, 'a panel is open').not.toBeNull();
  return JSON.stringify(panel);
}

describe('F at the fire (Luc, Round 4)', () => {
  it('says "Cook at the fire" and opens the menu that cooks: every fire recipe is on it', () => {
    const solo = client();
    const game = ashoreGame('home_knoll');
    standAtFire(game.players[0], 'home_knoll', 'campfire');
    solo.app.session.adoptGame(game);
    frames(solo.app, 0.1);
    expect(solo.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Cook at the fire', keyLabel: 'F' });
    expect(solo.app.session.isOpen('crafting')).toBe(false);
    solo.app.session.keyDown('KeyF');
    solo.app.session.keyUp('KeyF');
    expect(solo.app.session.isOpen('crafting')).toBe(true);
    frames(solo.app, 0.1);
    // Nothing went to the rules: no refusal, no command.
    expect(solo.models.at(-1)!.toasts.map((toast) => toast.text)).toEqual([]);
    expect(recipesOf('fire')).toContain('Cooked fish');
    for (const name of recipesOf('fire')) expect(shown(solo.models), name).toContain(`"${name}"`);
  });

  it('does the same at a camp with a fire and no bench', () => {
    const solo = client();
    const game = ashoreGame('orchard_hill');
    standAtFire(game.players[0], 'orchard_hill', 'campfire');
    solo.app.session.adoptGame(game);
    frames(solo.app, 0.1);
    expect(solo.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Cook at the fire', keyLabel: 'F' });
    solo.app.session.keyDown('KeyF');
    solo.app.session.keyUp('KeyF');
    frames(solo.app, 0.1);
    expect(solo.app.session.isOpen('crafting')).toBe(true);
    for (const name of recipesOf('fire')) expect(shown(solo.models), name).toContain(`"${name}"`);
  });

  it('says "Use the forge" at Tink\'s hearth and opens on what a forge makes', () => {
    const solo = client();
    const game = ashoreGame('scrapyard_bar');
    standAtFire(game.players[0], 'scrapyard_bar', 'forge_hearth');
    solo.app.session.adoptGame(game);
    frames(solo.app, 0.1);
    expect(solo.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Use the forge', keyLabel: 'F' });
    solo.app.session.keyDown('KeyF');
    solo.app.session.keyUp('KeyF');
    frames(solo.app, 0.1);
    expect(solo.app.session.isOpen('crafting')).toBe(true);
    for (const name of recipesOf('forge')) expect(shown(solo.models), name).toContain(`"${name}"`);
  });

  it('does the same on a guest\'s screen', () => {
    const game = ashoreGame('home_knoll');
    const host = client();
    const guest = client();
    host.app.session.playerName = 'Luc';
    host.app.session.onShare = (link) => link.accept(pair.host);
    const pair = createLoopbackPair({});
    host.app.session.adoptGame(game);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    expect(guest.app.session.localPlayerId).toBe(1);
    standAtFire(game.players[1], 'home_knoll', 'campfire');
    tick(0.5);
    expect(guest.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Cook at the fire', keyLabel: 'F' });
    guest.app.session.keyDown('KeyF');
    guest.app.session.keyUp('KeyF');
    tick(0.1);
    expect(guest.app.session.isOpen('crafting')).toBe(true);
    for (const name of recipesOf('fire')) expect(shown(guest.models), name).toContain(`"${name}"`);
  });
});
