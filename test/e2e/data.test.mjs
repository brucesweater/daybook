import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE, FIXTURE_PATH, doc, event, task } from '../helpers/data.mjs';
import { TIME_ZONE, launch, savedData, until, withApp, zoned } from '../helpers/harness.mjs';

let env;
let dir;
before(async () => {
  env = await launch();
  dir = await mkdtemp(join(tmpdir(), 'daybook-test-'));
});
after(async () => {
  await env.close();
  await rm(dir, { recursive: true, force: true });
});

const NOW = zoned(TIME_ZONE, 2026, 11, 5, 12);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const openTitles = (page) => page.locator('#open-list .task:not(.leaving) .task-title').allInnerTexts();
const agendaTitles = (page) => page.locator('#agenda-list .agenda-item:not(.leaving) .agenda-row-title').allInnerTexts();
const cell = (page, day) => page.locator(`#days-pane .day[data-day="${day}"]`);

async function chooseFile(page, path) {
  await page.locator('#menu-button').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import Backup…' }).click();
  await (await chooser).setFiles(path);
}

async function writeTemp(name, text) {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}

describe('persistence', () => {
  test('everything survives a reload', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Dentist');
      await page.locator('#event-submit').click();
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      await page.locator('#add-input').fill('Essay');
      await page.locator('#add-input').press('Enter');
      await page.locator('#add-input').fill('Done one');
      await page.locator('#add-input').press('Enter');
      await page.getByRole('button', { name: 'Mark Done one as done' }).click();
      const before = await savedData(page);

      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.deepEqual(await agendaTitles(page), ['Dentist']);
      assert.deepEqual(await openTitles(page), ['Essay']);
      assert.equal(await page.locator('#completed-label').innerText(), 'Completed (1)');
      const after = await savedData(page);
      assert.deepEqual(after.events, before.events);
      assert.deepEqual(after.tasks, before.tasks);
    });
  });

  test('stored under daybook.v1, in the file format', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#add-input').fill('Essay');
      await page.locator('#add-input').press('Enter');
      const saved = await savedData(page);
      assert.equal(saved.app, 'Daybook');
      assert.equal(saved.version, 1);
      assert.match(saved.exportedAt, /Z$/);
      assert.deepEqual(saved.events, []);
      assert.deepEqual(Object.keys(saved.tasks[0]), ['id', 'title', 'notes', 'assignedAt', 'completedAt']);
    });
  });

  test('the first visit starts empty and does not look broken', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await page.locator('#agenda-empty').isVisible(), true);
      assert.equal(await page.locator('#todo-empty').isVisible(), true);
      assert.equal(await page.locator('.saved-line').innerText(), 'Saved in this browser.\nNothing is uploaded.'.replace('\n', ' '));
      assert.equal(await page.locator('.notice').count(), 0);
    });
  });
});

