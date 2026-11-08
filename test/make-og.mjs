// Renders docs/og.png, the link preview, from the site itself with its fictional ?demo data.

import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const OUTPUT = fileURLToPath(new URL('../docs/og.png', import.meta.url));

const [browser, server] = await Promise.all([chromium.launch({ channel: 'chrome', headless: true }), startServer()]);
// Laid out at 1600 by 840 and rendered at three quarters, which gives exactly 1200 by 630.
const context = await browser.newContext({
  viewport: { width: 1600, height: 840 },
  deviceScaleFactor: 0.75,
  colorScheme: 'light',
  locale: 'en-US',
  timezoneId: 'America/Chicago',
  serviceWorkers: 'block',
});
const page = await context.newPage();
// A weekday partway through a month, so the grid has a good shape.
await page.clock.install({ time: new Date('2026-11-12T15:20:00-06:00') });
await page.goto(`${server.url}?demo`);
await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
await page.screenshot({ path: OUTPUT });
await context.close();
await browser.close();
await server.close();
console.log(`Wrote ${OUTPUT}`);
