// Names, dates and times as the interface shows them. The interface language is English; only the first
// weekday and the 12/24-hour choice come from the browser's locale.
//
// Days are formatted against UTC midnight in a UTC formatter, so the local zone (and its daylight saving)
// can't move a label. Event times are minutes on a fixed reference date, for the same reason.

import * as Day from './calendar-day.js';

const LOCALE = 'en-u-ca-gregory-nu-latn';

function utcFormatter(options) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options });
}

const MONTH_LONG = utcFormatter({ month: 'long' });
const WEEKDAY_LONG = utcFormatter({ weekday: 'long' });
const WEEKDAY_NARROW = utcFormatter({ weekday: 'narrow' });
const MONTH_DAY_LONG = utcFormatter({ month: 'long', day: 'numeric' });
const MONTH_DAY_SHORT = utcFormatter({ month: 'short', day: 'numeric' });
const MONTH_DAY_YEAR_SHORT = utcFormatter({ month: 'short', day: 'numeric', year: 'numeric' });
const TIME_12 = utcFormatter({ hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
const TIME_24 = utcFormatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A day as a UTC Date, for the formatters above only. */
function utcDate(day) {
  const { year, month, day: date } = Day.parts(day);
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, date);
  return result;
}

// January 1, 2001 is an arbitrary fixed day. UTC has no daylight saving.
const REFERENCE_DAY = Date.UTC(2001, 0, 1);

export function monthName(month) {
  return MONTH_LONG.format(utcDate(Day.make(2001, month, 1)));
}

/** Weekday number 0 (Sunday) to 6 → `Sunday`. */
export function weekdayName(weekday) {
  // January 7, 2001 was a Sunday.
  return WEEKDAY_LONG.format(utcDate(Day.make(2001, 1, 7 + weekday)));
}

/** Weekday number 0 (Sunday) to 6 → `S`. */
export function weekdayLetter(weekday) {
  return WEEKDAY_NARROW.format(utcDate(Day.make(2001, 1, 7 + weekday)));
}

/** `Sunday, November 1`. */
export function longDay(day) {
  return `${WEEKDAY_LONG.format(utcDate(day))}, ${MONTH_DAY_LONG.format(utcDate(day))}`;
}

/** The agenda header: `Today · Sunday, November 1`, or just the date on any other day. */
export function agendaTitle(day, today) {
  return day === today ? `Today · ${longDay(day)}` : longDay(day);
}

/** A grid day's accessible name: `Thursday, November 5, 2 events`. */
export function dayLabel(day, eventCount) {
  if (eventCount === 0) return longDay(day);
  return `${longDay(day)}, ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`;
}

/** `Oct 31`, or `Oct 31, 2025` with the year. */
export function shortDay(day, withYear = false) {
  return (withYear ? MONTH_DAY_YEAR_SHORT : MONTH_DAY_SHORT).format(utcDate(day));
}

/** Minutes after midnight → `2:00 PM` or `14:00`. */
export function timeText(minutes, uses24Hour = false) {
  const text = (uses24Hour ? TIME_24 : TIME_12).format(REFERENCE_DAY + minutes * 60000);
  // Some ICU versions put a narrow no-break space before PM.
  return text.replace(/[  ]/g, ' ');
}

/** Minutes after midnight → the `HH:MM` a time input holds. */
export function minutesToField(minutes) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A time input's value → minutes after midnight, or null if it isn't a complete time. */
export function fieldToMinutes(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Whether the locale writes times on a 24-hour clock. `undefined` means the browser's own locale. */
export function prefers24Hour(locale) {
  try {
    const options = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    if (options.hourCycle) return options.hourCycle === 'h23' || options.hourCycle === 'h24';
    if (typeof options.hour12 === 'boolean') return !options.hour12;
  } catch {
    // Fall through to 12-hour.
  }
  return false;
}

/** The locale's first day of the week, 0 (Sunday) to 6. Sunday when the browser can't say. */
export function firstWeekdayOf(locale) {
  try {
    const intlLocale = new Intl.Locale(locale);
    const info = typeof intlLocale.getWeekInfo === 'function' ? intlLocale.getWeekInfo() : intlLocale.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7;
  } catch {
    // Fall through to Sunday.
  }
  return 0;
}

/** `daybook-backup-2026-11-01.json`. */
export function backupFilename(day) {
  return `daybook-backup-${day}.json`;
}

function plural(number, noun) {
  return `${number} ${noun}${number === 1 ? '' : 's'}`;
}

/** The question asked before an import replaces everything. */
export function importQuestion({ events, tasks }) {
  return `Replace everything here with ${plural(events.length, 'event')} and ${plural(tasks.length, 'task')} from this backup?`;
}
