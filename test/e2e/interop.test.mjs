// A backup the iOS app really exported (test/fixtures/ios-export.json, made by its InteropTests), imported through the
// menu and read off the screen. The unit tests check the same file against the validator.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, savedData, until, withApp } from '../helpers/harness.mjs';

const PATH = new URL('../fixtures/ios-export.json', import.meta.url).pathname;
const RAW = JSON.parse(readFileSync(PATH, 'utf8'));
// November 5 in every test zone, and every task in the file was checked off on the same day in all of them.
const NOW = Date.parse('2026-11-05T12:00:00.000Z');

let env;
let dir;
before(async () => { env = await launch(); dir = mkdtempSync(join(tmpdir(), 'daybook-interop-')); });
after(async () => { await env.close(); rmSync(dir, { recursive: true, force: true }); });

const cell = (page, day) => page.locator(`#days-pane .day[data-day="${day}"]`);
const rows = (page, list, parts) => page.locator(`${list} .task:not(.leaving), ${list} .agenda-item:not(.leaving)`)
  .evaluateAll((items, names) => items.map((item) => names.map((name) => item.querySelector(name).textContent).join(' | ')), parts);
const agenda = (page) => rows(page, '#agenda-list', ['.agenda-row-title', '.agenda-row-time']);

async function agendaOn(page, day) {
  await cell(page, day).click();
  await until(async () => assert.equal(await page.locator('#days-pane .day.is-selected').getAttribute('data-day'), day));
  return agenda(page);
}

test('a backup the iOS app exported imports through the menu and reads the same on screen', async () => {
  await withApp(env, { clock: NOW, reducedMotion: 'reduce' }, async ({ page }) => {
    await page.locator('#menu-button').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import Backup…' }).click();
    await (await chooser).setFiles(PATH);
    await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
    assert.equal(await page.locator('#alert-message').innerText(), 'Replace everything here with 11 events and 7 tasks from this backup?');
    await page.locator('#alert-confirm').click();

    const saved = await savedData(page);
    assert.deepEqual(saved.events, RAW.events);
    assert.deepEqual(saved.tasks, RAW.tasks);

    assert.equal(await page.locator('#todo-count').innerText(), '5 open');
    assert.deepEqual(await rows(page, '#open-list', ['.task-title', '.task-notes', '.task-line']), [
      'Reply to Coach |  | Assigned 2 months ago',
      'Return library books |  | Assigned 2 weeks ago',
      'Finish the essay | Two pages, double spaced | Assigned 6 days ago',
      '📔 写日记 | 每天 15 分钟… | Assigned 4 days ago',
      'Buy “good” <paper> & pens |  | Assigned 2 days ago',
    ]);
    await page.locator('#completed-toggle').click();
    assert.equal(await page.locator('#completed-label').innerText(), 'Completed (2)');
    assert.deepEqual(await rows(page, '#done-list', ['.task-title', '.task-line']), [
      'Pack for 🇯🇵 trip — 東京 | Done Nov 4 · took 2 days',
      'Old year ✓ 旧年 | Done Dec 31, 2025 · took 1 day',
    ]);

    assert.equal(await page.locator('#agenda-title').innerText(), 'Today · Thursday, November 5');
    assert.deepEqual(await agenda(page), ['Dentist | 2:30 PM – 3:30 PM']);
    assert.deepEqual(await agendaOn(page, '2026-11-01'), ['Red-eye ✈️ | Starts 11:30 PM']);
    assert.deepEqual(await agendaOn(page, '2026-11-02'), ['Red-eye ✈️ | Ends 6:45 AM', '🌃 夜市 Night market | 8:00 PM – 12:00 AM']);
    assert.deepEqual(await agendaOn(page, '2026-11-03'), [], 'the night market ends exactly at midnight');
    assert.equal(await cell(page, '2026-11-02').getAttribute('aria-label'), 'Monday, November 2, 2 events');
    assert.equal(await cell(page, '2026-11-03').getAttribute('aria-label'), 'Tuesday, November 3');
    assert.deepEqual(await agendaOn(page, '2026-11-10'), ['Workshop 🧪 实验 | All day']);
    assert.deepEqual(await agendaOn(page, '2026-11-11'), ['Workshop 🧪 实验 | Ends 5:30 PM']);

    await page.locator('#next-month').click();
    assert.deepEqual(await agendaOn(page, '2026-12-31'), ['Ski week ⛷️ スキー | All day', 'Party | 8:00 PM – 12:00 AM']);
    assert.deepEqual(await agendaOn(page, '2027-01-01'), ['Ski week ⛷️ スキー | All day'], 'adjacent day: moves to January');
    await page.locator('#next-month').click();
    await page.locator('#next-month').click();
    assert.deepEqual(await agendaOn(page, '2027-03-14'), ['DST check 🕑 | 2:30 AM – 3:15 AM']);
  });
});

test('only UTF-8 files import, as on iOS: a broken byte or UTF-16 is refused, a byte order mark is fine', async () => {
  const json = JSON.stringify({ app: 'Daybook', version: 1, events: [], tasks: [{ id: 't', title: 'TITLE', assignedAt: '2026-10-29T13:00:00Z' }] });
  const [head, tail] = json.split('TITLE');
  const files = {
    'broken-byte.json': Buffer.concat([Buffer.from(head), Buffer.from([0x41, 0xff, 0x42]), Buffer.from(tail)]),
    'utf16.json': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json.replace('TITLE', 'Essay'), 'utf16le')]),
    'bom.json': Buffer.from(`\uFEFF${json.replace('TITLE', 'Essay')}`),
  };
  await withApp(env, { clock: NOW }, async ({ page }) => {
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(dir, name);
      writeFileSync(path, bytes);
      await page.locator('#menu-button').click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('menuitem', { name: 'Import Backup…' }).click();
      await (await chooser).setFiles(path);
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
      const expected = name === 'bom.json' ? 'Replace everything here with 0 events and 1 task from this backup?' : 'This file isn’t a Daybook backup.';
      assert.equal(await page.locator('#alert-message').innerText(), expected, name);
      await page.locator('#alert-confirm').click();
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), false));
    }
    assert.deepEqual((await savedData(page)).tasks.map((task) => task.title), ['Essay']);
  });
});
