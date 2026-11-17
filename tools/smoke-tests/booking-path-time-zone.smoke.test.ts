import type { Page } from 'playwright';
import { expect, test } from 'vitest';
import { browserScenario } from './browser-scenario.js';
import { startCalendar } from './calendar.js';

async function scenario(
  run: (
    page: Page,
    url: string,
    backend: Awaited<ReturnType<typeof startCalendar>>,
  ) => Promise<void>,
) {
  await browserScenario(
    () => startCalendar('2026-11-15T01:00:00.000Z'),
    {
      timezoneId: 'Europe/Moscow',
      viewport: { width: 360, height: 900 },
    },
    run,
  );
}

async function publish(url: string) {
  const response = await fetch(`${url}/api/meeting-types`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Знакомство', durationMinutes: 30 }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

test('owner Asia/Krasnoyarsk, guest Europe/Moscow: 10:00 slot equals 14:00 owner time on calendar, form, confirmation and owner list; manual zone choice survives the path and back', async () => {
  await scenario(async (page, url, backend) => {
    const item = await publish(backend.url);

    const owner = await page.context().newPage();
    await owner.goto(`${url}/owner`);
    await owner.getByTestId('current-owner-time-zone').waitFor();
    await owner.getByLabel('Новый IANA-идентификатор').selectOption('Asia/Krasnoyarsk');
    await owner.getByRole('button', { name: 'Сохранить пояс', exact: true }).click();
    await owner
      .getByTestId('current-owner-time-zone')
      .filter({ hasText: 'Asia/Krasnoyarsk' })
      .waitFor();

    await page.goto(`${url}/meeting-types/${item.id}`);
    await page.getByTestId('current-zone').filter({ hasText: 'Europe/Moscow' }).waitFor();
    const dateButtons = page.getByRole('group', { name: 'Даты записи' });
    await dateButtons.getByRole('button', { name: /^16 ноября/ }).click();
    const slot = page
      .getByRole('group', { name: 'Свободное время' })
      .getByRole('button', { name: '10:00 – 10:30', exact: true });
    await slot.waitFor();
    expect(await slot.getAttribute('data-testid')).toBe('slot-2026-11-16T07:00:00.000Z');
    await slot.click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();

    await page.getByRole('heading', { name: 'Подтвердите запись', exact: true }).waitFor();
    await page.getByText('10:00 – 10:30', { exact: true }).first().waitFor();
    await page.getByText('Europe/Moscow', { exact: true }).first().waitFor();
    await page.getByText('14:00 – 14:30', { exact: true }).waitFor();
    await page.getByText('Asia/Krasnoyarsk (время владельца)', { exact: true }).waitFor();

    await page.getByRole('link', { name: 'Изменить время', exact: true }).click();
    await page.getByTestId('guest-time-zone').waitFor();
    expect(await page.getByTestId('guest-time-zone').inputValue()).toBe('Europe/Moscow');
    expect(new URL(page.url()).searchParams.get('tz')).toBe('Europe/Moscow');
    await page
      .getByRole('group', { name: 'Свободное время' })
      .getByRole('button', { name: '10:00 – 10:30', exact: true })
      .click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();

    await page.getByLabel('Имя', { exact: true }).fill('Гость');
    await page.getByLabel('Электронная почта', { exact: true }).fill('guest@example.com');
    await page.getByText('14:00 – 14:30', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Подтвердить запись', exact: true }).click();
    await page.getByRole('heading', { name: 'Вы записаны', exact: true }).waitFor();
    await page.getByText('10:00 – 10:30', { exact: true }).first().waitFor();
    await page.getByText('Europe/Moscow', { exact: true }).first().waitFor();
    await page.getByText('14:00 – 14:30', { exact: true }).waitFor();
    await page.getByText('Asia/Krasnoyarsk (время владельца)', { exact: true }).waitFor();

    await owner.reload();
    const meetings = owner.getByRole('region', { name: 'Предстоящие встречи', exact: true });
    const booking = meetings.getByRole('listitem').filter({ hasText: 'Гость' });
    await booking.getByText('14:00 – 14:30', { exact: true }).waitFor();
    await booking.getByText('Asia/Krasnoyarsk (время владельца)', { exact: true }).waitFor();
    await owner.close();
  });
});
