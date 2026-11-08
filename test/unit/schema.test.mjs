import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Day from '../../docs/js/calendar-day.js';
import { parseDocument, parseInstant, readDocument, stringifyDocument } from '../../docs/js/schema.js';
import { agendaFor, timeLine } from '../../docs/js/events.js';
import { doneLine, sortOpen } from '../../docs/js/tasks.js';

const FIXTURE = readFileSync(new URL('../fixtures/daybook-sample.json', import.meta.url), 'utf8');

const goodEvent = () => ({
  id: 'e1', title: 'Dentist', notes: '', allDay: false,
  startDay: '2026-11-05', startMinutes: 870, endDay: '2026-11-05', endMinutes: 930,
});
const goodTask = () => ({
  id: 't1', title: 'Essay', notes: '', assignedAt: '2026-10-29T13:00:00.000Z', completedAt: null,
});
const doc = (events = [goodEvent()], tasks = [goodTask()]) => ({
  app: 'Daybook', version: 1, exportedAt: '2026-11-01T18:30:00.000Z', events, tasks,
});
const withEvent = (change) => doc([{ ...goodEvent(), ...change }]);
const withTask = (change) => doc(undefined, [{ ...goodTask(), ...change }]);
const without = (object, key) => {
  const copy = { ...object };
  delete copy[key];
  return copy;
};

test('a good document reads', () => {
  const data = readDocument(doc());
  assert.deepEqual(data.events, [goodEvent()]);
  assert.deepEqual(data.tasks, [goodTask()]);
});

test('the top level is checked: app, version, arrays', () => {
  for (const bad of [
    null, 5, 'x', [], {},
    { ...doc(), app: 'Other' },
    { ...doc(), app: 'daybook' },
    without(doc(), 'app'),
    { ...doc(), version: 2 },
    { ...doc(), version: '1' },
    without(doc(), 'version'),
    without(doc(), 'events'),
    without(doc(), 'tasks'),
    { ...doc(), events: {} },
    { ...doc(), tasks: 'none' },
    { ...doc(), events: null },
  ]) {
    assert.equal(readDocument(bad), null, JSON.stringify(bad));
  }
});

test('empty arrays are fine, and exportedAt is not required', () => {
  assert.deepEqual(readDocument({ app: 'Daybook', version: 1, events: [], tasks: [] }), { events: [], tasks: [] });
});

test('events: id and title must be strings', () => {
  for (const change of [{ id: 5 }, { id: null }, { title: 5 }, { title: null }]) {
    assert.equal(readDocument(withEvent(change)), null, JSON.stringify(change));
  }
  assert.equal(readDocument(doc([without(goodEvent(), 'id')])), null);
  assert.equal(readDocument(doc([without(goodEvent(), 'title')])), null);
  assert.equal(readDocument(doc(['not an event'])), null);
  assert.equal(readDocument(doc([null])), null);
});

test('events: days must be valid and in order', () => {
  for (const change of [
    { startDay: '2026-02-30', endDay: '2026-03-01' },
    { startDay: '11/05/2026' },
    { startDay: '2026-11-5' },
    { endDay: '2026-13-01' },
    { startDay: null },
    { endDay: 20261105 },
    { startDay: '2026-11-06', endDay: '2026-11-05', startMinutes: 0, endMinutes: 1 },
  ]) {
    assert.equal(readDocument(withEvent(change)), null, JSON.stringify(change));
  }
  assert.equal(readDocument(doc([without(goodEvent(), 'startDay')])), null);
  assert.equal(readDocument(doc([without(goodEvent(), 'endDay')])), null);
});

test('events: minutes must be in range or missing', () => {
  for (const change of [
    { startMinutes: -1 }, { startMinutes: 1440 }, { endMinutes: 1440 }, { endMinutes: -5 },
    { startMinutes: 870.5 }, { startMinutes: '870' }, { endMinutes: true },
  ]) {
    assert.equal(readDocument(withEvent(change)), null, JSON.stringify(change));
  }
  // Edges of the range.
  const edge = readDocument(withEvent({ startMinutes: 0, endMinutes: 1439 }));
  assert.equal(edge.events[0].startMinutes, 0);
  assert.equal(edge.events[0].endMinutes, 1439);
});

test('events: on one day, the end can not be before the start', () => {
  assert.equal(readDocument(withEvent({ startMinutes: 600, endMinutes: 599 })), null);
  assert.ok(readDocument(withEvent({ startMinutes: 600, endMinutes: 600 })));
  // Across days it can be numerically smaller.
  assert.ok(readDocument(withEvent({ startMinutes: 1380, endDay: '2026-11-06', endMinutes: 60 })));
});

