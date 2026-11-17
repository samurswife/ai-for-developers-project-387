import { useCallback, useEffect, useState } from 'react';
import {
  calendarSettingsGetCalendarSettings,
  calendarSettingsUpdateCalendarSettings,
  type CalendarSettingsBody,
  type FieldError,
} from '@calendar/api-sdk';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const STATE_DEFAULT: CalendarSettingsBody = { timeZone: 'Europe/Moscow' };

type SettingsState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; current: CalendarSettingsBody; saving: boolean; error: string | null };

export function OwnerCalendarSettings() {
  const [zones, setZones] = useState<string[]>([]);
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const [picked, setPicked] = useState<string>(STATE_DEFAULT.timeZone);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await calendarSettingsGetCalendarSettings({ client: api, signal });
        if (!result.data) {
          setState({ status: 'error' });
          return;
        }
        setPicked(result.data.timeZone);
        setState({ status: 'ready', current: result.data, saving: false, error: null });
      } catch {
        setState({ status: 'error' });
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setZones(
      typeof Intl.supportedValuesOf === 'function'
        ? (Intl.supportedValuesOf('timeZone') as string[]).sort((a, b) => a.localeCompare(b))
        : [STATE_DEFAULT.timeZone],
    );
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  async function save(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (state.status !== 'ready' || state.saving) return;
    setState((previous) =>
      previous.status === 'ready' ? { ...previous, saving: true, error: null } : previous,
    );
    const result = await calendarSettingsUpdateCalendarSettings({
      client: api,
      body: { timeZone: picked },
    });
    if (result.data) {
      setState({ status: 'ready', current: result.data, saving: false, error: null });
      return;
    }
    if (result.error?.code === 'VALIDATION_ERROR') {
      const fieldError: FieldError | undefined = result.error.fieldErrors?.find(
        (entry) => entry.field === 'timeZone',
      );
      setState((previous) =>
        previous.status === 'ready'
          ? {
              ...previous,
              saving: false,
              error: fieldError?.message ?? result.error?.message ?? 'Пояс не принят.',
            }
          : previous,
      );
      return;
    }
    setState((previous) =>
      previous.status === 'ready'
        ? { ...previous, saving: false, error: 'Не удалось сохранить пояс.' }
        : previous,
    );
  }

  return (
    <div className="mt-8 border-t border-border pt-6" aria-labelledby="owner-time-zone-title">
      <h2 id="owner-time-zone-title" className="text-xl font-semibold">
        Часовой пояс владельца
      </h2>
      <p className="mt-2 text-muted-foreground">
        Все рабочие дни, часы и 14-дневное окно записи считаются в этом поясе. Слоты передаются в
        UTC по-прежнему.
      </p>
      {state.status === 'ready' ? (
        <>
          <p className="mt-3">
            Текущий пояс:{' '}
            <span className="font-medium" data-testid="current-owner-time-zone">
              {state.current.timeZone}
            </span>
          </p>
          <form className="mt-4 space-y-4" onSubmit={save} aria-busy={state.saving}>
            <div>
              <label htmlFor="owner-time-zone">Новый IANA-идентификатор</label>
              <select
                id="owner-time-zone"
                name="timeZone"
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                disabled={state.saving}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
            {state.error && (
              <p role="alert" className="field-error">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={state.saving || picked === state.current.timeZone}>
              {state.saving ? 'Сохраняем…' : 'Сохранить пояс'}
            </Button>
          </form>
        </>
      ) : state.status === 'error' ? (
        <p role="alert" className="mt-4">
          Не удалось загрузить настройки календаря.
        </p>
      ) : (
        <output className="mt-4 block">Загружаем настройки календаря…</output>
      )}
    </div>
  );
}
