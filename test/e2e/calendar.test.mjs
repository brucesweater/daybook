import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, allDayEvent, doc, event } from '../helpers/data.mjs';
import { TIME_ZONE, launch, savedData, timedTouch, touchSwipe, until, withApp, zoned } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const NOV5 = zoned(TIME_ZONE, 2026, 11, 5, 12);
const cell = (page, day) => page.locator(`#days-pane .day[data-day="${day}"]`);
const text = (locator) => locator.innerText();
const selectedDay = (page) => page.locator('#days-pane .day.is-selected').getAttribute('data-day');
const monthTitle = async (page) => (await page.locator('#month-title').innerText()).replace(/\s+/g, ' ').trim();
const agendaTitles = (page) => page.locator('#agenda-list .agenda-item:not(.leaving) .agenda-row-title').allInnerTexts();
const agendaTimes = (page) => page.locator('#agenda-list .agenda-item:not(.leaving) .agenda-row-time').allInnerTexts();
const sheetGone = (page) => until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
/** Waits for a sheet to finish arriving: a click sooner than this is taken for the tail of what opened it. */
const sheetUp = (page) => until(async () => assert.equal(await page.locator('dialog[open]').evaluate((node) => node.getAnimations().length), 0));
/** The id of what's at a point. A click on a dialog's backdrop targets the dialog, so that's its id. */
const underPoint = (page, x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, y]);

async function addEvent(page, title) {
  await page.locator('#new-event').click();
  await page.locator('#event-title').fill(title);
  await page.locator('#event-submit').click();
  await sheetGone(page);
}

describe('month header and grid', () => {
  test('header shows the month bold and the year regular in the secondary colour', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      assert.equal(await monthTitle(page), 'November 2026');
      const name = await page.locator('#month-name').evaluate((node) => getComputedStyle(node).fontWeight);
      const year = await page.locator('#month-year').evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.fontWeight, style.color];
      });
      assert.equal(name, '700');
      assert.deepEqual(year, ['400', 'rgb(110, 110, 115)']);
      assert.equal(await page.locator('#month-title').evaluate((node) => getComputedStyle(node).fontSize), '34px');
    });
  });

  test('always 7 columns and 6 rows, with weekday letters, and the layout never jumps', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      assert.deepEqual(await page.locator('.weekday').allInnerTexts(), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
      const heights = [];
      for (let i = 0; i < 14; i += 1) {
        assert.equal(await page.locator('#days-pane .week').count(), 6);
        assert.equal(await page.locator('#days-pane .day').count(), 42);
        heights.push(await page.locator('#days-pane').evaluate((node) => node.getBoundingClientRect().height));
        await page.locator('#next-month').click();
      }
      assert.equal(new Set(heights).size, 1, `grid height stays put: ${heights}`);
    });
  });

  test('November 2026 under its DST change: every date appears exactly once', async () => {
    await withApp(env, { clock: zoned('America/Chicago', 2026, 11, 1, 15, 5), timezoneId: 'America/Chicago' }, async ({ page }) => {
      const days = await page.locator('#days-pane .day').evaluateAll((cells) => cells.map((node) => node.dataset.day));
      assert.equal(new Set(days).size, 42);
      assert.equal(days[0], '2026-11-01');
      for (let date = 1; date <= 30; date += 1) {
        const day = `2026-11-${String(date).padStart(2, '0')}`;
        assert.equal(days.filter((value) => value === day).length, 1, day);
      }
      assert.equal(await text(page.locator('#agenda-title')), 'Today · Sunday, November 1');
      assert.equal(await page.locator('#days-pane .day[aria-current="date"]').getAttribute('data-day'), '2026-11-01');
    });
  });

  test('adjacent-month days are quieter, in both modes', async () => {
    for (const [colorScheme, quiet, normal] of [['light', 'rgb(110, 110, 115)', 'rgb(29, 29, 31)'], ['dark', 'rgb(152, 152, 157)', 'rgb(245, 245, 247)']]) {
      await withApp(env, { clock: NOV5, colorScheme }, async ({ page }) => {
        const colorOf = (day) => cell(page, day).locator('.day-number').evaluate((node) => getComputedStyle(node).color);
        assert.equal(await colorOf('2026-12-05'), quiet);
        assert.equal(await colorOf('2026-11-20'), normal);
      });
    }
  });

  test('selecting an adjacent-month day moves to that month', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      const adjacent = cell(page, '2026-12-05');
      assert.ok(await adjacent.evaluate((node) => node.classList.contains('is-adjacent')));
      await adjacent.click();
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await selectedDay(page), '2026-12-05');
      assert.equal(await text(page.locator('#agenda-title')), 'Saturday, December 5');
      await cell(page, '2026-11-30').click();
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await selectedDay(page), '2026-11-30');
    });
  });

  test('today is accent-coloured; selected gets a disc: accent on today, label otherwise', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      const number = (day) => cell(page, day).locator('.day-number');
      const paint = (locator) => locator.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.color, style.backgroundColor];
      });
      assert.deepEqual(await paint(number('2026-11-05')), ['rgb(255, 255, 255)', 'rgb(224, 40, 29)']);
      await cell(page, '2026-11-10').click();
      await until(async () => assert.deepEqual(await paint(number('2026-11-10')), ['rgb(255, 255, 255)', 'rgb(29, 29, 31)']));
      await until(async () => assert.deepEqual(await paint(number('2026-11-05')), ['rgb(224, 40, 29)', 'rgba(0, 0, 0, 0)']));
    });
  });

  test('one dot and only one, however many events', async () => {
    const day = '2026-11-10';
    const events = Array.from({ length: 5 }, (_, i) => event(`e${i}`, `Event ${i}`, day, 60 * (i + 8)));
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      assert.equal(await cell(page, day).locator('.day-dot').count(), 1);
      assert.ok(await cell(page, day).evaluate((node) => node.classList.contains('has-event')));
      assert.equal(await cell(page, '2026-11-11').evaluate((node) => node.classList.contains('has-event')), false);
      assert.equal(await cell(page, day).innerText(), '10');
      await cell(page, day).click();
      assert.equal((await agendaTitles(page)).length, 5);
    });
  });

  test('chevrons select the 1st, or today in the month that contains it', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#next-month').click();
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await selectedDay(page), '2026-12-01');
      await page.locator('#next-month').click();
      assert.equal(await monthTitle(page), 'January 2027');
      assert.equal(await selectedDay(page), '2027-01-01');
      await page.locator('#prev-month').click();
      await page.locator('#prev-month').click();
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await selectedDay(page), '2026-11-05');
      await page.locator('#prev-month').click();
      assert.equal(await selectedDay(page), '2026-10-01');
    });
  });

  test('Today jumps back cleanly from far away', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      for (let i = 0; i < 30; i += 1) await page.locator('#next-month').click();
      assert.equal(await monthTitle(page), 'May 2029');
      await page.locator('#go-today').click();
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await selectedDay(page), '2026-11-05');
      assert.equal(await text(page.locator('#agenda-title')), 'Today · Thursday, November 5');
      await until(async () => assert.equal(await page.locator('.days-ghost').count(), 0));
    });
  });

  test('double-clicking a day opens New Event on that day', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await cell(page, '2026-11-20').dblclick();
      assert.equal(await page.locator('#event-sheet-title').innerText(), 'New Event');
      assert.equal(await page.locator('#event-start-date').inputValue(), '2026-11-20');
    });
  });

  test('double-clicking an adjacent-month day opens New Event on the day that was clicked', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await cell(page, '2026-12-03').dblclick();
      assert.equal(await page.locator('#event-start-date').inputValue(), '2026-12-03');
      assert.equal(await monthTitle(page), 'December 2026');
    });
  });
});

