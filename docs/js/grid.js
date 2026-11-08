// The month grid: always 42 days (6 rows of 7), so the layout never jumps between months.

import * as Day from './calendar-day.js';

export const CELLS = 42;

/**
 * @param firstWeekday 0 for Sunday-first, 1 for Monday-first, and so on.
 * @returns 42 `{ day, inMonth }` objects, in reading order.
 */
export function monthGrid(year, month, firstWeekday = 0) {
  const first = Day.make(year, month, 1);
  const start = Day.addDays(first, -((Day.weekday(first) - firstWeekday + 7) % 7));
  const cells = [];
  for (let i = 0; i < CELLS; i += 1) {
    const day = Day.addDays(start, i);
    cells.push({ day, inMonth: Day.isInMonth(day, { year, month }) });
  }
  return cells;
}

/** The first day of the week `day` is in. */
export function weekStart(day, firstWeekday = 0) {
  return Day.addDays(day, -((Day.weekday(day) - firstWeekday + 7) % 7));
}

/** The last day of the week `day` is in. */
export function weekEnd(day, firstWeekday = 0) {
  return Day.addDays(weekStart(day, firstWeekday), 6);
}

/** Weekday numbers (0 is Sunday) in the order the grid's columns show them. */
export function weekdayOrder(firstWeekday = 0) {
  return Array.from({ length: 7 }, (_, i) => (firstWeekday + i) % 7);
}
