import { useEffect, useState } from 'react';
import { calendarSettingsGetCalendarSettings, type Booking } from '@calendar/api-sdk';
import { api } from '@/lib/api';
import { BookingDetails } from './BookingDetails';
import { resetBookingDraft } from './booking-scenario';
import {
  detectBrowserTimeZone,
  listSupportedTimeZones,
  ownerZoneLabel,
  zoneLabel,
} from './time-zone';

const DEFAULT_OWNER_TIME_ZONE = 'Europe/Moscow';

export function ConfirmationPage({ id }: { id: string }) {
  let booking: Booking | undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(`booking:${id}`) ?? 'null');
    if (saved?.id === id) booking = saved;
  } catch {
    /* Missing or unreadable tab data does not cancel a booking. */
  }
  const [ownerTimeZone, setOwnerTimeZone] = useState<string | null>(null);
  useEffect(() => {
    if (!booking) return undefined;
    const controller = new AbortController();
    calendarSettingsGetCalendarSettings({ client: api, signal: controller.signal })
      .then((result) => {
        if (result.data) setOwnerTimeZone(result.data.timeZone);
        return undefined;
      })
      .catch(() => {
        /* Keep the guest-only view; the owner zone stays unknown without settings. */
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!booking)
    return (
      <section className="page-panel">
        <h1 className="text-3xl font-semibold">Данные подтверждения недоступны</h1>
        <p className="mt-4">
          В этой вкладке нет сведений о записи. Это не означает отмену встречи.
        </p>
        <a
          href="/meeting-types"
          className="navigation-link mt-4 inline-block text-primary underline"
        >
          В каталог
        </a>
      </section>
    );
  const param = new URLSearchParams(location.search).get('tz');
  const zones = listSupportedTimeZones();
  const guestZone = param && zones.includes(param) ? param : detectBrowserTimeZone();
  const secondaryZone = ownerTimeZone ?? DEFAULT_OWNER_TIME_ZONE;
  return (
    <section className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Вы записаны</h1>
      <div className="page-panel mt-6 space-y-5">
        <BookingDetails
          meetingType={booking.meetingType}
          startsAt={booking.startsAt}
          endsAt={booking.endsAt}
          primaryTimeZone={guestZone}
          primaryZoneLabel={zoneLabel(guestZone)}
          secondaryTimeZone={secondaryZone}
          secondaryZoneLabel={ownerZoneLabel(secondaryZone)}
        />
        <p className="break-words">{booking.guestName}</p>
        <p className="break-all">{booking.guestEmail}</p>
        <a
          href="/meeting-types"
          onClick={resetBookingDraft}
          className="navigation-link inline-block text-primary underline"
        >
          Записаться снова
        </a>
      </div>
    </section>
  );
}
