// The Daybook file format, version 1. It is both the localStorage format and the backup format.
// parseDocument is the only way data gets in; anything it doesn't like rejects the entire file.

import * as Day from './calendar-day.js';

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

// The first and last years of the format are out of bounds for instants. An offset can carry one past the edge, and
// what gets written back wouldn't read again; and in some time zone its local day would be in a year that can't be written.
const FIRST_INSTANT = Date.parse('0001-01-01T00:00:00.000Z');
const LAST_INSTANT = Date.parse('9998-12-31T23:59:59.999Z');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMinute(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1439;
}

// JSON can spell half of an emoji ("\ud83d"), and JavaScript keeps it, but the iOS app can't read such a string and
// refuses the whole file. Refusing it here too means a file one product takes, the other takes as well.
const LONE_SURROGATE = /\p{Cs}/u;

function isText(value) {
  return typeof value === 'string' && !LONE_SURROGATE.test(value);
}

function isOptionalString(value) {
  return value === undefined || value === null || isText(value);
}

/**
 * An ISO 8601 instant → milliseconds since the epoch, or null. Written out rather than trusting Date.parse,
 * which accepts almost anything and rolls February 30 over into March in some browsers.
 */
export function parseInstant(value) {
  if (typeof value !== 'string') return null;
  const match = INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds, fraction = '', zone] = match;
  if (!Day.isValid(`${year}-${month}-${day}`)) return null;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hours), Number(minutes), Number(seconds), Number(`${fraction}000`.slice(0, 3)));
  const offsetHours = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinutes = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (offsetHours * 60 + offsetMinutes) * 60000;
  const instant = date.getTime() + (zone[0] === '-' ? offset : -offset);
  return instant >= FIRST_INSTANT && instant <= LAST_INSTANT ? instant : null;
}

function readEvent(raw) {
  if (!isObject(raw)) return null;
  const { id, title, notes, allDay, startDay, endDay } = raw;
  if (!isText(id) || !isText(title) || !isOptionalString(notes)) return null;
  if (allDay !== undefined && allDay !== null && typeof allDay !== 'boolean') return null;
  if (!Day.isValid(startDay) || !Day.isValid(endDay) || endDay < startDay) return null;

  const start = raw.startMinutes ?? null;
  const end = raw.endMinutes ?? null;
  if ((start !== null && !isMinute(start)) || (end !== null && !isMinute(end))) return null;
  if (startDay === endDay && start !== null && end !== null && end < start) return null;

  // A timed event needs times to be timed. With none it is all-day, and a missing side falls back to the
  // edge of its day.
  const isAllDay = allDay === true || (start === null && end === null);
  return {
    id,
    title,
    notes: notes ?? '',
    allDay: isAllDay,
    startDay,
    startMinutes: isAllDay ? null : (start ?? 0),
    endDay,
    endMinutes: isAllDay ? null : (end ?? 1439),
  };
}

function readTask(raw) {
  if (!isObject(raw)) return null;
  const { id, title, notes } = raw;
  if (!isText(id) || !isText(title) || !isOptionalString(notes)) return null;
  const assigned = parseInstant(raw.assignedAt);
  if (assigned === null) return null;
  const hasCompleted = raw.completedAt !== undefined && raw.completedAt !== null;
  const completed = hasCompleted ? parseInstant(raw.completedAt) : null;
  if (hasCompleted && completed === null) return null;
  return {
    id,
    title,
    notes: notes ?? '',
    // Always rewritten with fractional seconds, as writers on both platforms must.
    assignedAt: new Date(assigned).toISOString(),
    completedAt: completed === null ? null : new Date(completed).toISOString(),
  };
}

/** Reads a list, keeping the first of any duplicate id. Returns null if any item is invalid. */
function readList(rawList, readItem) {
  const seen = new Set();
  const items = [];
  for (const raw of rawList) {
    const item = readItem(raw);
    if (!item) return null;
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/** A parsed JSON value → `{ events, tasks }`, or null if it isn't a valid Daybook file. */
export function readDocument(value) {
  if (!isObject(value) || value.app !== 'Daybook' || value.version !== 1) return null;
  if (!Array.isArray(value.events) || !Array.isArray(value.tasks)) return null;
  const events = readList(value.events, readEvent);
  const tasks = readList(value.tasks, readTask);
  return events && tasks ? { events, tasks } : null;
}

/** A file's text → `{ events, tasks }`, or null. */
export function parseDocument(text) {
  try {
    return readDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Data → the JSON text of a Daybook file. */
export function stringifyDocument({ events, tasks }, now = new Date()) {
  return JSON.stringify({ app: 'Daybook', version: 1, exportedAt: now.toISOString(), events, tasks }, null, 2);
}
