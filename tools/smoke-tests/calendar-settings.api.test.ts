import { expect, test } from 'vitest';
import { startBackend } from './apps.js';

test('a fresh server returns the default owner time zone', async () => {
  const backend = await startBackend();
  try {
    const response = await fetch(`${backend.url}/api/calendar-settings`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
    expect(await response.json()).toEqual({ timeZone: 'Europe/Moscow' });
  } finally {
    await backend.close();
  }
});

test('a non-IANA value is rejected by PUT and does not change the current zone', async () => {
  const backend = await startBackend();
  try {
    const response = await fetch(`${backend.url}/api/calendar-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeZone: 'Not/AZone' }),
    });
    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.fieldErrors).toContainEqual({
      field: 'timeZone',
      code: 'VALIDATION_ERROR',
      message: expect.any(String),
    });
    const after = await fetch(`${backend.url}/api/calendar-settings`);
    expect(await after.json()).toEqual({ timeZone: 'Europe/Moscow' });
  } finally {
    await backend.close();
  }
});

test('PUT with a valid IANA zone persists and Availability.timeZone reflects it', async () => {
  const backend = await startBackend();
  try {
    const update = await fetch(`${backend.url}/api/calendar-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeZone: 'Asia/Krasnoyarsk' }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ timeZone: 'Asia/Krasnoyarsk' });
    const settings = await fetch(`${backend.url}/api/calendar-settings`);
    expect(await settings.json()).toEqual({ timeZone: 'Asia/Krasnoyarsk' });
    const publish = await fetch(`${backend.url}/api/meeting-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Знакомство', durationMinutes: 30 }),
    });
    const item = await publish.json();
    const slots = await (await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`)).json();
    expect(slots.timeZone).toBe('Asia/Krasnoyarsk');
  } finally {
    await backend.close();
  }
});
