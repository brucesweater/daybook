import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, doc, task } from '../helpers/data.mjs';
import { TIME_ZONE, launch, savedData, timedTouch, touchSwipe, until, withApp, zoned } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const NOW = zoned(TIME_ZONE, 2026, 11, 5, 12);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const openTitles = (page) => page.locator('#open-list .task:not(.leaving) .task-title').allInnerTexts();
const doneTitles = (page) => page.locator('#done-list .task:not(.leaving) .task-title').allInnerTexts();
const count = (page) => page.locator('#todo-count').innerText();
const row = (page, title) => page.locator('.task:not(.leaving)', { hasText: title });
const sheetGone = (page) => until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));

async function add(page, title) {
  await page.locator('#add-input').fill(title);
  await page.locator('#add-input').press('Enter');
}

describe('list', () => {
  test('empty state on first visit', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await page.locator('#todo-empty .section-title').innerText(), 'Nothing to do');
      assert.equal(await page.locator('#todo-empty .todo-empty-hint').innerText(), 'Add a task below.');
      assert.equal(await count(page), '');
      assert.equal(await page.locator('#completed').isVisible(), false);
      assert.equal(await page.locator('#add-input').getAttribute('placeholder'), 'Add a task');
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), null, 'nothing saved until something changes');
    });
  });

  test('adding: Return adds and keeps focus; blank does nothing; new tasks land at the bottom', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await add(page, '   ');
      assert.deepEqual(await openTitles(page), []);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), null);
      await add(page, 'First');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
      assert.equal(await page.locator('#add-input').inputValue(), '');
      await page.keyboard.type('Second');
      await page.keyboard.press('Enter');
      await page.keyboard.type('  Third  ');
      await page.keyboard.press('Enter');
      assert.deepEqual(await openTitles(page), ['First', 'Second', 'Third']);
      assert.equal(await count(page), '3 open');
      assert.equal(await page.locator('#todo-empty').isVisible(), false);
      const saved = await savedData(page);
      assert.equal(saved.tasks.length, 3);
      assert.equal(saved.tasks[0].completedAt, null);
      const assigned = Date.parse(saved.tasks[0].assignedAt);
      assert.ok(Math.abs(assigned - NOW) < 60 * 1000);
      assert.match(saved.tasks[0].assignedAt, /\.\d{3}Z$/);
    });
  });

  test('the add row comes directly after the last open task, and + focuses it', async () => {
    const tasks = Array.from({ length: 40 }, (_, i) => task(`t${i}`, `Task ${i}`, (40 - i) * HOUR, NOW));
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      const after = await page.locator('#open-list').evaluate((list) => list.nextElementSibling.id);
      assert.equal(after, 'add-form');
      await page.getByRole('button', { name: 'Add a task' }).click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
      const box = await page.locator('#add-form').boundingBox();
      const card = await page.locator('#todo-scroll').boundingBox();
      assert.ok(box.y >= card.y && box.y + box.height <= card.y + card.height, 'scrolled into view');
    });
  });

  test('oldest first, whatever order they are stored in', async () => {
    const tasks = [
      task('c', 'Newest', 1 * HOUR, NOW),
      task('a', 'Oldest', 3 * DAY, NOW),
      task('b', 'Middle', 1 * DAY, NOW),
    ];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      assert.deepEqual(await openTitles(page), ['Oldest', 'Middle', 'Newest']);
    });
  });

  test('the row: a 22 pt circle with a 44 pt target, and a title that wraps and never truncates', async () => {
    const long = 'A very long task title that goes on and on and on, far past the edge of any card, because real life is like that sometimes and nobody is going to shorten it';
    await withApp(env, { clock: NOW, seed: doc([], [task('a', long, DAY, NOW)]) }, async ({ page }) => {
      const check = page.locator('.check');
      const button = await check.boundingBox();
      const circle = await page.locator('.check-circle').boundingBox();
      assert.ok(button.width >= 44 && button.height >= 44, 'target');
      assert.ok(Math.abs(circle.width - 22) < 1 && Math.abs(circle.height - 22) < 1, 'circle');
      const title = page.locator('.task-title');
      assert.equal(await title.innerText(), long);
      const lines = await title.evaluate((node) => {
        const style = getComputedStyle(node);
        return [node.scrollWidth <= node.clientWidth, style.textOverflow, style.whiteSpace, node.getBoundingClientRect().height > parseFloat(style.lineHeight) * 1.5];
      });
      assert.deepEqual(lines, [true, 'clip', 'normal', true]);
    });
  });

  test('notes show one quiet line between title and age', async () => {
    const tasks = [task('a', 'Essay', DAY, NOW, { notes: 'Two pages\nDouble spaced' })];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      const parts = await page.locator('.task-text').evaluate((node) => [...node.children].filter((child) => !child.hidden).map((child) => child.className.split(' ')[0]));
      assert.deepEqual(parts, ['task-title', 'task-notes', 'task-line']);
      assert.equal(await page.locator('.task-notes').innerText(), 'Two pages…');
      assert.equal(await page.locator('.task-notes').evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap');
    });
  });

  test('no notes, no notes line', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      assert.equal(await page.locator('.task-notes').isVisible(), false);
    });
  });
});

