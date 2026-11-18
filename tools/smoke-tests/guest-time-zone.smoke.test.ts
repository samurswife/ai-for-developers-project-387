import type { Page } from 'playwright';
import { expect, test } from 'vitest';
import { browserScenario } from './browser-scenario.js';
import { startCalendar } from './calendar.js';

async function scenario(
  start: () => Promise<Awaited<ReturnType<typeof startCalendar>>>,
  pageOptions: Parameters<typeof browserScenario>[1],
  run: (
    page: Page,
    url: string,
    backend: Awaited<ReturnType<typeof startCalendar>>,
  ) => Promise<void>,
) {
  await browserScenario(start, pageOptions, run);
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

const NEIGHBOR_UTC = '2026-11-16T02:00:00.000Z';

test('Asia/Krasnoyarsk owner slot 2026-11-16 09:00 appears to Pacific/Honolulu guest as 2026-11-15 16:00 under the correct local date with the same UTC instant', async () => {
  await scenario(
    () => startCalendar('2026-11-15T01:00:00.000Z'),
    {
      timezoneId: 'Pacific/Honolulu',
      viewport: { width: 360, height: 900 },
    },
    async (page, url, backend) => {
      const settings = await fetch(`${backend.url}/api/calendar-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeZone: 'Asia/Krasnoyarsk' }),
      });
      expect(settings.status).toBe(200);
      const item = await publish(backend.url);
      await page.goto(`${url}/meeting-types/${item.id}`);
      await page.getByTestId('current-zone').filter({ hasText: 'Pacific/Honolulu' }).waitFor();
      const dateButtons = page.getByRole('group', { name: 'Даты записи' });
      expect(await dateButtons.getByRole('button').count()).toBeGreaterThanOrEqual(14);
      await dateButtons.getByRole('button', { name: /^15 ноября/ }).click();
      const slots = page.getByRole('group', { name: 'Свободное время' });
      const neighbor = slots.getByRole('button', { name: '16:00 – 16:30', exact: true });
      await neighbor.waitFor();
      const testId = await neighbor.evaluate(
        (element) => element.getAttribute('data-testid') ?? '',
      );
      expect(testId).toBe(`slot-${NEIGHBOR_UTC}`);
      await neighbor.click();
      const selected = await page.getByText(/^Выбрано: 16:00 – 16:30/).textContent();
      expect(selected).toMatch(/(Pacific\/Honolulu|$)/);

      await page.getByTestId('guest-time-zone').selectOption('Asia/Krasnoyarsk');
      await page.getByTestId('current-zone').filter({ hasText: 'Asia/Krasnoyarsk' }).waitFor();
      await dateButtons.getByRole('button', { name: /^16 ноября/ }).click();
      const ownerView = page
        .getByRole('group', { name: 'Свободное время' })
        .getByRole('button', { name: '09:00 – 09:30', exact: true });
      await ownerView.waitFor();
      const ownerTestId = await ownerView.evaluate(
        (element) => element.getAttribute('data-testid') ?? '',
      );
      expect(ownerTestId).toBe(`slot-${NEIGHBOR_UTC}`);
    },
  );
});

test('manual time zone picker re-renders the same UTC slots in the chosen zone without changing their moments', async () => {
  await scenario(
    () => startCalendar('2026-11-09T05:00:00.000Z'),
    {
      timezoneId: 'Europe/Moscow',
      viewport: { width: 360, height: 900 },
    },
    async (page, url) => {
      const item = await publish(url);
      await page.goto(`${url}/meeting-types/${item.id}`);
      await page.getByTestId('current-zone').filter({ hasText: 'Europe/Moscow' }).waitFor();
      const moscowFirst = page.getByRole('button', { name: '09:00 – 09:30', exact: true });
      await moscowFirst.waitFor();
      const moscowSlot = await moscowFirst.evaluate(
        (element) => element.getAttribute('data-testid') ?? '',
      );

      await page.getByTestId('guest-time-zone').selectOption('Asia/Tokyo');
      await page.getByTestId('current-zone').filter({ hasText: 'Asia/Tokyo' }).waitFor();
      const tokyoFirst = page.getByRole('button', { name: '15:00 – 15:30', exact: true });
      await tokyoFirst.waitFor();
      const tokyoSlot = await tokyoFirst.evaluate(
        (element) => element.getAttribute('data-testid') ?? '',
      );
      expect(tokyoSlot).toBe(moscowSlot);

      await page.getByTestId('guest-time-zone').selectOption('America/Los_Angeles');
      await page.getByTestId('current-zone').filter({ hasText: 'America/Los_Angeles' }).waitFor();
      const laFirst = page.getByRole('button', { name: '22:00 – 22:30', exact: true });
      await laFirst.waitFor();
      const laSlot = await laFirst.evaluate((element) => element.getAttribute('data-testid') ?? '');
      expect(laSlot).toBe(moscowSlot);
    },
  );
});

test('an empty owner date still appears as an empty guest date in the calendar and never becomes a free slot', async () => {
  await scenario(
    () => startCalendar('2026-11-09T05:00:00.000Z'),
    {
      timezoneId: 'Europe/Moscow',
      viewport: { width: 360, height: 900 },
    },
    async (page, url, backend) => {
      const item = await publish(backend.url);
      await page.goto(`${url}/meeting-types/${item.id}`);
      await dates(page)
        .getByRole('button', { name: /^15 ноября/ })
        .click();
      await page.getByRole('group', { name: 'Свободное время' }).waitFor({ state: 'detached' });
      await page.getByRole('heading', { name: /15 ноября 2026 г\./ }).waitFor();
      await page.getByText('На эту дату свободного времени нет', { exact: true }).waitFor();

      await page.getByTestId('guest-time-zone').selectOption('Asia/Tokyo');
      await dates(page)
        .getByRole('button', { name: /^15 ноября/ })
        .click();
      await page.getByText('На эту дату свободного времени нет', { exact: true }).waitFor();
    },
  );
});

function dates(page: Page) {
  return page.getByRole('group', { name: 'Даты записи' });
}
