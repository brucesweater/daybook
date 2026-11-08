// Fictional data for ?demo, relative to now. It lives in memory only and is never saved.

import * as Day from './calendar-day.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function demoData(now = new Date()) {
  const today = Day.fromDate(now);
  const on = (offset) => Day.addDays(today, offset);
  const nowMs = now.getTime();
  const ago = (elapsed) => new Date(nowMs - elapsed).toISOString();

  let nextId = 1;
  const id = (kind) => `demo-${kind}-${nextId++}`;

  const timed = (title, startOffset, startMinutes, endOffset, endMinutes, notes = '') => ({
    id: id('event'),
    title,
    notes,
    allDay: false,
    startDay: on(startOffset),
    startMinutes,
    endDay: on(endOffset),
    endMinutes,
  });
  const allDay = (title, startOffset, endOffset = startOffset, notes = '') => ({
    id: id('event'),
    title,
    notes,
    allDay: true,
    startDay: on(startOffset),
    startMinutes: null,
    endDay: on(endOffset),
    endMinutes: null,
  });

  const task = (title, assigned, notes = '', done = null) => ({
    id: id('task'),
    title,
    notes,
    assignedAt: ago(assigned),
    completedAt: done === null ? null : ago(done),
  });

  return {
    events: [
      allDay('Farmers market', 0),
      timed('Design review', 0, 600, 0, 660, 'Second floor, the room with the plants'),
      timed('Dentist', 0, 870, 0, 930, 'Bring the insurance card'),
      timed('Dinner with the neighbors', 0, 1110, 0, 1230),
      timed('Piano lesson', 1, 960, 1, 1020),
      timed('Book club', 3, 1140, 3, 1260, 'This month: the one about the lighthouse'),
      timed('Late show at the Orpheum', 4, 1350, 5, 45),
      allDay('Long weekend at the lake', 6, 8, 'Pack the kayak'),
      timed('Car inspection', 10, 510, 10, 570),
      timed('Haircut', 13, 720, 13, 750),
      timed('Team offsite', -3, 540, -3, 1020),
      allDay('Library books due', -6),
      timed('Parent-teacher night', -9, 1080, -9, 1170),
    ],
    tasks: [
      task('Renew passport', 96 * DAY, 'Photos are in the top drawer'),
      task('Back up the old laptop', 38 * DAY),
      task('Call the landlord about the radiator', 16 * DAY),
      task('Return the blue jacket', 9 * DAY, 'Receipt is in the glove box'),
      task('Finish the history essay', 3 * DAY, 'Two pages, double spaced'),
      task('Book flights for spring break', 5 * HOUR),
      task('Buy oat milk', 12 * MINUTE),
      task('Pay the electric bill', 4 * DAY, '', 22 * HOUR),
      task('Send thank-you notes', 19 * DAY, '', 3 * DAY),
      task('Schedule the eye exam', 31 * DAY, '', 8 * DAY),
      task('Water the ferns', 2 * DAY, '', 2 * DAY - 25 * MINUTE),
    ],
  };
}