describe('agenda', () => {
  test('header wording, and a quiet centred No events', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      assert.equal(await text(page.locator('#agenda-title')), 'Today · Thursday, November 5');
      const empty = page.locator('#agenda-empty');
      assert.equal(await empty.innerText(), 'No events');
      assert.equal(await empty.evaluate((node) => getComputedStyle(node).textAlign), 'center');
      assert.equal(await empty.evaluate((node) => getComputedStyle(node).color), 'rgb(110, 110, 115)');
      await cell(page, '2026-11-01').click();
      assert.equal(await text(page.locator('#agenda-title')), 'Sunday, November 1');
    });
  });

  test('order and time lines, from the fixture', async () => {
    await withApp(env, { clock: NOV5, seed: FIXTURE }, async ({ page }) => {
      await cell(page, '2026-11-05').click();
      assert.deepEqual(await agendaTitles(page), ['Dentist']);
      assert.deepEqual(await agendaTimes(page), ['2:30 PM – 3:30 PM']);
      await cell(page, '2026-11-07').click();
      assert.deepEqual(await agendaTitles(page), ['写作业 ✏️']);
      assert.deepEqual(await agendaTimes(page), ['All day']);
      await cell(page, '2026-11-13').click();
      assert.deepEqual(await agendaTimes(page), ['Starts 11:00 PM']);
      await cell(page, '2026-11-14').click();
      assert.deepEqual(await agendaTimes(page), ['Ends 1:00 AM']);
      await cell(page, '2026-11-28').click();
      assert.deepEqual(await agendaTitles(page), ['Road trip']);
      assert.deepEqual(await agendaTimes(page), ['All day']);
      await cell(page, '2026-12-02').click();
      assert.deepEqual(await agendaTitles(page), ['Road trip']);
      await cell(page, '2026-12-03').click();
      assert.deepEqual(await agendaTitles(page), []);
    });
  });

  test('a party ending exactly at midnight is not on the next day', async () => {
    await withApp(env, { clock: NOV5, seed: FIXTURE }, async ({ page }) => {
      for (let i = 0; i < 2; i += 1) await page.locator('#next-month').click();
      assert.equal(await monthTitle(page), 'January 2027');
      assert.ok(await cell(page, '2026-12-31').evaluate((node) => node.classList.contains('has-event')));
      assert.equal(await cell(page, '2027-01-01').evaluate((node) => node.classList.contains('has-event')), false);
      assert.deepEqual(await agendaTitles(page), []);
      await cell(page, '2026-12-31').click();
      assert.deepEqual(await agendaTitles(page), ['Party']);
      assert.deepEqual(await agendaTimes(page), ['8:00 PM – 12:00 AM']);
    });
  });

  test('a deleted row closes where it is, and the rows around it stay put', async () => {
    const day = '2026-11-05';
    const events = ['One', 'Two', 'Three', 'Four'].map((title, i) => event(`e${i}`, title, day, 480 + i * 60));
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      await page.evaluate(() => {
        const list = document.querySelector('#agenda-list');
        window.__orders = new Set();
        new MutationObserver(() => window.__orders.add([...list.children].map((node) => node.dataset.key).join())).observe(list, { childList: true });
      });
      await page.locator('.agenda-row').nth(1).click();
      await page.locator('#event-delete').click();
      await sheetGone(page);
      await until(async () => assert.deepEqual(await agendaTitles(page), ['One', 'Three', 'Four']));
      await until(async () => assert.equal(await page.locator('#agenda-list > li').count(), 3));
      assert.deepEqual(await page.evaluate(() => [...window.__orders]), ['e0,e2,e3'], 'the row is never anywhere but its own place');
    });
  });

  test('each day opens at the top of its agenda', async () => {
    const days = ['2026-11-05', '2026-11-06'];
    const events = days.flatMap((day) => Array.from({ length: 20 }, (_, i) => event(`${day}-${i}`, `Event ${i}`, day, 300 + i * 30)));
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      const scroller = page.locator('.agenda-scroll');
      await scroller.evaluate((node) => { node.scrollTop = 500; });
      assert.equal(await scroller.evaluate((node) => node.scrollTop), 500);
      await cell(page, '2026-11-06').click();
      assert.equal(await scroller.evaluate((node) => node.scrollTop), 0);

      // A change to the same day leaves the place alone.
      await scroller.evaluate((node) => { node.scrollTop = 500; });
      await page.locator('#add-input').fill('Unrelated');
      await page.locator('#add-input').press('Enter');
      assert.equal(await scroller.evaluate((node) => node.scrollTop), 500);
    });
  });

  test('all-day first, then by start time, then by title; rows have the 3 pt accent bar', async () => {
    const day = '2026-11-05';
    const events = [
      event('a', 'Zebra', day, 600),
      event('b', 'Apple', day, 600),
      event('c', 'Early', day, 300),
      allDayEvent('d', 'Yard sale', day),
      allDayEvent('e', 'Art show', day),
    ];
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      assert.deepEqual(await agendaTitles(page), ['Art show', 'Yard sale', 'Early', 'Apple', 'Zebra']);
      const bar = page.locator('.agenda-bar').first();
      assert.deepEqual(await bar.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.width, style.backgroundColor, style.borderTopLeftRadius];
      }), ['3px', 'rgb(224, 40, 29)', '3px']);
    });
  });
});