describe('age lines', () => {
  const ages = (page) => page.locator('#open-list .task-line').allInnerTexts();

  test('exact wording and colour bands', async () => {
    const tasks = [
      task('a', 'A', 30 * 1000, NOW),
      task('b', 'B', MINUTE, NOW),
      task('c', 'C', 12 * MINUTE, NOW),
      task('d', 'D', HOUR, NOW),
      task('e', 'E', 5 * HOUR, NOW),
      task('f', 'F', DAY, NOW),
      task('g', 'G', 6 * DAY, NOW),
      task('h', 'H', 7 * DAY, NOW),
      task('i', 'I', 13 * DAY, NOW),
      task('j', 'J', 14 * DAY, NOW),
      task('k', 'K', 29 * DAY, NOW),
      task('l', 'L', 30 * DAY, NOW),
      task('m', 'M', 60 * DAY, NOW),
      task('n', 'N', 364 * DAY, NOW),
      task('o', 'O', 365 * DAY, NOW),
      task('p', 'P', 3 * 365 * DAY, NOW),
    ];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await page.clock.pauseAt(NOW + 5000);
      const expected = {
        A: ['Assigned just now', 'rgb(110, 110, 115)', '400'],
        B: ['Assigned 1 minute ago', 'rgb(110, 110, 115)', '400'],
        C: ['Assigned 12 minutes ago', 'rgb(110, 110, 115)', '400'],
        D: ['Assigned 1 hour ago', 'rgb(110, 110, 115)', '400'],
        E: ['Assigned 5 hours ago', 'rgb(110, 110, 115)', '400'],
        F: ['Assigned 1 day ago', 'rgb(110, 110, 115)', '400'],
        G: ['Assigned 6 days ago', 'rgb(110, 110, 115)', '400'],
        H: ['Assigned 7 days ago', 'rgb(178, 95, 0)', '500'],
        I: ['Assigned 13 days ago', 'rgb(178, 95, 0)', '500'],
        J: ['Assigned 2 weeks ago', 'rgb(178, 95, 0)', '500'],
        K: ['Assigned 4 weeks ago', 'rgb(178, 95, 0)', '500'],
        L: ['Assigned 4 weeks ago', 'rgb(215, 0, 21)', '500'],
        M: ['Assigned 2 months ago', 'rgb(215, 0, 21)', '500'],
        N: ['Assigned 12 months ago', 'rgb(215, 0, 21)', '500'],
        O: ['Assigned 1 year ago', 'rgb(215, 0, 21)', '500'],
        P: ['Assigned 3 years ago', 'rgb(215, 0, 21)', '500'],
      };
      for (const [title, [words, color, weight]] of Object.entries(expected)) {
        const line = page.locator('.task').filter({ has: page.getByText(title, { exact: true }) }).locator('.task-line');
        assert.equal(await line.innerText(), words, title);
        assert.deepEqual(await line.evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.color, style.fontWeight];
        }), [color, weight], title);
      }
    });
  });

  test('stay current while the page is open', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await add(page, 'Fresh');
      assert.deepEqual(await ages(page), ['Assigned just now']);
      await page.clock.runFor(90 * 1000);
      await until(async () => assert.deepEqual(await ages(page), ['Assigned 1 minute ago']));
      await page.clock.runFor(60 * 60 * 1000);
      await until(async () => assert.deepEqual(await ages(page), ['Assigned 1 hour ago']));
    });
  });

  test('refresh within 30 seconds, without any event', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'A', 50 * 1000, NOW)]) }, async ({ page }) => {
      await page.clock.pauseAt(NOW + 5000);
      assert.deepEqual(await ages(page), ['Assigned just now']);
      await page.clock.runFor(30 * 1000);
      await until(async () => assert.deepEqual(await ages(page), ['Assigned 1 minute ago']));
    });
  });

  test('refresh on returning to the page', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'A', 2 * MINUTE, NOW)]) }, async ({ page }) => {
      await page.clock.pauseAt(NOW + 5000);
      await page.clock.setSystemTime(NOW + 3 * DAY);
      assert.deepEqual(await ages(page), ['Assigned 2 minutes ago']);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await until(async () => assert.deepEqual(await ages(page), ['Assigned 3 days ago']));
    });
  });

  test('colour updates too as a task crosses a band', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'A', 7 * DAY - 10 * 1000, NOW)]) }, async ({ page }) => {
      const line = page.locator('.task-line');
      const color = () => line.evaluate((node) => getComputedStyle(node).color);
      assert.equal(await color(), 'rgb(110, 110, 115)');
      await page.clock.runFor(30 * 1000);
      await until(async () => assert.equal(await color(), 'rgb(178, 95, 0)'));
    });
  });

  test('refreshing does not disturb focus or typing', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'A', 2 * MINUTE, NOW)]) }, async ({ page }) => {
      await page.locator('#add-input').fill('half typ');
      await page.clock.runFor(120 * 1000);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
      assert.equal(await page.locator('#add-input').inputValue(), 'half typ');
    });
  });

  test('a day is 24 hours of real time, even across the DST change', async () => {
    const zone = 'America/Chicago';
    const now = zoned(zone, 2026, 11, 1, 12);
    // Noon the day before is 25 real hours back; 11:00 PM the night before is 14 hours back.
    const tasks = [task('a', 'Yesterday noon', 25 * HOUR, now), task('b', 'Last night', 14 * HOUR, now)];
    await withApp(env, { clock: now, timezoneId: zone, seed: doc([], tasks) }, async ({ page }) => {
      await page.clock.pauseAt(now + 5000);
      assert.deepEqual(await ages(page), ['Assigned 1 day ago', 'Assigned 14 hours ago']);
    });
  });
});

