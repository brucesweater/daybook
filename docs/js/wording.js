// The exact words for how long something has waited. Elapsed time is a real duration in milliseconds, so
// here (and only here) a "day" really is 24 hours, as the spec's table says.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function count(number, unit) {
  return `${number} ${unit}${number === 1 ? '' : 's'}`;
}

/** `5 minutes`, `1 hour`, `2 weeks`… or null when under a minute. Every boundary belongs to the next row. */
function phrase(elapsedMs) {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < MINUTE) return null;
  if (elapsed < HOUR) return count(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return count(Math.floor(elapsed / HOUR), 'hour');
  const days = Math.floor(elapsed / DAY);
  if (days < 14) return count(days, 'day');
  if (days < 60) return count(Math.floor(days / 7), 'week');
  if (days < 365) return count(Math.floor(days / 30), 'month');
  return count(Math.floor(days / 365), 'year');
}

/** The age line on an open task. */
export function ageText(assignedMs, nowMs) {
  const words = phrase(nowMs - assignedMs);
  return words === null ? 'Assigned just now' : `Assigned ${words} ago`;
}

/** How long a finished task took, as in `took 3 days`. */
export function durationText(startMs, endMs) {
  return phrase(endMs - startMs) ?? 'under a minute';
}

/** Colour band of an age line: under 7 days, 7 to 29 days, 30 days or more. */
export function ageTone(assignedMs, nowMs) {
  const days = Math.floor(Math.max(0, nowMs - assignedMs) / DAY);
  if (days >= 30) return 'old';
  if (days >= 7) return 'warm';
  return 'fresh';
}