describe('event editor', () => {
  test('+ opens New Event with the selected day, title focused, Add disabled while blank', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await cell(page, '2026-11-20').click();
      await page.locator('#new-event').click();
      assert.equal(await page.locator('#event-sheet-title').innerText(), 'New Event');
      assert.equal(await page.locator('#event-submit').innerText(), 'Add');
      assert.equal(await page.locator('#event-sheet [data-cancel]').innerText(), 'Cancel');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'event-title');
      assert.equal(await page.locator('#event-start-date').inputValue(), '2026-11-20');
      assert.equal(await page.locator('#event-end-date').inputValue(), '2026-11-20');
      assert.equal(await page.locator('#event-start-time').inputValue(), '09:00');
      assert.equal(await page.locator('#event-end-time').inputValue(), '10:00');
      assert.ok(await page.locator('#event-submit').isDisabled());
      await page.locator('#event-title').fill('   ');
      assert.ok(await page.locator('#event-submit').isDisabled());
      await page.locator('#event-title').press('Enter');
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true, 'Return does nothing while blank');
      await page.locator('#event-title').fill(' Dentist ');
      assert.equal(await page.locator('#event-submit').isDisabled(), false);
      assert.equal(await page.locator('#event-delete').isVisible(), false);
    });
  });

  test('default time today is the next full hour, capped to stay on that day', async () => {
    for (const [hour, minute, start, end] of [[15, 5, '16:00', '17:00'], [22, 30, '23:00', '23:59'], [23, 30, '23:00', '23:59'], [9, 0, '10:00', '11:00']]) {
      await withApp(env, { clock: zoned(TIME_ZONE, 2026, 11, 5, hour, minute) }, async ({ page }) => {
        await page.locator('#new-event').click();
        assert.equal(await page.locator('#event-start-time').inputValue(), start);
        assert.equal(await page.locator('#event-end-time').inputValue(), end);
        assert.equal(await page.locator('#event-end-date').inputValue(), '2026-11-05');
      });
    }
  });

  test('add, edit, delete and undo an event', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      // Add.
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('  Dentist  ');
      await page.locator('#event-notes').fill('Bring the card');
      await page.locator('#event-start-time').fill('14:30');
      await page.locator('#event-end-time').fill('15:30');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.deepEqual(await agendaTitles(page), ['Dentist']);
      assert.deepEqual(await agendaTimes(page), ['2:30 PM – 3:30 PM']);
      assert.equal(await cell(page, '2026-11-05').getAttribute('aria-label'), 'Thursday, November 5, 1 event');
      let saved = await savedData(page);
      assert.equal(saved.events.length, 1);
      const [added] = saved.events;
      assert.deepEqual(
        [added.title, added.notes, added.allDay, added.startDay, added.startMinutes, added.endDay, added.endMinutes],
        ['Dentist', 'Bring the card', false, '2026-11-05', 870, '2026-11-05', 930],
      );

      // Edit.
      await page.locator('.agenda-row').click();
      assert.equal(await page.locator('#event-sheet-title').innerText(), 'Edit Event');
      assert.equal(await page.locator('#event-submit').innerText(), 'Save');
      assert.equal(await page.locator('#event-title').inputValue(), 'Dentist');
      assert.equal(await page.locator('#event-notes').inputValue(), 'Bring the card');
      assert.equal(await page.locator('#event-start-time').inputValue(), '14:30');
      assert.equal(await page.locator('#event-delete').innerText(), 'Delete Event');
      await page.locator('#event-title').fill('Orthodontist');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.deepEqual(await agendaTitles(page), ['Orthodontist']);
      saved = await savedData(page);
      assert.equal(saved.events[0].id, added.id, 'same id');

      // Delete: no confirmation, an undo toast.
      await page.locator('.agenda-row').click();
      await page.locator('#event-delete').click();
      await sheetGone(page);
      await until(async () => assert.deepEqual(await agendaTitles(page), []));
      assert.equal(await page.locator('.toast-message').innerText(), 'Event deleted');
      assert.equal(await page.locator('.toast-undo').innerText(), 'Undo');
      assert.equal((await savedData(page)).events.length, 0);
      assert.equal(await cell(page, '2026-11-05').getAttribute('aria-label'), 'Thursday, November 5');

      // Undo restores it exactly.
      await page.locator('.toast-undo').click();
      await until(async () => assert.deepEqual(await agendaTitles(page), ['Orthodontist']));
      const restored = (await savedData(page)).events[0];
      assert.deepEqual(restored, saved.events[0]);
      await until(async () => assert.equal(await page.locator('.toast').count(), 0));
    });
  });

  test('Cancel, Esc and a backdrop click all cancel', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      const sheet = page.locator('#event-sheet');
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Nope');
      await sheet.locator('[data-cancel]').click();
      await sheetGone(page);

      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Nope');
      await page.keyboard.press('Escape');
      await sheetGone(page);

      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Nope');
      await sheetUp(page);
      await page.mouse.click(10, 10);
      await sheetGone(page);

      assert.deepEqual(await agendaTitles(page), []);
      assert.equal(await page.evaluate(() => localStorage.getItem('daybook.v1')), null);
    });
  });

  test('a press on the backdrop that ends inside the sheet does not cancel, and neither does the reverse', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Half typed');
      await sheetUp(page);
      const box = await page.locator('#event-sheet').boundingBox();
      await page.mouse.move(10, 10);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 4 });
      await page.mouse.up();
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);

      await page.mouse.down();
      await page.mouse.move(10, 10, { steps: 4 });
      await page.mouse.up();
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await page.locator('#event-title').inputValue(), 'Half typed');
    });
  });

  test('double-clicking whatever opens a sheet leaves it open', async () => {
    const day = '2026-11-05';
    const events = [event('a', 'Dentist', day, 600)];
    const tasks = [{ id: 't', title: 'Essay', notes: '', assignedAt: new Date(NOV5 - 3600000).toISOString(), completedAt: null }];
    for (const [name, selector, sheet] of [['+', '#new-event', 'event-sheet'], ['a row', '.agenda-row', 'event-sheet'], ['a task', '.task-text', 'task-sheet']]) {
      await withApp(env, { clock: NOV5, seed: doc(events, tasks) }, async ({ page }) => {
        const box = await page.locator(selector).boundingBox();
        const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.dblclick(x, y);
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => document.querySelector('dialog[open]')?.id ?? null), sheet, name);
        assert.equal(await underPoint(page, x, y), sheet, `${name}: the second click really landed on the backdrop`);
      });
    }
  });

  test('double-tapping the + on a phone leaves the sheet open', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      const box = await page.locator('#new-event').boundingBox();
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await underPoint(page, x, y), 'event-sheet', 'the second tap really landed on the backdrop');
    });
  });

  test('Esc, Esc, N in quick succession: the new sheet stays, and keeps what is typed', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      await sheetUp(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('n');
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      await page.keyboard.type('Still here');
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await page.locator('#event-title').inputValue(), 'Still here');
      await page.keyboard.press('Enter');
      await sheetGone(page);
      assert.deepEqual(await agendaTitles(page), ['Still here']);
    });
  });

  test('saving an event onto another day puts keyboard focus on that day', async () => {
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'Dentist', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').focus();
      await page.keyboard.press('Enter');
      await page.locator('#event-start-date').fill('2026-11-20');
      await page.keyboard.press('Enter');
      await sheetGone(page);
      assert.equal(await selectedDay(page), '2026-11-20');
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.dataset.day), '2026-11-20'));
    });
  });

  test('saving on the same day returns to the row', async () => {
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'Dentist', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').focus();
      await page.keyboard.press('Enter');
      await page.locator('#event-title').fill('Orthodontist');
      await page.keyboard.press('Enter');
      await sheetGone(page);
      assert.equal(await page.evaluate(() => document.activeElement.className), 'agenda-row');
    });
  });

  test('a sheet on its way out does not respond: Cancel then Delete deletes nothing, and a double Delete deletes once', async () => {
    const day = '2026-11-05';
    const events = [event('a', 'Keep me', day, 600), event('b', 'Delete me', day, 720)];
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page, problems }) => {
      await page.locator('.agenda-row').first().click();
      // All in one go, so the sheet is still closing for the second and third clicks.
      await page.evaluate(() => {
        document.querySelector('#event-sheet [data-cancel]').click();
        document.querySelector('#event-delete').click();
        document.querySelector('#event-all-day').click();
      });
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      assert.deepEqual(await page.locator('.agenda-row-title').allInnerTexts(), ['Keep me', 'Delete me']);
      assert.equal(await page.locator('.toast').count(), 0);

      await page.locator('.agenda-row').nth(1).click();
      await page.evaluate(() => {
        const remove = document.querySelector('#event-delete');
        remove.click();
        remove.click();
      });
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      await until(async () => assert.deepEqual(await page.locator('.agenda-row-title').allInnerTexts(), ['Keep me']));
      assert.equal(await page.locator('.toast').count(), 1);
      assert.deepEqual(problems, []);

      // And the sheet works as normal the next time.
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Next');
      await page.locator('#event-submit').click();
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      assert.deepEqual(await page.locator('.agenda-row-title').allInnerTexts(), ['Keep me', 'Next']);
    });
  });

  test('a click inside the sheet does not cancel', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-sheet-title').click();
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
    });
  });

  test('the sheet is a real modal: focus stays in it', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      for (let i = 0; i < 24; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => !document.activeElement || document.activeElement === document.body || !!document.activeElement.closest('dialog'));
        assert.ok(inside, 'focus left the sheet');
      }
    });
  });

  test('moving Starts past Ends pushes Ends along, keeping the duration', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      const [startDate, startTime, endDate, endTime] = ['start-date', 'start-time', 'end-date', 'end-time'].map((name) => page.locator(`#event-${name}`));
      await startTime.fill('10:00');
      await endTime.fill('11:30');
      await startTime.fill('12:00');
      assert.equal(await endTime.inputValue(), '13:30');
      assert.equal(await endDate.inputValue(), '2026-11-05');
      await startDate.fill('2026-11-20');
      assert.equal(await endDate.inputValue(), '2026-11-20');
      assert.equal(await endTime.inputValue(), '13:30');
      await startTime.fill('23:30');
      assert.equal(await endDate.inputValue(), '2026-11-21');
      assert.equal(await endTime.inputValue(), '01:00');
      // A separate, earlier edit does not pull it back.
      await page.locator('#event-notes').focus();
      await startTime.fill('08:00');
      assert.equal(await endDate.inputValue(), '2026-11-21');
    });
  });

  test('a date past the last month the grid can draw is not taken, and nothing breaks', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page, problems }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Far future');
      const startDate = page.locator('#event-start-date');
      assert.equal(await startDate.getAttribute('max'), '9999-11-30');
      assert.equal(await page.locator('#event-end-date').getAttribute('max'), '9999-11-30');
      await startDate.fill('9999-12-15');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.deepEqual(problems, []);
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal((await savedData(page)).events[0].startDay, '2026-11-05');

      // The last month it can show is fine, and the app keeps working after it.
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Almost');
      await startDate.fill('9999-11-30');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.equal(await monthTitle(page), 'November 9999');
      await page.locator('#add-input').fill('Still works');
      await page.locator('#add-input').press('Enter');
      assert.deepEqual(await page.locator('#open-list .task-title').allInnerTexts(), ['Still works']);
      assert.deepEqual(problems, []);
    });
  });

  test('moving Ends before Starts is not allowed', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      const [startDate, startTime, endDate, endTime] = ['start-date', 'start-time', 'end-date', 'end-time'].map((name) => page.locator(`#event-${name}`));
      await startTime.fill('10:00');
      await endTime.fill('11:00');
      assert.equal(await endDate.getAttribute('min'), '2026-11-05');
      await endDate.fill('2026-11-01');
      assert.equal(await endDate.inputValue(), '2026-11-05');
      assert.equal(await endTime.inputValue(), '10:00', 'it stops at Starts');
      await endTime.fill('11:00');
      await endTime.fill('09:00');
      assert.equal(await endTime.inputValue(), '10:00');
      assert.equal(await startDate.inputValue(), '2026-11-05');
      assert.equal(await startTime.inputValue(), '10:00');
    });
  });

  test('typing an End that is before Starts waits for you to finish, then stops at Starts', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      const endTime = page.locator('#event-end-time');
      const endDate = page.locator('#event-end-date');
      await page.locator('#event-start-time').fill('10:00');
      await endTime.fill('11:00');
      await endDate.focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('10'); // Month 10 is before Starts, but the typing isn't over.
      assert.equal(await endDate.inputValue(), '2026-10-05');
      assert.equal(await endDate.getAttribute('aria-invalid'), 'true');
      await page.locator('#event-notes').focus();
      assert.equal(await endDate.inputValue(), '2026-11-05');
      assert.equal(await endDate.getAttribute('aria-invalid'), null);
    });
  });

  test('all-day switch hides times, saves no minutes, and comes back with times', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Holiday');
      const toggle = page.getByRole('switch', { name: 'All-day' });
      assert.equal(await toggle.isChecked(), false);
      await toggle.click({ force: true });
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.locator('#event-start-time').isVisible(), false);
      assert.equal(await page.locator('#event-end-time').isVisible(), false);
      await page.locator('#event-end-date').fill('2026-11-07');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.deepEqual(await agendaTimes(page), ['All day']);
      const saved = (await savedData(page)).events[0];
      assert.deepEqual([saved.allDay, saved.startMinutes, saved.endMinutes, saved.endDay], [true, null, null, '2026-11-07']);
      assert.ok(await cell(page, '2026-11-07').evaluate((node) => node.classList.contains('has-event')));
      await page.locator('.agenda-row').click();
      await page.getByRole('switch', { name: 'All-day' }).click({ force: true });
      assert.equal(await page.locator('#event-start-time').inputValue(), '09:00');
      assert.equal(await page.locator('#event-end-time').inputValue(), '10:00');
    });
  });

  test('an event saved onto another day takes the calendar there', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Far away');
      await page.locator('#event-start-date').fill('2027-02-10');
      await page.locator('#event-submit').click();
      await sheetGone(page);
      assert.equal(await monthTitle(page), 'February 2027');
      assert.equal(await selectedDay(page), '2027-02-10');
      assert.deepEqual(await agendaTitles(page), ['Far away']);
    });
  });

  test('the toast lives in a polite live region that is there before it appears', async () => {
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'A', '2026-11-05', 600)]) }, async ({ page }) => {
      const region = page.locator('#toast-region');
      assert.equal(await region.getAttribute('role'), 'status');
      assert.equal(await region.getAttribute('aria-live'), 'polite');
      assert.equal(await region.innerText(), '');
      await page.locator('.agenda-row').click();
      await page.locator('#event-delete').click();
      await sheetGone(page);
      assert.match(await region.innerText(), /Event deleted\s+Undo/);
    });
  });

  test('a toast stays while the pointer is on it, and Esc takes a focused one away', async () => {
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'A', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').click();
      await page.locator('#event-delete').click();
      await sheetGone(page);
      await page.locator('.toast').hover();
      await page.clock.runFor(9000);
      assert.equal(await page.locator('.toast').count(), 1);
      await page.mouse.move(5, 5);
      await page.clock.runFor(5100);
      await until(async () => assert.equal(await page.locator('.toast').count(), 0));

      await page.locator('.toast-undo').waitFor({ state: 'detached' });
    });
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'A', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').focus();
      await page.keyboard.press('Enter');
      await page.locator('#event-delete').focus();
      await page.keyboard.press('Enter');
      await sheetGone(page);
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.className), 'toast-undo'));
      await page.keyboard.press('Escape');
      await until(async () => assert.equal(await page.locator('.toast').count(), 0));
      assert.equal(await page.evaluate(() => document.activeElement.dataset.day), '2026-11-05');
      assert.deepEqual(await agendaTitles(page), []);
    });
  });

  test('a new toast replaces the old one, and it goes away after 5 seconds', async () => {
    const events = [event('a', 'A', '2026-11-05', 600), event('b', 'B', '2026-11-05', 700)];
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      for (const expected of [1, 1]) {
        await page.locator('.agenda-row').first().click();
        await page.locator('#event-delete').click();
        await sheetGone(page);
        assert.equal(await page.locator('.toast').count(), expected);
      }
      // Undo only brings back the latest.
      await page.locator('.toast-undo').click();
      await until(async () => assert.deepEqual(await agendaTitles(page), ['B']));
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await sheetGone(page);
      await page.mouse.move(5, 5);
      await page.clock.runFor(4900);
      assert.equal(await page.locator('.toast').count(), 1);
      await page.clock.runFor(200);
      await until(async () => assert.equal(await page.locator('.toast').count(), 0));
    });
  });
});