test('events: all-day minutes may be null or absent, and read back as null', () => {
  const asNull = readDocument(withEvent({ allDay: true, startMinutes: null, endMinutes: null })).events[0];
  const absent = readDocument(doc([without(without({ ...goodEvent(), allDay: true }, 'startMinutes'), 'endMinutes')])).events[0];
  assert.equal(asNull.startMinutes, null);
  assert.equal(asNull.endMinutes, null);
  assert.deepEqual(absent, asNull);
});

test('events: all-day with leftover minutes drops them', () => {
  const event = readDocument(withEvent({ allDay: true })).events[0];
  assert.equal(event.startMinutes, null);
  assert.equal(event.endMinutes, null);
});

test('events: timed with no minutes at all reads as all-day; a missing side falls back to the day edge', () => {
  const none = readDocument(doc([{ id: 'x', title: 'X', allDay: false, startDay: '2026-11-05', endDay: '2026-11-05' }]));
  assert.equal(none.events[0].allDay, true);
  const noEnd = readDocument(doc([{ id: 'x', title: 'X', allDay: false, startDay: '2026-11-05', startMinutes: 60, endDay: '2026-11-05' }]));
  assert.equal(noEnd.events[0].allDay, false);
  assert.equal(noEnd.events[0].endMinutes, 1439);
  const noStart = readDocument(doc([{ id: 'x', title: 'X', allDay: false, startDay: '2026-11-05', endDay: '2026-11-05', endMinutes: 60 }]));
  assert.equal(noStart.events[0].startMinutes, 0);
  assert.equal(noStart.events[0].endMinutes, 60);
});

test('events: allDay may be missing, but anything else than a boolean rejects', () => {
  const timed = readDocument(doc([without(goodEvent(), 'allDay')])).events[0];
  assert.equal(timed.allDay, false);
  assert.equal(readDocument(withEvent({ allDay: 'yes' })), null);
  assert.equal(readDocument(withEvent({ allDay: 1 })), null);
});

test('notes may be absent, read as empty; other types reject', () => {
  assert.equal(readDocument(doc([without(goodEvent(), 'notes')])).events[0].notes, '');
  assert.equal(readDocument(doc(undefined, [without(goodTask(), 'notes')])).tasks[0].notes, '');
  assert.equal(readDocument(withEvent({ notes: 5 })), null);
  assert.equal(readDocument(withTask({ notes: {} })), null);
});

test('tasks: id, title and assignedAt are required and checked', () => {
  for (const change of [
    { id: 1 }, { title: 1 }, { assignedAt: null }, { assignedAt: 5 }, { assignedAt: '' },
    { assignedAt: 'yesterday' }, { assignedAt: 'Nov 1 2026' }, { assignedAt: '2026-10-29' },
    { assignedAt: '2026-10-29T13:00:00' }, { assignedAt: '2026-02-30T13:00:00Z' },
    { assignedAt: '2026-10-29T25:00:00Z' }, { assignedAt: '2026-10-29T13:60:00Z' }, { assignedAt: '2026-10-29T13:00:60Z' },
  ]) {
    assert.equal(readDocument(withTask(change)), null, JSON.stringify(change));
  }
  assert.equal(readDocument(doc(undefined, [without(goodTask(), 'id')])), null);
  assert.equal(readDocument(doc(undefined, [without(goodTask(), 'title')])), null);
  assert.equal(readDocument(doc(undefined, [without(goodTask(), 'assignedAt')])), null);
  assert.equal(readDocument(doc(undefined, ['nope'])), null);
});

test('tasks: completedAt may be null or absent, otherwise must be a valid instant', () => {
  assert.equal(readDocument(doc(undefined, [without(goodTask(), 'completedAt')])).tasks[0].completedAt, null);
  assert.equal(readDocument(withTask({ completedAt: null })).tasks[0].completedAt, null);
  assert.equal(readDocument(withTask({ completedAt: 'soon' })), null);
  assert.equal(readDocument(withTask({ completedAt: 5 })), null);
  assert.equal(readDocument(withTask({ completedAt: false })), null);
});