describe('checking off', () => {
  test('fills at the tap, completedAt set at the tap; moves to Completed after about 0.9 s', async () => {
    await withApp(env, { seed: doc([], [task('a', 'Essay', DAY, Date.now()), task('b', 'Other', HOUR, Date.now())]) }, async ({ page }) => {
      assert.equal(await count(page), '2 open');
      const check = page.getByRole('button', { name: 'Mark Essay as done' });
      const started = Date.now();
      await check.click();
      const essay = row(page, 'Essay');
      assert.ok(await essay.evaluate((node) => node.classList.contains('is-checked')));
      assert.equal(await essay.locator('.task-title').evaluate((node) => getComputedStyle(node).textDecorationLine), 'line-through');
      const saved = (await savedData(page)).tasks.find((item) => item.id === 'a');
      assert.ok(saved.completedAt, 'completedAt is set at the tap');
      assert.ok(Math.abs(Date.parse(saved.completedAt) - started) < 2000);
      assert.equal(await count(page), '1 open');
      // Still in place for now.
      assert.deepEqual(await openTitles(page), ['Essay', 'Other']);
      assert.equal(await page.locator('#completed').isVisible(), false);
      // Then it moves.
      await until(async () => assert.deepEqual(await openTitles(page), ['Other']));
      const elapsed = Date.now() - started;
      assert.ok(elapsed > 600 && elapsed < 1800, `took ${elapsed} ms`);
      assert.equal(await page.locator('#completed-label').innerText(), 'Completed (1)');
      assert.equal(Date.parse((await savedData(page)).tasks.find((item) => item.id === 'a').completedAt), Date.parse(saved.completedAt));
    });
  });

  test('the circle fills with the accent colour and a white check draws in', async () => {
    await withApp(env, { seed: doc([], [task('a', 'Essay', DAY, Date.now())]) }, async ({ page }) => {
      await page.locator('.check').click();
      await until(async () => {
        const values = await page.locator('.check').evaluate((node) => ({
          fill: getComputedStyle(node.querySelector('.check-fill')).fill,
          opacity: getComputedStyle(node.querySelector('.check-fill')).opacity,
          stroke: getComputedStyle(node.querySelector('.check-mark')).stroke,
          offset: getComputedStyle(node.querySelector('.check-mark')).strokeDashoffset,
        }));
        assert.equal(values.fill, 'rgb(224, 40, 29)');
        assert.equal(values.opacity, '1');
        assert.equal(values.stroke, 'rgb(255, 255, 255)');
        assert.ok(['0', '0px'].includes(values.offset), values.offset);
      });
    });
  });

  test('tapping again within the window cancels it', async () => {
    await withApp(env, { seed: doc([], [task('a', 'Essay', DAY, Date.now())]) }, async ({ page }) => {
      await page.locator('.check').click();
      assert.ok((await savedData(page)).tasks[0].completedAt);
      await page.waitForTimeout(150);
      await page.locator('.check').click();
      assert.equal((await savedData(page)).tasks[0].completedAt, null);
      assert.equal(await count(page), '1 open');
      await page.waitForTimeout(1200);
      assert.deepEqual(await openTitles(page), ['Essay']);
      assert.equal(await row(page, 'Essay').evaluate((node) => node.classList.contains('is-checked')), false);
      assert.equal(await page.locator('#completed').isVisible(), false);
    });
  });

  test('checking the last open task reads All done', async () => {
    await withApp(env, { seed: doc([], [task('a', 'Essay', DAY, Date.now())]) }, async ({ page }) => {
      await page.locator('.check').click();
      assert.equal(await count(page), 'All done');
      await until(async () => assert.deepEqual(await openTitles(page), []));
      assert.equal(await page.locator('#todo-empty').isVisible(), true);
      assert.equal(await count(page), 'All done');
    });
  });

  test('several can settle at once', async () => {
    const now = Date.now();
    const tasks = [task('a', 'A', 3 * DAY, now), task('b', 'B', 2 * DAY, now), task('c', 'C', DAY, now)];
    await withApp(env, { seed: doc([], tasks) }, async ({ page }) => {
      await page.getByRole('button', { name: 'Mark A as done' }).click();
      await page.getByRole('button', { name: 'Mark C as done' }).click();
      assert.equal(await count(page), '1 open');
      await until(async () => assert.deepEqual(await openTitles(page), ['B']));
      assert.equal(await page.locator('#completed-label').innerText(), 'Completed (2)');
    });
  });

  test('reopening keeps the original assignedAt, and returns it to its place', async () => {
    const now = Date.now();
    const tasks = [task('a', 'Old', 3 * DAY, now), task('b', 'New', HOUR, now)];
    await withApp(env, { seed: doc([], tasks) }, async ({ page }) => {
      const assigned = tasks[0].assignedAt;
      await page.getByRole('button', { name: 'Mark Old as done' }).click();
      await until(async () => assert.deepEqual(await openTitles(page), ['New']));
      await page.locator('#completed-toggle').click();
      assert.deepEqual(await doneTitles(page), ['Old']);
      await page.getByRole('button', { name: 'Mark Old as not done' }).click();
      await until(async () => assert.deepEqual(await openTitles(page), ['Old', 'New']));
      const saved = (await savedData(page)).tasks.find((item) => item.id === 'a');
      assert.equal(saved.assignedAt, assigned);
      assert.equal(saved.completedAt, null);
      assert.equal(await page.locator('#completed').isVisible(), false, 'section hides with nothing in it');
      assert.match(await row(page, 'Old').locator('.task-line').innerText(), /^Assigned 3 days ago$/);
    });
  });
});