describe('keyboard', () => {
  async function focusGrid(page) {
    await page.locator('#days-pane .day[tabindex="0"]').focus();
  }
  const focusedDay = (page) => page.evaluate(() => document.activeElement.dataset.day);

  test('roving tabindex: only the selected day is in the tab order', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      const stops = () => page.locator('#days-pane .day[tabindex="0"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.day));
      assert.deepEqual(await stops(), ['2026-11-05']);
      await focusGrid(page);
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await stops(), ['2026-11-06']);
      assert.equal(await focusedDay(page), '2026-11-06');
    });
  });

  test('arrows, Home and End move the selection', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await focusGrid(page);
      const presses = [
        ['ArrowRight', '2026-11-06'], ['ArrowLeft', '2026-11-05'], ['ArrowDown', '2026-11-12'], ['ArrowUp', '2026-11-05'],
        ['Home', '2026-11-01'], ['End', '2026-11-07'],
      ];
      for (const [key, day] of presses) {
        await page.keyboard.press(key);
        assert.equal(await selectedDay(page), day, key);
        assert.equal(await focusedDay(page), day, key);
      }
    });
  });

  test('arrows cross month boundaries, and focus stays on the selected day', async () => {
    await withApp(env, { clock: zoned(TIME_ZONE, 2026, 11, 30, 12) }, async ({ page }) => {
      await focusGrid(page);
      await page.keyboard.press('ArrowRight');
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await selectedDay(page), '2026-12-01');
      assert.equal(await focusedDay(page), '2026-12-01');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await focusedDay(page), '2026-11-30');
    });
  });

  test('PageUp and PageDown change month by the same rule as the chevrons', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await focusGrid(page);
      await page.keyboard.press('PageDown');
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await focusedDay(page), '2026-12-01');
      await page.keyboard.press('PageUp');
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await focusedDay(page), '2026-11-05');
    });
  });

  test('T is today and N is a new event', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#next-month').click();
      await page.locator('#next-month').click();
      await page.keyboard.press('t');
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await selectedDay(page), '2026-11-05');
      await cell(page, '2026-11-20').click();
      await page.keyboard.press('n');
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await page.locator('#event-start-date').inputValue(), '2026-11-20');
    });
  });

  test('T and N do nothing while typing in a field or with a sheet open', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.locator('#add-input').focus();
      await page.keyboard.type('nt');
      assert.equal(await page.locator('#add-input').inputValue(), 'nt');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.locator('#add-input').fill('');
      await page.locator('#next-month').click();
      await page.locator('#new-event').click();
      await page.locator('#event-title').press('t');
      assert.equal(await page.locator('#event-title').inputValue(), 't');
      assert.equal(await monthTitle(page), 'December 2026');
    });
  });

  test('modified keys are left to the browser', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await page.keyboard.press('Control+n');
      await page.keyboard.press('Meta+n');
      assert.equal(await page.locator('dialog[open]').count(), 0);
    });
  });

  test('focus rings show on keyboard focus', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      await focusGrid(page);
      await page.keyboard.press('ArrowRight');
      const outline = await page.locator('#days-pane .day.is-selected .day-number').evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.outlineStyle, style.outlineWidth];
      });
      assert.deepEqual(outline, ['solid', '2px']);
    });
  });

  test('deleting from the keyboard puts focus on Undo, and Enter undoes', async () => {
    await withApp(env, { clock: NOV5, seed: doc([event('a', 'A', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').focus();
      await page.keyboard.press('Enter');
      await page.locator('#event-delete').focus();
      await page.keyboard.press('Enter');
      await sheetGone(page);
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.className), 'toast-undo'));
      await page.keyboard.press('Enter');
      await until(async () => assert.deepEqual(await agendaTitles(page), ['A']));
      await until(async () => assert.equal(await page.evaluate(() => document.activeElement.dataset.day), '2026-11-05'));
    });
  });
});

