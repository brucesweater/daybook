// Test data: the shared fixture, and messy real-life data for layout checks.

import { readFileSync } from 'node:fs';

export const FIXTURE_PATH = new URL('../fixtures/daybook-sample.json', import.meta.url).pathname;
export const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function doc(events = [], tasks = []) {
  return { app: 'Daybook', version: 1, exportedAt: new Date(0).toISOString(), events, tasks };
}

export function event(id, title, startDay, startMinutes, endDay = startDay, endMinutes = startMinutes + 60, notes = '') {
  return { id, title, notes, allDay: false, startDay, startMinutes, endDay, endMinutes };
}

export function allDayEvent(id, title, startDay, endDay = startDay, notes = '') {
  return { id, title, notes, allDay: true, startDay, startMinutes: null, endDay, endMinutes: null };
}

export function task(id, title, elapsed, now, { notes = '', doneAfter = null } = {}) {
  const assigned = now - elapsed;
  return {
    id,
    title,
    notes,
    assignedAt: new Date(assigned).toISOString(),
    completedAt: doneAfter === null ? null : new Date(assigned + doneAfter).toISOString(),
  };
}

const LONG_WORD = 'Supercalifragilisticexpialidocious'.repeat(4);
const LONG_TITLE = 'Write the long-overdue letter to the housing office about the radiator on the third floor that has been knocking every single night since the start of October';

/** Long titles, 40 tasks, five events on `day` (a local day), notes everywhere. */
export function messyData(now, day) {
  const events = [
    allDayEvent('m-e1', LONG_TITLE, day),
    allDayEvent('m-e2', 'Holiday market downtown', day),
    event('m-e3', LONG_WORD, day, 480, day, 540, 'Notes that go on and on '.repeat(10)),
    event('m-e4', '写作业 ✏️ 明天要交的作文和数学卷子', day, 780, day, 840),
    event('m-e5', 'Overlaps the one before it', day, 780, day, 1439),
  ];
  const tasks = [];
  for (let i = 0; i < 40; i += 1) {
    const title = i === 3 ? LONG_WORD : i === 7 ? LONG_TITLE : i === 11 ? '整理房间，然后给奶奶打电话 ☎️' : `Task number ${i + 1}`;
    tasks.push(task(`m-t${i}`, title, (40 - i) * 2 * DAY + i * HOUR, now, { notes: i % 5 === 0 ? 'Some notes that are long enough that they certainly will not fit on one line of even the widest of cards' : '' }));
  }
  for (let i = 0; i < 12; i += 1) {
    tasks.push(task(`m-d${i}`, i === 2 ? LONG_TITLE : `Finished thing ${i + 1}`, (i + 1) * 3 * DAY, now, { doneAfter: (i + 1) * HOUR * 7 }));
  }
  return doc(events, tasks);
}
