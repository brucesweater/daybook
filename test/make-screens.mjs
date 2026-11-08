// Renders the README's screenshots into screens/, from the site itself, with its fictional ?demo data.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const OUT = fileURLToPath(new URL('../screens/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const SHOTS = [
  { file: 'desktop-light', device: DESKTOP, colorScheme: 'light', run: async () => {} },
  { file: 'desktop-dark', device: DESKTOP, colorScheme: 'dark', run: async () => {} },
  {
    file: 'desktop-edit-event',
    device: DESKTOP,
    colorScheme: 'light',
    run: async (page) => page.locator('.agenda-row').nth(1).click(),
  },
  {
    file: 'desktop-completed-dark',
    device: DESKTOP,
    colorScheme: 'dark',
    run: async (page) => {
      await page.locator('#completed-toggle').click();
      await page.waitForTimeout(340);
      await page.locator('#completed').evaluate((node) => node.scrollIntoView({ block: 'end' }));
    },
  },
  {
    file: 'desktop-undo',
    device: DESKTOP,
    colorScheme: 'light',
    run: async (page) => {
      await page.locator('#open-list .task-text').nth(5).click();
      await page.locator('#task-delete').click();
      await page.locator('.toast').waitFor();
    },
  },
  { file: 'phone-calendar', device: PHONE, colorScheme: 'light', run: async () => {} },
  { file: 'phone-todo-dark', device: PHONE, colorScheme: 'dark', run: async (page) => page.locator('#tab-todo').click() },
  { file: 'phone-new-event', device: PHONE, colorScheme: 'light', run: async (page) => page.locator('#new-event').click() },
  {
    file: 'phone-undo-dark',
    device: PHONE,
    colorScheme: 'dark',
    run: async (page) => {
      await page.locator('#tab-todo').click();
      await page.locator('#open-list .task-text').nth(5).click();
      await page.locator('#task-delete').click();
      await page.locator('.toast').waitFor();
    },
  },
];

const [browser, server] = await Promise.all([chromium.launch({ channel: 'chrome', headless: true }), startServer()]);

for (const { file, device, colorScheme, run } of SHOTS) {
  const context = await browser.newContext({
    ...device,
    colorScheme,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  // A weekday partway through a month, so the grid has a good shape. It's the same moment as docs/og.png.
  await page.clock.install({ time: new Date('2026-11-12T15:20:00-06:00') });
  await page.goto(`${server.url}?demo`);
  await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
  await run(page);
  // The pointer leaves first, so whatever it last touched has finished fading out of its hover fill.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}${file}.png` });
  await context.close();
}

await browser.close();
await server.close();
console.log(`${SHOTS.length} screenshots in screens/`);
