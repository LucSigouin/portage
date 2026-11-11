/**
 * The settings screen in a real browser: a slider, a checkbox and a picker
 * each change the game, and the changes are still there after a reload.
 * Needs the dev server on http://localhost:5220.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(90_000);

const ready = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);

const settings = (page: Page): Promise<any> => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as unknown as { portage: { session: any } }).portage.session.settings)));

const fontSize = (page: Page): Promise<number> =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.iw')!).fontSize));

/** The frame rate the loop measured, once its readout has settled. */
async function measuredRate(page: Page): Promise<number> {
  await page.waitForTimeout(2500);
  return page.evaluate(() => (window as unknown as { portage: { app: any } }).portage.app.lastModel.debug.framesPerSecond);
}

test('sliders, checkboxes and pickers change the game and persist', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await ready(page);
  const before = await fontSize(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  // Audio: a slider.
  await page.locator('[data-setting="audio.master"]').fill('0.35');
  expect((await settings(page)).audio.master).toBe(0.35);
  await expect(page.locator('.iw-row', { hasText: 'Master volume' }).locator('output')).toHaveText('35%');

  // Accessibility: the interface grows, and the meters get patterns.
  await page.getByRole('button', { name: 'Accessibility' }).click();
  await page.locator('[data-setting="accessibility.uiScale"]').fill('1.5');
  // The UI picks the new scale up on its next frame.
  await expect.poll(() => fontSize(page)).toBeCloseTo(before * 1.5, 1);
  await page.locator('[data-setting="accessibility.patternedMeters"]').check();
  // Scavenging takes one press now: the hold-or-toggle picker is gone.
  await expect(page.locator('[data-setting="accessibility.scavengeMode"]')).toHaveCount(0);
  await expect(page.locator('.iw-panel-settings')).not.toContainText(/scaveng/i);
  expect((await settings(page)).accessibility).toEqual({ uiScale: 1.5, reduceCameraMotion: false, patternedMeters: true });

  // Graphics: the frame-rate cap is real, and a preset sets the detail options.
  await page.getByRole('button', { name: 'Graphics' }).click();
  await page.locator('[data-setting="graphics.showFps"]').check();
  expect(await measuredRate(page)).toBeGreaterThanOrEqual(55);
  await page.locator('[data-setting="graphics.fpsCap"]').selectOption({ label: '30 fps' });
  const capped = await measuredRate(page);
  expect(capped).toBeGreaterThanOrEqual(28);
  expect(capped).toBeLessThanOrEqual(32);
  await page.locator('[data-setting="graphics.fpsCap"]').selectOption({ label: '60 fps' });
  await page.locator('[data-setting="graphics.qualityPreset"]').selectOption({ label: 'Low' });
  expect((await settings(page)).graphics).toMatchObject({ qualityPreset: 'low', renderScale: 0.75, shadows: 'off', waterDetail: 'low' });
  await expect(page.locator('.iw-row', { hasText: 'Render scale' }).locator('output')).toHaveText('75%');

  // Everything is still there after a reload, and the game shows it.
  await page.reload();
  await ready(page);
  const reloaded = await settings(page);
  expect(reloaded.audio.master).toBe(0.35);
  expect(reloaded.accessibility).toEqual({ uiScale: 1.5, reduceCameraMotion: false, patternedMeters: true });
  expect(reloaded.graphics).toMatchObject({ qualityPreset: 'low', showFps: true, fpsCap: 60 });
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByRole('button', { name: 'New game here' }).first().click();
  await expect(page.locator('.iw-meter .iw-bar.iw-stripes')).toHaveCount(1);
  await expect(page.locator('.iw-debug')).toContainText('fps');
});
