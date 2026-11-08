import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaFor,
  coversDay,
  defaultTimes,
  draftFromEvent,
  effectiveEndDay,
  endIsBeforeStart,
  eventCounts,
  fieldsFromDraft,
  moveEnd,
  moveStart,
  newDraft,
  setAllDay,
  timeLine,
} from '../../docs/js/events.js';

function timed(title, startDay, startMinutes, endDay, endMinutes, id = title) {
  return { id, title, notes: '', allDay: false, startDay, startMinutes, endDay, endMinutes };
}
function allDay(title, startDay, endDay = startDay, id = title) {
  return { id, title, notes: '', allDay: true, startDay, startMinutes: null, endDay, endMinutes: null };
}

test('an event covers exactly the days from start through effective end', () => {
  const trip = allDay('Trip', '2026-11-27', '2026-12-02');
  assert.equal(coversDay(trip, '2026-11-26'), false);
  assert.equal(coversDay(trip, '2026-11-27'), true);
  assert.equal(coversDay(trip, '2026-11-30'), true);
  assert.equal(coversDay(trip, '2026-12-02'), true);
  assert.equal(coversDay(trip, '2026-12-03'), false);
});

test('a timed event ending exactly at midnight does not show on the next day', () => {
  const party = timed('Party', '2026-12-31', 1200, '2027-01-01', 0);
  assert.equal(effectiveEndDay(party), '2026-12-31');
  assert.equal(coversDay(party, '2026-12-31'), true);
  assert.equal(coversDay(party, '2027-01-01'), false);
});

test('ending one minute after midnight does show on the next day', () => {
  const late = timed('Late', '2026-12-31', 1200, '2027-01-01', 1);
  assert.equal(effectiveEndDay(late), '2027-01-01');
  assert.equal(coversDay(late, '2027-01-01'), true);
});

test('midnight rule needs a timed event that ends on a later day', () => {
  // All-day events have no end time; the rule must not apply.
  const holiday = { ...allDay('Holiday', '2026-12-31', '2027-01-01'), endMinutes: 0 };
  assert.equal(effectiveEndDay(holiday), '2027-01-01');
  assert.equal(coversDay(holiday, '2027-01-01'), true);
  // Zero-length at midnight on one day stays on that day.
  const instant = timed('Marker', '2026-11-05', 0, '2026-11-05', 0);
  assert.equal(effectiveEndDay(instant), '2026-11-05');
  assert.equal(coversDay(instant, '2026-11-05'), true);
  assert.equal(coversDay(instant, '2026-11-04'), false);
});

test('a multi-day timed event ending at midnight loses only its last day', () => {
  const event = timed('Conference', '2026-11-01', 1320, '2026-11-03', 0);
  assert.equal(effectiveEndDay(event), '2026-11-02');
  assert.equal(coversDay(event, '2026-11-01'), true);
  assert.equal(coversDay(event, '2026-11-02'), true);
  assert.equal(coversDay(event, '2026-11-03'), false);
});

test('DST days are covered like any others', () => {
  const event = timed('Overnight', '2026-10-31', 1380, '2026-11-02', 60);
  assert.deepEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((d) => coversDay(event, d)),
    [false, true, true, true, false]);
});

test('time lines', () => {
  const day = '2026-11-05';
  assert.equal(timeLine(allDay('A', day), day), 'All day');
  assert.equal(timeLine(allDay('A', '2026-11-01', '2026-11-30'), day), 'All day');
  assert.equal(timeLine(allDay('A', day, '2026-11-30'), day), 'All day');
  assert.equal(timeLine(timed('B', day, 840, day, 900), day), '2:00 PM – 3:00 PM');
  assert.equal(timeLine(timed('B', day, 840, day, 900), day, true), '14:00 – 15:00');
  const late = timed('C', '2026-11-13', 1380, '2026-11-14', 60);
  assert.equal(timeLine(late, '2026-11-13'), 'Starts 11:00 PM');
  assert.equal(timeLine(late, '2026-11-14'), 'Ends 1:00 AM');
  assert.equal(timeLine(late, '2026-11-13', true), 'Starts 23:00');
  assert.equal(timeLine(late, '2026-11-14', true), 'Ends 01:00');
  const long = timed('D', '2026-11-01', 600, '2026-11-04', 660);
  assert.equal(timeLine(long, '2026-11-01'), 'Starts 10:00 AM');
  assert.equal(timeLine(long, '2026-11-02'), 'All day');
  assert.equal(timeLine(long, '2026-11-03'), 'All day');
  assert.equal(timeLine(long, '2026-11-04'), 'Ends 11:00 AM');
});