describe('a finished row on its way out', () => {
  const now = Date.now();
  const five = () => ['A', 'B', 'C', 'D', 'E'].map((title, i) => task(title.toLowerCase(), title, (5 - i) * DAY, now));
  const focusedRow = (page) => page.evaluate(() => document.activeElement.closest('[data-key]')?.dataset.key ?? document.activeElement.id ?? null);

  test('closes where it is, and the rows around it stay put', async () => {
    await withApp(env, { seed: doc([], five()) }, async ({ page }) => {
      await page.evaluate(() => {
        const list = document.querySelector('#open-list');
        const row = list.querySelector('[data-key="b"]');
        const startedAt = row.getBoundingClientRect().top;
        window.__orders = new Set();
        window.__moved = 0;
        new MutationObserver(() => {
          window.__orders.add([...list.children].map((node) => node.dataset.key + (node.classList.contains('leaving') ? '*' : '')).join());
          if (row.isConnected) window.__moved = Math.max(window.__moved, Math.abs(row.getBoundingClientRect().top - startedAt));
        }).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      await page.getByRole('button', { name: 'Mark B as done' }).click();
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 4));
      assert.deepEqual(await page.evaluate(() => [...window.__orders]), ['a,b,c,d,e', 'a,b*,c,d,e', 'a,c,d,e'], 'never anywhere but its own place');
      assert.equal(await page.evaluate(() => window.__moved), 0, 'and it never moved on screen');
    });
  });

  test('passes keyboard focus to the next row', async () => {
    await withApp(env, { seed: doc([], five()) }, async ({ page }) => {
      await page.getByRole('button', { name: 'Mark B as done' }).focus();
      await page.keyboard.press('Space');
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 4));
      assert.equal(await focusedRow(page), 'c');
    });
  });

  test('passes keyboard focus to the next row on a long list too, so the next Space checks that one', async () => {
    const tasks = Array.from({ length: 40 }, (_, i) => task(`t${i}`, `Task ${i}`, (40 - i) * DAY, now));
    await withApp(env, { seed: doc([], tasks) }, async ({ page }) => {
      await page.getByRole('button', { name: 'Mark Task 0 as done' }).focus();
      await page.keyboard.press('Space');
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 39));
      assert.equal(await focusedRow(page), 't1');
      const [row, scroller] = await Promise.all([page.locator('[data-key="t1"]').boundingBox(), page.locator('#todo-scroll').boundingBox()]);
      assert.ok(row.y >= scroller.y && row.y + row.height <= scroller.y + scroller.height, 'and it is on screen');
      await page.keyboard.press('Space');
      assert.ok((await savedData(page)).tasks.find((item) => item.id === 't1').completedAt);
    });
  });

  test('leaves focus alone if you have moved on while it settles', async () => {
    await withApp(env, { seed: doc([], five()) }, async ({ page }) => {
      await page.getByRole('button', { name: 'Mark A as done' }).focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab'); // The task's text.
      await page.keyboard.press('Tab'); // The next circle.
      assert.equal(await focusedRow(page), 'b');
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 4));
      assert.equal(await focusedRow(page), 'b');
      await page.keyboard.press('Space');
      assert.ok((await savedData(page)).tasks.find((item) => item.id === 'b').completedAt);
    });
  });

  test('the last one: focus goes to the Add field from the keyboard, but never for a pointer', async () => {
    await withApp(env, { seed: doc([], [task('a', 'Only', DAY, now)]) }, async ({ page }) => {
      await page.locator('.check').focus();
      await page.keyboard.press('Space');
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 0));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
    });
    await withApp(env, { seed: doc([], [task('a', 'Only', DAY, now)]) }, async ({ page }) => {
      await page.locator('.check').click();
      await until(async () => assert.equal(await page.locator('#open-list > li').count(), 0));
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'add-input');
      await page.keyboard.press('n');
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true, 'N is a shortcut, not a letter in a field');
    });
  });
});