describe('grid accessibility', () => {
  test('grid semantics, labels, aria-selected and aria-current', async () => {
    const events = [event('a', 'A', '2026-11-05', 600), event('b', 'B', '2026-11-05', 700), event('c', 'C', '2026-11-06', 700)];
    await withApp(env, { clock: NOV5, seed: doc(events) }, async ({ page }) => {
      assert.equal(await page.locator('[role="grid"]').count(), 1);
      assert.equal(await page.locator('[role="grid"] [role="row"]').count(), 7);
      assert.equal(await page.locator('[role="columnheader"]').count(), 7);
      assert.equal(await page.locator('#days-pane [role="gridcell"]').count(), 42);
      assert.equal(await page.getByRole('columnheader', { name: 'Sunday' }).count(), 1);
      const today = page.getByRole('gridcell', { name: 'Thursday, November 5, 2 events' });
      assert.equal(await today.getAttribute('aria-selected'), 'true');
      assert.equal(await today.getAttribute('aria-current'), 'date');
      const other = page.getByRole('gridcell', { name: 'Friday, November 6, 1 event' });
      assert.equal(await other.getAttribute('aria-selected'), 'false');
      assert.equal(await other.getAttribute('aria-current'), null);
      assert.equal(await page.getByRole('gridcell', { name: 'Saturday, November 7', exact: true }).count(), 1);
    });
  });
});

