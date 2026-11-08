// Rules for to-do tasks. Tasks are instants: assignedAt and completedAt are ISO 8601 UTC.

import * as Day from './calendar-day.js';
import { fieldToMinutes, minutesToField, shortDay } from './format.js';
import { durationText } from './wording.js';

const ms = (iso) => Date.parse(iso);

/** Oldest first, so what has waited longest stays on top. New tasks land at the bottom. */
export function sortOpen(tasks) {
  return [...tasks].sort((a, b) => ms(a.assignedAt) - ms(b.assignedAt));
}

/** Newest-done first. */
export function sortDone(tasks) {
  return [...tasks].sort((a, b) => ms(b.completedAt) - ms(a.completedAt));
}

/** `3 open`, `All done` when tasks exist and none are open, and nothing with no tasks at all. */
export function countText(tasks) {
  const open = tasks.filter((task) => !task.completedAt).length;
  if (open > 0) return `${open} open`;
  return tasks.length > 0 ? 'All done' : '';
}

/** `Done Oct 31 · took 3 days`. The year shows only if it isn't the current one. */
export function doneLine(task, nowMs) {
  const done = ms(task.completedAt);
  const day = Day.fromDate(new Date(done));
  const withYear = Day.parts(day).year !== new Date(nowMs).getFullYear();
  return `Done ${shortDay(day, withYear)} · took ${durationText(ms(task.assignedAt), done)}`;
}

/** The quiet line in a task's row: the first line of its notes, with … when more follows, as the iOS app shows it. */
export function notesPreview(notes) {
  const [first, ...more] = notes.trim().split(/\r?\n/);
  return more.length > 0 ? `${first}…` : first;
}

/** An instant → the local `{ day, time }` that date and time inputs hold. */
export function instantToFields(iso) {
  const date = new Date(iso);
  return { day: Day.fromDate(date), time: minutesToField(date.getHours() * 60 + date.getMinutes()) };
}

/**
 * Local date and time inputs → an instant, which can't be in the future. Returns null when the inputs
 * don't hold a complete date and time.
 */
export function fieldsToInstant(day, time, nowMs) {
  const minutes = fieldToMinutes(time);
  if (!Day.isValid(day) || minutes === null) return null;
  return new Date(Math.min(Day.toDate(day, minutes).getTime(), nowMs)).toISOString();
}
