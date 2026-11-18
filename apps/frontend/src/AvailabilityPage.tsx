import { useCallback, useMemo, useState } from 'react';
import {
  meetingTypesGetMeetingType,
  meetingTypesGetSlots,
  type Availability,
  type MeetingType,
} from '@calendar/api-sdk';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { bookingDraft, navigate } from './booking-scenario';
import {
  detectBrowserTimeZone,
  guestZoneFromPath,
  listSupportedTimeZones,
  regroupAvailabilityByZone,
  zoneLabel,
} from './time-zone';
import { useReadLifecycle } from './use-read-lifecycle';

type CalendarState =
  | { status: 'loading' | 'error' | 'not-found' }
  | {
      status: 'ready';
      item: MeetingType;
      availability: Availability;
      date: string | null;
      start: string | null;
    };

async function readCalendar(id: string, signal: AbortSignal): Promise<CalendarState> {
  try {
    const [type, slots] = await Promise.all([
      meetingTypesGetMeetingType({ client: api, path: { id }, signal }),
      meetingTypesGetSlots({ client: api, path: { id }, signal }),
    ]);
    if (
      type.error?.code === 'MEETING_TYPE_NOT_FOUND' ||
      slots.error?.code === 'MEETING_TYPE_NOT_FOUND'
    )
      return { status: 'not-found' };
    if (!type.data || !slots.data) return { status: 'error' };
    return {
      status: 'ready',
      item: type.data,
      availability: slots.data,
      date: null,
      start: null,
    };
  } catch {
    return { status: 'error' };
  }
}

function timeLabel(timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
function shortDateLabel(timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
function longDateLabel(timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    dateStyle: 'long',
  });
}
const intervalText = (slot: { startsAt: string; endsAt: string }, timeZone: string) =>
  `${timeLabel(timeZone).format(new Date(slot.startsAt))} – ${timeLabel(timeZone).format(new Date(slot.endsAt))}`;

