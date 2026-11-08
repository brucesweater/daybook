import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeMonth, dayForKey, goToToday, initialState, rollToday, selectDay } from '../../docs/js/calendar-state.js';

const TODAY = '2026-11-01';

test('starts on today', () => {
  assert.deepEqual(initialState(TODAY), { today: TODAY, selected: TODAY, year: 2026, month: 11 });
});

test('selecting an adjacent-month day moves to that month', () => {
  const state = selectDay(initialState(TODAY), '2026-12-05');
  assert.equal(state.selected, '2026-12-05');
  assert.equal(state.month, 12);
  assert.equal(state.today, TODAY);
  const back = selectDay(initialState(TODAY), '2026-10-31');
  assert.equal(back.month, 10);
});

test('changing month selects the 1st, or today if that month contains today', () => {
  const next = changeMonth(initialState(TODAY), 1);
  assert.deepEqual([next.year, next.month, next.selected], [2026, 12, '2026-12-01']);
  const year = changeMonth(next, 1);
  assert.deepEqual([year.year, year.month, year.selected], [2027, 1, '2027-01-01']);
  const prev = changeMonth(initialState(TODAY), -1);
  assert.equal(prev.selected, '2026-10-01');
  const backHome = changeMonth(prev, 1);
  assert.equal(backHome.selected, TODAY);
  // Today partway through a month.
  const midMonth = initialState('2026-11-17');
  assert.equal(changeMonth(changeMonth(midMonth, 1), -1).selected, '2026-11-17');
});

test('Today jumps back from far away', () => {
  let state = initialState(TODAY);
  for (let i = 0; i < 40; i += 1) state = changeMonth(state, 1);
  assert.deepEqual([state.year, state.month], [2030, 3]);
  const home = goToToday(state);
  assert.deepEqual([home.year, home.month, home.selected], [2026, 11, TODAY]);
});

test('midnight moves a selection that was on today, and leaves any other alone', () => {
  const onToday = rollToday(initialState('2026-11-30'), '2026-12-01');
  assert.deepEqual([onToday.today, onToday.selected, onToday.month], ['2026-12-01', '2026-12-01', 12]);

  const elsewhere = rollToday(selectDay(initialState('2026-11-30'), '2026-11-15'), '2026-12-01');
  assert.deepEqual([elsewhere.today, elsewhere.selected, elsewhere.month], ['2026-12-01', '2026-11-15', 11]);

  const same = initialState(TODAY);
  assert.equal(rollToday(same, TODAY), same);
});

test('grid keys move the selection', () => {
  assert.equal(dayForKey('2026-11-05', 'ArrowLeft', 0), '2026-11-04');
  assert.equal(dayForKey('2026-11-05', 'ArrowRight', 0), '2026-11-06');
  assert.equal(dayForKey('2026-11-05', 'ArrowUp', 0), '2026-10-29');
  assert.equal(dayForKey('2026-11-05', 'ArrowDown', 0), '2026-11-12');
  assert.equal(dayForKey('2026-11-05', 'Home', 0), '2026-11-01');
  assert.equal(dayForKey('2026-11-05', 'End', 0), '2026-11-07');
  assert.equal(dayForKey('2026-11-05', 'Home', 1), '2026-11-02');
  assert.equal(dayForKey('2026-11-05', 'End', 1), '2026-11-08');
  assert.equal(dayForKey('2026-11-05', 'Enter', 0), null);
});