describe('locale', () => {
  test('Monday-first and 24-hour from the browser locale, English names regardless', async () => {
    const events = [event('a', 'A', '2026-11-05', 870)];
    await withApp(env, { clock: NOV5, locale: 'de-DE', seed: doc(events) }, async ({ page }) => {
      assert.deepEqual(await page.locator('.weekday').allInnerTexts(), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
      assert.equal(await page.locator('#days-pane .day').first().getAttribute('data-day'), '2026-10-26');
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await text(page.locator('#agenda-title')), 'Today · Thursday, November 5');
      assert.deepEqual(await agendaTimes(page), ['14:30 – 15:30']);
      await page.locator('#days-pane .day[tabindex="0"]').focus();
      await page.keyboard.press('Home');
      assert.equal(await selectedDay(page), '2026-11-02');
    });
  });

  test('Sunday-first and 12-hour in en-US', async () => {
    await withApp(env, { clock: NOV5, locale: 'en-US', seed: doc([event('a', 'A', '2026-11-05', 870)]) }, async ({ page }) => {
      assert.equal(await page.locator('#days-pane .day').first().getAttribute('data-day'), '2026-11-01');
      assert.deepEqual(await agendaTimes(page), ['2:30 PM – 3:30 PM']);
    });
  });

  test('a Buddhist or Japanese device calendar does not touch the data', async () => {
    for (const locale of ['th-TH-u-ca-buddhist', 'ja-JP-u-ca-japanese']) {
      await withApp(env, { clock: NOV5, locale }, async ({ page }) => {
        assert.equal(await monthTitle(page), 'November 2026');
        await addEvent(page, 'Dentist');
        const saved = (await savedData(page)).events[0];
        assert.equal(saved.startDay, '2026-11-05');
        await page.locator('#add-input').fill('Task');
        await page.locator('#add-input').press('Enter');
        assert.match((await savedData(page)).tasks[0].assignedAt, /^2026-11-0\dT/);
      });
    }
  });
});

