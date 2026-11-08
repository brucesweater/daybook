import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Format from '../../docs/js/format.js';

test('month and weekday names are English', () => {
  assert.equal(Format.monthName(1), 'January');
  assert.equal(Format.monthName(11), 'November');
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(Format.weekdayName),
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  );
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(Format.weekdayLetter), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
});

test('agenda titles', () => {
  assert.equal(Format.longDay('2026-11-01'), 'Sunday, November 1');
  assert.equal(Format.agendaTitle('2026-11-01', '2026-11-01'), 'Today · Sunday, November 1');
  assert.equal(Format.agendaTitle('2026-11-05', '2026-11-01'), 'Thursday, November 5');
});

test('grid labels', () => {
  assert.equal(Format.dayLabel('2026-11-05', 0), 'Thursday, November 5');
  assert.equal(Format.dayLabel('2026-11-05', 1), 'Thursday, November 5, 1 event');
  assert.equal(Format.dayLabel('2026-11-05', 2), 'Thursday, November 5, 2 events');
});

test('short days', () => {
  assert.equal(Format.shortDay('2026-10-31'), 'Oct 31');
  assert.equal(Format.shortDay('2025-10-31', true), 'Oct 31, 2025');
  assert.equal(Format.shortDay('2026-09-03'), 'Sep 3');
});

test('12-hour times', () => {
  assert.equal(Format.timeText(0), '12:00 AM');
  assert.equal(Format.timeText(60), '1:00 AM');
  assert.equal(Format.timeText(719), '11:59 AM');
  assert.equal(Format.timeText(720), '12:00 PM');
  assert.equal(Format.timeText(840), '2:00 PM');
  assert.equal(Format.timeText(870), '2:30 PM');
  assert.equal(Format.timeText(1439), '11:59 PM');
});

test('24-hour times', () => {
  assert.equal(Format.timeText(0, true), '00:00');
  assert.equal(Format.timeText(60, true), '01:00');
  assert.equal(Format.timeText(840, true), '14:00');
  assert.equal(Format.timeText(1439, true), '23:59');
});

test('times are plain ASCII spaces, whatever the ICU version does', () => {
  assert.doesNotMatch(Format.timeText(840), /[  ]/);
});

test('every minute of the day formats to itself, so no hour is skipped or repeated', () => {
  const seen12 = new Set();
  const seen24 = new Set();
  for (let minutes = 0; minutes < 1440; minutes += 1) {
    seen12.add(Format.timeText(minutes));
    seen24.add(Format.timeText(minutes, true));
    assert.equal(Format.fieldToMinutes(Format.minutesToField(minutes)), minutes);
  }
  assert.equal(seen12.size, 1440);
  assert.equal(seen24.size, 1440);
});

test('time fields', () => {
  assert.equal(Format.minutesToField(0), '00:00');
  assert.equal(Format.minutesToField(870), '14:30');
  assert.equal(Format.fieldToMinutes('14:30'), 870);
  assert.equal(Format.fieldToMinutes('14:30:15'), 870);
  assert.equal(Format.fieldToMinutes(''), null);
  assert.equal(Format.fieldToMinutes(null), null);
  assert.equal(Format.fieldToMinutes('24:00'), null);
  assert.equal(Format.fieldToMinutes('12:60'), null);
});

test('12/24-hour choice comes from the locale', () => {
  assert.equal(Format.prefers24Hour('en-US'), false);
  assert.equal(Format.prefers24Hour('de-DE'), true);
  assert.equal(Format.prefers24Hour('en-GB'), true);
  assert.equal(Format.prefers24Hour('ja-JP'), true);
  assert.equal(Format.prefers24Hour('not a locale!'), false);
});

test('first weekday comes from the locale, Sunday as the fallback', () => {
  assert.equal(Format.firstWeekdayOf('en-US'), 0);
  assert.equal(Format.firstWeekdayOf('en-GB'), 1);
  assert.equal(Format.firstWeekdayOf('de-DE'), 1);
  assert.equal(Format.firstWeekdayOf('ja-JP'), 0);
  assert.equal(Format.firstWeekdayOf('not a locale!'), 0);
  assert.equal(Format.firstWeekdayOf(undefined), 0);
});

test('first weekday falls back to Sunday when the browser has no week data', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, 'getWeekInfo');
  const accessor = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, 'weekInfo');
  delete Intl.Locale.prototype.getWeekInfo;
  delete Intl.Locale.prototype.weekInfo;
  t.after(() => {
    if (descriptor) Object.defineProperty(Intl.Locale.prototype, 'getWeekInfo', descriptor);
    if (accessor) Object.defineProperty(Intl.Locale.prototype, 'weekInfo', accessor);
  });
  assert.equal(Format.firstWeekdayOf('de-DE'), 0);
});

test('backup filename', () => {
  assert.equal(Format.backupFilename('2026-11-01'), 'daybook-backup-2026-11-01.json');
});

test('the import question', () => {
  assert.equal(
    Format.importQuestion({ events: new Array(4), tasks: new Array(9) }),
    'Replace everything here with 4 events and 9 tasks from this backup?',
  );
  assert.equal(
    Format.importQuestion({ events: new Array(1), tasks: new Array(1) }),
    'Replace everything here with 1 event and 1 task from this backup?',
  );
  assert.equal(
    Format.importQuestion({ events: [], tasks: [] }),
    'Replace everything here with 0 events and 0 tasks from this backup?',
  );
});
