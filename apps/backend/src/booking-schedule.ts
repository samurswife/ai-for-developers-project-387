/**
 * Working-window scheduler parameterized by the owner time zone. Working days
 * (Mon–Fri), working hours (09:00–18:00), grid step (15 minutes) and window
 * length (14 calendar days) are fixed; only the zone identifier varies.
 * Returned UTC instants survive DST changes; the local-clock grid is anchored
 * to the owner zone for each date.
 */
export const WINDOW_LENGTH_DAYS = 14;
export const WINDOW_START_HOUR = 9;
export const WINDOW_END_HOUR = 18;
export const GRID_MINUTES = 15;
const MS_PER_MINUTE = 60_000;

/** Local-clock parts of the supplied instant in the owner zone. */
function ownerLocalParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date(instant));
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const weekdayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    weekdayIndex,
  };
}

/** UTC instant for owner-zone local time `year-month-day hour:minute:00.000`. */
function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const trial = Date.UTC(year, month - 1, day, hour, minute);
  const observedParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(trial));
  const observed = Date.UTC(
    Number(observedParts.find((part) => part.type === 'year')?.value),
    Number(observedParts.find((part) => part.type === 'month')?.value) - 1,
    Number(observedParts.find((part) => part.type === 'day')?.value),
    Number(observedParts.find((part) => part.type === 'hour')?.value),
    Number(observedParts.find((part) => part.type === 'minute')?.value),
    Number(observedParts.find((part) => part.type === 'second')?.value),
  );
  return trial + (trial - observed);
}

/** `YYYY-MM-DD` owner date for the supplied instant. */
function ownerDateString(instant: number, timeZone: string) {
  const parts = ownerLocalParts(instant, timeZone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

/** The following owner-zone date string (after local midnight rolls over). */
function nextOwnerDate(date: string, timeZone: string) {
  const ownerMidnight = zonedLocalToUtc(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    0,
    0,
    timeZone,
  );
  for (let step = 30; step <= 30 * 60; step += 30) {
    const candidate = ownerMidnight + step * MS_PER_MINUTE;
    if (candidate - (24 * 60 * MS_PER_MINUTE) > ownerMidnight) break;
    const parts = ownerLocalParts(candidate, timeZone);
    if (parts.hour === 0 && parts.minute === 0) {
      return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
    }
  }
  // DST spring-forward may miss local 00:00. Probe 23:00..24:00 in 30 min steps.
  const ownerLateNight = zonedLocalToUtc(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    23,
    0,
    timeZone,
  );
  for (let step = 0; step <= 6 * 60; step += 30) {
    const candidate = ownerLateNight + step * MS_PER_MINUTE;
    const parts = ownerLocalParts(candidate, timeZone);
    if (parts.hour === 0 && parts.minute === 0 && candidate > ownerMidnight + 12 * 60 * MS_PER_MINUTE) {
      return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
    }
  }
  // Fallback: advance exactly 24h UTC; correct on non-DST days.
  const [year, month, day] = date.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * MS_PER_MINUTE);
  return `${tomorrow.getUTCFullYear().toString().padStart(4, '0')}-${(tomorrow.getUTCMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getUTCDate().toString().padStart(2, '0')}`;
}

/** Mon=0..Sun=6 weekday index for the owner-zone midnight of the supplied date. */
function ownerWeekdayIndex(date: string, timeZone: string) {
  const midnight = zonedLocalToUtc(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    0,
    0,
    timeZone,
  );
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(midnight));
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
}

/**
 * All scheduled starts for the owner window. Each item is the UTC instant of a
 * grid start that falls inside a working day and hour after `currentTime`. Days
 * without eligible starts are retained with an empty array.
 */
export function scheduledDays(timeZone: string, durationMinutes: number, currentTime: number) {
  const firstDate = ownerDateString(currentTime, timeZone);
  const result: { date: string; starts: number[] }[] = [];
  let cursorDate = firstDate;
  for (let offset = 0; offset < WINDOW_LENGTH_DAYS; offset += 1) {
    const weekday = ownerWeekdayIndex(cursorDate, timeZone);
    const opens = zonedLocalToUtc(
      Number(cursorDate.slice(0, 4)),
      Number(cursorDate.slice(5, 7)),
      Number(cursorDate.slice(8, 10)),
      WINDOW_START_HOUR,
      0,
      timeZone,
    );
    const closes = zonedLocalToUtc(
      Number(cursorDate.slice(0, 4)),
      Number(cursorDate.slice(5, 7)),
      Number(cursorDate.slice(8, 10)),
      WINDOW_END_HOUR,
      0,
      timeZone,
    );
    const starts: number[] = [];
    if (
      weekday >= 0 &&
      weekday <= 4 &&
      Number.isFinite(opens) &&
      Number.isFinite(closes) &&
      closes > opens
    ) {
      for (
        let start = opens;
        start + durationMinutes * MS_PER_MINUTE <= closes;
        start += GRID_MINUTES * MS_PER_MINUTE
      )
        if (start > currentTime) starts.push(start);
    }
    result.push({ date: cursorDate, starts });
    cursorDate = nextOwnerDate(cursorDate, timeZone);
  }
  return result;
}

/** Half-open overlap check on UTC instants, independent of zone. */
export function isOccupied(
  start: number,
  end: number,
  bookings: readonly { startsAt: string; endsAt: string }[],
) {
  return bookings.some(
    (booking) => start < Date.parse(booking.endsAt) && Date.parse(booking.startsAt) < end,
  );
}
