import type { Availability, AvailabilityDay, Slot } from '@calendar/api-sdk';

/** Read the IANA time zone reported by the running browser. */
export function detectBrowserTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    /* Fall through to the default below for non-Intl environments. */
  }
  return 'UTC';
}

/** Sorted list of IANA zones supported by the runtime, for the manual selector. */
export function listSupportedTimeZones(): string[] {
  if (typeof Intl.supportedValuesOf !== 'function') return ['UTC'];
  return (Intl.supportedValuesOf('timeZone') as string[])
    .slice()
    .sort((a, b) => a.localeCompare(b));
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Local Y/M/D/H/M parts of the given UTC instant in the given IANA zone. */
function partsInZone(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const lookup = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    second: lookup('second'),
  };
}

/** Calendar date (YYYY-MM-DD) of the instant in the given IANA zone. */
function dateInZone(instant: number, timeZone: string): string {
  const { year, month, day } = partsInZone(instant, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, width: number) {
  return value.toString().padStart(width, '0');
}

/** UTC instant for `year-month-day hour:minute:00.000` local time in `timeZone`. */
function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const trial = Date.UTC(year, month - 1, day, hour, minute);
  const observed = partsInZone(trial, timeZone);
  const observedUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second,
  );
  return trial + (trial - observedUtc);
}

/** UTC instant of local midnight of the guest-zone calendar date. */
function guestMidnightUtc(date: string, timeZone: string): number {
  return zonedLocalToUtc(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    0,
    0,
    timeZone,
  );
}

/** Owner-zone midnight of the supplied window date, used as the absolute interval bound. */
function ownerMidnightUtc(date: string, timeZone: string): number {
  return zonedLocalToUtc(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    0,
    0,
    timeZone,
  );
}

/** Calendar date that follows the supplied `YYYY-MM-DD` value by exactly one day. */
function addOneDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + MS_PER_DAY);
  return `${next.getUTCFullYear().toString().padStart(4, '0')}-${(next.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`;
}

/** Calendar date that precedes the supplied `YYYY-MM-DD` value by exactly one day. */
function subtractOneDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const prev = new Date(Date.UTC(year, month - 1, day) - MS_PER_DAY);
  return `${prev.getUTCFullYear().toString().padStart(4, '0')}-${(prev.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${prev.getUTCDate().toString().padStart(2, '0')}`;
}

/** Visible label the calendar shows for the supplied IANA zone. */
export function zoneLabel(zone: string): string {
  return zone;
}

/** Explicit owner-zone label used wherever the owner's view is secondary. */
export function ownerZoneLabel(zone: string): string {
  if (zone === 'Europe/Moscow') return 'Московское время (UTC+3)';
  return `${zone} (время владельца)`;
}

/**
 * Re-group the owner's availability into the guest's calendar days. Slot
 * moments (`startsAt`, `endsAt`) stay exactly as the server returned them: only
 * which date row holds the slot changes. The walk covers every guest local
 * date whose `[midnight, nextMidnight)` interval intersects the owner's
 * absolute 14-day window, even when no slot lands on it.
 */
export function regroupAvailabilityByZone(
  availability: Availability,
  guestZone: string,
): AvailabilityDay[] {
  const ownerZone = availability.timeZone;
  const ownerStartUtc = ownerMidnightUtc(availability.windowStartDate, ownerZone);
  const ownerEndUtc = ownerMidnightUtc(addOneDay(availability.windowEndDate), ownerZone);

  const firstGuestDate = dateInZone(ownerStartUtc, guestZone);
  const firstGuestMidnight = guestMidnightUtc(firstGuestDate, guestZone);
  let cursorDate =
    firstGuestMidnight > ownerStartUtc ? subtractOneDay(firstGuestDate) : firstGuestDate;

  const result: AvailabilityDay[] = [];
  while (true) {
    const cursorMidnight = guestMidnightUtc(cursorDate, guestZone);
    if (cursorMidnight >= ownerEndUtc) break;
    const nextMidnight = guestMidnightUtc(addOneDay(cursorDate), guestZone);
    if (nextMidnight > ownerStartUtc) {
      const slots: Slot[] = [];
      for (const day of availability.days) {
        for (const slot of day.slots) {
          const start = Date.parse(slot.startsAt);
          if (start >= cursorMidnight && start < nextMidnight) slots.push(slot);
        }
      }
      result.push({ date: cursorDate, slots });
    }
    cursorDate = addOneDay(cursorDate);
  }
  return result;
}
