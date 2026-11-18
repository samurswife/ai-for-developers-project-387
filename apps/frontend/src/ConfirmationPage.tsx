import { useEffect, useState } from 'react';
import { calendarSettingsGetCalendarSettings, type Booking } from '@calendar/api-sdk';
import { api } from '@/lib/api';
import { BookingDetails } from './BookingDetails';
import { resetBookingDraft } from './booking-scenario';
import { guestZoneFromPath, ownerZoneLabel, zoneLabel } from './time-zone';

export function ConfirmationPage({ id }: { id: string }) {
  let booking: Booking | undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(`booking:${id}`) ?? 'null');
    if (saved?.id === id) booking = saved;
  } catch {
    /* Missing or unreadable tab data does not cancel a booking. */
  }
  const hasBooking = !!booking && booking.id === id;
  const [ownerTimeZone, setOwnerTimeZone] = useState<string | null>(null);
  useEffect(() => {
    if (!hasBooking) return undefined;
    const controller = new AbortController();
    calendarSettingsGetCalendarSettings({ client: api, signal: controller.signal })
      .then((result) => {
        if (result.data) setOwnerTimeZone(result.data.timeZone);
        return undefined;
      })
      .catch(() => {
        /* Without settings the owner representation stays hidden rather than guessed. */
      });
    return () => controller.abort();
    // Settings are global owner state; refetch when tab-only booking data appears or disappears.
  }, [hasBooking]);
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
  const guestZone = guestZoneFromPath();
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
          secondaryTimeZone={ownerTimeZone ?? undefined}
          secondaryZoneLabel={ownerTimeZone ? ownerZoneLabel(ownerTimeZone) : undefined}
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