test('instants: with and without fractional seconds, and always written with them', () => {
  assert.equal(parseInstant('2026-09-01T08:15:30Z'), Date.UTC(2026, 8, 1, 8, 15, 30));
  assert.equal(parseInstant('2026-09-01T08:15:30.000Z'), Date.UTC(2026, 8, 1, 8, 15, 30));
  assert.equal(parseInstant('2026-09-01T08:15:30.250Z'), Date.UTC(2026, 8, 1, 8, 15, 30, 250));
  assert.equal(parseInstant('2026-09-01T08:15:30.5Z'), Date.UTC(2026, 8, 1, 8, 15, 30, 500));
  assert.equal(parseInstant('2026-09-01T08:15:30.123456Z'), Date.UTC(2026, 8, 1, 8, 15, 30, 123));
  assert.equal(parseInstant('2026-09-01T08:15:30+02:00'), Date.UTC(2026, 8, 1, 6, 15, 30));
  assert.equal(parseInstant('2026-09-01T08:15:30-05:30'), Date.UTC(2026, 8, 1, 13, 45, 30));
  const read = readDocument(withTask({ assignedAt: '2026-09-01T08:15:30Z', completedAt: '2026-09-02T00:00:00Z' })).tasks[0];
  assert.equal(read.assignedAt, '2026-09-01T08:15:30.000Z');
  assert.equal(read.completedAt, '2026-09-02T00:00:00.000Z');
});

test('instants too near the ends of the four-digit years are refused', () => {
  // These two normalise to +010000-01-01T00:00:59.000Z and -000001-12-31T23:59:00.000Z, which the pattern refuses on
  // the way back in: accepting them would make the whole store unreadable on the next load.
  for (const instant of ['9999-12-31T23:59:59-00:01', '0000-01-01T00:00:00+00:01']) {
    assert.equal(parseInstant(instant), null, instant);
    assert.equal(readDocument(withTask({ assignedAt: instant })), null, instant);
    assert.equal(readDocument(withTask({ completedAt: instant })), null, instant);
  }
  // And these are local dates in a year the calendar can't write, somewhere on Earth.
  for (const instant of ['0000-01-01T00:00:00.000Z', '0000-12-31T23:59:59.999Z', '9999-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
    assert.equal(parseInstant(instant), null, instant);
  }
});

test('any instant that reads is written so that it reads again, and has a local day, in any zone', () => {
  const edges = ['0001-01-01T00:00:00Z', '0001-01-01T00:00:00.000Z', '9998-12-31T23:59:59.999Z', '9998-12-31T23:59:59Z', '2026-11-01T06:30:00Z', '1004-02-29T00:00:00Z'];
  for (const instant of edges) {
    const ms = parseInstant(instant);
    assert.notEqual(ms, null, instant);
    const task = readDocument(withTask({ assignedAt: instant, completedAt: instant })).tasks[0];
    assert.equal(parseInstant(task.assignedAt), ms, instant);
    assert.notEqual(parseDocument(stringifyDocument({ events: [], tasks: [task] })), null, instant);
    assert.ok(Day.isValid(Day.fromDate(new Date(ms))), `${instant} in ${process.env.TZ}`);
    assert.doesNotThrow(() => doneLine(task, Date.now()), instant);
  }
});

test('duplicate ids keep the first', () => {
  const events = [{ ...goodEvent(), title: 'First' }, { ...goodEvent(), title: 'Second' }];
  const tasks = [{ ...goodTask(), title: 'First' }, { ...goodTask(), title: 'Second' }];
  const data = readDocument(doc(events, tasks));
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].title, 'First');
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, 'First');
});

test('ids are opaque: case is preserved, and differing case is a different id', () => {
  const tasks = [{ ...goodTask(), id: 'AbC' }, { ...goodTask(), id: 'abc' }];
  assert.deepEqual(readDocument(doc(undefined, tasks)).tasks.map((task) => task.id), ['AbC', 'abc']);
});

test('one bad item rejects the entire file', () => {
  assert.equal(readDocument(doc([goodEvent(), { ...goodEvent(), id: 'e2', startDay: 'nope' }])), null);
  assert.equal(readDocument(doc(undefined, [goodTask(), { ...goodTask(), id: 't2', assignedAt: 'nope' }])), null);
});

test('unknown fields are ignored, and dropped', () => {
  const data = readDocument({
    ...doc([{ ...goodEvent(), color: 'blue' }], [{ ...goodTask(), priority: 3 }]),
    somethingFromTheFuture: { ignored: true },
  });
  assert.deepEqual(data.events, [goodEvent()]);
  assert.deepEqual(data.tasks, [goodTask()]);
});

test('text that is not JSON rejects', () => {
  for (const text of ['', 'hello', '{', '[]', 'null', '{"app":"Daybook"}', '<html></html>']) {
    assert.equal(parseDocument(text), null, text);
  }
});

