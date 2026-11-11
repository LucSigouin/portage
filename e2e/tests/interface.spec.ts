/**
 * The Ink & Wash interface in a real browser, headless.
 *
 * - every staged shot renders with a clean console and nothing off this site;
 * - nothing scrolls sideways and no text is clipped at 720p, 1080p, 1440p and 4K;
 * - every control on every menu, panel and dialog is reached and pressed by keyboard, and sends its intent;
 * - a settings change and a key rebind made by keyboard work end to end and survive a reload;
 * - a slider drag and the keyboard focus survive frames that redraw the panel (the DOM is diffed, not rebuilt);
 * - with the inventory open the interface adds under half a millisecond a frame, and the whole frame's work stays under 6 ms;
 * - nothing on screen moves by itself, and opening a panel moves nothing else.
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

type Step = { intent: Record<string, unknown> } | { key: string };

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
  { name: 'a toast in play', query: '?at=quest1', steps: [{ key: 'KeyB' }], shows: '.iw-toast' },
  { name: 'the whole chart', query: '?shot=beacon', steps: [open('map')], shows: '.iw-chart' },
  { name: 'pause over the settings', query: '?shot=pause', steps: settingsTab('controls'), shows: '.iw-bindings' },
  { name: 'settings: waiting for a key', query: '', steps: [...settingsTab('controls'), { intent: { type: 'begin_rebind', action: 'paddle', slot: 0 } }], shows: '.iw-listen' },
  { name: 'credits at the Beacon', query: '?shot=beacon', steps: [open('credits')], shows: '.iw-panel-credits' },
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

async function show(page: Page, view: View): Promise<void> {
  await page.goto(`${BASE}/${view.query}`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel != null);
  await page.evaluate(() => document.fonts.ready);
  if (UI_SCALE !== 1) {
    await page.evaluate((value) => (window as any).portage.session.handleIntent({ type: 'change_setting', setting: 'accessibility.uiScale', value }), UI_SCALE);
  }
  for (const step of view.steps ?? []) {
    if ('key' in step) await page.keyboard.press(step.key);
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
  for (const view of [...SHOTS, ...MENUS]) {
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
    const card = parent.closest('.iw-panel, .iw-vitals, .iw-notes, .iw-prompt, .iw-toast, .iw-hint, .iw-debug, .iw-chart, .iw-mark-chip');
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
    for (const view of [...SHOTS, ...MENUS]) {
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
  for (const view of [...SHOTS, ...MENUS]) {
    await show(page, view);
    expect(await page.evaluate(contrastProblems), view.name).toEqual([]);
  }
});

// --- Keyboard ----------------------------------------------------------------------

interface Focused {
  /** Position among the controls of the open surface, or -1. */
  index: number;
  button: boolean;
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
    const { count } = await page.evaluate(focusState);
    expect(count, `${view.name}: controls`).toBeGreaterThan(0);

    // Into the menu: Tab where the game leaves Tab alone, an arrow key where Tab is the game's. Then Tab from control to control.
    const reached = new Set<number>();
    let buttons = 0;
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
        buttons += 1;
        // Enter and Space both press a button; use each in turn.
        await page.keyboard.press(buttons % 2 === 0 ? 'Space' : 'Enter');
        const after = await page.evaluate(focusState);
        expect(after.focused.index, `${view.name}: "${state.focused.label}" lost the focus when pressed`).toBe(state.focused.index);
      }
    }
    expect(reached.size, `${view.name}: controls reached`).toBe(count);
    // One more step wraps round to the first control, and Shift+Tab steps back to the last.
    await page.keyboard.press('Tab');
    expect((await page.evaluate(focusState)).focused.index, `${view.name}: wrap`).toBe(0);
    await page.keyboard.press('Shift+Tab');
    expect((await page.evaluate(focusState)).focused.index, `${view.name}: back`).toBe(count - 1);

    const sent = await page.evaluate(() => ((window as any).sent as string[]).sort());
    expect(sent.length, `${view.name}: one intent per button`).toBe(buttons);
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
  await focusOn(page, (focused) => focused.label === 'accessibility.scavengeMode');
  // A closed picker takes the first letter of an option: P for "Press once to start, again to stop".
  await page.keyboard.press('KeyP');
  expect((await settings()).accessibility).toMatchObject({ patternedMeters: true, scavengeMode: 'toggle' });

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
  expect(reloaded.accessibility).toMatchObject({ patternedMeters: true, scavengeMode: 'toggle' });
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
  // Batches of 100, because the browser's clock is too coarse to time one call.
  const interfaceOnly = await page.evaluate(() => {
    const { app } = (window as any).portage;
    const batches: number[] = [];
    for (let batch = 0; batch < 20; batch += 1) {
      const models = Array.from({ length: 100 }, () => structuredClone(app.lastModel));
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
  await samePixels(SHOTS.find((shot) => shot.name === 'lobby')!, ['.iw-lobby-col']);

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