describe('touch', () => {
  const swipeOverGrid = async (page, direction) => {
    const box = await page.locator('#days').boundingBox();
    const y = box.y + box.height / 2;
    const from = direction === 'left' ? box.x + box.width - 30 : box.x + 30;
    const to = direction === 'left' ? box.x + 30 : box.x + box.width - 30;
    await touchSwipe(page, { x: from, y }, { x: to, y });
  };

  test('swiping the grid changes month, selecting by the usual rule', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      await swipeOverGrid(page, 'left');
      await until(async () => assert.equal(await monthTitle(page), 'December 2026'));
      assert.equal(await selectedDay(page), '2026-12-01');
      await until(async () => assert.equal(await page.locator('.days-ghost').count(), 0));
      await swipeOverGrid(page, 'right');
      await until(async () => assert.equal(await monthTitle(page), 'November 2026'));
      assert.equal(await selectedDay(page), '2026-11-05');
    });
  });

  test('while dragging, the neighbouring months sit either side at full width, following the finger', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      const box = await page.locator('#days').boundingBox();
      const y = box.y + 60;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
      for (const x of [285, 270, 250, 230, 200]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      // Touch moves reach the page on a later frame, so this waits for the last one. Everything is read inside one
      // evaluate: read in two calls, a move landing between them would look like the months had drifted apart.
      await until(async () => {
        const { pane, ghosts } = await page.evaluate(() => {
          const pane = document.querySelector('#days-pane').getBoundingClientRect();
          return {
            pane: { x: pane.x, width: pane.width },
            ghosts: [...document.querySelectorAll('.days-ghost')].map((node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.x, width: rect.width };
            }),
          };
        });
        assert.equal(ghosts.length, 2);
        assert.equal(Math.round(ghosts[0].width), Math.round(box.width), 'previous month has full width');
        assert.equal(Math.round(ghosts[1].width), Math.round(box.width), 'next month has full width');
        assert.equal(Math.round(ghosts[0].x + ghosts[0].width), Math.round(pane.x), 'previous month is just left of this one');
        assert.equal(Math.round(ghosts[1].x), Math.round(pane.x + pane.width), 'next month is just right of this one');
        assert.ok(pane.x < box.x - 50, 'this month has moved with the finger');
      });
      await page.screenshot({ path: new URL('../artifacts/mid-swipe.png', import.meta.url).pathname });
      // On past a quarter of the width, so turning the month doesn't depend on how fast this ran.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 60, y }] });
      await until(async () => assert.ok((await page.locator('#days-pane').boundingBox()).x < box.x - 98));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(async () => assert.equal(await monthTitle(page), 'December 2026'));
      await cdp.detach();
    });
  });

  // 85 px is short of a quarter of this grid, so only speed can turn the month.
  const shortDrag = (y) => [
    { x: 300, y, at: 0 }, { x: 285, y, at: 16 }, { x: 260, y, at: 32 }, { x: 230, y, at: 48 }, { x: 200, y, at: 64 },
  ];

  test('a short flick turns the month', async () => {
    await withApp(env, { layout: 'phone' }, async ({ page }) => {
      const before = await monthTitle(page);
      const box = await page.locator('#days').boundingBox();
      await timedTouch(page, shortDrag(box.y + 60), 80);
      await until(async () => assert.notEqual(await monthTitle(page), before));
    });
  });

  test('the same flick, then a pause before lifting, springs back', async () => {
    await withApp(env, { layout: 'phone' }, async ({ page }) => {
      const before = await monthTitle(page);
      const box = await page.locator('#days').boundingBox();
      await timedTouch(page, shortDrag(box.y + 60), 600);
      await until(async () => assert.equal(await page.locator('.days-ghost').count(), 0));
      assert.equal(await monthTitle(page), before);
      assert.equal(await page.locator('#days-pane').evaluate((node) => node.style.transform), '');
    });
  });

  test('a short swipe springs back', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      const box = await page.locator('#days').boundingBox();
      const y = box.y + 40;
      await touchSwipe(page, { x: 200, y }, { x: 175, y }, { steps: 10, stepDelay: 30 });
      await until(async () => assert.equal(await page.locator('.days-ghost').count(), 0));
      assert.equal(await monthTitle(page), 'November 2026');
      assert.equal(await page.locator('#days-pane').evaluate((node) => node.style.transform), '');
    });
  });

  test('a swipe does not select the day under the finger', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      await swipeOverGrid(page, 'left');
      await until(async () => assert.equal(await monthTitle(page), 'December 2026'));
      await page.waitForTimeout(450);
      assert.equal(await selectedDay(page), '2026-12-01');
    });
  });

  test('tapping days and adjacent days works on touch', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone' }, async ({ page }) => {
      await cell(page, '2026-11-18').tap();
      assert.equal(await selectedDay(page), '2026-11-18');
      await cell(page, '2026-12-03').tap();
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await selectedDay(page), '2026-12-03');
    });
  });

  test('a mouse drag on the grid does not change month', async () => {
    await withApp(env, { clock: NOV5 }, async ({ page }) => {
      const box = await page.locator('#days').boundingBox();
      await page.mouse.move(box.x + box.width - 30, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 30, box.y + 40, { steps: 8 });
      await page.mouse.up();
      assert.equal(await monthTitle(page), 'November 2026');
    });
  });

  test('swiping an agenda row far deletes it, with undo', async () => {
    const events = [event('a', 'Dentist', '2026-11-05', 600), event('b', 'Lunch', '2026-11-05', 720)];
    await withApp(env, { clock: NOV5, layout: 'phone', seed: doc(events) }, async ({ page }) => {
      const box = await page.locator('.agenda-item').first().boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + 20, y });
      await until(async () => assert.deepEqual(await agendaTitles(page), ['Lunch']));
      assert.equal(await page.locator('.toast-message').innerText(), 'Event deleted');
      assert.equal((await savedData(page)).events.length, 1);
      await page.locator('.toast-undo').tap();
      await until(async () => assert.deepEqual(await agendaTitles(page), ['Dentist', 'Lunch']));
      assert.equal((await savedData(page)).events.length, 2);
    });
  });

  test('tapping an agenda row opens the editor', async () => {
    await withApp(env, { clock: NOV5, layout: 'phone', seed: doc([event('a', 'Dentist', '2026-11-05', 600)]) }, async ({ page }) => {
      await page.locator('.agenda-row').tap();
      assert.equal(await page.locator('#event-sheet-title').innerText(), 'Edit Event');
    });
  });

  test('a row left swiped open and then removed from another tab does not eat the next tap', async () => {
    const events = [event('a', 'Dentist', '2026-11-05', 600), event('b', 'Lunch', '2026-11-05', 720)];
    await withApp(env, { clock: NOV5, layout: 'phone', seed: doc(events) }, async ({ page, context }) => {
      const box = await page.locator('.agenda-item').first().boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe(page, { x: box.x + box.width - 10, y }, { x: box.x + box.width - 110, y }, { steps: 20, stepDelay: 25 });
      await until(async () => assert.equal(await page.locator('.swipe-delete').isVisible(), true));

      const other = await context.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      await other.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('daybook.v1'));
        data.events = data.events.filter((item) => item.id !== 'a');
        localStorage.setItem('daybook.v1', JSON.stringify(data));
      });
      await other.close();
      await until(async () => assert.deepEqual(await agendaTitles(page), ['Lunch']));
      await until(async () => assert.equal(await page.locator('#agenda-list > li').count(), 1));

      await page.locator('.agenda-row').tap();
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true, 'the tap counted');
    });
  });
});

