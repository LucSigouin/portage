/**
 * The Feedback card in a real browser, with real keys.
 *
 *   PORTAGE_URL=http://localhost:5222 npm --prefix e2e test -- feedback.spec.ts
 *
 * Needs the game's dev server. The store's answers are stand-ins here (the request is caught on its way
 * out), so no relay is needed: the store itself is tested in relay/tests/feedback-worker.test.ts.
 * The last test goes through the dev server's `/relay` to a relay on this computer (port 8791), and is
 * skipped, not passed, when none answers there.
 */
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const CARD = '.iw-panel-feedback';

type Portage = { session: { panels: { stack: string[] }; game: { tick: number; canoe: { position: unknown }; players: { position: unknown }[] } | null } };
const stack = (page: Page): Promise<string> => page.evaluate(() => [...(window as unknown as { portage: Portage }).portage.session.panels.stack].join(','));

async function lobby(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.waitForFunction(() => (window as unknown as { portage?: { worldView?: { probe?: () => { drawingWidth: number } } } }).portage?.worldView?.probe?.().drawingWidth! > 0, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.iw-lobby-col .iw-mi');
}

const openFromLobby = async (page: Page): Promise<void> => {
  await page.locator('.iw-lobby-col .iw-mi', { hasText: 'Feedback' }).click();
  await page.waitForSelector(`${CARD} textarea`);
};

/** A new game, the pause card, and the Feedback card from there. */
async function openFromPause(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await page.waitForFunction(() => {
    const { session } = (window as unknown as { portage: Portage }).portage;
    return session.game != null && session.panels.stack.length === 0;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.locator('.iw-panel-pause .iw-mi', { hasText: 'Feedback' }).click();
  await page.waitForSelector(`${CARD} textarea`);
}

/** Catch the note on its way out and answer in the store's place. Gives back the bodies that were sent. */
async function store(page: Page, answer: (route: Route) => Promise<void>): Promise<string[]> {
  const bodies: string[] = [];
  await page.route('**/feedback', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postData() ?? '');
    return answer(route);
  });
  return bodies;
}
const kept = (route: Route): Promise<void> => route.fulfill({ status: 201, body: 'kept\n', headers: { 'content-type': 'text/plain; charset=utf-8' } });
const status = (page: Page) => page.locator(`${CARD} [data-feedback-status]`);
const settled = (page: Page) => status(page).filter({ hasText: /Sent|Could not/ }).waitFor({ timeout: 20_000 });

test('Feedback is a line of the lobby and of the pause card, and Esc closes the card back to where it was opened', async ({ page }) => {
  await lobby(page);
  const lines = await page.locator('.iw-lobby-col .iw-mi .iw-label').allInnerTexts();
  expect(lines.slice(-2)).toEqual(['Feedback', 'Credits']);
  await openFromLobby(page);
  await expect(page.locator(`${CARD} h2`)).toHaveText('Feedback');
  // The caret is in the box, ready to write.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('iw-feedback-note');
  // The card is whole on the screen.
  const box = await page.locator(CARD).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press('Escape');
  await expect(page.locator(CARD)).toHaveCount(0);
  expect(await stack(page)).toBe('');

  await openFromPause(page);
  expect(await stack(page)).toBe('pause,feedback');
  await page.keyboard.press('Escape');
  expect(await stack(page)).toBe('pause');
  const paused = await page.locator('.iw-panel-pause .iw-mi .iw-label').allInnerTexts();
  expect(paused.slice(-2)).toEqual(['Feedback', 'Save and quit to the lobby']);
});

test('typing a note never triggers a game key: every key is a letter in the box and nothing else', async ({ page }) => {
  await lobby(page);
  await openFromPause(page);
  const where = (): Promise<string> => page.evaluate(() => {
    const game = (window as unknown as { portage: Portage }).portage.session.game!;
    return JSON.stringify([game.tick, game.canoe.position, game.players[0]!.position]);
  });
  const before = await where();
  // Paddle, steer, bail, interact, auto-paddle, the panel keys, the tools, the map.
  const note = 'wasd qe bm i 12345 the paddle sticks after a storm';
  await page.keyboard.type(note, { delay: 10 });
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'End']) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  await expect(page.locator(`${CARD} textarea`)).toHaveValue(`${note}\nsecond line`);
  expect(await stack(page)).toBe('pause,feedback');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('iw-feedback-note');
  expect(await where()).toBe(before);
  await expect(page.locator(`${CARD} [data-feedback-count]`)).toHaveText(`${note.length + 12} / 2,000`);
  // Tab goes on to the name line, where letters are letters too, and Enter sends nothing.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('iw-feedback-name');
  await page.keyboard.type('Sam e q');
  await page.keyboard.press('Enter');
  await expect(page.locator(`${CARD} input`)).toHaveValue('Sam e q');
  await expect(status(page)).toHaveText('');
  expect(await stack(page)).toBe('pause,feedback');
  // The box stops at 2,000 characters.
  await page.locator(`${CARD} textarea`).fill('x'.repeat(2100));
  await expect(page.locator(`${CARD} [data-feedback-count]`)).toHaveText('2,000 / 2,000');
});

