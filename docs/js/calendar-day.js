// CalendarDay: one local calendar day, written 'YYYY-MM-DD'.
//
// All day arithmetic in Daybook goes through here. It is plain integer maths on the proleptic Gregorian
// calendar (Howard Hinnant's civil-day algorithms), with no Date objects and no 86400-second steps, so a
// daylight-saving change can't shift anything. Strings in this format also sort correctly with < and >.

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Splits a day string. Assumes it is valid; use isValid on anything from outside. */
export function parts(day) {
  const [, year, month, date] = DAY_PATTERN.exec(day);
  return { year: Number(year), month: Number(month), day: Number(date) };
}

export function isValid(value) {
  if (typeof value !== 'string') return false;
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  return month >= 1 && month <= 12 && date >= 1 && date <= daysInMonth(year, month);
}

export function make(year, month, day) {
  const pad = (number, width) => String(number).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Days since 1970-01-01. */
export function toNumber(day) {
  const { year, month, day: date } = parts(day);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + date - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function fromNumber(number) {
  const z = number + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const date = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted + (shifted < 10 ? 3 : -9);
  return make(yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, date);
}

export function addDays(day, count) {
  return fromNumber(toNumber(day) + count);
}

/** How many days `later` is after `earlier`. */
export function diffDays(later, earlier) {
  return toNumber(later) - toNumber(earlier);
}

/** 0 is Sunday, 6 is Saturday. 1970-01-01 was a Thursday. */
export function weekday(day) {
  return (((toNumber(day) + 4) % 7) + 7) % 7;
}

/** The local calendar day of a Date. Date's getters are always Gregorian, whatever the device calendar is. */
export function fromDate(date = new Date()) {
  return make(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** A local Date for a day plus minutes after midnight. Never `new Date(string)`, which reads days as UTC. */
export function toDate(day, minutes = 0) {
  const { year, month, day: date } = parts(day);
  const result = new Date(2000, 0, 1, 0, 0, 0, 0);
  result.setFullYear(year, month - 1, date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

export function monthOf(day) {
  const { year, month } = parts(day);
  return { year, month };
}

export function addMonths({ year, month }, count) {
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

export function firstOfMonth({ year, month }) {
  return make(year, month, 1);
}

export function isInMonth(day, { year, month }) {
  const value = parts(day);
  return value.year === year && value.month === month;
}

/** Negative when month `a` is before month `b`. */
export function compareMonths(a, b) {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}
