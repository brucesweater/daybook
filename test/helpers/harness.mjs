// Shared E2E setup: the /daybook/ server, Chrome, and a context that records anything that goes wrong.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** The time zone this run tests. Unit tests take the same zone from TZ. */
export const TIME_ZONE = process.env.DAYBOOK_TZ || 'America/Chicago';

export const LAYOUTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
};

export async function launch() {
  const [browser, server] = await Promise.all([chromium.launch({ channel: 'chrome', headless: true }), startServer()]);
  return { browser, server, close: async () => { await browser.close(); await server.close(); } };
}

/**
 * Opens the site in a fresh context.
 * Anything that shouldn't happen lands in `problems`: console errors, uncaught exceptions, requests that
 * leave the origin or the /daybook/ base path, and failed responses.
 */
export async function openApp(env, {
  layout = 'desktop',
  colorScheme = 'light',
  locale = 'en-US',
  timezoneId = TIME_ZONE,
  query = '',
  clock = null,
  seed = null,
  reducedMotion = 'no-preference',
  serviceWorkers = 'block',
  init = null,
  allowProblems = false,
} = {}) {
  const context = await env.browser.newContext({
    ...LAYOUTS[layout],
    colorScheme,
    locale,
    timezoneId,
    reducedMotion,
    serviceWorkers,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const problems = [];
  const base = env.server.url;
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`exception: ${error.message}`));
  context.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (!url.startsWith(base) && url !== base.slice(0, -1)) problems.push(`left the base path: ${url}`);
  });
  context.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  if (clock) await page.clock.install({ time: clock });
  if (init) await page.addInitScript(init);
  if (seed !== null) {
    await page.addInitScript(([key, value]) => {
      if (sessionStorage.getItem('test.seeded')) return;
      sessionStorage.setItem('test.seeded', '1');
      localStorage.setItem(key, value);
    }, ['daybook.v1', typeof seed === 'string' ? seed : JSON.stringify(seed)]);
  }
  await page.goto(`${base}${query}`);
  await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
  const finish = async () => {
    await context.close();
    if (!allowProblems && problems.length > 0) throw new Error(`Problems:\n${problems.join('\n')}`);
  };
  return { context, page, problems, finish };
}

export async function runAxe(page) {
  await page.evaluate(`${AXE_SOURCE}\n;void 0`);
  const results = await page.evaluate(() => globalThis.axe.run(document, { resultTypes: ['violations', 'incomplete'] }));
  const summarize = (item) => `${item.impact} ${item.id}: ${item.help}\n    ${item.nodes.slice(0, 5).map((node) => node.target.join(' ')).join('\n    ')}`;
  return {
    violations: results.violations,
    serious: results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
    report: results.violations.map(summarize).join('\n'),
  };
}

/** Elements that stick out of the page sideways. */
export function horizontalOverflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [];
    if (document.documentElement.scrollWidth > width) offenders.push(`document ${document.documentElement.scrollWidth} > ${width}`);
    for (const node of document.querySelectorAll('body *')) {
      if (node.closest('.visually-hidden, .days-ghost')) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && (box.right > width + 0.5 || box.left < -0.5)) {
        offenders.push(`${node.tagName}.${node.className} ${Math.round(box.left)}..${Math.round(box.right)}`);
      }
    }
    return offenders;
  });
}

/** Keeps trying an assertion until it passes or time runs out, then lets it fail for real. */
export async function until(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** Runs a test body against a fresh page, and fails it if anything went wrong in the page. */
export async function withApp(env, options, body) {
  const app = await openApp(env, options);
  let failed = true;
  try {
    await body(app);
    failed = false;
  } finally {
    if (failed) await app.context.close();
    else await app.finish();
  }
}

/** The instant at which a wall clock in `timeZone` reads the given time. */
export function zoned(timeZone, year, month, day, hour = 12, minute = 0, second = 0) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(format.formatToParts(guess).map(({ type, value }) => [type, Number(value)]));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += wanted - shown;
  }
  return guess;
}

/** A real touch swipe, through the browser's input pipeline, so the page sees touch pointer events. */
export async function touchSwipe(page, from, to, { steps = 10, stepDelay = 16 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
    });
    await new Promise((resolve) => setTimeout(resolve, stepDelay));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/**
 * A touch whose timing is written down, not measured: every point says when it happens, in milliseconds after the
 * start, and the browser stamps its events with those times. How fast the finger moved then doesn't depend on how
 * busy the machine is.
 *
 * Use it without `clock`: Playwright's fake clock also fakes Event.timeStamp, which would overwrite these times.
 */
export async function timedTouch(page, points, releaseAt) {
  const cdp = await page.context().newCDPSession(page);
  const start = Date.now();
  const at = (ms) => (start + ms) / 1000;
  const [first, ...rest] = points;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x, y: first.y }], timestamp: at(first.at) });
  for (const { x, y, at: ms } of rest) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }], timestamp: at(ms) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at(releaseAt) });
  await cdp.detach();
}

/** What's in localStorage under the store key, parsed. */
export function savedData(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('daybook.v1')));
}
