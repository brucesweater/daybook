// Real key presses into the native date and time inputs.
//
// `.fill()` sets a whole value in one go, so it can't see what happens digit by digit: typing 2:30 PM passes through
// 2:00 AM and 2:30 AM on the way, and Chrome forgets the digits so far if anything writes to the input in between.
// Every test here types, the way a person does.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { doc, task } from '../helpers/data.mjs';
import { TIME_ZONE, launch, savedData, until, withApp, zoned } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const NOW = zoned(TIME_ZONE, 2026, 11, 20, 12);
const sheetGone = (page) => until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
const press = async (page, keys) => {
  for (const key of keys) await page.keyboard.press(key);
};

/** New Event on `day`, which isn't today, so it starts as 9:00 to 10:00 AM. Presses keys in one input, saves with Return. */
async function typeIntoNewEvent(page, day, selector, keys, { allDay = false } = {}) {
  await page.locator(`#days-pane .day[data-day="${day}"]`).click();
  await page.locator('#new-event').click();
  await page.locator('#event-title').fill('Typed');
  if (allDay) await page.getByRole('switch', { name: 'All-day' }).click({ force: true });
  await page.locator(selector).focus();
  await press(page, keys);
  await page.keyboard.press('Enter');
  await sheetGone(page);
  const saved = (await savedData(page)).events[0];
  return [saved.startDay, saved.startMinutes, saved.endDay, saved.endMinutes];
}

describe('typing into Starts: in-between values do not add up', () => {
  const CASES = [
    ['2:30 PM on a 9 to 10 AM event', 'en-US', '#event-start-time', ['2', '3', '0', 'p'], ['2026-11-05', 870, '2026-11-05', 930]],
    ['hour 11 on a 9 to 10 AM event', 'en-US', '#event-start-time', ['1', '1'], ['2026-11-05', 660, '2026-11-05', 720]],
    ['hour 14 on a 24-hour clock', 'en-GB', '#event-start-time', ['1', '4'], ['2026-11-05', 840, '2026-11-05', 900]],
    ['minutes 45, not past Ends', 'en-US', '#event-start-time', ['ArrowRight', '4', '5'], ['2026-11-05', 585, '2026-11-05', 600]],
    ['arrow up twice', 'en-US', '#event-start-time', ['ArrowUp', 'ArrowUp'], ['2026-11-05', 660, '2026-11-05', 720]],
    ['month 12', 'en-US', '#event-start-date', ['1', '2'], ['2026-12-05', 540, '2026-12-05', 600]],
    ['day 25', 'en-US', '#event-start-date', ['ArrowRight', '2', '5'], ['2026-11-25', 540, '2026-11-25', 600]],
    ['year 2027', 'en-US', '#event-start-date', ['ArrowRight', 'ArrowRight', '2', '0', '2', '7'], ['2027-11-05', 540, '2027-11-05', 600]],
  ];
  for (const [name, locale, selector, keys, expected] of CASES) {
    test(name, async () => {
      await withApp(env, { clock: NOW, locale }, async ({ page }) => {
        assert.deepEqual(await typeIntoNewEvent(page, '2026-11-05', selector, keys), expected);
      });
    });
  }

  test('all-day: day 30 pushes Ends to day 30, not past it', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      const saved = await typeIntoNewEvent(page, '2026-11-05', '#event-start-date', ['ArrowRight', '3', '0'], { allDay: true });
      assert.deepEqual(saved, ['2026-11-30', null, '2026-11-30', null]);
    });
  });

  test('a push keeps a longer duration, and Ends shows it as you type', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#days-pane .day[data-day="2026-11-05"]').click();
      await page.locator('#new-event').click();
      await page.locator('#event-end-time').fill('12:30');
      await page.locator('#event-start-time').focus();
      await press(page, ['1', '1', 'ArrowRight', 'ArrowRight', 'p']); // 11 PM: 3.5 hours later runs into the next day.
      assert.equal(await page.locator('#event-start-time').inputValue(), '23:00');
      assert.equal(await page.locator('#event-end-date').inputValue(), '2026-11-06');
      assert.equal(await page.locator('#event-end-time').inputValue(), '02:30');
    });
  });

  test('changing your mind while still in the field measures from where the edit began', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      const saved = await typeIntoNewEvent(page, '2026-11-05', '#event-start-time', ['1', '1', 'ArrowLeft', '8']);
      assert.deepEqual(saved, ['2026-11-05', 480, '2026-11-05', 600], 'the 11 on the way pushed nothing that stays');
    });
  });

  test('a new edit starts from what the last one left', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#days-pane .day[data-day="2026-11-05"]').click();
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Typed');
      await page.locator('#event-start-time').focus();
      await press(page, ['1', '1']); // 11:00 to 12:00.
      await page.locator('#event-notes').focus();
      assert.equal(await page.locator('#event-end-time').inputValue(), '12:00');
      await page.locator('#event-start-time').focus();
      await press(page, ['8']); // Earlier doesn't pull Ends back.
      await page.locator('#event-notes').focus();
      await page.locator('#event-submit').click();
      await sheetGone(page);
      const [saved] = (await savedData(page)).events;
      assert.deepEqual([saved.startMinutes, saved.endMinutes], [480, 720]);
    });
  });

  test('editing Ends in between does not get undone by going back to Starts', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#days-pane .day[data-day="2026-11-05"]').click();
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Typed');
      await page.locator('#event-start-time').focus();
      await press(page, ['1', '0']); // 10:00, Ends still 10:00.
      await page.locator('#event-end-time').focus();
      await press(page, ['1', '1']); // Ends 11:00.
      await page.locator('#event-start-time').focus();
      await press(page, ['9']);
      await page.keyboard.press('Enter');
      await sheetGone(page);
      const [saved] = (await savedData(page)).events;
      assert.deepEqual([saved.startMinutes, saved.endMinutes], [540, 660]);
    });
  });
});