test('a party ending at midnight reads as one evening on its one day', () => {
  const party = timed('Party', '2026-12-31', 1200, '2027-01-01', 0);
  assert.equal(timeLine(party, '2026-12-31'), '8:00 PM – 12:00 AM');
  assert.equal(timeLine(party, '2026-12-31', true), '20:00 – 00:00');
});

test('a multi-day event ending at midnight is All day on its last covered day, not "Ends 12:00 AM"', () => {
  const event = timed('Conference', '2026-11-01', 1320, '2026-11-03', 0);
  assert.equal(timeLine(event, '2026-11-01'), 'Starts 10:00 PM');
  assert.equal(timeLine(event, '2026-11-02'), 'All day');
});

test('labels do not shift on DST-change days', () => {
  for (const day of ['2026-03-08', '2026-11-01']) {
    assert.equal(timeLine(timed('E', day, 60, day, 180), day), '1:00 AM – 3:00 AM');
    assert.equal(timeLine(timed('E', day, 150, day, 150), day), '2:30 AM – 2:30 AM');
  }
});

test('agenda order: all-day first, then by start time, then by title', () => {
  const day = '2026-11-05';
  const events = [
    timed('Zebra', day, 600, day, 660),
    timed('Apple', day, 600, day, 660),
    timed('Early', day, 300, day, 360),
    allDay('Yard sale', day),
    allDay('Art show', day),
    timed('Other day', '2026-11-06', 600, '2026-11-06', 660),
  ];
  assert.deepEqual(agendaFor(events, day).map((event) => event.title), ['Art show', 'Yard sale', 'Early', 'Apple', 'Zebra']);
});

test('agenda order: an event running all through the day sits with the all-day ones', () => {
  const day = '2026-11-05';
  const events = [
    timed('Breakfast', day, 480, day, 540),
    timed('Long haul', '2026-11-04', 600, '2026-11-06', 600),
    allDay('Holiday', day),
  ];
  assert.deepEqual(agendaFor(events, day).map((event) => event.title), ['Holiday', 'Long haul', 'Breakfast']);
});

test('agenda order: something ending today comes before what starts today', () => {
  const day = '2026-11-14';
  const events = [
    timed('Breakfast', day, 480, day, 540),
    timed('Late show', '2026-11-13', 1380, day, 60),
    timed('Night owl', day, 1380, '2026-11-15', 60),
  ];
  assert.deepEqual(agendaFor(events, day).map((event) => event.title), ['Late show', 'Breakfast', 'Night owl']);
});

test('agenda order: titles compare without regard to case, numbers in order, ids break ties', () => {
  const day = '2026-11-05';
  const titles = ['item 10', 'Item 9', 'apple'];
  assert.deepEqual(
    agendaFor(titles.map((title) => allDay(title, day)), day).map((event) => event.title),
    ['apple', 'Item 9', 'item 10'],
  );
  const ties = [allDay('Same', day, day, 'b'), allDay('Same', day, day, 'a')];
  assert.deepEqual(agendaFor(ties, day).map((event) => event.id), ['a', 'b']);
});

test('agendaFor leaves its input alone', () => {
  const day = '2026-11-05';
  const events = [timed('B', day, 600, day, 660), timed('A', day, 300, day, 360)];
  const before = [...events];
  agendaFor(events, day);
  assert.deepEqual(events, before);
});

test('eventCounts counts covered days, bounded by the range, and honours the midnight rule', () => {
  const counts = eventCounts(
    [
      timed('One', '2026-11-05', 600, '2026-11-05', 660),
      timed('Two', '2026-11-05', 700, '2026-11-05', 760),
      allDay('Trip', '2026-11-27', '2026-12-20'),
      timed('Party', '2026-11-10', 1200, '2026-11-11', 0),
      allDay('Way before', '2020-01-01', '2020-01-02'),
    ],
    '2026-11-01',
    '2026-12-12',
  );
  assert.equal(counts.get('2026-11-05'), 2);
  assert.equal(counts.get('2026-11-10'), 1);
  assert.equal(counts.has('2026-11-11'), false);
  assert.equal(counts.get('2026-11-27'), 1);
  assert.equal(counts.get('2026-12-12'), 1);
  assert.equal(counts.has('2026-12-13'), false);
  assert.equal(counts.has('2020-01-01'), false);
  assert.equal(counts.has('2026-11-04'), false);
});

test('default times on another day are 9 to 10', () => {
  const now = new Date(2026, 10, 1, 15, 5);
  assert.deepEqual(defaultTimes('2026-11-02', now), { startMinutes: 540, endMinutes: 600 });
  assert.deepEqual(defaultTimes('2025-01-01', now), { startMinutes: 540, endMinutes: 600 });
});