describe('backup', () => {
  test('the menu has exactly the two items, and the top bar the line', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await page.locator('#menu').isVisible(), false);
      await page.locator('#menu-button').click();
      assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['Export Backup…', 'Import Backup…']);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-export');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-import');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-export');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-button');
      await page.locator('#menu-button').click();
      await page.mouse.click(300, 300);
      assert.equal(await page.locator('#menu').isVisible(), false);
    });
  });

  test('export then import round trip', async () => {
    const events = [event('e1', 'Dentist', '2026-11-05', 870, '2026-11-05', 930, 'Card'), { id: 'E2', title: '写作业 ✏️', notes: '', allDay: true, startDay: '2026-11-07', startMinutes: null, endDay: '2026-11-09', endMinutes: null }];
    const tasks = [task('t1', 'Essay', 3 * DAY, NOW, { notes: 'Two pages' }), task('T2', 'Done', 9 * DAY, NOW, { doneAfter: DAY })];
    let exported;
    await withApp(env, { clock: NOW, seed: doc(events, tasks) }, async ({ page }) => {
      await page.locator('#menu-button').click();
      const waiting = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Export Backup…' }).click();
      const download = await waiting;
      assert.equal(download.suggestedFilename(), 'daybook-backup-2026-11-05.json');
      exported = await readFile(await download.path(), 'utf8');
      const parsed = JSON.parse(exported);
      assert.equal(parsed.app, 'Daybook');
      assert.equal(parsed.version, 1);
      assert.equal(Date.parse(parsed.exportedAt) > NOW - 5000, true);
      assert.deepEqual(parsed.events, events);
      assert.deepEqual(parsed.tasks, tasks);
    });

    const path = await writeTemp('roundtrip.json', exported);
    await withApp(env, { clock: NOW, seed: doc([], [task('old', 'Replaced', DAY, NOW)]) }, async ({ page }) => {
      await chooseFile(page, path);
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
      assert.equal(await page.locator('#alert-message').innerText(), 'Replace everything here with 2 events and 2 tasks from this backup?');
      assert.deepEqual(await openTitles(page), ['Replaced'], 'nothing changes until confirmed');
      await page.locator('#alert-confirm').click();
      assert.deepEqual(await openTitles(page), ['Essay']);
      assert.deepEqual(await agendaTitles(page), ['Dentist']);
      const saved = await savedData(page);
      assert.deepEqual(saved.events, events);
      assert.deepEqual(saved.tasks, tasks);
    });
  });

  test('the shared fixture imports, with all its quirks', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await chooseFile(page, FIXTURE_PATH);
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
      assert.equal(await page.locator('#alert-message').innerText(), 'Replace everything here with 5 events and 3 tasks from this backup?');
      await page.locator('#alert-confirm').click();
      assert.deepEqual(await agendaTitles(page), ['Dentist']);
      assert.deepEqual(await openTitles(page), ['Reply to Coach', 'Finish the essay']);
      const saved = await savedData(page);
      assert.equal('somethingFromTheFuture' in saved, false);
      assert.equal(saved.tasks[1].assignedAt, '2026-09-01T08:15:30.000Z');
      assert.equal(saved.events[1].id, 'ABCDEF12-3456-7890-ABCD-EF1234567890');
    });
  });

  test('Cancel on the question changes nothing', async () => {
    const seed = doc([], [task('old', 'Keep me', DAY, NOW)]);
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      const before = await page.evaluate(() => localStorage.getItem('daybook.v1'));
      await chooseFile(page, FIXTURE_PATH);
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
      await page.locator('#alert-cancel').click();
      assert.equal(await page.locator('#alert').evaluate((node) => node.open), false);
      assert.deepEqual(await openTitles(page), ['Keep me']);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), before);
    });
  });

  test('a bad file is refused with the exact message, and changes nothing', async () => {
    const bad = {
      'not-json.json': 'hello, this is not json',
      'empty.json': '',
      'wrong-app.json': JSON.stringify({ ...doc(), app: 'Other' }),
      'wrong-version.json': JSON.stringify({ ...doc(), version: 2 }),
      'no-arrays.json': JSON.stringify({ app: 'Daybook', version: 1 }),
      'bad-event.json': JSON.stringify(doc([{ id: 'x', title: 'X', startDay: '2026-02-30', endDay: '2026-02-30' }])),
      'bad-task.json': JSON.stringify(doc([], [{ id: 'x', title: 'X', assignedAt: 'yesterday' }])),
      'backwards.json': JSON.stringify(doc([{ id: 'x', title: 'X', startDay: '2026-11-05', startMinutes: 600, endDay: '2026-11-05', endMinutes: 500 }])),
    };
    const seed = doc([], [task('old', 'Keep me', DAY, NOW)]);
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      const before = await page.evaluate(() => localStorage.getItem('daybook.v1'));
      for (const [name, text] of Object.entries(bad)) {
        await chooseFile(page, await writeTemp(name, text));
        await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
        assert.equal(await page.locator('#alert-message').innerText(), 'This file isn’t a Daybook backup.', name);
        assert.equal(await page.locator('#alert-cancel').isVisible(), false);
        await page.locator('#alert-confirm').click();
        assert.deepEqual(await openTitles(page), ['Keep me'], name);
        assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), before, name);
      }
    });
  });

  test('choosing the same file twice still works', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      for (let i = 0; i < 2; i += 1) {
        await chooseFile(page, FIXTURE_PATH);
        await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
        await page.locator('#alert-cancel').click();
      }
    });
  });

  test('a date no file should have is refused at import, so it can not brick the store on the next load', async () => {
    const odd = ['9999-12-31T23:59:59-00:01', '0000-01-01T00:00:00+00:01', '0000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.000Z'];
    await withApp(env, { clock: NOW, seed: doc([], [task('old', 'Keep me', DAY, NOW)]) }, async ({ page }) => {
      for (const [i, assignedAt] of odd.entries()) {
        await chooseFile(page, await writeTemp(`odd-${i}.json`, JSON.stringify(doc([], [{ id: 'x', title: 'X', assignedAt, completedAt: null }]))));
        await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
        assert.equal(await page.locator('#alert-message').innerText(), 'This file isn’t a Daybook backup.', assignedAt);
        await page.locator('#alert-confirm').click();
      }
      assert.deepEqual(await openTitles(page), ['Keep me']);
    });
  });

  /** Imports a file, and returns how many rows animated in or out as it landed. */
  async function importCountingAnimations(page, name, data) {
    await page.evaluate(() => {
      window.__animated = 0;
      window.__observer?.disconnect();
      window.__observer = new MutationObserver((records) => {
        for (const { target } of records) if (target.classList.contains('is-animating')) window.__animated += 1;
      });
      window.__observer.observe(document.querySelector('#open-list'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await chooseFile(page, await writeTemp(name, JSON.stringify(data)));
    await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
    await page.locator('#alert-confirm').click();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    return page.evaluate(() => window.__animated);
  }

  test('a big import stays quick: rows that many do not animate one by one, coming or going', async () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => task(`t${i}`, `Task ${i}`, (i + 1) * HOUR, NOW));
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await importCountingAnimations(page, 'big.json', doc([], tasks)), 0);
      assert.equal(await page.locator('#open-list > li').count(), 1000);
      assert.equal(await importCountingAnimations(page, 'none.json', doc()), 0);
      assert.equal(await page.locator('#open-list > li').count(), 0);
    });
  });

  test('a few new rows still open up', async () => {
    const tasks = Array.from({ length: 3 }, (_, i) => task(`t${i}`, `Task ${i}`, (i + 1) * HOUR, NOW));
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await importCountingAnimations(page, 'few.json', doc([], tasks)), 3);
    });
  });

  test('importing drops anything mid-settle, and keeps the app working', async () => {
    const real = Date.now();
    await withApp(env, { seed: doc([], [task('a', 'Checking', DAY, real)]) }, async ({ page }) => {
      await page.locator('.check').click();
      await chooseFile(page, FIXTURE_PATH);
      await until(async () => assert.equal(await page.locator('#alert').evaluate((node) => node.open), true));
      await page.locator('#alert-confirm').click();
      await page.waitForTimeout(1000);
      assert.deepEqual(await openTitles(page), ['Reply to Coach', 'Finish the essay']);
    });
  });
});