test('the shared fixture loads, with all its quirks', () => {
  const data = parseDocument(FIXTURE);
  assert.ok(data, 'fixture is valid');
  assert.equal(data.events.length, 5);
  assert.equal(data.tasks.length, 3);

  const byId = new Map(data.events.map((event) => [event.id, event]));

  // Uppercase id: case preserved.
  assert.equal(data.events[1].id, 'ABCDEF12-3456-7890-ABCD-EF1234567890');
  // CJK and emoji survive, notes absent reads as empty, null minutes.
  assert.equal(data.events[1].title, '写作业 ✏️');
  assert.equal(data.events[1].notes, '');
  assert.equal(data.events[1].allDay, true);
  assert.equal(data.events[1].startMinutes, null);
  // Minutes entirely absent on an all-day event.
  const trip = byId.get('trip-without-minutes');
  assert.equal(trip.startMinutes, null);
  assert.equal(trip.endMinutes, null);
  assert.equal(agendaFor(data.events, '2026-11-26').length, 0);
  assert.deepEqual(agendaFor(data.events, '2026-11-27').map((event) => event.id), ['trip-without-minutes']);
  assert.deepEqual(agendaFor(data.events, '2026-12-02').map((event) => event.id), ['trip-without-minutes']);
  assert.equal(agendaFor(data.events, '2026-12-03').length, 0);
  // The party ends exactly at midnight, so it's not on New Year's Day.
  assert.deepEqual(agendaFor(data.events, '2026-12-31').map((event) => event.id), ['party-ends-at-midnight']);
  assert.equal(agendaFor(data.events, '2027-01-01').length, 0);
  assert.equal(timeLine(byId.get('party-ends-at-midnight'), '2026-12-31'), '8:00 PM – 12:00 AM');
  // The late show crosses midnight, so it's on both days.
  const show = byId.get('late-show-crosses-midnight');
  assert.equal(timeLine(show, '2026-11-13'), 'Starts 11:00 PM');
  assert.equal(timeLine(show, '2026-11-14'), 'Ends 1:00 AM');
  // Dentist.
  const dentist = byId.get('9f3c1a52-7b1e-4c9d-8f10-2a6d5e4b3c21');
  assert.equal(timeLine(dentist, '2026-11-05'), '2:30 PM – 3:30 PM');
  assert.equal(dentist.notes, 'Bring the insurance card');

  // Tasks: mixed-case ids that differ only in case stay distinct and untouched.
  assert.equal(data.tasks[0].id, '1b7e6c1a-0000-4000-8000-000000000001');
  assert.equal(data.tasks[1].id, '1B7E6C1A-0000-4000-8000-000000000002');
  // No fractional seconds; notes and completedAt absent.
  assert.equal(data.tasks[1].assignedAt, '2026-09-01T08:15:30.000Z');
  assert.equal(data.tasks[1].notes, '');
  assert.equal(data.tasks[1].completedAt, null);
  // Three fractional digits.
  assert.equal(data.tasks[2].completedAt, '2026-10-23T17:45:12.250Z');
  // Oldest open first.
  assert.deepEqual(
    sortOpen(data.tasks.filter((task) => !task.completedAt)).map((task) => task.title),
    ['Reply to Coach', 'Finish the essay'],
  );
  // Took three days.
  assert.match(doneLine(data.tasks[2], Date.UTC(2026, 10, 1)), /^Done Oct 2[34] · took 3 days$/);
});

test('round trip: read, write, read again gives the same data', () => {
  const first = parseDocument(FIXTURE);
  const written = stringifyDocument(first, new Date('2026-11-01T20:00:00.000Z'));
  const second = parseDocument(written);
  assert.deepEqual(second, first);
  // And writing again is byte-identical.
  assert.equal(stringifyDocument(second, new Date('2026-11-01T20:00:00.000Z')), written);
});

test('what gets written follows the format', () => {
  const data = parseDocument(FIXTURE);
  const written = JSON.parse(stringifyDocument(data, new Date('2026-11-01T20:00:00.000Z')));
  assert.equal(written.app, 'Daybook');
  assert.equal(written.version, 1);
  assert.equal(written.exportedAt, '2026-11-01T20:00:00.000Z');
  assert.equal('somethingFromTheFuture' in written, false);
  for (const task of written.tasks) {
    assert.match(task.assignedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(task.completedAt === null || /\.\d{3}Z$/.test(task.completedAt));
    assert.deepEqual(Object.keys(task), ['id', 'title', 'notes', 'assignedAt', 'completedAt']);
  }
  for (const event of written.events) {
    assert.deepEqual(Object.keys(event), ['id', 'title', 'notes', 'allDay', 'startDay', 'startMinutes', 'endDay', 'endMinutes']);
    if (event.allDay) {
      assert.equal(event.startMinutes, null);
      assert.equal(event.endMinutes, null);
    }
  }
});
