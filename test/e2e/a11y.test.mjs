import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { doc, messyData } from '../helpers/data.mjs';
import { TIME_ZONE, launch, openApp, runAxe, until, zoned } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const NOW = zoned(TIME_ZONE, 2026, 11, 5, 12);
const noSheet = (page) => until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));

async function showScreen(page, layout, name) {
  if (layout === 'phone') await page.locator(`#tab-${name}`).click();
}

/** Each state is set up on a fresh page. */
const STATES = {
  populated: { query: '?demo', setup: async () => {} },
  'populated, To-Do': { query: '?demo', setup: async (page, layout) => showScreen(page, layout, 'todo') },
  'Completed expanded': {
    query: '?demo',
    setup: async (page, layout) => {
      await showScreen(page, layout, 'todo');
      await page.locator('#completed-toggle').click();
    },
  },
  empty: { setup: async () => {} },
  'empty, To-Do': { setup: async (page, layout) => showScreen(page, layout, 'todo') },
  'new event sheet': { query: '?demo', setup: async (page) => page.locator('#new-event').click() },
  'edit event sheet': { query: '?demo', setup: async (page) => page.locator('.agenda-row').first().click() },
  'edit task sheet': {
    query: '?demo',
    setup: async (page, layout) => {
      await showScreen(page, layout, 'todo');
      await page.locator('#open-list .task-text').first().click();
    },
  },
  'menu open': { query: '?demo', setup: async (page) => page.locator('#menu-button').click() },
  'import question': {
    query: '?demo',
    setup: async (page) => {
      await page.locator('#menu-button').click();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#menu-import').click();
      await (await chooser).setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc())) });
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
    },
  },
  'undo toast': {
    query: '?demo',
    setup: async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await noSheet(page);
      await page.locator('.toast').waitFor();
    },
  },
  'messy data': { seed: messyData(NOW, '2026-11-05'), setup: async () => {} },
  'a corrupt-store notice': { seed: '{{{', setup: async () => {} },
};

for (const colorScheme of ['light', 'dark']) {
  for (const layout of ['desktop', 'phone']) {
    describe(`axe, ${colorScheme}, ${layout}`, () => {
      for (const [name, { query = '', seed = null, setup }] of Object.entries(STATES)) {
        test(name, async () => {
          const app = await openApp(env, { clock: NOW, colorScheme, layout, query, seed, reducedMotion: 'reduce' });
          await setup(app.page, layout);
          const { serious, report, violations } = await runAxe(app.page);
          assert.equal(serious.length, 0, report);
          assert.equal(violations.length, 0, `Minor findings too:\n${report}`);
          await app.finish();
        });
      }
    });
  }
}
