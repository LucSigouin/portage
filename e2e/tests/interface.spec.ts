/**
 * The Ink & Wash interface in a real browser, headless.
 *
 * - every staged shot renders with a clean console and nothing off this site;
 * - nothing scrolls sideways and no text is clipped at 720p, 1080p, 1440p and 4K;
 * - every control on every menu, panel and dialog is reached and pressed by keyboard, and sends its intent;
 * - a settings change and a key rebind made by keyboard work end to end and survive a reload;
 * - a slider drag and the keyboard focus survive frames that redraw the panel (the DOM is diffed, not rebuilt);
 * - with the inventory open the interface adds under half a millisecond a frame, and the whole frame's work stays under 6 ms;
 * - every row that names an item shows that item's icon, sharp and inside its card at every size;
 * - nothing on screen moves by itself, and opening a panel moves nothing else;
 * - a panel that runs past the bottom of a short window says so with a still mark, and a panel that fits has none;
 * - with a crew: a row a player in the crew card, each following its own player; a toque in each
 *   crewmate's colour at their place on the compass and the map; the card clear of the middle of
 *   the view and of every other card; a crewmate's new tool told on this screen;
 * - alone: no crew card or mark, and the cards the same pixels as with a crew;
 * - the lobby menu is written once its faces are in, and never moves.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
/** Not a gate: set PORTAGE_UI_SCALE=1.5 to run the layout checks at another interface size. */
const UI_SCALE = Number(process.env.PORTAGE_UI_SCALE ?? 1);

test.use({
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(600_000);

/** `stage` is a script run in the page with `portage` in hand, to put the crew where a view needs them. */
type Step = { intent: Record<string, unknown> } | { key: string } | { stage: string } | { click: string };

interface View {
  name: string;
  query: string;
  steps?: Step[];
  /** Something that must be on screen once the view is up. */
  shows: string;
}

const open = (panel: string): Step => ({ intent: { type: 'open_panel', panel } });
const settingsTab = (tab: string): Step[] => [open('settings'), { intent: { type: 'select_settings_tab', tab } }];

/** Every `?shot=` the game can stage. */
const SHOTS: View[] = [
  { name: 'lobby', query: '?shot=lobby', shows: '.iw-lobby-col' },
  { name: 'settings', query: '?shot=settings', shows: '.iw-panel-settings' },
  { name: 'play', query: '?shot=play', shows: '.iw-vitals' },
  { name: 'island', query: '?shot=island', shows: '.iw-prompt' },
  { name: 'inventory', query: '?shot=inventory', shows: '.iw-panel-inventory' },
  { name: 'crafting', query: '?shot=crafting', shows: '.iw-panel-crafting' },
  { name: 'builder', query: '?shot=builder', shows: '.iw-panel-canoe_builder' },
  { name: 'quests', query: '?shot=quests', shows: '.iw-panel-quest_log' },
  { name: 'map', query: '?shot=map', shows: '.iw-panel-map' },
  { name: 'dialogue', query: '?shot=dialogue', shows: '.iw-panel-dialogue' },
  { name: 'pause', query: '?shot=pause', shows: '.iw-panel-pause' },
  { name: 'storm', query: '?shot=storm', shows: '.iw-vitals' },
  { name: 'night', query: '?shot=night', shows: '.iw-vitals' },
  { name: 'upgraded', query: '?shot=upgraded', shows: '.iw-vitals' },
  { name: 'beacon', query: '?shot=beacon', shows: '.iw-vitals' },
];

/** The menus, dialogs and states the shots do not reach. */
const MENUS: View[] = [
  { name: 'how to play', query: '', steps: [open('how_to_play')], shows: '.iw-panel-how_to_play' },
  { name: 'credits', query: '', steps: [open('credits')], shows: '.iw-panel-credits' },
  { name: 'save slots', query: '', steps: [open('save_slots')], shows: '.iw-panel-save_slots' },
  { name: 'settings: graphics', query: '', steps: settingsTab('graphics'), shows: '[data-setting="graphics.fpsCap"]' },
  { name: 'settings: controls', query: '', steps: settingsTab('controls'), shows: '.iw-bindings' },
  { name: 'settings: gameplay', query: '', steps: settingsTab('gameplay'), shows: '[data-setting="gameplay.hints"]' },
  { name: 'settings: accessibility', query: '', steps: settingsTab('accessibility'), shows: '[data-setting="accessibility.uiScale"]' },
  { name: 'confirm dialog', query: '', steps: [...settingsTab('controls'), { intent: { type: 'reset_key_bindings' } }], shows: '.iw-confirm-box' },
  { name: 'a toast in play', query: '?at=quest1', steps: [{ key: 'KeyL' }], shows: '.iw-toast' },
  { name: 'the whole chart', query: '?shot=beacon', steps: [open('map')], shows: '.iw-chart' },
  { name: 'pause over the settings', query: '?shot=pause', steps: settingsTab('controls'), shows: '.iw-bindings' },
  { name: 'settings: waiting for a key', query: '', steps: [...settingsTab('controls'), { intent: { type: 'begin_rebind', action: 'paddle', slot: 0 } }], shows: '.iw-listen' },
  { name: 'credits at the Beacon', query: '?shot=beacon', steps: [open('credits')], shows: '.iw-panel-credits' },
  // The crew lobby's two cards, with the longest name there is. Neither needs the relay: nothing is dialled.
  { name: 'host a crew', query: '', steps: [open('crew_host'), { intent: { type: 'crew_field', field: 'name', value: 'Bartholomew W' } }], shows: '.iw-panel-crew_host' },
  {
    name: 'join a crew, with a complaint', query: '', shows: '.iw-crew-status.iw-tone-warning',
    steps: [open('crew_join'), { intent: { type: 'crew_field', field: 'code', value: 'HELLO' } },
      { intent: { type: 'crew_field', field: 'name', value: 'Bartholomew W' } }, { intent: { type: 'crew_join' } }],
  },
  // An inventory tile pressed open: what the item is and what can be done with it. And two open, in the bag and the boat.
  { name: 'inventory, a row opened', query: '?shot=inventory', steps: [{ click: '.iw-item-pick' }], shows: '.iw-item-detail' },
  {
    name: 'inventory, a row opened in each column', query: '?shot=inventory', shows: '.iw-item-detail',
    steps: [{ click: '.iw-inv-pack .iw-item-pick >> nth=-1' }, { click: '.iw-inv-boat .iw-item-pick' }],
  },
  // The room card with its code and its link. This one dials the relay: set PORTAGE_RELAY_UP=1 when it is running (relay/, npm run dev).
  ...(process.env.PORTAGE_RELAY_UP ? [{
    name: 'host a crew, the room open', query: '', shows: '.iw-code',
    steps: [open('crew_host'), { intent: { type: 'crew_field', field: 'name', value: 'Bartholomew W' } }, { intent: { type: 'crew_open_room' } }],
  }] : []),
];

/** Put one player ashore on an island, a few metres east of its middle. Used by the staging scripts below. */
const PUT_ASHORE = `
  const data = await import('/src/data/index.ts');
  const game = portage.session.game;
  const put = (player, islandId, east) => {
    const centre = data.ISLANDS_BY_ID[islandId].center;
    Object.assign(player, { mode: 'foot', seat: null, asleep: false, islandId, position: { x: centre.x + east, y: 1, z: centre.z } });
  };
`;
/** You and player 4 in the canoe; player 2 asleep on Cabin Roofs; player 3 worn out on Home Knoll. */
const SPLIT_CREW = `${PUT_ASHORE}
  put(game.players[1], 'cabin_roofs', 4);
  put(game.players[2], 'home_knoll', 6);
  game.players[1].asleep = true;
  game.players[2].energy = 9;
`;
/** The most the crew card ever has to hold: everyone else far off on the island with the longest name, every meter low. */
const CREW_IN_TROUBLE = `${PUT_ASHORE}
  const longest = data.ISLANDS.reduce((first, second) => (second.name.length > first.name.length ? second : first));
  for (const player of game.players.slice(1)) {
    put(player, longest.id, 0);
    Object.assign(player, { hunger: 5, thirst: 5, energy: 5 });
  }
`;
/** Player 3 comes back (a `?crew=N` stand-in is away, and nobody acts for an away player) and makes the crew's first knife. */
const CREWMATE_MAKES_A_KNIFE = `
  const sim = await import('/src/sim/index.ts');
  const game = portage.session.game;
  sim.setConnected(game, 2, true, true);
  game.players[2].backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
  if (!sim.dispatch(game, { type: 'craft', recipeId: 'stone_knife' }, 2).ok) throw new Error('the knife was not made');
`;

/** The HUD with a crew (`?crew=N`): the crew card, the crewmates' marks, a crew note. */
const CREW: View[] = [
  { name: 'crew of 2, afloat', query: '?shot=play&crew=2', shows: '.iw-crew' },
  { name: 'crew of 3, ashore', query: '?shot=island&crew=3', shows: '.iw-crew' },
  { name: 'crew of 4, afloat', query: '?shot=play&crew=4', shows: '.iw-crew' },
  { name: 'crew of 4, ashore', query: '?shot=island&crew=4', shows: '.iw-crew' },
  { name: 'crew of 4, split up', query: '?shot=play&crew=4', steps: [{ stage: SPLIT_CREW }], shows: '.iw-mark-crew' },
  { name: 'crew of 4, everyone in trouble', query: '?shot=play&crew=4', steps: [{ stage: CREW_IN_TROUBLE }], shows: '.iw-mate-alert' },
  { name: 'crew of 4, on the map', query: '?shot=play&crew=4', steps: [{ stage: SPLIT_CREW }, open('map')], shows: '.iw-marker-crew' },
  { name: 'a crew note in play', query: '?at=quest1&crew=3', steps: [{ stage: CREWMATE_MAKES_A_KNIFE }], shows: '.iw-toast' },
];

/** Views with something for the keyboard to work: a lobby, a panel or a dialog. `tab` where the game leaves Tab alone. */
const SURFACES: (View & { tab: boolean })[] = [
  { ...SHOTS[0]!, tab: true },
  { ...SHOTS[1]!, tab: true },
  ...MENUS.slice(0, 8).map((view) => ({ ...view, tab: true })),
  ...['inventory', 'crafting', 'builder', 'quests', 'map', 'dialogue', 'pause'].map((name) => ({
    ...SHOTS.find((shot) => shot.name === name)!, tab: false,
  })),
];

/** Collect what a clean page must not do: console errors and warnings, crashes, failed or off-site requests. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  const origin = new URL(BASE).origin;
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    // The graphics driver's own performance chatter is not a page fault (same rule as shoot.mjs).
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  page.on('request', (request) => {
    const target = request.url();
    if (!target.startsWith(origin) && !target.startsWith('data:') && !target.startsWith('blob:')) problems.push(`off-origin request: ${target}`);
  });
  return problems;
}

const frames = (page: Page, count = 2): Promise<void> => page.evaluate((wanted) => new Promise<void>((resolve) => {
  const step = (left: number): void => void (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(wanted);
}), count);

/** Run a staging script in the page: an async body with `portage` in hand. */
const stage = (page: Page, script: string): Promise<void> => page.evaluate(
  (body) => new (Object.getPrototypeOf(async () => {}).constructor)('portage', body)((window as any).portage) as Promise<void>, script,
);

async function show(page: Page, view: View): Promise<void> {
  await page.goto(`${BASE}/${view.query}`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel != null);
  await page.evaluate(() => document.fonts.ready);
  if (UI_SCALE !== 1) {
    await page.evaluate((value) => (window as any).portage.session.handleIntent({ type: 'change_setting', setting: 'accessibility.uiScale', value }), UI_SCALE);
  }
  for (const step of view.steps ?? []) {
    if ('key' in step) await page.keyboard.press(step.key);
    else if ('click' in step) await page.locator(step.click).first().click();
    else if ('stage' in step) await stage(page, step.stage);
    else await page.evaluate((intent) => (window as any).portage.session.handleIntent(intent), step.intent);
    await frames(page, 3);
  }
  await expect(page.locator(view.shows).first(), `${view.name} shows ${view.shows}`).toBeVisible();
  // Let the short hover and tick transitions finish, so what is measured is the page at rest.
  await page.waitForTimeout(350);
}

const session = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((body) => new Function('portage', `return (${body});`)((window as any).portage) as never, read) as Promise<T>;

// --- Rendering ---------------------------------------------------------------------

test('every staged shot renders with a clean console, from this site only, and at rest', async ({ page }) => {
  const problems = watch(page);
  for (const view of [...SHOTS, ...MENUS, ...CREW]) {
    await show(page, view);
    const state = await page.evaluate(() => ({
      // Nothing may still be animating once the page has settled: no loops, no shimmer.
      running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      fonts: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, '')),
      greybox: document.querySelectorAll('[class*="gb-"]').length,
    }));
    expect(state.running, `${view.name}: animations still running`).toBe(0);
    expect(state.greybox, `${view.name}: greybox markup`).toBe(0);
    expect(new Set(state.fonts), `${view.name}: fonts`).toEqual(new Set(['IM Fell English', 'Kalam']));
    expect(problems, `${view.name}: console and network`).toEqual([]);
  }
});

