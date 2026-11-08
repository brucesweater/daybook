import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Day from '../../docs/js/calendar-day.js';
import { monthGrid, weekEnd, weekStart, weekdayOrder } from '../../docs/js/grid.js';

const SUNDAY = 0;
const MONDAY = 1;

function days(year, month, first) {
  return monthGrid(year, month, first).map((cell) => cell.day);
}

test('always 42 cells, every month for fifty years, either week start', () => {
  for (let year = 2000; year < 2050; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (const first of [SUNDAY, MONDAY, 6]) {
        const cells = monthGrid(year, month, first);
        assert.equal(cells.length, 42);
        // Every row begins on the first weekday.
        assert.equal(Day.weekday(cells[0].day), first);
        assert.equal(Day.weekday(cells[35].day), first);
        // Consecutive days, and exactly this month's days are marked inMonth.
        cells.forEach((cell, i) => {
          if (i > 0) assert.equal(Day.diffDays(cell.day, cells[i - 1].day), 1);
          assert.equal(cell.inMonth, Day.isInMonth(cell.day, { year, month }));
        });
        assert.equal(cells.filter((cell) => cell.inMonth).length, Day.daysInMonth(year, month));
      }
    }
  }
});

test('November 2026, Sunday first: the DST-change day is an ordinary cell, every date once', () => {
  const cells = monthGrid(2026, 11, SUNDAY);
  // November 1, 2026 is a Sunday (and a 25-hour day in America/Chicago), so it sits top left.
  assert.deepEqual(cells[0], { day: '2026-11-01', inMonth: true });
  assert.equal(cells[1].day, '2026-11-02');
  assert.deepEqual(cells[29], { day: '2026-11-30', inMonth: true });
  assert.deepEqual(cells[30], { day: '2026-12-01', inMonth: false });
  assert.deepEqual(cells[41], { day: '2026-12-12', inMonth: false });

  const list = cells.map((cell) => cell.day);
  assert.equal(new Set(list).size, 42, 'no date appears twice');
  for (let date = 1; date <= 30; date += 1) {
    const day = Day.make(2026, 11, date);
    assert.equal(list.filter((value) => value === day).length, 1, day);
  }
});

test('November 2026, Monday first', () => {
  const list = days(2026, 11, MONDAY);
  assert.equal(list[0], '2026-10-26');
  assert.equal(list[6], '2026-11-01');
  assert.equal(list[7], '2026-11-02');
  assert.equal(list[41], '2026-12-06');
  assert.equal(new Set(list).size, 42);
});

test('March 2026 also has a DST change, and it also appears once', () => {
  const list = days(2026, 3, SUNDAY);
  assert.equal(new Set(list).size, 42);
  assert.equal(list.filter((value) => value === '2026-03-08').length, 1);
  assert.equal(list[7], '2026-03-08');
});

test('leap February', () => {
  const sunday = monthGrid(2024, 2, SUNDAY);
  assert.equal(sunday[0].day, '2024-01-28');
  assert.deepEqual(sunday[4], { day: '2024-02-01', inMonth: true });
  assert.deepEqual(sunday[32], { day: '2024-02-29', inMonth: true });
  assert.deepEqual(sunday[33], { day: '2024-03-01', inMonth: false });

  const monday = monthGrid(2024, 2, MONDAY);
  assert.equal(monday[0].day, '2024-01-29');
  assert.equal(monday.filter((cell) => cell.inMonth).length, 29);

  // 2028 is the next leap February after this was written; 2100 isn't one.
  assert.equal(monthGrid(2028, 2, SUNDAY).filter((cell) => cell.inMonth).length, 29);
  assert.equal(monthGrid(2100, 2, SUNDAY).filter((cell) => cell.inMonth).length, 28);
});

test('a month that starts on the first weekday begins in the first cell', () => {
  // February 2026 is exactly four weeks, Sunday to Saturday.
  const list = monthGrid(2026, 2, SUNDAY);
  assert.deepEqual(list[0], { day: '2026-02-01', inMonth: true });
  assert.deepEqual(list[27], { day: '2026-02-28', inMonth: true });
  assert.deepEqual(list[28], { day: '2026-03-01', inMonth: false });
  assert.deepEqual(list[41], { day: '2026-03-14', inMonth: false });
});

test('months that really need six rows fit, with the last day in the sixth row', () => {
  // August 2026 starts on Saturday and has 31 days, so it spills into a sixth row.
  const august = monthGrid(2026, 8, SUNDAY);
  assert.equal(august[0].day, '2026-07-26');
  assert.deepEqual(august[6], { day: '2026-08-01', inMonth: true });
  assert.deepEqual(august[36], { day: '2026-08-31', inMonth: true });
  assert.ok(36 >= 35, 'index 36 is in the sixth row');
  // The Monday-first equivalent: August 2027 starts on a Sunday, the last Monday-first column.
  const mondayFirst = monthGrid(2027, 8, MONDAY);
  assert.deepEqual(mondayFirst[6], { day: '2027-08-01', inMonth: true });
  assert.deepEqual(mondayFirst[36], { day: '2027-08-31', inMonth: true });
});

test('year boundary: adjacent days come from the neighbouring year', () => {
  const january = monthGrid(2027, 1, SUNDAY);
  assert.equal(january[0].day, '2026-12-27');
  assert.equal(january[0].inMonth, false);
  const december = monthGrid(2026, 12, SUNDAY);
  assert.equal(december[41].day, '2027-01-09');
  assert.equal(december[41].inMonth, false);
});

test('weekStart and weekEnd', () => {
  assert.equal(weekStart('2026-11-05', SUNDAY), '2026-11-01');
  assert.equal(weekEnd('2026-11-05', SUNDAY), '2026-11-07');
  assert.equal(weekStart('2026-11-05', MONDAY), '2026-11-02');
  assert.equal(weekEnd('2026-11-05', MONDAY), '2026-11-08');
  assert.equal(weekStart('2026-11-01', SUNDAY), '2026-11-01');
  assert.equal(weekStart('2026-11-01', MONDAY), '2026-10-26');
  assert.equal(weekEnd('2026-11-01', MONDAY), '2026-11-01');
});

test('weekdayOrder rotates from the first weekday', () => {
  assert.deepEqual(weekdayOrder(SUNDAY), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekdayOrder(MONDAY), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(weekdayOrder(6), [6, 0, 1, 2, 3, 4, 5]);
});
