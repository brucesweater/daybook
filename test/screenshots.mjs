// Screenshots of every size, mode and state, into test/artifacts/. Run: npm run screenshots
// Pass words to narrow it down: `npm run screenshots -- 390x844 dark sheet`.
// A passing test doesn't prove it's beautiful, so these get looked at.

import { mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';
import { messyData } from './helpers/data.mjs';

const OUT = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const filters = process.argv.slice(2);

const SIZES = [
  [1440, 900],
  [1280, 720],
  [1000, 800],
  [820, 1180],
  [390, 844],
  [320, 568],
];
/** Only for the states that name them: a short laptop window, a big screen, an iPad on its side, a phone on its side. */
const EXTRA_SIZES = [
  [1280, 600],
  [1366, 650],
  [1920, 1080],
  [2560, 1440],
  [1180, 820],
  [844, 390],
];
const MODES = ['light', 'dark'];

const TIME_ZONE = 'America/Chicago';
/** Today in the browser's zone. toISOString would give the UTC day, which is tomorrow every evening in Chicago. */
const todayThere = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

const isPaged = (width) => width < 1000;
const noSheet = async (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'));
const settle = (page) => page.waitForTimeout(420);

async function showTodo(page, width) {
  if (isPaged(width)) await page.locator('#tab-todo').click();
}

const NOTCH = { top: 47, bottom: 34, left: 0, right: 0 };
const NOTCH_SIDEWAYS = { top: 0, bottom: 21, left: 47, right: 47 };

/** Hovers over something once it has stopped moving. */
const hover = (selector) => async (page) => {
  await page.locator(selector).first().hover();
};
/** Shows a keyboard focus ring: tabbing is what makes one appear. */
const focusRing = (selector) => async (page) => {
  await page.locator(selector).first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
};

const STATES = {
  demo: { query: '?demo', run: async () => {} },
  'demo-todo': { query: '?demo', paged: true, run: async (page, width) => showTodo(page, width) },
  empty: { query: '', run: async () => {} },
  'empty-todo': { query: '', paged: true, run: async (page, width) => showTodo(page, width) },
  completed: {
    query: '?demo',
    run: async (page, width) => {
      await showTodo(page, width);
      await page.locator('#completed-toggle').click();
      await page.waitForTimeout(340);
      await page.locator('#completed').evaluate((node) => node.scrollIntoView({ block: 'end' }));
    },
  },
  'sheet-new-event': { query: '?demo', run: async (page) => page.locator('#new-event').click() },
  'sheet-edit-event': { query: '?demo', run: async (page) => page.locator('.agenda-row').nth(2).click() },
  'sheet-all-day': {
    query: '?demo',
    run: async (page) => {
      await page.locator('#new-event').click();
      await page.waitForTimeout(340);
      await page.getByRole('switch', { name: 'All-day' }).click({ force: true });
      await page.locator('#event-title').fill('Long weekend at the lake');
    },
  },
  'sheet-task': {
    query: '?demo',
    run: async (page, width) => {
      await showTodo(page, width);
      await page.locator('#open-list .task-text').first().click();
    },
  },
  'menu': { query: '?demo', run: async (page) => page.locator('#menu-button').click() },
  'alert': {
    query: '?demo',
    run: async (page) => {
      await page.locator('#menu-button').click();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#menu-import').click();
      await (await chooser).setFiles({
        name: 'b.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ app: 'Daybook', version: 1, events: new Array(0), tasks: [] })),
      });
    },
  },
  toast: {
    query: '?demo',
    run: async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await noSheet(page);
      await page.locator('.toast').waitFor();
    },
  },
  messy: { seed: true, query: '', run: async () => {} },
  'messy-todo': { seed: true, query: '', paged: true, run: async (page, width) => showTodo(page, width) },
  'next-month': { query: '?demo', run: async (page) => page.locator('#next-month').click() },
  corrupt: { raw: '{{{ not a backup', query: '', run: async () => {} },
  // Today unselected, in its accent colour, next to a selected day's disc.
  'other-day': {
    query: '?demo',
    sizes: ['1280x720', '390x844'],
    run: async (page) => page.locator('#days-pane .day:not(.is-today):not(.is-adjacent)').nth(4).click(),
  },
  // A notched iPhone. Headless Chrome has no safe areas of its own, so these come from DevTools.
  'safe-calendar': { query: '?demo', sizes: ['390x844'], insets: NOTCH, run: async () => {} },
  'safe-todo': { query: '?demo', sizes: ['390x844'], insets: NOTCH, run: async (page) => page.locator('#tab-todo').click() },
  'safe-sheet': { query: '?demo', sizes: ['390x844'], insets: NOTCH, run: async (page) => page.locator('.agenda-row').nth(1).click() },
  'safe-toast': {
    query: '?demo',
    sizes: ['390x844'],
    insets: NOTCH,
    run: async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await noSheet(page);
      await page.locator('.toast').waitFor();
    },
  },
  'sideways-notch': { query: '?demo', sizes: ['844x390'], insets: NOTCH_SIDEWAYS, run: async () => {} },
  'toast-todo': {
    query: '?demo',
    sizes: ['1440x900', '1280x720', '1000x800', '390x844'],
    run: async (page, width) => {
      await showTodo(page, width);
      await page.locator('#open-list .task-text').first().click();
      await page.locator('#task-delete').click();
      await noSheet(page);
      await page.locator('.toast').waitFor();
    },
  },
  // A short laptop window: one scroller, the header staying, at the top and scrolled.
  short: { query: '?demo', sizes: ['1280x600', '1366x650'], run: async () => {} },
  'short-scrolled': {
    query: '?demo',
    sizes: ['1280x600', '1366x650'],
    run: async (page) => page.locator('#calendar-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; }),
  },
  // Big screens, full and empty.
  big: { query: '?demo', sizes: ['1920x1080', '2560x1440'], run: async () => {} },
  'big-empty': { query: '', sizes: ['1920x1080', '2560x1440'], run: async () => {} },
  // Touch on an iPad on its side.
  'tablet-sideways': { query: '?demo', sizes: ['1180x820'], touch: true, run: async () => {} },
  // What the pointer and the keyboard do to things.
  'hover-today': { query: '?demo', sizes: ['1280x720'], keepPointer: true, run: hover('#go-today') },
  'hover-task': { query: '?demo', sizes: ['1280x720'], keepPointer: true, run: hover('#open-list .task-text') },
  'hover-completed': { query: '?demo', sizes: ['1280x720'], keepPointer: true, run: hover('#completed-toggle') },
  'hover-clear': { query: '?demo', sizes: ['1280x720'], keepPointer: true, run: hover('#clear-completed') },
  'hover-agenda': { query: '?demo', sizes: ['1280x720'], keepPointer: true, run: hover('.agenda-row') },
  'hover-delete': {
    query: '?demo',
    sizes: ['1280x720'],
    keepPointer: true,
    run: async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.waitForTimeout(340);
      await page.locator('#event-delete').hover();
    },
  },
  'hover-undo': {
    query: '?demo',
    sizes: ['1280x720'],
    keepPointer: true,
    run: async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await noSheet(page);
      await page.locator('.toast-undo').hover();
    },
  },
  'focus-day': { query: '?demo', sizes: ['1280x720', '320x568'], run: focusRing('#days-pane .day[tabindex="0"]') },
  'focus-clear': { query: '?demo', sizes: ['1280x720'], run: focusRing('#clear-completed') },
  'focus-task': { query: '?demo', sizes: ['1280x720'], run: focusRing('#open-list .task-text') },
};