// --- Layout ------------------------------------------------------------------------

/** Run in the page: everything that scrolls sideways, is cut off, or sits where it cannot be read. */
function layoutProblems(): string[] {
  const problems: string[] = [];
  const root = document.querySelector('.iw');
  if (!root) return ['the interface is not mounted'];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const name = (element: Element): string =>
    `${element.tagName.toLowerCase()}.${String(element.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')}`
    + ` "${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;

  const page = document.documentElement;
  if (page.scrollWidth > width || page.scrollHeight > height) problems.push(`the page scrolls: ${page.scrollWidth} x ${page.scrollHeight}`);

  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.closest('svg, [data-clips], [hidden]')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.display === 'contents' || style.display === 'inline') continue;
    if (style.overflowX !== 'visible' && element.scrollWidth > element.clientWidth + 1) {
      problems.push(`scrolls or is cut off sideways (${element.scrollWidth} > ${element.clientWidth}): ${name(element)}`);
    }
    if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && element.scrollHeight > element.clientHeight + 1) {
      problems.push(`cut off below (${element.scrollHeight} > ${element.clientHeight}): ${name(element)}`);
    }
  }

  // Every run of text: on the screen, inside its card, and not under the edge of a scrolling body.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  // The torn edge of the lobby page comes no further left than 81% of the page's width.
  const lobby = root.querySelector('.iw-lobby');
  const pageEdge = lobby ? Number.parseFloat(getComputedStyle(lobby, '::before').width) * 0.81 : width;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !(node.textContent ?? '').trim() || parent.closest('svg, [data-clips], [hidden], option')) continue;
    range.selectNodeContents(node);
    const boxes = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0);
    if (boxes.length === 0) {
      problems.push(`text is not drawn: ${name(parent)}`);
      continue;
    }
    const scroller = parent.closest('.iw-body');
    const scrollerBox = scroller?.getBoundingClientRect();
    // The four letters round the map's chart sit on its rim on purpose, half in and half out: the card they stay inside is the panel.
    const cards = '.iw-panel, .iw-crew, .iw-vitals, .iw-notes, .iw-prompt, .iw-toast, .iw-hint, .iw-debug, .iw-chart, .iw-mark-chip';
    const card = parent.closest('.iw-rim-letter') ? parent.closest('.iw-panel') : parent.closest(cards);
    // A line of handwriting is boxed taller than it is drawn (the face has long ascenders), so allow that much above and below.
    const slack = Number.parseFloat(getComputedStyle(parent).fontSize) * 0.45;
    const cardBox = card?.getBoundingClientRect();
    const onLobby = parent.closest('.iw-lobby-col') !== null;
    // Words on a button, key cap or cost chip stay inside it. (The name over a selected tool card sits above the card on purpose.)
    const holderBox = parent.closest('.iw-nm') ? undefined : parent.closest('button, .iw-key, .iw-cost')?.getBoundingClientRect();
    for (const box of boxes) {
      const where = `${name(parent)} at ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
      if (box.left < -0.5 || box.right > width + 0.5) problems.push(`off the screen sideways: ${where}`);
      if (!scroller && (box.top < -0.5 || box.bottom > height + 0.5)) problems.push(`off the screen: ${where}`);
      if (cardBox && (box.left < cardBox.left - 0.5 || box.right > cardBox.right + 0.5)) problems.push(`spills out of its card sideways: ${where}`);
      if (cardBox && !scroller && (box.top < cardBox.top - slack || box.bottom > cardBox.bottom + slack)) problems.push(`spills out of its card: ${where}`);
      if (scrollerBox && (box.left < scrollerBox.left - 0.5 || box.right > scrollerBox.right + 0.5)) problems.push(`cut off by its scrolling body: ${where}`);
      if (onLobby && box.right > pageEdge) problems.push(`runs off the lobby page onto the scene: ${where}`);
      if (holderBox && (box.left < holderBox.left - 0.5 || box.right > holderBox.right + 0.5)) problems.push(`spills out of its button or chip: ${where}`);
      if (box.height < 9) problems.push(`too small to read (${box.height.toFixed(1)} px tall): ${where}`);
    }
  }
  return problems;
}