describe('corrupt or unavailable storage', () => {
  test('corrupt: starts empty, keeps a copy, says so once, works, and does not overwrite until a change', async () => {
    const corrupt = '{"app":"Daybook","version":1,"events":[{"oops":true}],"tasks":[]}';
    await withApp(env, { clock: NOW, seed: corrupt }, async ({ page }) => {
      const notice = page.locator('.notice');
      assert.equal(await notice.count(), 1);
      assert.match(await notice.innerText(), /couldn’t be read/);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1.corrupt')), corrupt);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), corrupt, 'not overwritten on load');
      assert.equal(await page.locator('#todo-empty').isVisible(), true);

      // A reload doesn't say it again.
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.equal(await notice.count(), 0, 'says so once');

      // The app works; the copy stays.
      await page.locator('#add-input').fill('Fresh start');
      await page.locator('#add-input').press('Enter');
      assert.equal((await savedData(page)).tasks[0].title, 'Fresh start');
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1.corrupt')), corrupt);

      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.deepEqual(await openTitles(page), ['Fresh start']);
      assert.equal(await notice.count(), 0);
    });
  });

  test('not even JSON', async () => {
    await withApp(env, { clock: NOW, seed: '{{{ nope' }, async ({ page }) => {
      assert.equal(await page.locator('.notice').count(), 1);
      await page.locator('.notice-dismiss').click();
      assert.equal(await page.locator('.notice').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1.corrupt')), '{{{ nope');
    });
  });

  test('saving throws: a persistent polite banner, no crash, and it clears when saving works again', async () => {
    const init = () => {
      window.__failWrites = false;
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(...args) {
        if (window.__failWrites && this === window.localStorage) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return real.apply(this, args);
      };
    };
    await withApp(env, { clock: NOW, init }, async ({ page }) => {
      const banner = page.locator('#save-banner');
      assert.equal(await banner.count(), 0);
      await page.evaluate(() => { window.__failWrites = true; });
      await page.locator('#add-input').fill('Not saved');
      await page.locator('#add-input').press('Enter');
      assert.equal(await banner.count(), 1);
      assert.match(await banner.innerText(), /can’t be saved/);
      assert.deepEqual(await openTitles(page), ['Not saved'], 'the app keeps working');
      assert.equal(await page.locator('#notices').getAttribute('role'), 'status');

      await page.locator('#add-input').fill('Also not saved');
      await page.locator('#add-input').press('Enter');
      assert.equal(await banner.count(), 1, 'one banner, however many failures');

      await page.evaluate(() => { window.__failWrites = false; });
      await page.locator('#add-input').fill('Saved');
      await page.locator('#add-input').press('Enter');
      assert.equal(await banner.count(), 0);
      assert.equal((await savedData(page)).tasks.length, 3);
    });
  });

  test('localStorage blocked entirely: the page runs in memory and says so', async () => {
    const init = () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
    };
    await withApp(env, { clock: NOW, init }, async ({ page }) => {
      assert.equal(await page.locator('#save-banner').count(), 1);
      await page.locator('#add-input').fill('In memory');
      await page.locator('#add-input').press('Enter');
      assert.deepEqual(await openTitles(page), ['In memory']);
    });
  });

  test('navigator.storage.persist is called once, and its absence is fine', async () => {
    const counting = () => {
      window.__persistCalls = 0;
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: () => { window.__persistCalls += 1; return Promise.resolve(true); } } });
    };
    await withApp(env, { clock: NOW, init: counting }, async ({ page }) => {
      for (const title of ['One', 'Two', 'Three']) {
        await page.locator('#add-input').fill(title);
        await page.locator('#add-input').press('Enter');
      }
      assert.equal(await page.evaluate(() => window.__persistCalls), 1);
    });
    const absent = () => {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    };
    await withApp(env, { clock: NOW, init: absent }, async ({ page }) => {
      await page.locator('#add-input').fill('Fine');
      await page.locator('#add-input').press('Enter');
      assert.deepEqual(await openTitles(page), ['Fine']);
    });
  });

  test('no randomUUID: ids still come out as UUIDs', async () => {
    const init = () => {
      Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined });
    };
    await withApp(env, { clock: NOW, init }, async ({ page }) => {
      await page.locator('#add-input').fill('Fine');
      await page.locator('#add-input').press('Enter');
      assert.match((await savedData(page)).tasks[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });
});

describe('two tabs', () => {
  test('a change in one tab re-renders the other', async () => {
    await withApp(env, { clock: NOW }, async ({ context, page }) => {
      const other = await context.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);

      await page.locator('#add-input').fill('From tab one');
      await page.locator('#add-input').press('Enter');
      await until(async () => assert.deepEqual(await openTitles(other), ['From tab one']));

      await other.locator('.check').click();
      await until(async () => assert.equal(await page.locator('#todo-count').innerText(), 'All done'));
      await until(async () => assert.equal(await page.locator('#completed-label').innerText(), 'Completed (1)'));

      await other.evaluate(() => localStorage.clear());
      await until(async () => assert.equal(await page.locator('#todo-empty').isVisible(), true));
      await until(async () => assert.equal(await page.locator('#completed').isVisible(), false));
      await other.close();
    });
  });
});

describe('?demo', () => {
  test('seeds fictional data in memory only, and never saves', async () => {
    const counting = () => {
      window.__persistCalls = 0;
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: () => { window.__persistCalls += 1; return Promise.resolve(true); } } });
    };
    await withApp(env, { clock: NOW, query: '?demo', init: counting }, async ({ page }) => {
      assert.ok((await openTitles(page)).length >= 5);
      assert.ok((await agendaTitles(page)).length >= 3);
      assert.equal(await page.locator('#completed').isVisible(), true);
      await page.locator('#add-input').fill('Not saved');
      await page.locator('#add-input').press('Enter');
      await page.locator('#open-list .check').first().click();
      await page.locator('#clear-completed').click();
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
      assert.equal(await page.evaluate(() => window.__persistCalls), 0);
      assert.equal(await page.locator('.notice').count(), 0);
    });
  });

  test('real data underneath is untouched', async () => {
    const seed = JSON.stringify(doc([], [task('mine', 'My real task', DAY, NOW)]));
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      await page.goto(`${page.url()}?demo`);
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.equal((await openTitles(page)).includes('My real task'), false);
      await page.locator('#add-input').fill('Not saved');
      await page.locator('#add-input').press('Enter');
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), seed);
    });
  });

  test('the first visit without ?demo has no demo data', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.deepEqual(await openTitles(page), []);
      assert.deepEqual(await agendaTitles(page), []);
    });
  });
});