const [browser, server] = await Promise.all([chromium.launch({ channel: 'chrome', headless: true }), startServer()]);

const jobs = [];
for (const [width, height] of [...SIZES, ...EXTRA_SIZES]) {
  const isExtra = EXTRA_SIZES.some(([w, h]) => w === width && h === height);
  for (const colorScheme of MODES) {
    for (const [name, state] of Object.entries(STATES)) {
      if (state.paged && !isPaged(width)) continue;
      if (state.sizes ? !state.sizes.includes(`${width}x${height}`) : isExtra) continue;
      const file = `${width}x${height}-${colorScheme}-${name}`;
      if (filters.length > 0 && !filters.every((word) => file.includes(word))) continue;
      jobs.push({ width, height, colorScheme, state, file });
    }
  }
}

async function shoot({ width, height, colorScheme, state, file }) {
  const touch = width < 1000 || !!state.touch;
  const context = await browser.newContext({
    viewport: { width, height },
    // Enough to judge hairlines on the phone sizes without making huge files.
    deviceScaleFactor: width < 600 ? 2 : 1,
    isMobile: touch,
    hasTouch: touch,
    colorScheme,
    locale: 'en-US',
    timezoneId: TIME_ZONE,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  if (state.insets) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: state.insets });
  }
  if (state.seed || state.raw) {
    const data = state.raw ?? JSON.stringify(messyData(Date.now(), todayThere()));
    await page.addInitScript((value) => localStorage.setItem('daybook.v1', value), data);
  }
  await page.goto(`${server.url}${state.query}`);
  await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
  await state.run(page, width);
  // Unless the hover is the point, the pointer leaves, so the shot shows things at rest.
  if (!state.keepPointer) await page.mouse.move(2, 2);
  await settle(page);
  await page.screenshot({ path: `${OUT}${file}.png` });
  await context.close();
}

await Promise.all(Array.from({ length: 4 }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) await shoot(job);
}));

const shots = readdirSync(OUT).filter((name) => name.endsWith('.png')).length;
await browser.close();
await server.close();
console.log(`${shots} screenshots in test/artifacts/`);