for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
  test(`nothing scrolls sideways and no text is clipped at ${size.width}x${size.height}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    for (const view of [...SHOTS, ...MENUS, ...CREW]) {
      await show(page, view);
      expect(await page.evaluate(layoutProblems), `${view.name} at ${size.width}x${size.height}`).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}

// --- Contrast ----------------------------------------------------------------------

/** Run in the page: every run of text whose colour does not pass WCAG AA against the ground it is drawn on. */
function contrastProblems(): string[] {
  const problems: string[] = [];
  const root = document.querySelector('.iw');
  if (!root) return ['the interface is not mounted'];
  const parse = (colour: string): [number, number, number, number] | null => {
    const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(colour);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
  };
  const luminance = ([red, green, blue]: number[]): number => {
    const channel = (value: number): number => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(red!) + 0.7152 * channel(green!) + 0.0722 * channel(blue!);
  };
  /** The nearest solid ground behind an element: its own background, or the sheet a card or the lobby lays behind itself as `::before`. */
  const groundOf = (start: Element): number[] | null => {
    for (let element: Element | null = start; element; element = element.parentElement) {
      const own = parse(getComputedStyle(element).backgroundColor);
      if (own && own[3] >= 0.99) return own;
      const sheet = getComputedStyle(element, '::before');
      const behind = parse(sheet.backgroundColor);
      if (behind && behind[3] >= 0.99 && sheet.content !== 'none' && sheet.zIndex === '-1') return behind;
    }
    return null;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !(node.textContent ?? '').trim()) continue;
    // Not judged: drawn marks, what is hidden, what lies under a panel (it cannot be used), and controls that are switched off.
    if (parent.closest('svg, [hidden], [inert], option, button:disabled')) continue;
    const style = getComputedStyle(parent);
    const ink = parse(style.color);
    const ground = groundOf(parent);
    const label = `${parent.tagName.toLowerCase()}.${String(parent.getAttribute('class') ?? '')} "${(node.textContent ?? '').trim().slice(0, 30)}"`;
    if (!ink || !ground) {
      problems.push(`no solid ground behind the text: ${label}`);
      continue;
    }
    for (let element: Element | null = parent; element && element !== root; element = element.parentElement) {
      if (Number(getComputedStyle(element).opacity) < 1) problems.push(`drawn faint (opacity below 1): ${label}`);
    }
    const [light, dark] = [luminance(ink), luminance(ground)].sort((first, second) => second - first) as [number, number];
    const ratio = (light + 0.05) / (dark + 0.05);
    const pixels = Number.parseFloat(style.fontSize);
    const large = pixels >= 24 || (pixels >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) problems.push(`contrast ${ratio.toFixed(2)} to 1 (${style.color} on rgb(${ground.slice(0, 3).join(', ')})): ${label}`);
  }
  return problems;
}

test('all text on paper passes WCAG AA contrast, on solid ground, never drawn faint', async ({ page }) => {
  for (const view of [...SHOTS, ...MENUS, ...CREW]) {
    await show(page, view);
    expect(await page.evaluate(contrastProblems), view.name).toEqual([]);
  }
});

// --- Keyboard ----------------------------------------------------------------------

interface Focused {
  /** Position among the controls of the open surface, or -1. */
  index: number;
  button: boolean;
  /** An inventory row: it opens what the item is under itself and sends nothing to the game. */
  opens: boolean;
  /** Its `aria-expanded`, for a row; null for anything else. */
  expanded: string | null;
  label: string;
}

/** Run in the page: the controls the keyboard should reach, and which one has the focus. */
function focusState(): { count: number; focused: Focused; ringShown: boolean } {
  // The top thing with controls on it: a dialog over a panel over the lobby.
  const surface = ['.iw-confirm', '.iw-veil', '.iw-lobby'].map((selector) => document.querySelector<HTMLElement>(selector))
    .find((element) => element && !element.hidden);
  const controls = surface
    ? [...surface.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')].filter((control) => control.getClientRects().length > 0)
    : [];
  const active = document.activeElement as HTMLElement | null;
  const style = active ? getComputedStyle(active) : null;
  // The ring is on the control, or on the drawn box of a tick box. A menu line shows its paddle mark and underline instead.
  const ringed = (element: Element | null): boolean => {
    if (!element) return false;
    const outline = getComputedStyle(element);
    return outline.outlineStyle !== 'none' && Number.parseFloat(outline.outlineWidth) >= 1;
  };
  const underlined = active?.matches('.iw-mi') === true && getComputedStyle(active, '::after').transform === 'matrix(1, 0, 0, 1, 0, 0)';
  return {
    count: controls.length,
    focused: {
      index: active ? controls.indexOf(active) : -1,
      button: active instanceof HTMLButtonElement,
      opens: active?.dataset.detail !== undefined,
      expanded: active?.getAttribute('aria-expanded') ?? null,
      // A slider, tick box or picker is known by its setting; a button by what it says.
      label: active?.getAttribute('data-setting') ?? (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40),
    },
    ringShown: style !== null && (ringed(active) || ringed(active?.matches('input[type="checkbox"]') ? active.nextElementSibling : null) || underlined),
  };
}

/** Run in the page: the intents of every enabled control in the top surface of the model. */
function expectedIntents(): string[] {
  const model = (window as any).portage.app.lastModel;
  const top = model.confirm ?? model.panel ?? model.lobby;
  const found: string[] = [];
  const walk = (value: any): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'intent' || key === 'rebind' || key === 'clear') {
          if (entry !== null && value.enabled !== false) found.push(JSON.stringify(entry));
        } else walk(entry);
      }
    }
  };
  walk(top);
  return found.sort();
}

test('every control on every menu, panel and dialog is reached and pressed by keyboard', async ({ page }) => {
  const problems = watch(page);
  for (const view of SURFACES) {
    await show(page, view);
    // Record what the interface sends instead of acting on it, so one visit can press every button.
    await page.evaluate(() => {
      const live = (window as any).portage.session;
      (window as any).sent = [];
      live.handleIntent = (intent: { type: string }) => {
        if (intent.type !== 'hover') (window as any).sent.push(JSON.stringify(intent));
      };
    });
    let { count } = await page.evaluate(focusState);
    expect(count, `${view.name}: controls`).toBeGreaterThan(0);

    // Into the menu: Tab where the game leaves Tab alone, an arrow key where Tab is the game's. Then Tab from control to control.
    // An inventory row, pressed, opens its actions right under it: they are the next controls, reached and pressed in turn.
    const reached = new Set<number>();
    let buttons = 0;
    let rowsOpened = 0;
    let pressed = 0;
    for (let press = 0; press < count; press += 1) {
      await page.keyboard.press(press > 0 || view.tab ? 'Tab' : 'ArrowDown');
      await frames(page, 2);
      const state = await page.evaluate(focusState);
      expect(state.focused.index, `${view.name}: press ${press + 1} left the open surface`).toBe(press);
      reached.add(state.focused.index);
      if (!state.ringShown) {
        // A menu line inks its underline in over a quarter of a second.
        await expect.poll(async () => (await page.evaluate(focusState)).ringShown, { message: `${view.name}: no focus mark on "${state.focused.label}"` }).toBe(true);
      }
      if (state.focused.button) {
        if (state.focused.opens) rowsOpened += 1;
        else buttons += 1;
        pressed += 1;
        // Enter and Space both press a button; use each in turn.
        await page.keyboard.press(pressed % 2 === 0 ? 'Space' : 'Enter');
        const after = await page.evaluate(focusState);
        expect(after.focused.index, `${view.name}: "${state.focused.label}" lost the focus when pressed`).toBe(state.focused.index);
        if (state.focused.opens) {
          expect([state.focused.expanded, after.focused.expanded], `${view.name}: "${state.focused.label}" opened`).toEqual(['false', 'true']);
        }
        count = after.count;
      }
    }
    // The inventory's rows are buttons, and every one of them was opened.
    const rowCount = await page.locator('.iw-veil:not([hidden]) .iw-item-pick').count();
    expect(rowsOpened, `${view.name}: inventory rows opened`).toBe(rowCount);
    if (view.name === 'inventory') expect(rowCount).toBeGreaterThan(2);
    expect(reached.size, `${view.name}: controls reached`).toBe(count);
    // One more step wraps round to the first control, and Shift+Tab steps back to the last.
    await page.keyboard.press('Tab');
    expect((await page.evaluate(focusState)).focused.index, `${view.name}: wrap`).toBe(0);
    await page.keyboard.press('Shift+Tab');
    expect((await page.evaluate(focusState)).focused.index, `${view.name}: back`).toBe(count - 1);

    const sent = await page.evaluate(() => ((window as any).sent as string[]).sort());
    expect(sent.length, `${view.name}: one intent per button, none for opening a row`).toBe(buttons);
    expect(sent, `${view.name}: the intents the model gave`).toEqual(await page.evaluate(expectedIntents));
  }

  // The arrow keys walk a menu of buttons both ways.
  await show(page, SHOTS[0]!);
  const { count: lobbyCount } = await page.evaluate(focusState);
  for (let press = 0; press < lobbyCount; press += 1) {
    await page.keyboard.press(press % 2 === 0 ? 'ArrowDown' : 'ArrowRight');
    expect((await page.evaluate(focusState)).focused.index).toBe(press);
  }
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  expect((await page.evaluate(focusState)).focused.index).toBe(lobbyCount - 3);
  expect(problems).toEqual([]);
});

test('the compass strip moves in whole degrees while the model carries fractions', async ({ page }) => {
  const problems = watch(page);
  await show(page, { name: 'play', query: '?at=quest7', shows: '.iw-vitals' });
  // Swing the camera a little: the heading is now some fraction of a degree.
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 6 });
  await page.mouse.up();
  await frames(page, 4);
  const compass = await page.evaluate(() => {
    const scope = window as unknown as { portage: { app: any } };
    const model = scope.portage.app.lastModel.hud.compass;
    const track = document.querySelector<HTMLElement>('.iw-track')!;
    return {
      modelHeading: model.headingDegrees as number,
      drawnHeading: Number(track.style.getPropertyValue('--heading')),
      drawnMarks: [...document.querySelectorAll<HTMLElement>('.iw-mark')].map((mark) => Number(mark.style.getPropertyValue('--at'))),
    };
  });
  // The model is fine-grained, for a strip that will one day slide on a transform...
  expect(Number.isInteger(compass.modelHeading)).toBe(false);
  // ...and this strip, which restyles every tick when it moves, still moves a whole degree at a time.
  // Writing fractions here redrew the compass every frame and cost the look its 55 frames a second.
  expect(Number.isInteger(compass.drawnHeading)).toBe(true);
  expect(Math.abs(compass.drawnHeading - compass.modelHeading)).toBeLessThanOrEqual(0.5);
  for (const at of compass.drawnMarks) expect(Number.isInteger(at)).toBe(true);
  expect(problems).toEqual([]);
});

test('Tab stays the game\'s key in play, Esc stays the session\'s, and the hotbar answers its number keys', async ({ page }) => {
  const problems = watch(page);
  await show(page, { name: 'play', query: '?at=quest7', shows: '.iw-vitals' });
  const panels = (): Promise<string[]> => session(page, '[...portage.session.panels.stack]');

  // With no menu up, Tab is the inventory key, and pressing it again closes the inventory.
  await page.keyboard.press('Tab');
  await frames(page, 3);
  expect(await panels()).toEqual(['inventory']);
  expect((await page.evaluate(focusState)).focused.index).toBe(-1);
  await page.keyboard.press('Tab');
  await frames(page, 3);
  expect(await panels()).toEqual([]);

  // An arrow key puts the keyboard on the panel. From then on Tab is the panel's: it moves the focus
  // and the inventory does not open. Esc with a button focused still backs out through the session.
  await page.keyboard.press('KeyC');
  await frames(page, 3);
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(focusState)).toMatchObject({ focused: { index: 0 } });
  expect((await page.evaluate(focusState)).count).toBeGreaterThan(2);
  await page.keyboard.press('Tab');
  await frames(page, 3);
  expect((await page.evaluate(focusState)).focused.index).toBe(1);
  expect(await panels()).toEqual(['crafting']);
  await page.keyboard.press('Escape');
  await frames(page, 3);
  expect(await panels()).toEqual([]);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // Hotbar cards are out of the Tab order (number keys pick them), but they are real buttons for the pointer.
  const tabStops = await page.locator('.iw-hotbar button').evaluateAll((slots) => slots.map((slot) => (slot as HTMLElement).tabIndex));
  expect(tabStops.length).toBeGreaterThan(0);
  expect(tabStops.every((stop) => stop === -1)).toBe(true);
  await page.keyboard.press('Digit1');
  await frames(page, 3);
  await expect(page.locator('.iw-hotbar .iw-selected')).toHaveCount(1);
  await page.locator('.iw-hotbar button').first().click();
  await frames(page, 3);
  await expect(page.locator('.iw-hotbar .iw-selected')).toHaveCount(0);
  // A click by pointer hands the keyboard straight back to the game.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(problems).toEqual([]);
});

/** Press a focus key until the focused control matches. */
async function focusOn(page: Page, matches: (focused: Focused) => boolean, key = 'Tab'): Promise<void> {
  for (let press = 0; press < 90; press += 1) {
    await page.keyboard.press(key);
    await frames(page, 2);
    if (matches((await page.evaluate(focusState)).focused)) return;
  }
  throw new Error('the keyboard never reached the control');
}

test('by keyboard alone: a settings change and a key rebind work end to end and survive a reload', async ({ page }) => {
  const problems = watch(page);
  await show(page, { name: 'lobby', query: '', shows: '.iw-lobby-col' });
  const settings = (): Promise<any> => session(page, 'JSON.parse(JSON.stringify(portage.session.settings))');

  // Lobby to Settings. The focus lands on the first control of the panel that opens.
  await focusOn(page, (focused) => focused.label === 'Settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('.iw-panel-settings')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(focusState)).focused.label).toBe('Audio');

  // A slider, by arrow keys.
  await focusOn(page, (focused) => focused.label === 'audio.master');
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowLeft');
  expect((await settings()).audio.master).toBeCloseTo(0.65, 5);
  await expect(page.locator('.iw-row', { hasText: 'Master volume' }).locator('output')).toHaveText('65%');

  // A tick box and a picker, on another tab.
  await focusOn(page, (focused) => focused.label === 'Accessibility');
  await page.keyboard.press('Enter');
  await focusOn(page, (focused) => focused.label === 'accessibility.patternedMeters');
  await page.keyboard.press('Space');
  expect((await settings()).accessibility).toMatchObject({ patternedMeters: true });
  await focusOn(page, (focused) => focused.label === 'Gameplay');
  await page.keyboard.press('Enter');
  await focusOn(page, (focused) => focused.label === 'gameplay.difficulty');
  // A closed picker takes the first letter of an option: R for "Relaxed (meters drain 40% slower)".
  await page.keyboard.press('KeyR');
  expect((await settings()).gameplay).toMatchObject({ difficulty: 'relaxed' });

  // A key rebind: Paddle from W to I.
  await focusOn(page, (focused) => focused.label === 'Controls');
  await page.keyboard.press('Enter');
  await focusOn(page, (focused) => focused.label === 'W');
  await page.keyboard.press('Enter');
  await expect(page.locator('.iw-notice')).toContainText('Press a key for Paddle');
  await expect(page.locator('.iw-bind.iw-listen')).toHaveText('press…');
  await page.keyboard.press('KeyI');
  await expect(page.locator('.iw-notice')).toContainText('Paddle is now I.');
  // The key cap that was pressed is the same one, still focused, now reading I.
  await expect.poll(async () => (await page.evaluate(focusState)).focused.label).toBe('I');
  expect((await settings()).controls.keyBindings.paddle).toEqual(['KeyI', 'ArrowUp']);

  // Tab is a key like any other while a slot is waiting: it is bound, not used to move the focus.
  await focusOn(page, (focused) => focused.label === 'none');
  await page.keyboard.press('Enter');
  await expect(page.locator('.iw-bind.iw-listen')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.locator('.iw-notice')).toContainText('is now Tab');

  await page.reload();
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel != null);
  const reloaded = await settings();
  expect(reloaded.audio.master).toBeCloseTo(0.65, 5);
  expect(reloaded.accessibility).toMatchObject({ patternedMeters: true });
  expect(reloaded.gameplay).toMatchObject({ difficulty: 'relaxed' });
  expect(reloaded.controls.keyBindings.paddle).toEqual(['KeyI', 'ArrowUp']);

  // The reloaded page draws the saved values.
  await focusOn(page, (focused) => focused.label === 'Settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-setting="audio.master"]')).toHaveValue('0.65');
  await page.keyboard.press('Escape');
  await expect(page.locator('.iw-panel-settings')).toHaveCount(0);

  // New Game, slot 1, all by keyboard. Then the rebound key paddles and the old one does not.
  await focusOn(page, (focused) => focused.label.startsWith('New Game'));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await page.evaluate(focusState)).focused.label).toBe('New game here');
  await page.keyboard.press('Enter');
  await expect.poll(() => session(page, 'portage.session.screen')).toBe('game');
  await expect(page.locator('.iw-meter .iw-bar.iw-stripes')).toHaveCount(1);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  expect(Math.abs(await session<number>(page, 'portage.session.game.canoe.speed'))).toBeLessThan(0.2);
  await page.keyboard.down('KeyI');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyI');
  expect(await session<number>(page, 'portage.session.game.canoe.speed')).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});

// --- Diffed, not rebuilt -----------------------------------------------------------

test('a slider drag and the keyboard focus survive frames that redraw the panel', async ({ page }) => {
  const problems = watch(page);
  await show(page, { name: 'settings', query: '', steps: [open('settings')], shows: '.iw-panel-settings' });
  const setting = (id: string, value: number): Promise<void> =>
    page.evaluate(([name, next]) => (window as any).portage.session.handleIntent({ type: 'change_setting', setting: name, value: next }), [id, value] as const);

  // Mark every element of the panel. A rebuilt panel would be made of unmarked ones.
  const marked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.iw-veil *')];
    for (const element of all) (element as any).kept = true;
    return all.length;
  });
  expect(marked).toBeGreaterThan(30);
  const survivors = (): Promise<{ kept: number; total: number }> => page.evaluate(() => {
    const all = [...document.querySelectorAll('.iw-veil *')].filter((element) => !element.closest('svg'));
    return { kept: all.filter((element) => (element as any).kept === true).length, total: all.length };
  });

  // Drag the master volume bead from 80% towards 30%, redrawing the panel under it on the way.
  const slider = page.locator('[data-setting="audio.master"]');
  const box = (await slider.boundingBox())!;
  const bead = box.height * 0.77; // the bead is 1.15rem on a 1.5rem control
  const at = (share: number): number => box.x + bead / 2 + share * (box.width - bead);
  const middle = box.y + box.height / 2;
  await page.mouse.move(at(0.8), middle);
  await page.mouse.down();
  for (const [step, share] of [0.7, 0.6, 0.5, 0.4, 0.3].entries()) {
    await page.mouse.move(at(share), middle, { steps: 3 });
    // Another setting changes mid-drag, so the panel's model changes and the panel is drawn again.
    await setting('audio.music', 0.1 + step * 0.05);
    await frames(page, 3);
    const live = await slider.evaluate((element: HTMLInputElement) => ({ held: element.matches(':active'), value: Number(element.value), kept: (element as any).kept === true }));
    expect(live.kept, 'the slider is the same element mid-drag').toBe(true);
    expect(live.held, 'the slider is still held mid-drag').toBe(true);
    expect(live.value, `the bead follows the pointer at step ${step}`).toBeCloseTo(share, 1);
  }
  await page.mouse.up();
  await frames(page, 3);
  expect(await session<number>(page, 'portage.session.settings.audio.master')).toBeCloseTo(0.3, 1);
  await expect(page.locator('.iw-row', { hasText: 'Master volume' }).locator('output')).toHaveText('30%');
  // The other slider was redrawn from the model while this one was held.
  await expect(page.locator('[data-setting="audio.music"]')).toHaveValue('0.3');
  await expect(page.locator('.iw-row', { hasText: 'Music' }).locator('output')).toHaveText('30%');
  // Not one element of the panel was replaced: all that are there now were there before the drag.
  const afterDrag = await survivors();
  expect(afterDrag.total).toBeGreaterThan(30);
  expect(afterDrag.kept).toBe(afterDrag.total);

  // Focus: put the keyboard on a control, redraw the panel for a while, and it is still there.
  await focusOn(page, (focused) => focused.label === 'audio.ambience');
  for (let change = 0; change < 12; change += 1) {
    await setting('audio.effects', 0.2 + (change % 5) * 0.1);
    await frames(page, 2);
  }
  const held = await page.evaluate(() => ({
    setting: (document.activeElement as HTMLElement).dataset.setting, kept: (document.activeElement as any).kept === true,
  }));
  expect(held).toEqual({ setting: 'audio.ambience', kept: true });
  // Switching tab redraws the rows, and the tab that was pressed keeps the focus.
  await focusOn(page, (focused) => focused.label === 'Graphics');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-setting="graphics.fpsCap"]')).toBeVisible();
  expect(await page.evaluate(() => ({ label: document.activeElement?.textContent, kept: (document.activeElement as any).kept === true })))
    .toEqual({ label: 'Graphics', kept: true });

  // In play the HUD changes every frame, and is still made of the elements it started with.
  await show(page, { name: 'play', query: '?at=quest1&fps=1', shows: '.iw-vitals' });
  const parts = '.iw-vitals, .iw-meter, .iw-bar i, .iw-notes, .iw-hotbar, .iw-slot, .iw-track, .iw-debug > div';
  const before = await page.evaluate((selector) => {
    const all = [...document.querySelectorAll(selector)];
    for (const element of all) (element as any).kept = true;
    return { count: all.length, text: document.querySelector('.iw-hud')!.textContent, heading: getComputedStyle(document.querySelector('.iw-track')!).transform };
  }, parts);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const after = await page.evaluate((selector) => {
    const all = [...document.querySelectorAll(selector)];
    return {
      count: all.length, kept: all.filter((element) => (element as any).kept === true).length,
      text: document.querySelector('.iw-hud')!.textContent, heading: getComputedStyle(document.querySelector('.iw-track')!).transform,
    };
  }, parts);
  expect(after.text, 'the HUD text changed while paddling').not.toBe(before.text);
  expect(after.heading, 'the compass turned').not.toBe(before.heading);
  expect({ count: after.count, kept: after.kept }).toEqual({ count: before.count, kept: before.count });
  expect(problems).toEqual([]);
});

// --- Cost --------------------------------------------------------------------------

const median = (values: number[]): number => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)]!;

// The whole frame's budget covers the Ink & Wash look too (about 3 ms of the 16.7 ms a frame has at 60 a second).
// The interface's own share is held to half a millisecond.
test('with the inventory open, the interface adds under half a millisecond and the frame\'s work stays under 6 ms', async ({ page }) => {
  const problems = watch(page);
  await show(page, { name: 'inventory', query: '?shot=inventory&live=1&fps=1', shows: '.iw-panel-inventory' });
  await page.waitForTimeout(1500);
  const work: number[] = [];
  const rates: number[] = [];
  for (let sample = 0; sample < 40; sample += 1) {
    await page.waitForTimeout(100);
    const debug = await session<{ workMilliseconds: number; framesPerSecond: number }>(page, 'portage.app.lastModel.debug');
    work.push(debug.workMilliseconds);
    rates.push(debug.framesPerSecond);
  }
  // The interface's own share, timed directly: `update` with a fresh model object, as every frame gives it.
  // Fresh but for the chart: the game hands the same valley and the same record of the fog every frame until the
  // crew sees more (`ChartModel` in viewmodels/types.ts), and the minimap tells by that whether to paint.
  // Batches of 100, because the browser's clock is too coarse to time one call.
  const interfaceOnly = await page.evaluate(() => {
    const { app } = (window as any).portage;
    const batches: number[] = [];
    for (let batch = 0; batch < 20; batch += 1) {
      const models = Array.from({ length: 100 }, () => ({ ...structuredClone({ ...app.lastModel, chart: null }), chart: app.lastModel.chart }));
      const start = performance.now();
      for (const model of models) app.gameInterface.update(model);
      batches.push((performance.now() - start) / 100);
    }
    batches.sort((first, second) => first - second);
    return { median: batches[10]!, worst: batches[19]! };
  });
  console.log(`inventory open: work per frame median ${median(work).toFixed(2)} ms, highest ${Math.max(...work).toFixed(2)} ms, `
    + `${median(rates)} fps; interface update alone median ${interfaceOnly.median.toFixed(3)} ms, worst batch ${interfaceOnly.worst.toFixed(3)} ms`);
  expect(median(work)).toBeLessThan(6);
  expect(interfaceOnly.median).toBeLessThan(0.5);
  expect(median(rates)).toBeGreaterThanOrEqual(55);
  expect(problems).toEqual([]);
});

// --- Item icons --------------------------------------------------------------------

/**
 * Run in the page: every row of the model that names an item, against the icons drawn for them.
 * A row names an item with `itemId`; the icon beside it carries the same id as `data-item`.
 */
function itemIconProblems(): { problems: string[]; named: number; smallest: number } {
  const problems: string[] = [];
  const model = (window as any).portage.app.lastModel;
  const named: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        // An intent may carry an item id too: that is what a button does, not a row that names an item.
        // So may a tile's two quick presses (`shift` for Shift+click, `drop` for the drop key): they are intents as well.
        if (key === 'itemId') { if (entry !== null) named.push(entry as string); } else if (key !== 'intent' && key !== 'shift' && key !== 'drop') walk(entry);
      }
    }
  };
  const panel = model.panel ? structuredClone(model.panel) : null;
  // What is already bolted on does not show its bill of materials.
  if (panel?.id === 'canoe_builder') for (const row of [panel.hull, ...panel.attachments]) if (row?.built) delete row.costs;
  walk({ hotbar: model.hud?.hotbar, toasts: model.toasts, panel });

  const icons = [...document.querySelectorAll<HTMLElement>('.iw [data-item]')];
  const drawn = icons.map((icon) => icon.dataset.item!);
  if (JSON.stringify([...drawn].sort()) !== JSON.stringify([...named].sort())) {
    problems.push(`the model names ${JSON.stringify([...named].sort())} but the page draws ${JSON.stringify([...drawn].sort())}`);
  }

  const drawingOf = new Map<string, string>();
  let smallest = Infinity;
  for (const icon of icons) {
    const id = icon.dataset.item!;
    const picture = icon.querySelector('svg.iw-ico');
    if (!picture) {
      problems.push(`${id}: no drawing`);
      continue;
    }
    // One drawing per item, the same wherever it appears.
    const known = drawingOf.get(id);
    if (known !== undefined && known !== icon.innerHTML) problems.push(`${id}: drawn two different ways`);
    drawingOf.set(id, icon.innerHTML);

    const box = picture.getBoundingClientRect();
    smallest = Math.min(smallest, box.width);
    if (Math.abs(box.width - box.height) > 0.5) problems.push(`${id}: not square (${box.width} x ${box.height})`);
    if (box.width < 15) problems.push(`${id}: too small to read (${box.width.toFixed(1)} px)`);
    // Sharp at any size: live vector strokes, never a picture of them, never blurred or faded.
    if (picture.querySelector('image, foreignObject, animate, animateTransform, set')) problems.push(`${id}: holds a raster or an animation`);
    for (let element: Element | null = picture; element && !element.matches('.iw'); element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.filter !== 'none') problems.push(`${id}: drawn through a filter on ${element.tagName.toLowerCase()}.${element.className}`);
      if (style.animationName !== 'none') problems.push(`${id}: animated on ${element.tagName.toLowerCase()}.${element.className}`);
    }
    const pen = picture.querySelector('.iw-pen');
    const stroke = pen ? Number.parseFloat(getComputedStyle(pen).strokeWidth) : 0;
    if (stroke !== 1.5) problems.push(`${id}: pen weight ${stroke}`);

    // Inside its card, and not under the edge of the screen.
    const card = icon.closest('.iw-panel, .iw-toast, .iw-slot');
    const cardBox = card?.getBoundingClientRect();
    const scroller = icon.closest('.iw-body');
    if (!cardBox) problems.push(`${id}: not on a card`);
    else if (box.left < cardBox.left - 0.5 || box.right > cardBox.right + 0.5 || (!scroller && (box.top < cardBox.top - 0.5 || box.bottom > cardBox.bottom + 0.5))) {
      problems.push(`${id}: spills out of its card`);
    }
    if (box.left < 0 || box.right > window.innerWidth) problems.push(`${id}: off the screen`);

    // The icon comes first, the words stay: the item's name follows it in the same row.
    const row = icon.closest('.iw-cost, .iw-item, .iw-toast, .iw-key-items li, .iw-entry-text, .iw-slot')!;
    const words = (row.textContent ?? '').trim();
    const label = row.getAttribute('aria-label') ?? '';
    if (words === '' && label === '') problems.push(`${id}: an icon with no words beside it`);
    const range = document.createRange();
    const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      // A slot's number and the red ! before what a quest asks for stand to the left of the drawing on purpose.
      // An inventory tile's count (x12) stands under its drawing on purpose.
      if (!(node.textContent ?? '').trim() || node.parentElement!.closest('.iw-n, .iw-nm, .iw-tool-name, .iw-tile-count, .iw-quest-mark, svg')) continue;
      range.selectNodeContents(node);
      const first = range.getClientRects()[0];
      if (first && first.left < box.right - 1 && first.top < box.bottom && first.bottom > box.top) problems.push(`${id}: its words run under the icon`);
      break;
    }
  }
  // Different items never share a drawing.
  const seen = new Map<string, string>();
  for (const [id, drawing] of drawingOf) {
    const other = seen.get(drawing);
    if (other) problems.push(`${id} and ${other} are the same drawing`);
    seen.set(drawing, id);
  }
  return { problems, named: named.length, smallest };
}

test('every row that names an item shows its icon: hotbar, inventory, crafting, builder, quest rewards and loot notes, at every size', async ({ page }) => {
  const problems = watch(page);
  const views = ['play', 'inventory', 'crafting', 'builder', 'upgraded', 'quests'].map((name) => SHOTS.find((shot) => shot.name === name)!);
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(size);
    for (const view of views) {
      await show(page, view);
      const result = await page.evaluate(itemIconProblems);
      expect(result.problems, `${view.name} at ${size.width}x${size.height}`).toEqual([]);
      expect(result.named, `${view.name}: rows that name an item`).toBeGreaterThan(0);
      // At 4K the smallest icon is still drawn from its strokes, three times the size it has at 720p.
      if (size.width === 3840) expect(result.smallest, `${view.name}: smallest icon at 4K`).toBeGreaterThanOrEqual(45);
      expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
    }
  }

  // A loot note: drop a stack on the island and the note that reports it carries the item's icon.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await show(page, { name: 'island, live', query: '?shot=island&live', shows: '.iw-prompt' });
  const send = (intent: unknown): Promise<void> => page.evaluate((value) => (window as any).portage.session.handleIntent(value), intent);
  await send({ type: 'open_panel', panel: 'inventory' });
  await frames(page, 3);
  const dropped = await session<{ itemId: string; intent: unknown }>(page, `(() => {
    // A stack that may be dropped: not one an open quest still asks for (the rules refuse that, and say why).
    const slot = portage.app.lastModel.panel.backpack.slots.find((entry) => entry.itemId !== null && entry.buttons.find((button) => button.label === 'Drop').enabled);
    return { itemId: slot.itemId, intent: slot.buttons.find((button) => button.label === 'Drop').intent };
  })()`);
  await send(dropped.intent);
  await frames(page, 3);
  const accept = await session<unknown>(page, 'portage.app.lastModel.confirm ? portage.app.lastModel.confirm.accept.intent : null');
  if (accept) await send(accept);
  await frames(page, 3);
  await expect(page.locator(`.iw-toast [data-item="${dropped.itemId}"] svg.iw-ico`)).toBeVisible();
  const withNote = await page.evaluate(itemIconProblems);
  expect(withNote.problems, 'a loot note over the inventory').toEqual([]);
  expect(problems).toEqual([]);
});

// --- Steady ------------------------------------------------------------------------

test('nothing redraws itself, and opening a panel moves nothing else', async ({ page }) => {
  const problems = watch(page);

  // The paper cards, pen borders and tape included, are the same pixels half a second later.
  // The scene is hidden for this, so the only thing in the picture is the interface.
  const samePixels = async (view: View, selectors: string[]): Promise<void> => {
    await show(page, view);
    await page.addStyleTag({ content: '#world { visibility: hidden; }' });
    // Hiding the scene makes the browser paint the page afresh: let that finish before looking.
    await page.waitForTimeout(400);
    for (const selector of selectors) {
      const box = (await page.locator(selector).first().boundingBox())!;
      // A little beyond the card, to take in the wavering border and the tape.
      const clip = {
        x: Math.max(0, Math.floor(box.x - 10)), y: Math.max(0, Math.floor(box.y - 12)),
        width: Math.ceil(box.width + 20), height: Math.ceil(box.height + 24),
      };
      // Two pictures half a second apart must match. One late repaint is forgiven (the pair is taken again);
      // anything that keeps moving never gives two pictures alike.
      let earlier = await page.screenshot({ clip });
      let same = false;
      for (let look = 0; look < 3 && !same; look += 1) {
        await page.waitForTimeout(500);
        const later = await page.screenshot({ clip });
        same = earlier.equals(later);
        earlier = later;
      }
      expect(same, `${view.name}: ${selector} keeps changing with nothing happening`).toBe(true);
    }
  };
  await samePixels(SHOTS.find((shot) => shot.name === 'play')!, ['.iw-vitals', '.iw-notes', '.iw-hotbar', '.iw-compass', '.iw-hint']);
  await samePixels(SHOTS.find((shot) => shot.name === 'inventory')!, ['.iw-panel']);
  await samePixels(MENUS.find((view) => view.name === 'inventory, a row opened')!, ['.iw-panel']);

  // The two crafting menus and an opened inventory row: not one change to the page in a second, and nothing animating.
  // (Their pixels are not compared: with the scene hidden behind the veil the graphics chip rasters a pixel of the
  // small dirty-water drawing a hair differently from one paint to the next, the page unchanged. Seen 2026-11-13.)
  for (const view of [SHOTS.find((shot) => shot.name === 'crafting')!, SHOTS.find((shot) => shot.name === 'builder')!,
    MENUS.find((menu) => menu.name === 'inventory, a row opened')!]) {
    await show(page, view);
    const still = await page.evaluate(() => new Promise<{ changes: string[]; running: number }>((resolve) => {
      const changes: string[] = [];
      const observer = new MutationObserver((list) => {
        for (const change of list) changes.push(`${change.type} ${String((change.target as Element).className ?? '')} ${change.attributeName ?? ''}`);
      });
      observer.observe(document.querySelector('.iw-veil')!, { subtree: true, childList: true, attributes: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        resolve({ changes, running: document.getAnimations().filter((animation) => animation.playState === 'running').length });
      }, 1000);
    }));
    expect(still, `${view.name}: the open panel changed with nothing happening`).toEqual({ changes: [], running: 0 });
  }
  await samePixels(SHOTS.find((shot) => shot.name === 'lobby')!, ['.iw-lobby-col']);
  await samePixels(CREW.find((view) => view.name === 'crew of 4, split up')!, ['.iw-crew', '.iw-compass']);

  // Live play: the cards stay exactly where they are when a panel opens over them, and when it closes.
  await show(page, { name: 'play', query: '?at=quest1', shows: '.iw-vitals' });
  const places = (): Promise<string> => page.evaluate(() => JSON.stringify(['.iw-vitals', '.iw-notes', '.iw-compass', '.iw-hotbar'].map((selector) => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return [selector, box.x, box.y, box.width];
  })));
  const atRest = await places();
  for (const key of ['Tab', 'KeyC', 'KeyJ', 'KeyM', 'Escape']) {
    await page.keyboard.press(key);
    await frames(page, 4);
    expect(await places(), `after ${key}`).toBe(atRest);
  }

  // The settings sheet hangs from the same top edge on every tab, so the tabs never move under the pointer.
  await show(page, { name: 'settings', query: '', steps: [open('settings')], shows: '.iw-panel-settings' });
  const sheet = (): Promise<string> => page.locator('.iw-panel-settings').evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const tabs = panel.querySelector('.iw-tabs')!.getBoundingClientRect();
    return JSON.stringify([box.x, box.y, box.width, tabs.x, tabs.y, tabs.width, tabs.height]);
  });
  const audio = await sheet();
  for (const tab of ['Graphics', 'Controls', 'Gameplay', 'Accessibility']) {
    await page.getByRole('button', { name: tab }).click();
    await frames(page, 3);
    expect(await sheet(), `${tab} tab`).toBe(audio);
  }
  expect(problems).toEqual([]);
});

// --- The cut -----------------------------------------------------------------------

/** Run in the page: the open panel's body, the mark under it and the footer below, as they are drawn. */
function cutState(): {
  below: number; marked: boolean; words: string; mark: number[] | null; body: number[]; footer: number[]; buttons: number[][]; panel: number[];
  moving: number; transition: string;
} {
  const veil = document.querySelector('.iw-veil')!;
  const body = veil.querySelector<HTMLElement>('.iw-body')!;
  const mark = veil.querySelector<HTMLElement>('.iw-cut');
  const words = mark?.querySelector<HTMLElement>('.iw-cut-words') ?? null;
  const box = (element: Element): number[] => {
    const rect = element.getBoundingClientRect();
    return [rect.left, rect.top, rect.right, rect.bottom].map((value) => Math.round(value * 10) / 10);
  };
  const marked = mark !== null && words !== null && !mark.hidden && words.getClientRects().length > 0;
  return {
    below: Math.round(body.scrollHeight - body.clientHeight - body.scrollTop),
    marked,
    words: marked ? (words!.textContent ?? '').trim() : '',
    mark: marked ? box(words!) : null,
    body: box(body),
    footer: box(veil.querySelector('.iw-panel > footer')!),
    buttons: [...veil.querySelectorAll('.iw-panel > footer button')].map(box),
    panel: box(veil.querySelector('.iw-panel')!),
    moving: mark ? mark.getAnimations({ subtree: true }).length : 0,
    transition: words ? `${getComputedStyle(words).transitionDuration}|${getComputedStyle(words).animationName}` : '',
  };
}

test('a panel cut by a short window says there is more below, with a mark that stands still; a panel that fits has none', async ({ page }) => {
  const problems = watch(page);
  // Pictures for the fix round's report, when a folder is given: `<folder>/cut-<tag>-<view>-<width>.png`.
  const shots = process.env.FIXES_SHOTS ?? '';
  const tag = process.env.FIXES_SHOT_TAG ?? 'after';
  const builder = SHOTS.find((shot) => shot.name === 'builder')!;
  const controls = MENUS.find((view) => view.name === 'settings: controls')!;
  const inventory = SHOTS.find((shot) => shot.name === 'inventory')!;
  const small = { width: 1366, height: 768 };
  const large = { width: 1920, height: 1080 };
  const picture = async (name: string, width: number): Promise<void> => {
    if (shots) await page.screenshot({ path: `${shots}/cut-${tag}-${name}-${width}.png` });
  };

  // What is true of every view, cut or not: the mark is there exactly when the body goes on below its edge.
  const seen: string[] = [];
  for (const [size, view, name] of [
    [small, builder, 'builder'], [small, controls, 'settings-controls'], [small, inventory, 'inventory'],
    [large, builder, 'builder'], [large, controls, 'settings-controls'], [large, inventory, 'inventory'],
  ] as const) {
    await page.setViewportSize(size);
    await show(page, view);
    await picture(name, size.width);
    const state = await page.evaluate(cutState);
    const where = `${name} at ${size.width}x${size.height}`;
    seen.push(`${where}: ${state.below > 2 ? 'cut' : 'fits'}`);
    expect(state.marked, `${where}: ${state.below} px below the edge`).toBe(state.below > 2);
    if (!state.marked) continue;
    expect(state.words, where).toBe('more below');
    // The words hang just under the body's bottom edge: they cover nothing of the body, they are on the sheet,
    // and they touch no button of the footer.
    const [left, top, right, bottom] = state.mark!;
    expect(top, `${where}: under the cut, not over the last row`).toBeGreaterThanOrEqual(state.body[3]! - 0.5);
    expect(top - state.body[3]!, `${where}: right under the cut`).toBeLessThan(8);
    expect(bottom, where).toBeLessThan(state.panel[3]!);
    expect(left, where).toBeGreaterThan(state.panel[0]!);
    expect(right, where).toBeLessThan(state.panel[2]!);
    for (const button of state.buttons) {
      const apart = right < button[0]! || left > button[2]! || bottom < button[1]! || top > button[3]!;
      expect(apart, `${where}: the words touch a footer button`).toBe(true);
    }
    expect(await page.evaluate(layoutProblems), where).toEqual([]);
  }
  // The two views the review found cut at 1366 are cut and marked. The interface is sized by the window, so the
  // same two are cut at the same rows at 1920, where the cut happens to fall between two rows and looks like an
  // end: they are marked there too. A panel that fits has no mark at either size.
  expect(seen).toEqual([
    'builder at 1366x768: cut', 'settings-controls at 1366x768: cut', 'inventory at 1366x768: fits',
    'builder at 1920x1080: cut', 'settings-controls at 1920x1080: cut', 'inventory at 1920x1080: fits',
  ]);

  // It stands still: the same pixels half a second later, nothing animating, no transition to run.
  await page.setViewportSize(small);
  await show(page, builder);
  await page.addStyleTag({ content: '#world { visibility: hidden; }' });
  await page.waitForTimeout(400);
  const atTop = await page.evaluate(cutState);
  expect(atTop.marked).toBe(true);
  expect(atTop.moving).toBe(0);
  expect(atTop.transition).toBe('0s|none');
  const [left, top, right, bottom] = atTop.mark!;
  const clip = { x: Math.floor(atTop.body[0]!), y: Math.floor(top - 6), width: Math.ceil(atTop.body[2]! - atTop.body[0]!), height: Math.ceil(bottom - top + 12) };
  let earlier = await page.screenshot({ clip });
  let same = false;
  for (let look = 0; look < 3 && !same; look += 1) {
    await page.waitForTimeout(500);
    const later = await page.screenshot({ clip });
    same = earlier.equals(later);
    earlier = later;
  }
  expect(same, 'the mark keeps changing with nothing happening').toBe(true);
  expect(right - left).toBeGreaterThan(40);

  // It takes no room: at the end of the panel it is gone, and the body and the footer are where they were.
  for (let press = 0; press < 12 && (await page.evaluate(cutState)).below > 2; press += 1) {
    await page.keyboard.press('PageDown');
    await frames(page, 2);
  }
  const atEnd = await page.evaluate(cutState);
  expect(atEnd.below).toBeLessThanOrEqual(2);
  expect(atEnd.marked, 'at the end of the panel there is nothing more to say').toBe(false);
  expect([atEnd.body, atEnd.footer, atEnd.panel]).toEqual([atTop.body, atTop.footer, atTop.panel]);
  await picture('builder-at-its-end', small.width);
  // Back up, and it is back on the very same spot.
  await page.keyboard.press('PageUp');
  await frames(page, 2);
  const backUp = await page.evaluate(cutState);
  expect(backUp.marked).toBe(true);
  expect(backUp.mark).toEqual(atTop.mark);

  // The window is made tall enough for every key: the mark goes with the cut, with no click and no key.
  await show(page, controls);
  expect((await page.evaluate(cutState)).marked).toBe(true);
  await page.setViewportSize({ width: 1366, height: 1500 });
  await frames(page, 3);
  const grown = await page.evaluate(cutState);
  expect([grown.below > 2, grown.marked]).toEqual([false, false]);
  expect(problems).toEqual([]);
});

// --- Crew --------------------------------------------------------------------------

const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }];

/** `#rrggbb` as the browser reports a colour. */
const asRgb = (hex: string): string => `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

interface CrewMarkData { label: string; toque: string }
const crewMarksOf = (page: Page): Promise<CrewMarkData[]> =>
  page.evaluate(async () => ((await import('/src/data/index.ts' as string)) as { CREW_MARKS: CrewMarkData[] }).CREW_MARKS);

/** Run in the page: the crew card as drawn, a row a player. */
function crewRows(): { label: string; you: boolean; place: string; low: boolean; alert: boolean; lowBars: boolean[]; fills: string[]; toque: string; wash: string }[] {
  return [...document.querySelectorAll('.iw-crew .iw-mate')].map((row) => ({
    label: row.querySelector('.iw-mate-name')!.firstChild!.textContent ?? '',
    you: row.classList.contains('iw-you') && row.querySelector('.iw-mate-name .iw-kind')?.textContent === 'you',
    place: row.querySelector('.iw-mate-place')!.textContent ?? '',
    low: row.classList.contains('iw-low'),
    alert: row.querySelector('.iw-mate-alert') !== null,
    lowBars: [...row.querySelectorAll('.iw-bar')].map((bar) => bar.classList.contains('iw-low')),
    fills: [...row.querySelectorAll<HTMLElement>('.iw-bar > i')].map((fill) => fill.style.getPropertyValue('--v')),
    toque: getComputedStyle(row.querySelector('.iw-toque .iw-wash')!).fill,
    wash: getComputedStyle(row.querySelector('.iw-toque .iw-wash')!).opacity,
  }));
}

test('the crew list: no card alone, a row a player for 2, 3 and 4, each row following its own player', async ({ page }) => {
  const problems = watch(page);
  await show(page, SHOTS.find((shot) => shot.name === 'play')!);
  const marks = await crewMarksOf(page);
  expect(await page.locator('.iw-crew, .iw-mate, .iw-toque').count(), 'alone: nothing of the crew is drawn').toBe(0);

  for (const size of [2, 3, 4]) {
    await show(page, { name: `crew of ${size}`, query: `?shot=play&crew=${size}`, shows: '.iw-crew' });
    const rows = await page.evaluate(crewRows);
    expect(rows.map((row) => row.label), `crew of ${size}: labels`).toEqual(marks.slice(0, size).map((mark) => mark.label));
    // The chip is the toque colour the look dresses that player in, at full strength.
    expect(rows.map((row) => row.toque), `crew of ${size}: colours`).toEqual(marks.slice(0, size).map((mark) => asRgb(mark.toque)));
    expect(rows.every((row) => row.wash === '1')).toBe(true);
    expect(rows.map((row) => row.you), `crew of ${size}: you`).toEqual(rows.map((_, index) => index === 0));
    expect(rows.every((row) => row.place === 'Aboard' && !row.low && !row.alert)).toBe(true);
  }

  // Each row is its own player: change one player and only that row changes.
  const before = await page.evaluate(crewRows);
  await stage(page, 'Object.assign(portage.session.game.players[2], { hunger: 80, thirst: 40, energy: 5 });');
  await frames(page, 3);
  let rows = await page.evaluate(crewRows);
  expect(rows[2]).toMatchObject({ low: true, alert: true, lowBars: [false, false, true], fills: ['0.8', '0.4', '0.05'], place: 'Aboardlow energy' });
  expect([rows[0], rows[1], rows[3]]).toEqual([before[0], before[1], before[3]]);

  await stage(page, `${PUT_ASHORE} put(game.players[1], 'cabin_roofs', 4);`);
  await frames(page, 3);
  rows = await page.evaluate(crewRows);
  expect(rows[1]!.place).toMatch(/^Ashore · Cabin Roofs\d+ m$/);
  await stage(page, 'portage.session.game.players[1].asleep = true;');
  await frames(page, 3);
  rows = await page.evaluate(crewRows);
  expect(rows[1]!.place).toMatch(/^Asleep · Cabin Roofs\d+ m$/);
  expect(await page.locator('.iw-mate[data-player="1"] .iw-mate-asleep svg').count()).toBe(1);
  expect([rows[0], rows[3]]).toEqual([before[0], before[3]]);
  // What is drawn is what the model holds, row for row.
  const model = await session<{ label: string; placeText: string; distanceText: string; lowText: string }[]>(page, 'portage.app.lastModel.hud.crew');
  expect(rows.map((row) => `${row.label}|${row.place}`)).toEqual(
    model.map((row) => `${row.label}|${row.placeText}${row.distanceText}${row.lowText}`),
  );

  // A crewmate's new tool is told on this screen, with who made it and the tool's icon.
  await show(page, CREW.find((view) => view.name === 'a crew note in play')!);
  await expect(page.locator('.iw-toast', { hasText: 'Player 3 made a new tool: Stone knife' })).toBeVisible();
  await expect(page.locator('.iw-toast [data-item="stone_knife"] svg.iw-ico')).toBeVisible();
  expect(problems).toEqual([]);
});

/** Run in the page: what the crew card overlaps or covers. Empty when it is clear of everything. */
function crewCardProblems(): string[] {
  const problems: string[] = [];
  const card = document.querySelector('.iw-crew')?.getBoundingClientRect();
  if (!card) return ['no crew card'];
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (card.left < 0 || card.top < 0 || card.right > width || card.bottom > height) problems.push('the crew card runs off the screen');
  // The middle of the play view is the canoe and the water ahead of it: the card keeps to the left quarter.
  if (card.right > width / 4) problems.push(`the crew card reaches ${Math.round((card.right / width) * 100)}% across the view`);
  const vitals = document.querySelector('.iw-vitals')!.getBoundingClientRect();
  // The vitals stand bottom left (Luc's bugfix list, line 13), and the crew card on top of them.
  if (card.bottom > vitals.top) problems.push('the crew card is not over the vitals card');
  if (Math.abs(card.left - vitals.left) > 0.5 || Math.abs(card.width - vitals.width) > 0.5) problems.push('the crew card is not lined up with the vitals card');
  for (const selector of ['.iw-vitals', '.iw-notes', '.iw-strip', '.iw-mark-chip', '.iw-hotbar', '.iw-hint', '.iw-prompt', '.iw-toast', '.iw-debug']) {
    for (const other of document.querySelectorAll(selector)) {
      const box = other.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (card.left < box.right && card.right > box.left && card.top < box.bottom && card.bottom > box.top) problems.push(`the crew card overlaps ${selector}`);
    }
  }
  return problems;
}

test('the crew card stands on the vitals, clear of the middle of the view and of every other card, at every size', async ({ page }) => {
  const problems = watch(page);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const name of ['crew of 2, afloat', 'crew of 4, ashore', 'crew of 4, split up', 'crew of 4, everyone in trouble']) {
      await show(page, CREW.find((view) => view.name === name)!);
      // The busiest the screen gets: the notes queue full, on top of everything else.
      await stage(page, 'for (let note = 1; note <= 6; note += 1) portage.app.toasts.add({ text: `A note, number ${note}`, tone: "info" });');
      await frames(page, 3);
      expect(await page.locator('.iw-toast').count()).toBe(6);
      expect(await page.evaluate(crewCardProblems), `${name} at ${size.width}x${size.height}`).toEqual([]);
    }
  }
  expect(problems).toEqual([]);
});

/** Run in the page: where the HUD's cards stand against Luc's layout (bugfix list, line 13), and what overlaps. */
function hudLayoutProblems(): string[] {
  const problems: string[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const boxOf = (selector: string): DOMRect | null => {
    const element = document.querySelector(selector);
    const box = element?.getBoundingClientRect();
    return box && box.width > 0 && box.height > 0 ? box : null;
  };
  const vitals = boxOf('.iw-vitals');
  const notes = boxOf('.iw-notes');
  const tracker = boxOf('.iw-tracker');
  if (!vitals || !notes) return ['no vitals or notes card'];
  // The meters: bottom left.
  if (vitals.left > width / 4 || vitals.bottom < height - 4 * rem) problems.push(`the meters are not bottom left: ${Math.round(vitals.left)},${Math.round(vitals.bottom)}`);
  // The quest: top left.
  if (!tracker) problems.push('no quest on the notes card');
  else if (tracker.left > width / 4 || notes.top > 4 * rem) problems.push(`the quest is not top left: ${Math.round(tracker.left)},${Math.round(notes.top)}`);
  // The top right is the map's: nothing of the HUD in a square 17 rem a side from that corner (16 for the map, 1 of margin).
  const corner = { left: width - 17 * rem, top: 0, right: width, bottom: 17 * rem };
  const cards = ['.iw-vitals', '.iw-crew', '.iw-notes', '.iw-strip', '.iw-mark-chip', '.iw-hotbar', '.iw-hint', '.iw-prompt', '.iw-toast', '.iw-debug'];
  const placed: { selector: string; box: DOMRect }[] = [];
  for (const selector of cards) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest('[hidden]')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      placed.push({ selector, box });
      if (box.left < corner.right && box.right > corner.left && box.top < corner.bottom && box.bottom > corner.top) {
        problems.push(`${selector} stands in the top right corner, the map's place`);
      }
      if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) problems.push(`${selector} runs off the screen`);
    }
  }
  // No two cards overlap. (The compass chips ride under the strip by design: a chip and the strip are not compared.)
  for (let first = 0; first < placed.length; first += 1) {
    for (let second = first + 1; second < placed.length; second += 1) {
      const [one, other] = [placed[first]!, placed[second]!];
      if (one.selector === other.selector) continue;
      if ([one.selector, other.selector].includes('.iw-mark-chip') && [one.selector, other.selector].includes('.iw-strip')) continue;
      const [a, b] = [one.box, other.box];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) problems.push(`${one.selector} overlaps ${other.selector}`);
    }
  }
  return problems;
}

