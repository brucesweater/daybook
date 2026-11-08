// Backups that really crossed between the two products, so the website and the iOS app stay able to swap data.
//
// fixtures/ios-export.json is what the iOS app's own export wrote (its InteropTests make it), and fixtures/web-export.json
// is this site's export through its interface in Chrome (`node test/make-web-export.mjs`). The iOS app's tests load
// identical copies of both from ~/Developer/Daybook/Fixtures/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument, stringifyDocument } from '../../docs/js/schema.js';
import { agendaFor, timeLine } from '../../docs/js/events.js';
import { doneLine, sortDone, sortOpen } from '../../docs/js/tasks.js';
import { ageText } from '../../docs/js/wording.js';

const read = (name) => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');
const IOS = read('ios-export');
const WEB = read('web-export');
// Every task in the iOS sample was checked off between 08:00 and 15:00 UTC, so its Done day is the same in all three
// test zones. At this instant it is November 5 in all three too.
const NOW = Date.parse('2026-11-05T12:00:00.000Z');

test('the iOS app’s export passes the validator, field for field, and goes back unchanged', () => {
  const data = parseDocument(IOS);
  assert.ok(data, 'the validator accepts it');
  const raw = JSON.parse(IOS);
  assert.equal(data.events.length, 11);
  assert.equal(data.tasks.length, 7);
  assert.deepEqual(data.events, raw.events);
  assert.deepEqual(data.tasks, raw.tasks);
  const again = JSON.parse(stringifyDocument(data));
  assert.deepEqual(again.events, raw.events);
  assert.deepEqual(again.tasks, raw.tasks);
});

test('the iOS app’s events read the same here: days, time lines, the midnight rule', () => {
  const { events } = parseDocument(IOS);
  const agenda = (day) => agendaFor(events, day).map((event) => `${event.title} | ${timeLine(event, day)}`);
  assert.deepEqual(agenda('2026-11-01'), ['Red-eye ✈️ | Starts 11:30 PM']);
  assert.deepEqual(agenda('2026-11-02'), ['Red-eye ✈️ | Ends 6:45 AM', '🌃 夜市 Night market | 8:00 PM – 12:00 AM']);
  assert.deepEqual(agenda('2026-11-03'), [], 'the night market ends exactly at midnight');
  assert.deepEqual(agenda('2026-11-04'), ['Sunrise yoga | 6:00 AM – 7:00 AM']);
  assert.deepEqual(agenda('2026-11-07'), ['写作业 ✏️ | All day']);
  assert.deepEqual(agenda('2026-11-09'), ['Workshop 🧪 实验 | Starts 9:00 AM']);
  assert.deepEqual(agenda('2026-11-10'), ['Workshop 🧪 实验 | All day']);
  assert.deepEqual(agenda('2026-11-11'), ['Workshop 🧪 实验 | Ends 5:30 PM']);
  assert.deepEqual(agenda('2026-12-31'), ['Ski week ⛷️ スキー | All day', 'Party | 8:00 PM – 12:00 AM']);
  assert.deepEqual(agenda('2027-01-01'), ['Ski week ⛷️ スキー | All day']);
  assert.deepEqual(agenda('2027-01-03'), []);
  assert.deepEqual(agenda('2027-03-14'), ['DST check 🕑 | 2:30 AM – 3:15 AM']);
  assert.equal(events.find((event) => event.title === '🌃 夜市 Night market').notes, '多行\nnotes ✨');
  assert.equal(timeLine(events.find((event) => event.title === 'DST check 🕑'), '2027-03-14', true), '02:30 – 03:15');
});

test('the iOS app’s tasks read the same here: order, age lines, done lines', () => {
  const { tasks } = parseDocument(IOS);
  const open = sortOpen(tasks.filter((task) => !task.completedAt));
  assert.deepEqual(open.map((task) => `${task.title} | ${ageText(Date.parse(task.assignedAt), NOW)}`), [
    'Reply to Coach | Assigned 2 months ago',
    'Return library books | Assigned 2 weeks ago',
    'Finish the essay | Assigned 6 days ago',
    '📔 写日记 | Assigned 4 days ago',
    'Buy “good” <paper> & pens | Assigned 2 days ago',
  ]);
  const done = sortDone(tasks.filter((task) => task.completedAt));
  assert.deepEqual(done.map((task) => `${task.title} | ${doneLine(task, NOW)}`), [
    'Pack for 🇯🇵 trip — 東京 | Done Nov 4 · took 2 days',
    'Old year ✓ 旧年 | Done Dec 31, 2025 · took 1 day',
  ]);
});

test('same-time events tie on the title, compared the way the iOS app compares it (its InteropTests hold this list)', () => {
  const titles = ['apple', 'Apple', 'Éclair', 'eclair', 'Item 10', 'Item 9', 'Zed', 'zebra', 'Ab', 'a b', 'Äpfel', '写作业', '🎂 Party', '123', 'ápple'];
  const events = titles.map((title, index) => ({
    id: `tie-${String(index).padStart(2, '0')}`, title, notes: '', allDay: false,
    startDay: '2026-11-20', startMinutes: 600, endDay: '2026-11-20', endMinutes: 660,
  }));
  assert.deepEqual(agendaFor(events, '2026-11-20').map((event) => event.title), [
    '🎂 Party', '123', 'a b', 'Ab', 'Äpfel', 'apple', 'Apple', 'ápple', 'Éclair', 'eclair', 'Item 9', 'Item 10',
    'zebra', 'Zed', '写作业',
  ]);
});

test('a file the iOS app refuses is refused here too: half an emoji anywhere (its InteropTests check the same)', () => {
  const file = (field, raw) => JSON.stringify({
    app: 'Daybook', version: 1, events: [],
    tasks: [{ id: 't', title: 'T', notes: 'N', assignedAt: '2026-10-29T13:00:00Z', [field]: 'X' }],
  }).replace('"X"', raw);
  assert.ok(parseDocument(file('title', '"\\ud83d\\ude00"')), 'an escaped surrogate pair is 😀');
  assert.equal(parseDocument(file('title', '"\\ud83d\\ude00"')).tasks[0].title, '😀');
  for (const [field, raw] of [['title', '"\\ud83d"'], ['id', '"a\\udc00"'], ['notes', '"\\ud800x"']]) {
    assert.equal(parseDocument(file(field, raw)), null, `${field} ${raw}`);
  }
});

test('this site’s own export is still exactly what it writes', () => {
  const data = parseDocument(WEB);
  assert.ok(data);
  assert.equal(stringifyDocument(data, new Date(JSON.parse(WEB).exportedAt)), WEB);
});