describe('time zones', () => {
  // A zone west of UTC, a zone east of it, and the extremes, whichever zone this run is in.
  for (const timezoneId of ['America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test(`days stay on their days in ${timezoneId}`, async () => {
      const clock = zoned(timezoneId, 2026, 11, 5, 12);
      await withApp(env, { clock, timezoneId, seed: FIXTURE }, async ({ page }) => {
        // Wall-clock events land on the same day everywhere.
        assert.equal(await page.locator('#days-pane .day[aria-current="date"]').getAttribute('data-day'), '2026-11-05');
        assert.equal(await page.locator('#agenda-title').innerText(), 'Today · Thursday, November 5');
        assert.deepEqual(await agendaTitles(page), ['Dentist']);
        assert.deepEqual(await page.locator('.agenda-row-time').allInnerTexts(), ['2:30 PM – 3:30 PM']);
        assert.ok(await cell(page, '2026-11-07').evaluate((node) => node.classList.contains('has-event')));
        assert.equal(await cell(page, '2026-11-06').evaluate((node) => node.classList.contains('has-event')), false);
        assert.equal(await cell(page, '2026-11-08').evaluate((node) => node.classList.contains('has-event')), false);

        // Adding on a selected day saves exactly that day.
        await cell(page, '2026-11-20').click();
        await page.locator('#new-event').click();
        assert.equal(await page.locator('#event-start-date').inputValue(), '2026-11-20');
        await page.locator('#event-title').fill('Twentieth');
        await page.locator('#event-submit').click();
        await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
        const saved = (await savedData(page)).events.find((item) => item.title === 'Twentieth');
        assert.deepEqual([saved.startDay, saved.endDay], ['2026-11-20', '2026-11-20']);
        assert.equal(await cell(page, '2026-11-20').getAttribute('aria-label'), 'Friday, November 20, 1 event');
        assert.equal(await page.locator('#agenda-title').innerText(), 'Friday, November 20');

        // Instants show in local time: this one was 17:45 UTC.
        const expected = new Intl.DateTimeFormat('en', { timeZone: timezoneId, month: 'short', day: 'numeric' }).format(new Date('2026-10-23T17:45:12.250Z'));
        await page.locator('#completed-toggle').click();
        assert.equal(await page.locator('#done-list .task-line').innerText(), `Done ${expected} · took 3 days`);

        // Assigned shows local time and round-trips.
        await page.locator('#done-list .task-text').click();
        const fields = new Intl.DateTimeFormat('en-CA', { timeZone: timezoneId, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date('2026-10-20T09:00:00Z'));
        const part = (type) => fields.find((item) => item.type === type).value;
        assert.equal(await page.locator('#task-date').inputValue(), `${part('year')}-${part('month')}-${part('day')}`);
        assert.equal(await page.locator('#task-time').inputValue(), `${part('hour')}:${part('minute')}`);
      });
    });
  }

  test('the same backup reads the same wall-clock events in any zone', async () => {
    const seen = [];
    for (const timezoneId of ['America/Los_Angeles', 'Asia/Tokyo']) {
      await withApp(env, { clock: zoned(timezoneId, 2026, 11, 13, 12), timezoneId, seed: FIXTURE }, async ({ page }) => {
        seen.push([await agendaTitles(page), await page.locator('.agenda-row-time').allInnerTexts()]);
      });
    }
    assert.deepEqual(seen[0], seen[1]);
    assert.deepEqual(seen[0], [['Late show'], ['Starts 11:00 PM']]);
  });

  test('New-day default in the far west and far east follows the local clock, not UTC', async () => {
    // 8 PM on Nov 5 in Los Angeles is already Nov 6 in UTC. 8 AM on Nov 5 in Tokyo is still Nov 4 in UTC.
    for (const [timezoneId, hour] of [['America/Los_Angeles', 20], ['Asia/Tokyo', 8]]) {
      await withApp(env, { clock: zoned(timezoneId, 2026, 11, 5, hour), timezoneId }, async ({ page }) => {
        await page.locator('#new-event').click();
        assert.equal(await page.locator('#event-start-date').inputValue(), '2026-11-05');
        assert.equal(await page.locator('#event-start-time').inputValue(), `${String(hour + 1).padStart(2, '0')}:00`);
      });
    }
  });
});