test('the HUD: meters bottom left, quest top left, the top right clear for a map, and no card on another, at every size', async ({ page }) => {
  const problems = watch(page);
  const views: View[] = [
    SHOTS.find((shot) => shot.name === 'play')!, SHOTS.find((shot) => shot.name === 'island')!, SHOTS.find((shot) => shot.name === 'storm')!,
    CREW.find((view) => view.name === 'crew of 4, everyone in trouble')!, CREW.find((view) => view.name === 'crew of 4, split up')!,
  ];
  for (const size of [...SIZES, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    for (const view of views) {
      await show(page, view);
      // The busiest it gets: the notes queue full, and the tester's lines in the corner (every staged shot has them).
      await stage(page, 'for (let note = 1; note <= 6; note += 1) portage.app.toasts.add({ text: `A longer note, number ${note}, about a thing`, tone: "info" });');
      await frames(page, 3);
      expect(await page.locator('.iw-toast').count()).toBe(6);
      expect(await page.locator('.iw-debug:not([hidden])').count(), `${view.name}: the tester's lines`).toBe(1);
      expect(await page.evaluate(hudLayoutProblems), `${view.name} at ${size.width}x${size.height}`).toEqual([]);
    }
  }
  expect(problems).toEqual([]);
});

test('crewmates on the compass and the map: a toque in their colour at their place', async ({ page }) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await show(page, CREW.find((view) => view.name === 'crew of 4, split up')!);
  const marks = await crewMarksOf(page);

  // The compass: each crewmate who is somewhere else, at the bearing the model gives, in their colour.
  const compass = (): Promise<{ id: string; at: number; middle: number; colour: string; side: string }[]> => page.evaluate(() => {
    const strip = document.querySelector('.iw-strip')!.getBoundingClientRect();
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return [...document.querySelectorAll<HTMLElement>('.iw-mark-crew')].map((mark) => {
      const box = mark.querySelector('svg')!.getBoundingClientRect();
      const fan = (Number(mark.style.getPropertyValue('--n')) - 1.5) * 0.44 * rem;
      return {
        id: mark.dataset.player!,
        at: Number(mark.style.getPropertyValue('--at')),
        // Where on the strip the toque sits, in degrees from dead ahead, with its sideways fan taken out.
        middle: ((box.left + box.width / 2 - fan) - (strip.left + strip.width / 2)) / (strip.width / 180),
        colour: getComputedStyle(mark.querySelector('.iw-toque .iw-wash')!).fill,
        side: mark.classList.contains('iw-off-left') ? 'left' : mark.classList.contains('iw-off-right') ? 'right' : '',
      };
    });
  });
  const modelMarks = (): Promise<{ id: string; relativeDegrees: number; color: string; label: string }[]> =>
    session(page, 'portage.app.lastModel.hud.compass.marks.filter((mark) => mark.kind === "crew")');
  const pinned = (relative: number): number => Math.max(-84, Math.min(84, Math.round(relative)));
  const check = async (wanted: string[]): Promise<void> => {
    const [drawn, model] = [await compass(), await modelMarks()];
    expect(model.map((mark) => mark.id)).toEqual(wanted);
    expect(drawn.map((mark) => mark.id)).toEqual(wanted);
    drawn.forEach((mark, index) => {
      const from = model[index]!;
      expect(mark.at, `${from.label}: bearing`).toBe(pinned(from.relativeDegrees));
      expect(Math.abs(mark.middle - mark.at), `${from.label}: drawn at its bearing`).toBeLessThan(0.75);
      expect(mark.colour).toBe(asRgb(from.color));
      expect(from.color).toBe(marks[Number(from.id.slice(5))]!.toque);
      expect(mark.side).toBe(Math.abs(Math.round(from.relativeDegrees)) > 84 ? (from.relativeDegrees < 0 ? 'left' : 'right') : '');
    });
  };
  await check(['crew-1', 'crew-2']);
  // No chip of words under a toque: the crew list says who and how far.
  expect(await page.locator('.iw-mark-crew .iw-mark-chip').count()).toBe(0);
  const first = await compass();
  // Move a crewmate and their toque moves with them.
  await stage(page, `${PUT_ASHORE} put(game.players[1], 'birch_islet', 0);`);
  await frames(page, 3);
  await check(['crew-1', 'crew-2']);
  expect((await compass())[0]!.at).not.toBe(first[0]!.at);
  await stage(page, `${PUT_ASHORE} put(game.players[1], 'cabin_roofs', 4);`);
  await frames(page, 3);

  // The map: the same toques, each at its player's place on the chart.
  await page.evaluate(() => (window as any).portage.session.handleIntent({ type: 'open_panel', panel: 'map' }));
  await frames(page, 3);
  const chart = await page.evaluate(() => {
    const box = document.querySelector('.iw-chart')!.getBoundingClientRect();
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
      markers: [...document.querySelectorAll<HTMLElement>('.iw-marker-crew')].map((marker) => {
        const drawn = marker.querySelector('svg')!.getBoundingClientRect();
        return {
          title: marker.title,
          middle: drawn.left + drawn.width / 2 - (Number(marker.style.getPropertyValue('--n')) - 1.5) * 0.62 * rem,
          top: drawn.top, bottom: drawn.bottom, size: drawn.width,
          colour: getComputedStyle(marker.querySelector('.iw-toque .iw-wash')!).fill,
        };
      }),
      legend: [...document.querySelectorAll('.iw-legend-crew')].map((row) => [row.textContent, getComputedStyle(row.querySelector('.iw-toque .iw-wash')!).fill]),
    };
  });
  const places = await session<{ id: number; x: number; z: number }[]>(page,
    'portage.session.game.players.slice(1, 3).map((player) => ({ id: player.id, x: player.position.x, z: player.position.z }))');
  const bounds = await page.evaluate(async () => ((await import('/src/client/viewmodels/index.ts' as string)) as any).MAP_BOUNDS as Record<string, number>);
  expect(chart.markers.map((marker) => marker.title)).toEqual([marks[1]!.label, marks[2]!.label]);
  chart.markers.forEach((marker, index) => {
    const place = places[index]!;
    const x = chart.box.left + ((place.x - bounds.minimumX!) / (bounds.maximumX! - bounds.minimumX!)) * chart.box.width;
    const y = chart.box.top + ((place.z - bounds.minimumZ!) / (bounds.maximumZ! - bounds.minimumZ!)) * chart.box.height;
    expect(Math.abs(marker.middle - x), `${marker.title}: across the chart`).toBeLessThan(1);
    // The toque sits on its player's spot: the spot is inside the drawing.
    expect(y, `${marker.title}: down the chart`).toBeGreaterThan(marker.top);
    expect(y, `${marker.title}: down the chart`).toBeLessThan(marker.bottom);
    expect(marker.size).toBeGreaterThanOrEqual(15);
    expect(marker.colour).toBe(asRgb(marks[place.id]!.toque));
  });
  // Two islands, two places: far enough apart on the chart to tell at a glance.
  expect(Math.abs(chart.markers[0]!.middle - chart.markers[1]!.middle)).toBeGreaterThan(40);
  expect(chart.legend).toEqual([[marks[1]!.label, asRgb(marks[1]!.toque)], [marks[2]!.label, asRgb(marks[2]!.toque)]]);

  // Everyone back in the canoe: no toque left on the compass or the map.
  await stage(page, 'for (const player of portage.session.game.players) Object.assign(player, { mode: "canoe", islandId: null, asleep: false, position: { ...portage.session.game.canoe.position } });');
  await frames(page, 3);
  expect(await page.locator('.iw-mark-crew, .iw-marker-crew, .iw-legend-crew').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('alone, the HUD is the HUD it was: no crew card or mark, and its cards the same pixels as with a crew', async ({ page }) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const CARDS = ['.iw-vitals', '.iw-notes', '.iw-compass', '.iw-hotbar'];
  /** The cards of one view, the scene hidden, each with a little margin for its wavering border and tape. */
  const pictures = async (query: string, hideCrew: boolean): Promise<Buffer[]> => {
    await show(page, { name: query, query, shows: '.iw-vitals' });
    await page.addStyleTag({ content: `#world { visibility: hidden; }${hideCrew ? ' .iw-crew { display: none; }' : ''}` });
    await page.waitForTimeout(400);
    const shots: Buffer[] = [];
    for (const selector of CARDS) {
      const box = (await page.locator(selector).first().boundingBox())!;
      shots.push(await page.screenshot({ clip: {
        x: Math.max(0, Math.floor(box.x - 10)), y: Math.max(0, Math.floor(box.y - 12)), width: Math.ceil(box.width + 20), height: Math.ceil(box.height + 24),
      } }));
    }
    return shots;
  };
  for (const shot of ['play', 'island']) {
    // The pen borders are drawn through a filter, and about one load in thirty the graphics chip rasters one a hair
    // differently (a few hundred edge pixels, by at most 18 of 255), crew or no crew. A real change shows on every
    // load. So compare up to three pairs of loads, and ask that one pair matches to the pixel.
    let differing: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const alone = await pictures(`?shot=${shot}`, false);
      expect(await page.locator('.iw-crew, .iw-mate, .iw-toque, .iw-mark-crew, .iw-marker-crew').count(), `${shot}: alone`).toBe(0);
      const hud = await session<{ crew: unknown[]; marks: string[] }>(page,
        '({ crew: portage.app.lastModel.hud.crew, marks: portage.app.lastModel.hud.compass.marks.map((mark) => mark.kind) })');
      expect(hud.crew).toEqual([]);
      expect(hud.marks).not.toContain('crew');
      // With a crew of four beside you, the same cards are the same pixels once the crew card is taken away.
      const crewed = await pictures(`?shot=${shot}&crew=4`, true);
      differing = CARDS.filter((_, index) => !alone[index]!.equals(crewed[index]!));
      if (differing.length === 0) break;
    }
    expect(differing, `${shot}: cards that differ with a crew, on three loads running`).toEqual([]);
  }
  expect(problems).toEqual([]);
});

