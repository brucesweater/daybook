// Which month is showing and which day is selected. Plain values in, plain values out.

import * as Day from './calendar-day.js';
import { weekEnd, weekStart } from './grid.js';

export function initialState(today) {
  return { today, selected: today, ...Day.monthOf(today) };
}

/** Selecting a day moves to its month, which is how adjacent-month days work. */
export function selectDay(state, day) {
  return { ...state, selected: day, ...Day.monthOf(day) };
}

/** After changing month, select today if that month contains today, otherwise the 1st. */
export function changeMonth(state, delta) {
  const month = Day.addMonths(state, delta);
  const selected = Day.isInMonth(state.today, month) ? state.today : Day.firstOfMonth(month);
  return { ...state, ...month, selected };
}

export function goToToday(state) {
  return selectDay(state, state.today);
}

/** Midnight passed. If the selection was on "today" it stays on today; any other selection is left alone. */
export function rollToday(state, today) {
  if (today === state.today) return state;
  const next = { ...state, today };
  return state.selected === state.today ? selectDay(next, today) : next;
}

/** The day a grid navigation key lands on, or null if the key doesn't move the selection by days. */
export function dayForKey(selected, key, firstWeekday) {
  switch (key) {
    case 'ArrowLeft': return Day.addDays(selected, -1);
    case 'ArrowRight': return Day.addDays(selected, 1);
    case 'ArrowUp': return Day.addDays(selected, -7);
    case 'ArrowDown': return Day.addDays(selected, 7);
    case 'Home': return weekStart(selected, firstWeekday);
    case 'End': return weekEnd(selected, firstWeekday);
    default: return null;
  }
}
