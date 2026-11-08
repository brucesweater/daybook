import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageText, ageTone, durationText } from '../../docs/js/wording.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 1, 18, 30);

const age = (elapsed) => ageText(NOW - elapsed, NOW);
const duration = (elapsed) => durationText(NOW, NOW + elapsed);

// Every row of the spec's table, with both sides of each boundary.
const TABLE = [
  [0, 'just now', 'under a minute'],
  [1, 'just now', 'under a minute'],
  [59 * SECOND, 'just now', 'under a minute'],
  [MINUTE - 1, 'just now', 'under a minute'],
  [MINUTE, '1 minute ago', '1 minute'],
  [2 * MINUTE - 1, '1 minute ago', '1 minute'],
  [2 * MINUTE, '2 minutes ago', '2 minutes'],
  [12 * MINUTE, '12 minutes ago', '12 minutes'],
  [HOUR - 1, '59 minutes ago', '59 minutes'],
  [HOUR, '1 hour ago', '1 hour'],
  [2 * HOUR - 1, '1 hour ago', '1 hour'],
  [2 * HOUR, '2 hours ago', '2 hours'],
  [5 * HOUR, '5 hours ago', '5 hours'],
  [DAY - 1, '23 hours ago', '23 hours'],
  [DAY, '1 day ago', '1 day'],
  [2 * DAY - 1, '1 day ago', '1 day'],
  [2 * DAY, '2 days ago', '2 days'],
  [3 * DAY, '3 days ago', '3 days'],
  [13 * DAY, '13 days ago', '13 days'],
  [14 * DAY - 1, '13 days ago', '13 days'],
  [14 * DAY, '2 weeks ago', '2 weeks'],
  [21 * DAY - 1, '2 weeks ago', '2 weeks'],
  [21 * DAY, '3 weeks ago', '3 weeks'],
  [56 * DAY, '8 weeks ago', '8 weeks'],
  [59 * DAY, '8 weeks ago', '8 weeks'],
  [60 * DAY - 1, '8 weeks ago', '8 weeks'],
  [60 * DAY, '2 months ago', '2 months'],
  [90 * DAY - 1, '2 months ago', '2 months'],
  [90 * DAY, '3 months ago', '3 months'],
  [360 * DAY, '12 months ago', '12 months'],
  [364 * DAY, '12 months ago', '12 months'],
  [365 * DAY - 1, '12 months ago', '12 months'],
  [365 * DAY, '1 year ago', '1 year'],
  [730 * DAY - 1, '1 year ago', '1 year'],
  [730 * DAY, '2 years ago', '2 years'],
  [3 * 365 * DAY, '3 years ago', '3 years'],
  [40 * 365 * DAY, '40 years ago', '40 years'],
];

test('age wording, the whole table', () => {
  for (const [elapsed, words] of TABLE) {
    assert.equal(age(elapsed), `Assigned ${words}`, `elapsed ${elapsed} ms`);
  }
});

test('duration wording, the same rounding', () => {
  for (const [elapsed, , words] of TABLE) {
    assert.equal(duration(elapsed), words, `elapsed ${elapsed} ms`);
  }
});

test('the spec examples, verbatim', () => {
  assert.equal(age(30 * SECOND), 'Assigned just now');
  assert.equal(age(MINUTE), 'Assigned 1 minute ago');
  assert.equal(age(12 * MINUTE), 'Assigned 12 minutes ago');
  assert.equal(age(HOUR), 'Assigned 1 hour ago');
  assert.equal(age(5 * HOUR), 'Assigned 5 hours ago');
  assert.equal(age(DAY), 'Assigned 1 day ago');
  assert.equal(age(13 * DAY), 'Assigned 13 days ago');
  assert.equal(age(14 * DAY), 'Assigned 2 weeks ago');
  assert.equal(age(56 * DAY), 'Assigned 8 weeks ago');
  assert.equal(age(60 * DAY), 'Assigned 2 months ago');
  assert.equal(age(360 * DAY), 'Assigned 12 months ago');
  assert.equal(age(365 * DAY), 'Assigned 1 year ago');
  assert.equal(age(3 * 365 * DAY), 'Assigned 3 years ago');
  assert.equal(duration(30 * SECOND), 'under a minute');
  assert.equal(duration(5 * MINUTE), '5 minutes');
  assert.equal(duration(HOUR), '1 hour');
  assert.equal(duration(3 * DAY), '3 days');
  assert.equal(duration(14 * DAY), '2 weeks');
  assert.equal(duration(60 * DAY), '2 months');
  assert.equal(duration(365 * DAY), '1 year');
});

test('elapsed never goes below zero', () => {
  assert.equal(ageText(NOW + 5 * HOUR, NOW), 'Assigned just now');
  assert.equal(durationText(NOW + 5 * HOUR, NOW), 'under a minute');
  assert.equal(ageTone(NOW + 40 * DAY, NOW), 'fresh');
});

test('age colour bands', () => {
  const tone = (elapsed) => ageTone(NOW - elapsed, NOW);
  assert.equal(tone(0), 'fresh');
  assert.equal(tone(6 * DAY), 'fresh');
  assert.equal(tone(7 * DAY - 1), 'fresh');
  assert.equal(tone(7 * DAY), 'warm');
  assert.equal(tone(29 * DAY), 'warm');
  assert.equal(tone(30 * DAY - 1), 'warm');
  assert.equal(tone(30 * DAY), 'old');
  assert.equal(tone(400 * DAY), 'old');
});