describe('Undo for a pointer', () => {
  test('tapping Undo leaves focus out of the Add field, so T and N still work and no keyboard pops up', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW), task('b', 'Other', DAY, NOW)];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await row(page, 'Essay').locator('.task-text').click();
      await page.locator('#task-delete').click();
      await sheetGone(page);
      await page.locator('.toast-undo').click();
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay', 'Other']));
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'add-input');
      await page.keyboard.press('n');
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await page.locator('#add-input').inputValue(), '');
    });
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], tasks) }, async ({ page }) => {
      await page.locator('#tab-todo').tap();
      await row(page, 'Essay').locator('.task-text').tap();
      await page.locator('#task-delete').tap();
      await sheetGone(page);
      await page.locator('.toast-undo').tap();
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay', 'Other']));
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'add-input');
    });
  });

  test('from the keyboard it still comes back to the Add field', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW)];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await page.locator('.task-text').focus();
      await page.keyboard.press('Enter');
      await page.locator('#task-delete').focus();
      await page.keyboard.press('Enter');
      await sheetGone(page);
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.className), 'toast-undo'));
      await page.keyboard.press('Enter');
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay']));
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input'));
    });
  });
});

describe('completed section', () => {
  const now = Date.UTC(2026, 10, 1, 18);
  const done = [
    { id: 'a', title: 'Older', notes: '', assignedAt: '2026-10-20T12:00:00.000Z', completedAt: '2026-10-23T12:00:00.000Z' },
    { id: 'b', title: 'Newest', notes: '', assignedAt: '2026-10-31T12:00:00.000Z', completedAt: '2026-10-31T12:05:00.000Z' },
    { id: 'c', title: 'Last year', notes: '', assignedAt: '2025-03-01T12:00:00.000Z', completedAt: '2025-03-01T12:00:10.000Z' },
  ];

  test('collapsed by default; expands; rows newest-done first, struck through and secondary', async () => {
    await withApp(env, { clock: now, seed: doc([], done) }, async ({ page }) => {
      assert.equal(await page.locator('#completed-label').innerText(), 'Completed (3)');
      const toggle = page.locator('#completed-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#done-list').isVisible(), false);
      assert.equal(await page.locator('#clear-completed').innerText(), 'Clear');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await until(async () => assert.equal(await page.locator('#done-list').isVisible(), true));
      assert.deepEqual(await doneTitles(page), ['Newest', 'Older', 'Last year']);
      const title = page.locator('#done-list .task-title').first();
      assert.deepEqual(await title.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.textDecorationLine, style.color];
      }), ['line-through', 'rgb(110, 110, 115)']);
      await toggle.click();
      await until(async () => assert.equal(await page.locator('#done-list').isVisible(), false));
    });
  });

  test('the done line, with the year only if it is not the current one', async () => {
    await withApp(env, { clock: now, seed: doc([], done), timezoneId: 'UTC' }, async ({ page }) => {
      await page.locator('#completed-toggle').click();
      assert.deepEqual(await page.locator('#done-list .task-line').allInnerTexts(), [
        'Done Oct 31 · took 5 minutes',
        'Done Oct 23 · took 3 days',
        'Done Mar 1, 2025 · took under a minute',
      ]);
    });
  });

  test('Clear removes all completed tasks and offers undo, which restores them exactly', async () => {
    const tasks = [...done, { id: 'open', title: 'Still open', notes: '', assignedAt: '2026-10-31T12:00:00.000Z', completedAt: null }];
    await withApp(env, { clock: now, seed: doc([], tasks) }, async ({ page }) => {
      const before = (await savedData(page).catch(() => null));
      assert.equal(before.tasks.length, 4);
      await page.locator('#clear-completed').click();
      assert.equal(await page.locator('.toast-message').innerText(), 'Completed tasks cleared');
      assert.equal(await page.locator('#completed').isVisible(), false);
      assert.deepEqual((await savedData(page)).tasks.map((item) => item.id), ['open']);
      assert.deepEqual(await openTitles(page), ['Still open']);
      await page.locator('.toast-undo').click();
      assert.equal(await page.locator('#completed').isVisible(), true);
      assert.deepEqual((await savedData(page)).tasks, before.tasks);
    });
  });

  test('Clear leaves alone a task still settling', async () => {
    const real = Date.now();
    const tasks = [task('a', 'Done long ago', 3 * DAY, real, { doneAfter: DAY }), task('b', 'Just checked', DAY, real)];
    await withApp(env, { seed: doc([], tasks) }, async ({ page }) => {
      await page.getByRole('button', { name: 'Mark Just checked as done' }).click();
      await page.locator('#clear-completed').click();
      assert.deepEqual((await savedData(page)).tasks.map((item) => item.id), ['b']);
      await until(async () => assert.equal(await page.locator('#completed-label').innerText(), 'Completed (1)'));
    });
  });

  test('a task finished this year in the same list stays without a year, and a reopened one regains an age', async () => {
    await withApp(env, { clock: now, seed: FIXTURE }, async ({ page }) => {
      await page.locator('#completed-toggle').click();
      assert.match(await page.locator('#done-list .task-line').innerText(), /^Done Oct 2[34] · took 3 days$/);
    });
  });
});

