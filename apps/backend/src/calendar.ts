import type { MeetingType } from '@calendar/api-sdk';

/** Stateful part shared by every application operation. Resets on process restart. */
export const calendar: {
  meetingTypes: MeetingType[];
  bookings: {
    id: string;
    meetingTypeId: string;
    startsAt: string;
    endsAt: string;
    guestName: string;
    guestEmail: string;
  }[];
  timeZone: string;
} = { meetingTypes: [], bookings: [], timeZone: 'Europe/Moscow' };

/** Maximum owner-facing length of a stored IANA time zone identifier. */
const MAX_TIME_ZONE_LENGTH = 100;

/**
 * Returns true when the candidate resolves through `Intl.DateTimeFormat` without
 * `RangeError`. Mirrors the server contract used by the PUT validation pipe and
 * keeps the storage field consistent across reads, scheduling and writes.
 */
export function isValidIanaTimeZone(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_TIME_ZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed }).format();
    return true;
  } catch {
    return false;
  }
}