describe('the clock', () => {
  test('with the real clock and no fakes, today is today in this zone', async () => {
    await withApp(env, {}, async ({ page }) => {
      const now = new Date();
      const part = (options) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, ...options }).format(now);
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      assert.equal(await page.locator('#days-pane .day[aria-current="date"]').getAttribute('data-day'), iso);
      assert.equal(await selectedDay(page), iso);
      assert.equal(await monthTitle(page), `${part({ month: 'long' })} ${part({ year: 'numeric' })}`);
      assert.equal(await text(page.locator('#agenda-title')), `Today · ${part({ weekday: 'long' })}, ${part({ month: 'long', day: 'numeric' })}`);
      await page.locator('#new-event').click();
      assert.equal(await page.locator('#event-start-date').inputValue(), iso);
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', hour: 'numeric' }).format(now));
      assert.equal(await page.locator('#event-start-time').inputValue(), `${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`);
    });
  });

  test('today rolls over at midnight, and a selection on today follows it', async () => {
    const clock = zoned(TIME_ZONE, 2026, 11, 30, 23, 59, 40);
    await withApp(env, { clock }, async ({ page }) => {
      assert.equal(await text(page.locator('#agenda-title')), 'Today · Monday, November 30');
      await page.clock.fastForward(40 * 1000);
      await until(async () => assert.equal(await text(page.locator('#agenda-title')), 'Today · Tuesday, December 1'));
      assert.equal(await monthTitle(page), 'December 2026');
      assert.equal(await selectedDay(page), '2026-12-01');
      assert.equal(await page.locator('#days-pane .day[aria-current="date"]').getAttribute('data-day'), '2026-12-01');
    });
  });

  test('a selection somewhere else stays put when midnight passes', async () => {
    const clock = zoned(TIME_ZONE, 2026, 11, 5, 23, 59, 40);
    await withApp(env, { clock }, async ({ page }) => {
      await cell(page, '2026-11-20').click();
      await page.clock.fastForward(40 * 1000);
      await until(async () => assert.equal(await page.locator('#days-pane .day[aria-current="date"]').getAttribute('data-day'), '2026-11-06'));
      assert.equal(await selectedDay(page), '2026-11-20');
      assert.equal(await text(page.locator('#agenda-title')), 'Friday, November 20');
    });
  });

  test('coming back to the tab catches up on the date', async () => {
    const clock = zoned(TIME_ZONE, 2026, 11, 5, 12);
    await withApp(env, { clock }, async ({ page }) => {
      await page.clock.pauseAt(clock + 1000);
      await page.clock.setSystemTime(clock + 3 * 86400000);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await until(async () => assert.equal(await text(page.locator('#agenda-title')), 'Today · Sunday, November 8'));
    });
  });

  test('the DST day itself: labels and default times hold', async () => {
    // 1:30 AM happens twice on this day. This is the second one.
    const clock = zoned('America/Chicago', 2026, 11, 1, 1, 30) + 3600 * 1000;
    const day = '2026-11-01';
    const events = [event('a', 'Over the change', day, 60, day, 180)];
    await withApp(env, { clock, timezoneId: 'America/Chicago', seed: doc(events) }, async ({ page }) => {
      assert.deepEqual(await agendaTimes(page), ['1:00 AM – 3:00 AM']);
      await page.locator('#new-event').click();
      assert.equal(await page.locator('#event-start-date').inputValue(), day);
      assert.equal(await page.locator('#event-start-time').inputValue(), '02:00');
      assert.equal(await page.locator('#event-end-time').inputValue(), '03:00');
    });
  });
});
