// Rules for events: which days an event covers, how a day's agenda reads, and how the editor's Starts and
// Ends push on each other. Events are wall-clock: days plus minutes after local midnight, with no time zone.

import * as Day from './calendar-day.js';
import { timeText } from './format.js';

const MINUTES_PER_DAY = 1440;
const titleOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** One day before endDay for a timed event ending exactly at midnight, so it doesn't show on the next day. */
export function effectiveEndDay(event) {
  if (!event.allDay && event.endDay > event.startDay && event.endMinutes === 0) {
    return Day.addDays(event.endDay, -1);
  }
  return event.endDay;
}

export function coversDay(event, day) {
  return event.startDay <= day && day <= effectiveEndDay(event);
}

/** True when the agenda says `All day` for this event on this day. */
function runsAllDay(event, day) {
  return event.allDay || (day !== event.startDay && day !== event.endDay);
}

/** The time line under an agenda row. `uses24Hour` follows the browser's locale. */
export function timeLine(event, day, uses24Hour = false) {
  if (runsAllDay(event, day)) return 'All day';
  const start = timeText(event.startMinutes, uses24Hour);
  const end = timeText(event.endMinutes, uses24Hour);
  // Compared with the effective end, so a party ending at midnight reads `8:00 PM – 12:00 AM` on its one day.
  const startsToday = day === event.startDay;
  const endsToday = day === effectiveEndDay(event);
  if (startsToday && endsToday) return `${start} – ${end}`;
  return startsToday ? `Starts ${start}` : `Ends ${end}`;
}

/** The events covering a day, in agenda order: all-day first, then by start time, then by title. */
export function agendaFor(events, day) {
  const startOn = (event) => (event.startDay === day ? event.startMinutes : 0);
  return events
    .filter((event) => coversDay(event, day))
    .sort((a, b) => {
      const aAllDay = runsAllDay(a, day);
      const bAllDay = runsAllDay(b, day);
      if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
      if (!aAllDay && startOn(a) !== startOn(b)) return startOn(a) - startOn(b);
      return titleOrder.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/** How many events cover each day between two days, inclusive. Days with no event are absent. */
export function eventCounts(events, firstDay, lastDay) {
  const counts = new Map();
  const lower = Day.toNumber(firstDay);
  const upper = Day.toNumber(lastDay);
  for (const event of events) {
    const from = Math.max(Day.toNumber(event.startDay), lower);
    const to = Math.min(Day.toNumber(effectiveEndDay(event)), upper);
    for (let number = from; number <= to; number += 1) {
      const day = Day.fromNumber(number);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * New-event times. On today: the next full hour for one hour, capped so it stays on that day, with the end at
 * 23:59 if needed. On any other day: 9:00 to 10:00 AM.
 */
export function defaultTimes(day, now) {
  if (day !== Day.fromDate(now)) return { startMinutes: 540, endMinutes: 600 };
  const startMinutes = Math.min(now.getHours() + 1, 23) * 60;
  return { startMinutes, endMinutes: Math.min(startMinutes + 60, MINUTES_PER_DAY - 1) };
}

// ---------- The editor's draft ----------
//
// A draft keeps its times while it is all-day, so flipping the switch off and on loses nothing.

export function newDraft(day, now) {
  return { title: '', notes: '', allDay: false, startDay: day, endDay: day, ...defaultTimes(day, now) };
}

export function draftFromEvent(event) {
  return {
    title: event.title,
    notes: event.notes,
    allDay: event.allDay,
    startDay: event.startDay,
    endDay: event.endDay,
    startMinutes: event.startMinutes ?? 540,
    endMinutes: event.endMinutes ?? 600,
  };
}

function position(day, minutes) {
  return Day.toNumber(day) * MINUTES_PER_DAY + minutes;
}

function fromPosition(value) {
  const number = Math.floor(value / MINUTES_PER_DAY);
  return { day: Day.fromNumber(number), minutes: value - number * MINUTES_PER_DAY };
}

/**
 * Moving Starts past Ends pushes Ends along, keeping the duration. If that would run past the last day the format can
 * write, Ends stops at Starts.
 */
export function moveStart(draft, day, minutes = draft.startMinutes) {
  const next = { ...draft, startDay: day, startMinutes: minutes };
  if (draft.allDay) {
    if (day > draft.endDay) {
      const pushed = Day.addDays(day, Day.diffDays(draft.endDay, draft.startDay));
      next.endDay = Day.isValid(pushed) ? pushed : day;
    }
    return next;
  }
  const end = position(draft.endDay, draft.endMinutes);
  if (position(day, minutes) > end) {
    const duration = end - position(draft.startDay, draft.startMinutes);
    const pushed = fromPosition(position(day, minutes) + duration);
    next.endDay = Day.isValid(pushed.day) ? pushed.day : day;
    next.endMinutes = Day.isValid(pushed.day) ? pushed.minutes : minutes;
  }
  return next;
}

/** Whether a proposed end would fall before Starts. */
export function endIsBeforeStart(draft, day, minutes = draft.endMinutes) {
  if (draft.allDay) return day < draft.startDay;
  return position(day, minutes) < position(draft.startDay, draft.startMinutes);
}

/** Moving Ends before Starts is not allowed: it stops at Starts. */
export function moveEnd(draft, day, minutes = draft.endMinutes) {
  if (!endIsBeforeStart(draft, day, minutes)) return { ...draft, endDay: day, endMinutes: minutes };
  return { ...draft, endDay: draft.startDay, endMinutes: draft.startMinutes };
}

export function setAllDay(draft, allDay) {
  const next = { ...draft, allDay };
  // While all-day only the days moved, so the kept times may no longer make sense together.
  if (!allDay && position(next.endDay, next.endMinutes) < position(next.startDay, next.startMinutes)) {
    next.endMinutes = Math.min(next.startMinutes + 60, MINUTES_PER_DAY - 1);
  }
  return next;
}

/** A draft's fields as stored on an event. All-day events store no minutes. */
export function fieldsFromDraft(draft) {
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    allDay: draft.allDay,
    startDay: draft.startDay,
    startMinutes: draft.allDay ? null : draft.startMinutes,
    endDay: draft.endDay,
    endMinutes: draft.allDay ? null : draft.endMinutes,
  };
}