describe('task editor', () => {
  test('edit title, notes and assigned', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW, { notes: 'Old notes' })];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await page.locator('.task-text').click();
      assert.equal(await page.locator('#task-sheet-title').innerText(), 'Edit Task');
      assert.equal(await page.locator('#task-submit').innerText(), 'Save');
      assert.equal(await page.locator('#task-title').inputValue(), 'Essay');
      assert.equal(await page.locator('#task-notes').inputValue(), 'Old notes');
      assert.equal(await page.locator('#task-date').inputValue(), '2026-11-02');
      assert.equal(await page.locator('#task-time').inputValue(), '12:00');
      assert.equal(await page.locator('#task-delete').innerText(), 'Delete Task');

      await page.locator('#task-title').fill('Big essay');
      await page.locator('#task-notes').fill('New notes');
      await page.locator('#task-date').fill('2026-10-29');
      await page.locator('#task-time').fill('08:00');
      await page.locator('#task-submit').click();
      await sheetGone(page);
      assert.deepEqual(await openTitles(page), ['Big essay']);
      assert.equal(await page.locator('.task-notes').innerText(), 'New notes');
      assert.equal(await page.locator('.task-line').innerText(), 'Assigned 1 week ago'.replace('1 week', '7 days'));
      const saved = (await savedData(page)).tasks[0];
      assert.equal(saved.id, 'a');
      assert.equal(saved.assignedAt, new Date(zoned(TIME_ZONE, 2026, 10, 29, 8)).toISOString());
    });
  });

  test('saving without touching Assigned keeps the exact instant', async () => {
    const assignedAt = new Date(NOW - 3 * DAY + 12345).toISOString();
    const tasks = [{ id: 'a', title: 'Essay', notes: '', assignedAt, completedAt: null }];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await page.locator('.task-text').click();
      await page.locator('#task-title').fill('Essay 2');
      await page.locator('#task-submit').click();
      await sheetGone(page);
      assert.equal((await savedData(page)).tasks[0].assignedAt, assignedAt);
    });
  });

  test('Assigned can not be in the future', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'Essay', 3 * DAY, NOW)]) }, async ({ page }) => {
      await page.clock.pauseAt(NOW + 5000);
      await page.locator('.task-text').click();
      assert.equal(await page.locator('#task-date').getAttribute('max'), '2026-11-05');
      await page.locator('#task-date').fill('2026-12-25');
      assert.equal(await page.locator('#task-date').inputValue(), '2026-11-05');
      assert.equal(await page.locator('#task-time').inputValue(), '12:00');
      await page.locator('#task-time').fill('18:00');
      assert.equal(await page.locator('#task-time').inputValue(), '12:00');
      await page.locator('#task-submit').click();
      await sheetGone(page);
      assert.ok(Date.parse((await savedData(page)).tasks[0].assignedAt) <= NOW + 5000);
      assert.equal(await page.locator('.task-line').innerText(), 'Assigned just now');
    });
  });

  test('Save is disabled while the title is blank; Cancel and Esc change nothing', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      await page.locator('.task-text').click();
      await page.locator('#task-title').fill('   ');
      assert.ok(await page.locator('#task-submit').isDisabled());
      await page.locator('#task-title').fill('Changed');
      await page.keyboard.press('Escape');
      await sheetGone(page);
      assert.deepEqual(await openTitles(page), ['Essay']);
      await page.locator('.task-text').click();
      await page.locator('#task-title').fill('Changed');
      await page.locator('#task-sheet [data-cancel]').click();
      await sheetGone(page);
      assert.deepEqual(await openTitles(page), ['Essay']);
    });
  });

  test('a sheet on its way out does not respond: a double Delete deletes once, Cancel then Delete nothing', async () => {
    const tasks = [task('a', 'Keep me', 1000, NOW), task('b', 'Delete me', 900, NOW)];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page, problems }) => {
      await page.locator('#open-list .task-text').first().click();
      await page.evaluate(() => {
        document.querySelector('#task-sheet [data-cancel]').click();
        document.querySelector('#task-delete').click();
      });
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      assert.deepEqual(await page.locator('#open-list .task-title').allInnerTexts(), ['Keep me', 'Delete me']);

      await page.locator('#open-list .task-text').nth(1).click();
      await page.evaluate(() => {
        const remove = document.querySelector('#task-delete');
        remove.click();
        remove.click();
      });
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      await until(async () => assert.deepEqual(await page.locator('#open-list .task-title').allInnerTexts(), ['Keep me']));
      assert.equal(await page.locator('.toast').count(), 1);
      assert.deepEqual(problems, []);
    });
  });

  test('delete and undo a task, keeping id and dates', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW, { notes: 'Two pages' }), task('b', 'Other', DAY, NOW)];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      const before = tasks[0];
      await row(page, 'Essay').locator('.task-text').click();
      await page.locator('#task-delete').click();
      await sheetGone(page);
      await until(async () => assert.deepEqual(await openTitles(page), ['Other']));
      assert.equal(await page.locator('.toast-message').innerText(), 'Task deleted');
      assert.deepEqual((await savedData(page)).tasks.map((item) => item.id), ['b']);
      await page.locator('.toast-undo').click();
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay', 'Other']));
      assert.deepEqual((await savedData(page)).tasks[0], before);
    });
  });

  test('editing a completed task works and keeps it completed', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW, { doneAfter: DAY })];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page }) => {
      await page.locator('#completed-toggle').click();
      await page.locator('#done-list .task-text').click();
      await page.locator('#task-title').fill('Essay, finished');
      await page.locator('#task-submit').click();
      await sheetGone(page);
      assert.deepEqual(await doneTitles(page), ['Essay, finished']);
      assert.equal((await savedData(page)).tasks[0].completedAt, tasks[0].completedAt);
    });
  });

  test('a done task cleared in another tab while its sheet is open comes back done, not open', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW, { doneAfter: DAY })];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page, context }) => {
      await page.locator('#completed-toggle').click();
      await page.locator('#done-list .task-text').click();
      const other = await context.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      await other.locator('#clear-completed').click();
      await other.close();
      await until(async () => assert.equal(await page.locator('#completed').isVisible(), false));
      await page.locator('#task-title').fill('Essay, edited');
      await page.locator('#task-submit').click();
      await sheetGone(page);
      const saved = (await savedData(page)).tasks[0];
      assert.equal(saved.title, 'Essay, edited');
      assert.equal(saved.completedAt, tasks[0].completedAt);
      assert.deepEqual(await openTitles(page), []);
    });
  });

  test('an open task checked off in another tab stays done when an old sheet saves here', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW)];
    await withApp(env, { clock: NOW, seed: doc([], tasks) }, async ({ page, context }) => {
      await page.locator('.task-text').click();
      const other = await context.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      await other.locator('.check').click();
      await other.close();
      await until(async () => assert.equal(await count(page), 'All done'));
      await page.locator('#task-submit').click();
      await sheetGone(page);
      assert.ok((await savedData(page)).tasks[0].completedAt);
    });
  });
});