describe('typing into Ends: the digits so far survive', () => {
  const CASES = [
    ['minutes 45', '2026-11-05', '#event-end-time', ['ArrowRight', '4', '5'], ['2026-11-05', 540, '2026-11-05', 645]],
    ['11:30 PM', '2026-11-05', '#event-end-time', ['1', '1', '3', '0', 'p'], ['2026-11-05', 540, '2026-11-05', 1410]],
    ['hour 11', '2026-11-05', '#event-end-time', ['1', '1'], ['2026-11-05', 540, '2026-11-05', 660]],
    ['day 25, passing through a day before Starts', '2026-11-05', '#event-end-date', ['ArrowRight', '2', '5'], ['2026-11-05', 540, '2026-11-25', 600]],
    ['day 25, with Starts on the 1st', '2026-11-01', '#event-end-date', ['ArrowRight', '2', '5'], ['2026-11-01', 540, '2026-11-25', 600]],
    ['month 12', '2026-11-05', '#event-end-date', ['1', '2'], ['2026-11-05', 540, '2026-12-05', 600]],
    ['year 2027', '2026-11-05', '#event-end-date', ['ArrowRight', 'ArrowRight', '2', '0', '2', '7'], ['2026-11-05', 540, '2027-11-05', 600]],
    ['a date before Starts still stops at Starts', '2026-11-05', '#event-end-date', ['ArrowRight', '0', '1'], ['2026-11-05', 540, '2026-11-05', 540]],
    ['a time before Starts still stops at Starts', '2026-11-05', '#event-end-time', ['8'], ['2026-11-05', 540, '2026-11-05', 540]],
  ];
  for (const [name, day, selector, keys, expected] of CASES) {
    test(name, async () => {
      await withApp(env, { clock: NOW }, async ({ page }) => {
        assert.deepEqual(await typeIntoNewEvent(page, day, selector, keys), expected);
      });
    });
  }

  test('leaving the field writes the limits back: Ends can not be moved before the new Starts', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#days-pane .day[data-day="2026-11-05"]').click();
      await page.locator('#new-event').click();
      const endDate = page.locator('#event-end-date');
      await endDate.focus();
      await press(page, ['ArrowRight', '2', '5']);
      assert.equal(await endDate.getAttribute('min'), '2026-11-05');
      assert.equal(await page.locator('#event-end-time').getAttribute('min'), '09:00', 'not rewritten while typing');
      await page.locator('#event-notes').focus();
      assert.equal(await page.locator('#event-end-time').getAttribute('min'), '', 'a later day has no earliest time');
    });
  });
});

describe('typing into Assigned: the digits so far survive', () => {
  const local = (...parts) => new Date(zoned(TIME_ZONE, ...parts)).toISOString();

  async function typeIntoAssigned(page, selector, keys) {
    await page.locator('.task-text').click();
    await page.locator(selector).focus();
    await press(page, keys);
    await page.locator('#task-title').focus();
    await page.keyboard.press('Enter');
    await sheetGone(page);
    return (await savedData(page)).tasks[0].assignedAt;
  }

  const seed = doc([], [task('a', 'Essay', NOW - zoned(TIME_ZONE, 2026, 10, 15, 12), NOW)]);
  const CASES = [
    ['month 09', '#task-date', ['0', '9'], local(2026, 9, 15, 12)],
    ['month 11, still past', '#task-date', ['1', '1'], local(2026, 11, 15, 12)],
    ['day 25', '#task-date', ['ArrowRight', '2', '5'], local(2026, 10, 25, 12)],
    ['year 2025', '#task-date', ['ArrowRight', 'ArrowRight', '2', '0', '2', '5'], local(2025, 10, 15, 12)],
    ['hour 11, staying PM', '#task-time', ['1', '1'], local(2026, 10, 15, 23)],
    ['minutes 45', '#task-time', ['ArrowRight', '4', '5'], local(2026, 10, 15, 12, 45)],
    ['9:15 AM', '#task-time', ['0', '9', '1', '5', 'a'], local(2026, 10, 15, 9, 15)],
  ];
  for (const [name, selector, keys, expected] of CASES) {
    test(name, async () => {
      await withApp(env, { clock: NOW, seed }, async ({ page }) => {
        assert.equal(await typeIntoAssigned(page, selector, keys), expected);
      });
    });
  }

  test('a future month stops at now, and only once you have finished typing', async () => {
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      const assigned = await typeIntoAssigned(page, '#task-date', ['1', '2']);
      assert.ok(Math.abs(Date.parse(assigned) - NOW) < 60 * 1000, assigned);
    });
  });

  test('assigned earlier today: minutes 45 is minutes 45, with the limit on the time field in place', async () => {
    const today = doc([], [task('a', 'Essay', 4 * 3600 * 1000, NOW)]);
    await withApp(env, { clock: NOW, seed: today }, async ({ page }) => {
      assert.equal(await typeIntoAssigned(page, '#task-time', ['ArrowRight', '4', '5']), local(2026, 11, 20, 8, 45));
    });
  });

  test('the limits are back once focus leaves', async () => {
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      await page.locator('.task-text').click();
      const date = page.locator('#task-date');
      assert.equal(await date.getAttribute('max'), '2026-11-20');
      assert.equal(await page.locator('#task-time').getAttribute('max'), '');
      await date.focus();
      await press(page, ['1', '1', '2', '0']); // November 20, today, whose time can only go up to now.
      await page.locator('#task-title').focus();
      assert.equal(await date.inputValue(), '2026-11-20');
      assert.match(await page.locator('#task-time').getAttribute('max'), /^12:0\d$/);
    });
  });
});