export function AvailabilityPage({ id }: { id: string }) {
  const [state, setState] = useState<CalendarState>({ status: 'loading' });
  const [zones] = useState<string[]>(listSupportedTimeZones);
  const [browserZone] = useState<string>(detectBrowserTimeZone);
  const [pickedZone, setPickedZone] = useState<string | null>(guestZoneFromPath);
  const retry = useReadLifecycle(
    useCallback((signal: AbortSignal) => readCalendar(id, signal), [id]),
    () => setState({ status: 'loading' }),
    setState,
  );

  const viewZone = pickedZone ?? browserZone;

  function handleZoneChange(next: string) {
    setPickedZone(next || null);
    const url = new URL(location.href);
    if (next) url.searchParams.set('tz', next);
    else url.searchParams.delete('tz');
    history.replaceState(null, '', url);
    setState((previous) =>
      previous.status === 'ready' ? { ...previous, date: null, start: null } : previous,
    );
  }

  const guestDays = useMemo(
    () => (state.status === 'ready' ? regroupAvailabilityByZone(state.availability, viewZone) : []),
    [state, viewZone],
  );

  const selectedDay = useMemo(() => {
    if (state.status !== 'ready' || guestDays.length === 0) return undefined;
    const explicit = guestDays.find((day) => day.date === state.date);
    if (explicit) return explicit;
    const firstWithSlots = guestDays.find((day) => day.slots.length) ?? guestDays[0];
    return firstWithSlots;
  }, [guestDays, state]);

  const selectedSlot = selectedDay?.slots.find(
    (slot) => state.status === 'ready' && slot.startsAt === state.start,
  );
  const currentZoneText = zoneLabel(viewZone);
  const selectedDayDate = selectedDay?.date;

  return (
    <section aria-labelledby="calendar-title">
      <a href="/meeting-types" className="navigation-link text-primary underline">
        В каталог
      </a>
      <h1 id="calendar-title" className="mt-5 text-3xl font-semibold break-words sm:text-4xl">
        {state.status === 'ready'
          ? state.item.name
          : state.status === 'not-found'
            ? 'Тип встречи не найден'
            : 'Выберите время'}
      </h1>
      <div className="mt-6" aria-live="polite">
        {bookingDraft.message && (
          <p role="alert" className="mb-5">
            {bookingDraft.message}
          </p>
        )}
        {state.status === 'loading' && <output>Загружаем доступное время…</output>}
        {state.status === 'error' && (
          <div className="page-panel">
            <p role="alert">Не удалось загрузить доступное время.</p>
            <Button className="mt-4" onClick={retry}>
              Повторить
            </Button>
          </div>
        )}
        {state.status === 'not-found' && (
          <p>Этот тип встречи недоступен. Выберите другой в каталоге.</p>
        )}
        {state.status === 'ready' && selectedDay && (
          <>
            {state.item.description && (
              <p className="break-words whitespace-pre-wrap text-muted-foreground">
                {state.item.description}
              </p>
            )}
            <p className="mt-3">{state.item.durationMinutes} мин</p>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="guest-time-zone">Часовой пояс</label>
                <select
                  id="guest-time-zone"
                  name="timeZone"
                  value={viewZone}
                  onChange={(event) => handleZoneChange(event.target.value)}
                  data-testid="guest-time-zone"
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>
              <p className="font-medium" data-testid="current-zone">
                {currentZoneText}
              </p>
            </div>
            <h2 className="mt-8 text-xl font-semibold">Выберите дату</h2>
            <fieldset
              aria-label="Даты записи"
              className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
            >
              {guestDays.map((day) => {
                const safeDate = `${day.date}T12:00:00Z`;
                const selected = selectedDayDate === day.date;
                return (
                  <Button
                    key={day.date}
                    variant={selected ? 'default' : 'outline'}
                    aria-label={longDateLabel(viewZone).format(new Date(safeDate))}
                    aria-pressed={selected}
                    data-testid={`day-${day.date}`}
                    onClick={() => setState({ ...state, date: day.date, start: null })}
                  >
                    {selected && <span aria-hidden="true">✓</span>}
                    {shortDateLabel(viewZone).format(new Date(safeDate))}
                  </Button>
                );
              })}
            </fieldset>
            {!guestDays.some((day) => day.slots.length) && (
              <p className="mt-6">В ближайшие 14 дней свободного времени нет</p>
            )}
            <h2 className="mt-8 text-xl font-semibold">
              {longDateLabel(viewZone).format(new Date(`${selectedDay.date}T12:00:00Z`))}
            </h2>
            {selectedDay.slots.length === 0 ? (
              <p className="mt-4">На эту дату свободного времени нет</p>
            ) : (
              <fieldset
                aria-label="Свободное время"
                className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4"
              >
                {selectedDay.slots.map((slot) => {
                  const interval = intervalText(slot, viewZone);
                  return (
                    <Button
                      key={slot.startsAt}
                      variant={state.start === slot.startsAt ? 'default' : 'outline'}
                      aria-label={interval}
                      aria-pressed={state.start === slot.startsAt}
                      data-testid={`slot-${slot.startsAt}`}
                      onClick={() => setState({ ...state, start: slot.startsAt })}
                    >
                      <span className="block">{interval}</span>
                      <span className="block text-xs font-normal opacity-80">
                        {currentZoneText}
                      </span>
                    </Button>
                  );
                })}
              </fieldset>
            )}
            <div className="page-panel mt-8">
              {selectedSlot && (
                <p className="mb-3 font-semibold">
                  Выбрано: {intervalText(selectedSlot, viewZone)} ({currentZoneText})
                </p>
              )}
              <p className="text-muted-foreground">Выбор слота не удерживает время.</p>
              <Button
                className="mt-4"
                disabled={!selectedSlot}
                onClick={() => {
                  if (selectedSlot)
                    navigate(
                      `/meeting-types/${id}/book?start=${encodeURIComponent(
                        selectedSlot.startsAt,
                      )}&tz=${encodeURIComponent(viewZone)}`,
                    );
                }}
              >
                Продолжить
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