describe('touch', () => {
  const showTodo = (page) => page.locator('#tab-todo').tap();

  test('swiping a task far deletes it, with undo', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW), task('b', 'Other', DAY, NOW)];
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], tasks) }, async ({ page }) => {
      await showTodo(page);
      const box = await row(page, 'Essay').boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + 20, y });
      await until(async () => assert.deepEqual(await openTitles(page), ['Other']));
      assert.equal(await page.locator('.toast-message').innerText(), 'Task deleted');
      await page.locator('.toast-undo').tap();
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay', 'Other']));
      assert.deepEqual((await savedData(page)).tasks[0], tasks[0]);
    });
  });

  test('a short swipe opens a Delete button; tapping it deletes; tapping elsewhere closes', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, NOW), task('b', 'Other', DAY, NOW)];
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], tasks) }, async ({ page }) => {
      await showTodo(page);
      const box = await row(page, 'Essay').boundingBox();
      const y = box.y + box.height / 2;
      const partial = async () => {
        await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + box.width - 110, y }, { steps: 20, stepDelay: 25 });
        await until(async () => assert.equal(await page.locator('.swipe-delete').isVisible(), true));
        await page.waitForTimeout(320);
      };
      await partial();
      // Tapping elsewhere closes it and does nothing else.
      await row(page, 'Other').locator('.task-text').tap();
      await until(async () => assert.equal(await page.locator('.swipe-delete').count(), 0));
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.deepEqual(await openTitles(page), ['Essay', 'Other']);
      await page.waitForTimeout(450);
      await partial();
      const button = await page.locator('.swipe-delete').boundingBox();
      await page.locator('.swipe-delete').tap({ position: { x: button.width - 44, y: button.height / 2 } });
      await until(async () => assert.deepEqual(await openTitles(page), ['Other']));
    });
  });

  // About 90 px: past the point that opens the Delete button, nowhere near the distance that deletes.
  const shortFlick = (box) => {
    const y = box.y + box.height / 2;
    const x = box.x + box.width - 10;
    return [
      { x, y, at: 0 }, { x: x - 15, y, at: 16 }, { x: x - 45, y, at: 32 }, { x: x - 75, y, at: 48 }, { x: x - 105, y, at: 64 },
    ];
  };

  test('a short flick deletes the row, with undo', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, Date.now()), task('b', 'Other', DAY, Date.now())];
    await withApp(env, { layout: 'phone', seed: doc([], tasks) }, async ({ page }) => {
      await showTodo(page);
      await timedTouch(page, shortFlick(await row(page, 'Essay').boundingBox()), 80);
      await until(async () => assert.deepEqual(await openTitles(page), ['Other']));
      await page.locator('.toast-undo').tap();
      await until(async () => assert.deepEqual(await openTitles(page), ['Essay', 'Other']));
    });
  });

  test('the same flick, then a pause before lifting, only opens the Delete button', async () => {
    const tasks = [task('a', 'Essay', 3 * DAY, Date.now()), task('b', 'Other', DAY, Date.now())];
    await withApp(env, { layout: 'phone', seed: doc([], tasks) }, async ({ page }) => {
      await showTodo(page);
      await timedTouch(page, shortFlick(await row(page, 'Essay').boundingBox()), 600);
      await until(async () => assert.equal(await page.locator('.swipe-delete').isVisible(), true));
      await page.waitForTimeout(340);
      assert.deepEqual(await openTitles(page), ['Essay', 'Other'], 'nothing deleted');
      assert.equal(await page.locator('.toast').count(), 0);
      assert.equal((await savedData(page)).tasks.length, 2);
    });
  });

  test('a very short swipe springs back, and a vertical drag does not move the row', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      await showTodo(page);
      const box = await row(page, 'Essay').boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + box.width - 40, y }, { steps: 10, stepDelay: 30 });
      await until(async () => assert.equal(await page.locator('.swipe-delete').count(), 0));
      await touchSwipe(page, { x: box.x + 100, y }, { x: box.x + 100, y: y + 80 });
      assert.equal(await page.locator('.swipe-delete').count(), 0);
      assert.deepEqual(await openTitles(page), ['Essay']);
    });
  });

  test('a swipe does not also open the editor or check the box', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      await showTodo(page);
      const box = await row(page, 'Essay').boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + box.width - 40, y }, { steps: 10, stepDelay: 30 });
      await page.waitForTimeout(100);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal((await savedData(page)).tasks[0].completedAt, null);
    });
  });

  test('a mouse can not swipe a row', async () => {
    await withApp(env, { clock: NOW, seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      const box = await row(page, 'Essay').boundingBox();
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width - 10, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, y, { steps: 8 });
      await page.mouse.up();
      assert.equal(await page.locator('.swipe-delete').count(), 0);
      assert.deepEqual(await openTitles(page), ['Essay']);
    });
  });

  test('tap the circle, tap the text', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], [task('a', 'Essay', DAY, NOW)]) }, async ({ page }) => {
      await showTodo(page);
      await page.locator('.task-text').tap();
      assert.equal(await page.locator('#task-sheet-title').innerText(), 'Edit Task');
      await page.locator('#task-sheet [data-cancel]').tap();
      await sheetGone(page);
      await page.locator('.check').tap();
      assert.ok((await savedData(page)).tasks[0].completedAt);
    });
  });

  test('the add field stays above the tab bar while adding many in a row', async () => {
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      await showTodo(page);
      await page.locator('#focus-add').tap();
      for (let i = 0; i < 16; i += 1) {
        await page.keyboard.type(`Task ${i}`);
        await page.keyboard.press('Enter');
        await until(async () => {
          const [field, tabbar] = await Promise.all([page.locator('#add-form').boundingBox(), page.locator('.tabbar').boundingBox()]);
          assert.ok(field.y + field.height <= tabbar.y + 1, `field bottom ${field.y + field.height}, bar top ${tabbar.y}`);
        });
      }
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
    });
  });
});

describe('text safety', () => {
  test('titles and notes are text, never markup', async () => {
    const bomb = '<img src=x onerror="window.__owned=1"><b>bold</b>';
    const event = { id: 'e', title: bomb, notes: bomb, allDay: true, startDay: '2026-11-05', endDay: '2026-11-05' };
    const tasks = [task('a', bomb, DAY, NOW, { notes: bomb })];
    await withApp(env, { clock: NOW, seed: doc([event], tasks) }, async ({ page }) => {
      assert.equal(await page.locator('#open-list .task-title').innerText(), bomb);
      assert.equal(await page.locator('#open-list .task-notes').innerText(), bomb);
      assert.equal(await page.locator('.agenda-row-title').innerText(), bomb);
      assert.equal(await page.locator('#open-list img, #open-list b, #agenda-list img').count(), 0);
      await page.locator('.agenda-row').click();
      await page.keyboard.press('Escape');
      await sheetGone(page);
      assert.equal(await page.evaluate(() => window.__owned), undefined);
    });
  });
});
