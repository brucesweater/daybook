import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countText, doneLine, fieldsToInstant, instantToFields, notesPreview, sortDone, sortOpen } from '../../docs/js/tasks.js';

const task = (id, assignedAt, completedAt = null) => ({ id, title: id, notes: '', assignedAt, completedAt });

test('open tasks sort oldest first, across fractional and plain seconds', () => {
  const sorted = sortOpen([
    task('newer', '2026-10-29T13:00:00.500Z'),
    task('oldest', '2026-09-01T08:15:30.000Z'),
    task('middle', '2026-10-29T13:00:00.000Z'),
  ]);
  assert.deepEqual(sorted.map((t) => t.id), ['oldest', 'middle', 'newer']);
});

test('tasks added in the same millisecond keep the order they were added', () => {
  const at = '2026-10-29T13:00:00.000Z';
  assert.deepEqual(sortOpen([task('a', at), task('b', at), task('c', at)]).map((t) => t.id), ['a', 'b', 'c']);
});

test('completed tasks sort newest-done first', () => {
  const sorted = sortDone([
    task('old', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
    task('new', '2026-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
    task('mid', '2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(sorted.map((t) => t.id), ['new', 'mid', 'old']);
});

test('count text', () => {
  const a = '2026-10-29T13:00:00.000Z';
  assert.equal(countText([]), '');
  assert.equal(countText([task('a', a)]), '1 open');
  assert.equal(countText([task('a', a), task('b', a), task('c', a), task('d', a, a)]), '3 open');
  assert.equal(countText([task('d', a, a)]), 'All done');
});

test('done line wording and year rule', () => {
  // Noon UTC on these days stays on the same calendar day in zones from UTC-11 to UTC+11.
  const now = Date.UTC(2026, 10, 1, 12);
  const line = (assignedAt, completedAt) => doneLine(task('x', assignedAt, completedAt), now);
  assert.equal(line('2026-10-28T12:00:00Z', '2026-10-31T12:00:00Z'), 'Done Oct 31 · took 3 days');
  assert.equal(line('2026-10-31T12:00:00Z', '2026-10-31T12:00:30Z'), 'Done Oct 31 · took under a minute');
  assert.equal(line('2026-10-31T12:00:00Z', '2026-10-31T12:05:00Z'), 'Done Oct 31 · took 5 minutes');
  assert.equal(line('2026-10-31T11:00:00Z', '2026-10-31T12:00:00Z'), 'Done Oct 31 · took 1 hour');
  assert.equal(line('2026-10-17T12:00:00Z', '2026-10-31T12:00:00Z'), 'Done Oct 31 · took 2 weeks');
  assert.equal(line('2026-09-01T12:00:00Z', '2026-10-31T12:00:00Z'), 'Done Oct 31 · took 2 months');
  assert.equal(line('2025-10-31T12:00:00Z', '2026-10-31T12:00:00Z'), 'Done Oct 31 · took 1 year');
  assert.equal(line('2025-10-30T12:00:00Z', '2025-10-31T12:00:00Z'), 'Done Oct 31, 2025 · took 1 day');
});

test('a task finished before it was assigned took under a minute', () => {
  const now = Date.UTC(2026, 10, 1, 12);
  const line = doneLine(task('x', '2026-10-31T12:00:00Z', '2026-10-30T12:00:00Z'), now);
  assert.equal(line, 'Done Oct 30 · took under a minute');
});

test('notes preview is the first line', () => {
  assert.equal(notesPreview('Two pages'), 'Two pages');
  // More lines follow: … says so, the way the iOS app's one-line notes end.
  assert.equal(notesPreview('First\nSecond'), 'First…');
  assert.equal(notesPreview('First\r\nSecond'), 'First…');
  assert.equal(notesPreview('\n\n  First\nSecond'), 'First…');
  assert.equal(notesPreview('Only line\n\n'), 'Only line');
  assert.equal(notesPreview(''), '');
});

test('assigned fields round trip through local time', () => {
  const iso = new Date(2026, 9, 29, 8, 15).toISOString();
  assert.deepEqual(instantToFields(iso), { day: '2026-10-29', time: '08:15' });
  const now = Date.UTC(2030, 0, 1);
  assert.equal(fieldsToInstant('2026-10-29', '08:15', now), iso);
});

test('assigned fields can not be in the future: they stop at now', () => {
  const now = new Date(2026, 10, 1, 15, 5, 30).getTime();
  assert.equal(fieldsToInstant('2026-11-02', '09:00', now), new Date(now).toISOString());
  assert.equal(fieldsToInstant('2026-11-01', '15:06', now), new Date(now).toISOString());
  assert.equal(fieldsToInstant('2026-11-01', '15:05', now), new Date(2026, 10, 1, 15, 5).toISOString());
});

test('assigned fields that are not complete give null', () => {
  const now = Date.UTC(2030, 0, 1);
  assert.equal(fieldsToInstant('', '09:00', now), null);
  assert.equal(fieldsToInstant('2026-11-02', '', now), null);
  assert.equal(fieldsToInstant('2026-02-30', '09:00', now), null);
});
