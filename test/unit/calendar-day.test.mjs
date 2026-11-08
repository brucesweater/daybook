import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Day from '../../docs/js/calendar-day.js';

test('isValid accepts real days only', () => {
  for (const good of ['2026-11-01', '2024-02-29', '2000-02-29', '1999-12-31', '0001-01-01', '9999-12-31']) {
    assert.equal(Day.isValid(good), true, good);
  }
  for (const bad of [
    '2026-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-31', '2026-1-1', '26-11-01',
    '2026-11-01T00:00:00Z', ' 2026-11-01', '2026-11-01 ', '20261101', '', null, undefined, 20261101, {}, [],
  ]) {
    assert.equal(Day.isValid(bad), false, String(bad));
  }
});

test('leap years', () => {
  assert.equal(Day.isLeapYear(2024), true);
  assert.equal(Day.isLeapYear(2026), false);
  assert.equal(Day.isLeapYear(1900), false);
  assert.equal(Day.isLeapYear(2000), true);
  assert.equal(Day.daysInMonth(2024, 2), 29);
  assert.equal(Day.daysInMonth(2026, 2), 28);
  assert.equal(Day.daysInMonth(2026, 4), 30);
  assert.equal(Day.daysInMonth(2026, 12), 31);
});

test('toNumber and fromNumber are inverse, and agree with the epoch', () => {
  assert.equal(Day.toNumber('1970-01-01'), 0);
  assert.equal(Day.toNumber('1970-01-02'), 1);
  assert.equal(Day.toNumber('1969-12-31'), -1);
  assert.equal(Day.toNumber('2000-03-01'), 11017);
  for (let number = -600000; number <= 600000; number += 997) {
    assert.equal(Day.toNumber(Day.fromNumber(number)), number);
  }
});

test('every day from 1999 to 2031 agrees with the UTC calendar, and runs in sequence', () => {
  // Date.UTC is a safe cross-check here: UTC has no daylight saving.
  let day = '1999-01-01';
  for (let utc = Date.UTC(1999, 0, 1); utc < Date.UTC(2032, 0, 1); utc += 24 * 3600 * 1000) {
    assert.equal(day, new Date(utc).toISOString().slice(0, 10));
    assert.equal(Day.weekday(day), new Date(utc).getUTCDay());
    assert.equal(Day.isValid(day), true);
    day = Day.addDays(day, 1);
  }
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(Day.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(Day.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Day.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(Day.addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(Day.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(Day.addDays('2026-11-01', 0), '2026-11-01');
  assert.equal(Day.addDays('2026-11-01', 365), '2027-11-01');
});

test('daylight-saving days are ordinary days', () => {
  // US changes in 2026: March 8 is 23 hours long, November 1 is 25.
  assert.equal(Day.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(Day.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(Day.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(Day.diffDays('2026-11-02', '2026-10-31'), 2);
});

test('diffDays', () => {
  assert.equal(Day.diffDays('2026-11-05', '2026-11-01'), 4);
  assert.equal(Day.diffDays('2026-11-01', '2026-11-05'), -4);
  assert.equal(Day.diffDays('2027-01-01', '2026-12-31'), 1);
});

test('weekday', () => {
  assert.equal(Day.weekday('2026-11-01'), 0); // Sunday
  assert.equal(Day.weekday('2026-11-05'), 4); // Thursday
  assert.equal(Day.weekday('2026-11-07'), 6); // Saturday
  assert.equal(Day.weekday('1970-01-01'), 4);
  assert.equal(Day.weekday('1969-12-28'), 0);
});

test('fromDate reads the local calendar day, and toDate builds local midnight', () => {
  const date = new Date(2026, 10, 1, 23, 59, 59);
  assert.equal(Day.fromDate(date), '2026-11-01');
  assert.equal(Day.fromDate(new Date(2026, 10, 1, 0, 0, 0)), '2026-11-01');
  const local = Day.toDate('2026-11-05', 870);
  assert.deepEqual(
    [local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()],
    [2026, 10, 5, 14, 30],
  );
  assert.equal(Day.fromDate(Day.toDate('2026-11-01')), '2026-11-01');
});

test('a day string survives the trip through a local Date in this time zone, every day of 2026', () => {
  for (let day = '2026-01-01'; day < '2027-01-01'; day = Day.addDays(day, 1)) {
    assert.equal(Day.fromDate(Day.toDate(day)), day);
    assert.equal(Day.fromDate(Day.toDate(day, 720)), day);
    assert.equal(Day.fromDate(Day.toDate(day, 1439)), day);
  }
});

test('month helpers', () => {
  assert.deepEqual(Day.monthOf('2026-11-05'), { year: 2026, month: 11 });
  assert.deepEqual(Day.addMonths({ year: 2026, month: 11 }, 1), { year: 2026, month: 12 });
  assert.deepEqual(Day.addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(Day.addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(Day.addMonths({ year: 2026, month: 3 }, -15), { year: 2024, month: 12 });
  assert.deepEqual(Day.addMonths({ year: 2026, month: 11 }, 26), { year: 2029, month: 1 });
  assert.equal(Day.firstOfMonth({ year: 2026, month: 2 }), '2026-02-01');
  assert.equal(Day.isInMonth('2026-11-30', { year: 2026, month: 11 }), true);
  assert.equal(Day.isInMonth('2026-12-01', { year: 2026, month: 11 }), false);
  assert.equal(Day.isInMonth('2025-11-01', { year: 2026, month: 11 }), false);
  assert.ok(Day.compareMonths({ year: 2026, month: 1 }, { year: 2025, month: 12 }) > 0);
  assert.ok(Day.compareMonths({ year: 2025, month: 12 }, { year: 2026, month: 1 }) < 0);
  assert.equal(Day.compareMonths({ year: 2026, month: 1 }, { year: 2026, month: 1 }), 0);
});