test('default times today are the next full hour for one hour', () => {
  const at = (hours, minutes, seconds = 0) => defaultTimes('2026-11-01', new Date(2026, 10, 1, hours, minutes, seconds));
  assert.deepEqual(at(15, 5), { startMinutes: 960, endMinutes: 1020 });
  assert.deepEqual(at(0, 0), { startMinutes: 60, endMinutes: 120 });
  assert.deepEqual(at(9, 0), { startMinutes: 600, endMinutes: 660 });
  assert.deepEqual(at(21, 59, 59), { startMinutes: 1320, endMinutes: 1380 });
});

test('default times late at night stay on that day', () => {
  const at = (hours, minutes) => defaultTimes('2026-11-01', new Date(2026, 10, 1, hours, minutes));
  assert.deepEqual(at(22, 0), { startMinutes: 1380, endMinutes: 1439 });
  assert.deepEqual(at(22, 30), { startMinutes: 1380, endMinutes: 1439 });
  assert.deepEqual(at(23, 0), { startMinutes: 1380, endMinutes: 1439 });
  assert.deepEqual(at(23, 59), { startMinutes: 1380, endMinutes: 1439 });
});

test('newDraft fills in the day and default times', () => {
  const draft = newDraft('2026-11-05', new Date(2026, 10, 1, 15, 5));
  assert.deepEqual(draft, {
    title: '', notes: '', allDay: false,
    startDay: '2026-11-05', endDay: '2026-11-05', startMinutes: 540, endMinutes: 600,
  });
});

test('draftFromEvent offers ordinary times for an all-day event', () => {
  const draft = draftFromEvent(allDay('Trip', '2026-11-27', '2026-12-02'));
  assert.equal(draft.startMinutes, 540);
  assert.equal(draft.endMinutes, 600);
  assert.equal(draft.allDay, true);
});

const base = {
  title: 'T', notes: '', allDay: false,
  startDay: '2026-11-05', startMinutes: 540, endDay: '2026-11-05', endMinutes: 600,
};

test('moving Starts before Ends leaves Ends alone', () => {
  const next = moveStart(base, '2026-11-05', 570);
  assert.equal(next.startMinutes, 570);
  assert.equal(next.endDay, '2026-11-05');
  assert.equal(next.endMinutes, 600);
  const earlier = moveStart(base, '2026-11-01', 540);
  assert.equal(earlier.startDay, '2026-11-01');
  assert.equal(earlier.endDay, '2026-11-05');
  assert.equal(earlier.endMinutes, 600);
});

test('moving Starts exactly onto Ends leaves Ends alone', () => {
  const next = moveStart(base, '2026-11-05', 600);
  assert.equal(next.endMinutes, 600);
  assert.equal(next.endDay, '2026-11-05');
});

test('moving Starts past Ends pushes Ends along, keeping the duration', () => {
  const time = moveStart(base, '2026-11-05', 660);
  assert.equal(time.endDay, '2026-11-05');
  assert.equal(time.endMinutes, 720);
  const day = moveStart(base, '2026-11-09');
  assert.equal(day.startDay, '2026-11-09');
  assert.equal(day.startMinutes, 540);
  assert.equal(day.endDay, '2026-11-09');
  assert.equal(day.endMinutes, 600);
});

test('pushing Ends crosses midnight, months and DST days correctly', () => {
  const late = moveStart(base, '2026-11-05', 1410);
  assert.equal(late.endDay, '2026-11-06');
  assert.equal(late.endMinutes, 30);
  const multi = { ...base, endDay: '2026-11-07', endMinutes: 600 };
  const next = moveStart(multi, '2026-11-29', 540);
  assert.equal(next.endDay, '2026-12-01');
  assert.equal(next.endMinutes, 600);
  const dst = { ...base, startDay: '2026-10-30', endDay: '2026-11-02', startMinutes: 60, endMinutes: 120 };
  const moved = moveStart(dst, '2026-11-03', 60);
  assert.equal(moved.endDay, '2026-11-06');
  assert.equal(moved.endMinutes, 120);
});

test('all-day: moving Starts past Ends pushes by days', () => {
  const trip = { ...base, allDay: true, startDay: '2026-11-27', endDay: '2026-11-29' };
  assert.equal(moveStart(trip, '2026-11-28').endDay, '2026-11-29');
  assert.equal(moveStart(trip, '2026-11-29').endDay, '2026-11-29');
  const pushed = moveStart(trip, '2026-12-30');
  assert.equal(pushed.startDay, '2026-12-30');
  assert.equal(pushed.endDay, '2027-01-01');
});