// --- Lobby -------------------------------------------------------------------------

test('the lobby menu is written once its faces are in, and never moves', async ({ page }) => {
  // Hold the web fonts back, the way a slow first load does.
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let asked = 0;
  await page.route('**/*.woff2', async (route) => {
    asked += 1;
    await held;
    await route.continue();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.iw-lobby-col .iw-mi', { state: 'attached' });

  // From here on, every frame: is the menu showing, are its faces in, and where is every word of it.
  await page.evaluate(() => {
    const frames: { shown: boolean; faces: boolean; places: string }[] = [];
    (window as any).lobbyFrames = frames;
    const look = (): void => {
      const column = document.querySelector('.iw-lobby-col');
      if (column) {
        frames.push({
          shown: getComputedStyle(column).visibility === 'visible',
          faces: ['1em "IM Fell English"', 'italic 1em "IM Fell English"', '1em "Kalam"', '700 1em "Kalam"'].every((face) => document.fonts.check(face)),
          places: JSON.stringify([...column.querySelectorAll('.iw-logo-row, .iw-tagline, .iw-menu, .iw-mi, .iw-mi .iw-label, .iw-mi .iw-n')].map((part) => {
            const box = part.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 100) / 100);
          })),
        });
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.waitForTimeout(700);
  const waiting = await page.evaluate(() => (window as any).lobbyFrames.slice() as { shown: boolean; faces: boolean; places: string }[]);
  expect(asked, 'the page asked for its fonts').toBeGreaterThan(0);
  expect(waiting.length, 'frames seen while the fonts were held').toBeGreaterThan(5);
  expect(waiting.every((frame) => !frame.faces), 'the fonts are still held').toBe(true);
  // Not one frame of the menu in a stand-in face.
  expect(waiting.filter((frame) => frame.shown).length, 'frames that showed the menu before its faces were in').toBe(0);

  release();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.iw-lobby-col')).toBeVisible();
  await page.waitForTimeout(600);
  const all = await page.evaluate(() => (window as any).lobbyFrames.slice() as { shown: boolean; faces: boolean; places: string }[]);
  const shown = all.filter((frame) => frame.shown);
  expect(shown.length, 'frames that showed the menu').toBeGreaterThan(5);
  expect(shown.every((frame) => frame.faces), 'the menu only ever showed in its own faces').toBe(true);
  // Every frame the player could see has every word of the menu in the same place.
  expect(new Set(shown.map((frame) => frame.places)).size, 'different layouts of the menu the player saw').toBe(1);
  // And it is the stand-in face that would have moved it: hidden, the words were laid out somewhere else.
  expect(waiting[waiting.length - 1]!.places).not.toBe(shown[0]!.places);
  // The menu is there to use.
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible();
});