test('the request is what the card lists, and "Sent. Thank you." comes only when the store said it kept the note', async ({ page }) => {
  await lobby(page);
  const bodies = await store(page, kept);
  await openFromPause(page);
  await page.locator(`${CARD} textarea`).fill('The paddle sticks. <b>Really.</b>');
  await page.locator(`${CARD} input`).fill('Sam');
  await page.locator(`${CARD} .iw-fb-kind[data-kind="idea"]`).click();
  await expect(page.locator(`${CARD} .iw-fb-kind[data-kind="idea"]`)).toHaveAttribute('aria-pressed', 'true');
  const listed = await page.locator(`${CARD} .iw-fb-sent li`).evaluateAll((lines) => lines.map((line) => [(line as HTMLElement).dataset.part, line.lastChild?.textContent ?? '']));
  await page.locator(`${CARD} button[data-primary]`).click();
  await settled(page);
  await expect(status(page)).toHaveText('Sent. Thank you.');
  await expect(page.locator(`${CARD} textarea`)).toHaveValue('');
  await expect(page.locator(`${CARD} input`)).toHaveValue('Sam');

  expect(bodies).toHaveLength(1);
  const sent = JSON.parse(bodies[0]!) as { kind: string; note: string; name: string; version: string; context: Record<string, string> };
  expect(Object.keys(sent)).toEqual(['kind', 'note', 'name', 'version', 'context']);
  expect([sent.kind, sent.note, sent.name]).toEqual(['idea', 'The paddle sticks. <b>Really.</b>', 'Sam']);
  expect(Object.keys(sent.context)).toEqual(['quest', 'island', 'hull', 'played', 'crew', 'quality']);
  // The list on the card: the note, the name, the version, then one line for each line of context, with the same words.
  expect(listed).toEqual([['note', 'the idea written above'], ['name', 'Sam'], ['version', sent.version], ...Object.entries(sent.context)]);
  // What was typed is text on the card, never markup.
  expect(await page.locator(`${CARD} b`).count()).toBe(0);
});

test('"Could not send" keeps the note in the box and in the browser, whatever went wrong', async ({ page }) => {
  await lobby(page);
  const answers: ((route: Route) => Promise<void>)[] = [
    (route) => route.fulfill({ status: 503, body: 'feedback is off\n' }),
    (route) => route.fulfill({ status: 429, body: 'too many notes from this address: wait a minute\n' }),
    // A page of the site answering in the relay's place is not the store saying yes.
    (route) => route.fulfill({ status: 200, body: '<!doctype html><title>Portage</title>', headers: { 'content-type': 'text/html' } }),
    (route) => route.abort(),
  ];
  let turn = 0;
  const bodies = await store(page, (route) => answers[turn]!(route));
  await openFromLobby(page);
  await page.locator(`${CARD} textarea`).fill('The map key does nothing on the beach.');
  for (turn = 0; turn < answers.length; turn += 1) {
    await page.locator(`${CARD} button[data-primary]`).click();
    await settled(page);
    await expect(status(page)).toHaveText('Could not send. Your note is still in the box, and kept in this browser. Try again in a minute.');
    await expect(page.locator(`${CARD} textarea`)).toHaveValue('The map key does nothing on the beach.');
    await expect(page.locator(`${CARD} button[data-primary] .iw-label`)).toHaveText('Send again');
  }
  expect(bodies).toHaveLength(answers.length);
  // The page loaded again: the note is back in the box.
  await lobby(page);
  await openFromLobby(page);
  await expect(page.locator(`${CARD} textarea`)).toHaveValue('The map key does nothing on the beach.');
});

test('nothing on the card moves by itself: no transition and no animation of its own on any part of it', async ({ page }) => {
  await lobby(page);
  await openFromLobby(page);
  await page.locator(`${CARD} textarea`).fill('still');
  const moving = await page.evaluate((card) => [...document.querySelectorAll(`${card}, ${card} *`)].flatMap((part) => {
    const found: string[] = [];
    for (const pseudo of [null, '::before', '::after']) {
      const style = getComputedStyle(part, pseudo);
      const transition = style.transitionDuration.split(',').some((time) => parseFloat(time) > 0);
      const animation = style.animationName !== 'none' && style.animationDuration.split(',').some((time) => parseFloat(time) > 0);
      // The game's own paper buttons settle under the pointer over 0.15 s, on every card (theme.css): that is not this card's.
      const themeButton = pseudo === null && part.matches('button.iw-btn') && !animation && style.transitionProperty === 'transform' && style.transitionDuration === '0.15s';
      if ((transition || animation) && !themeButton) found.push(`${part.tagName.toLowerCase()}.${part.className}${pseudo ?? ''} ${style.transitionProperty} ${style.transitionDuration} ${style.animationName}`);
    }
    return found;
  }), CARD);
  expect(moving).toEqual([]);
});

test('through the dev server to a relay on this computer: the store keeps the note', async ({ page }) => {
  const relay = await page.request.get(`${BASE}/relay/health`).then((answer) => answer.text(), () => '');
  test.skip(!relay.startsWith('portage relay: ok'), 'no relay answers behind the dev server\'s /relay');
  await lobby(page);
  await openFromLobby(page);
  await page.locator(`${CARD} textarea`).fill('A note from e2e/tests/feedback.spec.ts. Not from a player.');
  const answered = page.waitForResponse((response) => response.url().endsWith('/relay/feedback') && response.request().method() === 'POST');
  await page.locator(`${CARD} button[data-primary]`).click();
  expect((await answered).status()).toBe(201);
  await settled(page);
  await expect(status(page)).toHaveText('Sent. Thank you.');
});