test('a push is measured from one draft: intermediate values leave nothing behind', () => {
  // What the editor does while 2:30 PM is typed: every value starts over from the draft the edit began with.
  const typed = [120, 150, 870].map((minutes) => moveStart(base, '2026-11-05', minutes));
  assert.deepEqual([typed[2].startMinutes, typed[2].endDay, typed[2].endMinutes], [870, '2026-11-05', 930]);
  // Feeding each value into the next is the bug that made: Ends drifted to 10:00 PM.
  const compounded = [120, 150, 870].reduce((draft, minutes) => moveStart(draft, '2026-11-05', minutes), base);
  assert.equal(compounded.endMinutes, 1320);
});

test('a push never runs off the end of the calendar: Ends stops at Starts instead', () => {
  const long = { ...base, startDay: '2026-11-05', endDay: '9999-10-30' };
  const timed = moveStart(long, '9999-11-30', 540);
  assert.deepEqual([timed.startDay, timed.endDay, timed.endMinutes], ['9999-11-30', '9999-11-30', 540]);
  const allDay = moveStart({ ...long, allDay: true }, '9999-11-30');
  assert.deepEqual([allDay.startDay, allDay.endDay], ['9999-11-30', '9999-11-30']);
  const inRange = moveStart({ ...base, endDay: '2026-11-07' }, '9999-11-30', 540);
  assert.equal(inRange.endDay, '9999-12-02', 'December 9999 is still a real day');
});

test('moving Ends later just moves it', () => {
  const next = moveEnd(base, '2026-11-06', 30);
  assert.equal(next.endDay, '2026-11-06');
  assert.equal(next.endMinutes, 30);
  assert.equal(next.startDay, '2026-11-05');
});

test('moving Ends before Starts is not allowed: it stops at Starts', () => {
  assert.equal(endIsBeforeStart(base, '2026-11-05', 539), true);
  assert.equal(endIsBeforeStart(base, '2026-11-05', 540), false);
  assert.equal(endIsBeforeStart(base, '2026-11-04', 1000), true);
  assert.equal(endIsBeforeStart(base, '2026-11-06', 0), false);

  const time = moveEnd(base, '2026-11-05', 500);
  assert.equal(time.endDay, '2026-11-05');
  assert.equal(time.endMinutes, 540);
  assert.equal(time.startMinutes, 540);

  const day = moveEnd(base, '2026-11-01', 1000);
  assert.equal(day.endDay, '2026-11-05');
  assert.equal(day.endMinutes, 540);
  assert.equal(day.startDay, '2026-11-05');
});

test('moving Ends onto the start day with an earlier time stops at Starts', () => {
  const draft = { ...base, startMinutes: 840, endDay: '2026-11-06', endMinutes: 600 };
  const next = moveEnd(draft, '2026-11-05');
  assert.equal(next.endDay, '2026-11-05');
  assert.equal(next.endMinutes, 840);
});

test('all-day: moving Ends before Starts stops at Starts, and only days matter', () => {
  const trip = { ...base, allDay: true, startDay: '2026-11-27', endDay: '2026-11-29' };
  assert.equal(endIsBeforeStart(trip, '2026-11-26'), true);
  assert.equal(endIsBeforeStart(trip, '2026-11-27'), false);
  assert.equal(moveEnd(trip, '2026-11-20').endDay, '2026-11-27');
  assert.equal(moveEnd(trip, '2026-11-27').endDay, '2026-11-27');
  assert.equal(moveEnd(trip, '2026-12-01').endDay, '2026-12-01');
});

test('turning all-day off keeps sensible times', () => {
  // Kept times that still work come back untouched.
  const on = setAllDay(base, true);
  assert.equal(on.allDay, true);
  const off = setAllDay(on, false);
  assert.equal(off.startMinutes, 540);
  assert.equal(off.endMinutes, 600);

  // While all-day, Ends moved back onto the start day; the kept times would now run backwards.
  const draft = { ...base, allDay: true, startMinutes: 840, endMinutes: 600 };
  const repaired = setAllDay(draft, false);
  assert.equal(repaired.endMinutes, 900);

  const lastHour = { ...base, allDay: true, startMinutes: 1430, endMinutes: 600 };
  assert.equal(setAllDay(lastHour, false).endMinutes, 1439);
});

test('fieldsFromDraft trims and drops minutes from all-day events', () => {
  assert.deepEqual(fieldsFromDraft({ ...base, title: '  Dentist ', notes: ' card\n ' }), {
    title: 'Dentist', notes: 'card', allDay: false,
    startDay: '2026-11-05', startMinutes: 540, endDay: '2026-11-05', endMinutes: 600,
  });
  assert.deepEqual(fieldsFromDraft({ ...base, allDay: true }), {
    title: 'T', notes: '', allDay: true,
    startDay: '2026-11-05', startMinutes: null, endDay: '2026-11-05', endMinutes: null,
  });
});
