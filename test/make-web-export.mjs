// `node test/make-web-export.mjs`: makes test/fixtures/web-export.json, the backup the iOS app's tests import.
//
// Everything goes through the real interface in Chrome: import the shared fixture, add events and tasks with emoji, CJK,
// notes, all-day and multi-day events, a party ending at midnight and a task checked off, then Export Backup….
// Copy the result to ~/Developer/Daybook/Fixtures/web-export.json (the two copies stay identical).

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { FIXTURE_PATH } from './helpers/data.mjs';
import { launch, openApp, until, zoned } from './helpers/harness.mjs';

const OUT = new URL('./fixtures/web-export.json', import.meta.url).pathname;
const ZONE = 'America/Chicago';
// The day after the clocks went back: 2026-11-01 had 25 hours here.
const NOW = zoned(ZONE, 2026, 11, 2, 10, 17, 23);

const sheetGone = (page) => until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));

async function addEvent(page, { title, notes = '', allDay = false, start, end }) {
  await page.locator('#new-event').click();
  await page.locator('#event-title').fill(title);
  if (allDay) await page.locator('#event-all-day').click();
  await page.locator('#event-start-date').fill(start[0]);
  if (!allDay) await page.locator('#event-start-time').fill(start[1]);
  await page.locator('#event-end-date').fill(end[0]);
  if (!allDay) await page.locator('#event-end-time').fill(end[1]);
  await page.locator('#event-notes').fill(notes);
  await page.locator('#event-submit').click();
  await sheetGone(page);
}

async function addTask(page, title) {
  await page.locator('#add-input').fill(title);
  await page.locator('#add-input').press('Enter');
}

const env = await launch();
try {
  const { page, finish } = await openApp(env, { clock: NOW, timezoneId: ZONE });

  await page.locator('#menu-button').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import Backup…' }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
  await page.locator('#alert-confirm').click();

  await addEvent(page, { title: '🎂 生日派对 Party', notes: '第一行\nSecond line 🎈', start: ['2026-11-02', '19:00'], end: ['2026-11-03', '00:00'] });
  await addEvent(page, { title: 'Conférence ✈️ 東京', notes: 'Spans the 25-hour day', start: ['2026-11-01', '22:30'], end: ['2026-11-04', '08:15'] });
  await addEvent(page, { title: 'Spring forward 🌸', start: ['2027-03-14', '01:30'], end: ['2027-03-14', '03:30'] });
  await addEvent(page, { title: '家庭旅行 Family trip', notes: '“Quotes” & <tags>', allDay: true, start: ['2026-11-20'], end: ['2026-11-23'] });
  await addEvent(page, { title: 'Night shift 🌙', start: ['2026-11-02', '22:00'], end: ['2026-11-03', '06:00'] });
  await addEvent(page, { title: 'Last minute', start: ['2026-11-02', '23:00'], end: ['2026-11-02', '23:59'] });

  await addTask(page, '写作文 ✍️ 800字');
  await addTask(page, 'Call 👵🏻 about the 🎄 plans');
  await addTask(page, 'Résumé: “quotes” & <angle> brackets');
  await until(async () => assert.equal(await page.locator('#open-list .task').count(), 5));

  // Notes and an earlier Assigned through the task editor, across the night the clocks went back.
  await page.locator('.task', { hasText: '写作文' }).locator('.task-text').click();
  await page.locator('#task-notes').fill('题目：我的家乡\n至少 800 字 📝');
  await page.locator('#task-date').fill('2026-10-31');
  await page.locator('#task-time').fill('23:45');
  await page.locator('#task-submit').click();
  await sheetGone(page);

  // Checked off, then left to settle into Completed.
  await page.locator('.task', { hasText: 'Call 👵🏻' }).locator('.check').click();
  await until(async () => assert.equal(await page.locator('#open-list .task:not(.leaving)').count(), 4), 6000);

  await page.locator('#menu-button').click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export Backup…' }).click();
  const file = await download;
  const text = await readFile(await file.path(), 'utf8');
  await writeFile(OUT, text);
  const { events, tasks } = JSON.parse(text);
  console.log(`${file.suggestedFilename()} → ${OUT}: ${events.length} events, ${tasks.length} tasks`);
  await finish();
} finally {
  await env.close();
}
