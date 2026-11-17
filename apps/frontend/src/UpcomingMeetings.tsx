import { useCallback, useState } from 'react';
import {
  bookingsListUpcomingBookings,
  calendarSettingsGetCalendarSettings,
  type Booking,
} from '@calendar/api-sdk';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { BookingDetails } from './BookingDetails';
import { ownerZoneLabel } from './time-zone';
import { useReadLifecycle } from './use-read-lifecycle';

type MeetingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: Booking[]; timeZone: string };

const DEFAULT_OWNER_TIME_ZONE = 'Europe/Moscow';

export function UpcomingMeetings() {
  const [state, setState] = useState<MeetingsState>({ status: 'loading' });
  const refresh = useReadLifecycle(
    useCallback(async (signal: AbortSignal): Promise<MeetingsState> => {
      try {
        const settings = await calendarSettingsGetCalendarSettings({ client: api, signal });
        const bookings = await bookingsListUpcomingBookings({ client: api, signal });
        if (!bookings.data) return { status: 'error' };
        return {
          status: 'ready',
          items: bookings.data.items,
          timeZone: settings.data?.timeZone ?? DEFAULT_OWNER_TIME_ZONE,
        };
      } catch {
        return { status: 'error' };
      }
    }, []),
    () => setState({ status: 'loading' }),
    setState,
  );

  const timeZone = state.status === 'ready' ? state.timeZone : DEFAULT_OWNER_TIME_ZONE;

  return (
    <section className="mt-10" aria-labelledby="upcoming-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="upcoming-title" className="text-xl font-semibold">
          Предстоящие встречи
        </h2>
        <Button variant="outline" onClick={refresh} disabled={state.status === 'loading'}>
          Обновить
        </Button>
      </div>
      <div className="mt-5" aria-live="polite" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <output>Загружаем предстоящие встречи…</output>}
        {state.status === 'error' && (
          <div className="page-panel">
            <p role="alert">Не удалось загрузить предстоящие встречи.</p>
            <Button className="mt-4" onClick={refresh}>
              Повторить
            </Button>
          </div>
        )}
        {state.status === 'ready' &&
          (state.items.length === 0 ? (
            <p className="page-panel">Предстоящих встреч пока нет</p>
          ) : (
            <ul className="space-y-5">
              {state.items.map((booking) => (
                <li className="page-panel min-w-0 break-words" key={booking.id}>
                  <BookingDetails
                    meetingType={booking.meetingType}
                    startsAt={booking.startsAt}
                    endsAt={booking.endsAt}
                    primaryTimeZone={timeZone}
                    primaryZoneLabel={ownerZoneLabel(timeZone)}
                  />
                  <p className="mt-4">{booking.guestName}</p>
                  <p className="mt-1">{booking.guestEmail}</p>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
