import { expect, test } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import openapi from '../../specs/generated/openapi.json' with { type: 'json' };
import { startCalendar } from './calendar.js';

const ajv = new Ajv2020({ allErrors: true, strictSchema: false });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat('int32', { type: 'number', validate: Number.isInteger });
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat('date-time', {
  type: 'string',
  validate: (s: string) => /Z$/.test(s) && Number.isFinite(Date.parse(s)),
});
const document = ajv.addSchema(openapi, 'api');

async function slotsResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
  const validate = document.compile({
    $ref: `api#/paths/~1api~1meeting-types~1{id}~1slots/get/responses/${status}/content/application~1json/schema`,
  });
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

async function publish(url: string, durationMinutes = 30) {
  const response = await fetch(`${url}/api/meeting-types`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Знакомство', durationMinutes }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function setZone(url: string, timeZone: string) {
  const response = await fetch(`${url}/api/calendar-settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timeZone }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ timeZone });
}

test('owner time zone Asia/Krasnoyarsk shifts grid to 02:00Z and anchors window at owner midnight', async () => {
  const backend = await startCalendar('2026-11-08T20:59:59.000Z');
  try {
    await setZone(backend.url, 'Asia/Krasnoyarsk');
    const item = await publish(backend.url, 30);
    const body = await slotsResponse(
      await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`),
      200,
    );
    expect(body.timeZone).toBe('Asia/Krasnoyarsk');
    expect(body.windowStartDate).toBe('2026-11-09');
    expect(body.windowEndDate).toBe('2026-11-22');
    const dates = body.days.map((day: { date: string }) => day.date);
    expect(dates).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    const startsAt = body.days[1].slots.map((slot: { startsAt: string }) => slot.startsAt);
    expect(startsAt[0]).toBe('2026-11-10T02:00:00.000Z');
    expect(startsAt[1]).toBe('2026-11-10T02:15:00.000Z');
    expect(startsAt.at(-1)).toBe('2026-11-10T10:30:00.000Z');
  } finally {
    await backend.close();
  }
});

test('Asia/Krasnoyarsk window advances at owner midnight (17:00 UTC)', async () => {
  const backend = await startCalendar('2026-11-08T20:59:59.000Z');
  try {
    await setZone(backend.url, 'Asia/Krasnoyarsk');
    const item = await publish(backend.url, 30);
    const read = async () =>
      slotsResponse(
        await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`),
        200,
      );
    const before = await read();
    expect(before.days.map((day: { date: string }) => day.date).slice(0, 3)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ]);
    await backend.setTime('2026-11-09T17:00:00.000Z');
    const after = await read();
    expect(after.days.map((day: { date: string }) => day.date).slice(0, 3)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  } finally {
    await backend.close();
  }
});

test('Europe/Berlin applies the autumn DST shift on working dates around the transition', async () => {
  const backend = await startCalendar('2026-10-22T22:00:00.000Z');
  try {
    await setZone(backend.url, 'Europe/Berlin');
    const item = await publish(backend.url, 30);
    const body = await slotsResponse(
      await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`),
      200,
    );
    const friday = body.days.find((day: { date: string }) => day.date === '2026-10-23');
    const monday = body.days.find((day: { date: string }) => day.date === '2026-10-26');
    const sunday = body.days.find((day: { date: string }) => day.date === '2026-10-25');
    expect(friday.slots.map((slot: { startsAt: string }) => slot.startsAt)[0]).toBe(
      '2026-10-23T07:00:00.000Z',
    );
    expect(monday.slots.map((slot: { startsAt: string }) => slot.startsAt)[0]).toBe(
      '2026-10-26T08:00:00.000Z',
    );
    expect(sunday.slots).toEqual([]);
  } finally {
    await backend.close();
  }
});

test('Europe/Berlin applies the spring DST shift on working dates around the transition', async () => {
  const backend = await startCalendar('2026-03-26T22:00:00.000Z');
  try {
    await setZone(backend.url, 'Europe/Berlin');
    const item = await publish(backend.url, 30);
    const body = await slotsResponse(
      await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`),
      200,
    );
    const friday = body.days.find((day: { date: string }) => day.date === '2026-03-27');
    const monday = body.days.find((day: { date: string }) => day.date === '2026-03-30');
    const sunday = body.days.find((day: { date: string }) => day.date === '2026-03-29');
    expect(friday.slots.map((slot: { startsAt: string }) => slot.startsAt)[0]).toBe(
      '2026-03-27T08:00:00.000Z',
    );
    expect(monday.slots.map((slot: { startsAt: string }) => slot.startsAt)[0]).toBe(
      '2026-03-30T07:00:00.000Z',
    );
    expect(sunday.slots).toEqual([]);
  } finally {
    await backend.close();
  }
});

test('changing the owner time zone leaves existing bookings unchanged at their UTC instants', async () => {
  const backend = await startCalendar('2026-11-09T05:00:00.000Z');
  try {
    const item = await publish(backend.url, 30);
    const created = await fetch(`${backend.url}/api/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meetingTypeId: item.id,
        startsAt: '2026-11-09T09:00:00+03:00',
        guestName: 'Старый',
        guestEmail: 'old@example.com',
      }),
    });
    const booking = await created.json();
    expect(booking.startsAt).toBe('2026-11-09T06:00:00.000Z');
    expect(booking.endsAt).toBe('2026-11-09T06:30:00.000Z');
    await setZone(backend.url, 'Asia/Krasnoyarsk');
    const afterSlots = await slotsResponse(
      await fetch(`${backend.url}/api/meeting-types/${item.id}/slots`),
      200,
    );
    expect(afterSlots.timeZone).toBe('Asia/Krasnoyarsk');
    const startsAt = afterSlots.days
      .flatMap((day: { slots: { startsAt: string }[] }) => day.slots)
      .map((slot: { startsAt: string }) => slot.startsAt);
    expect(startsAt).not.toContain('2026-11-09T06:00:00.000Z');
    await backend.setTime('2026-11-09T05:30:00.000Z');
    const upcomingResponse = await fetch(`${backend.url}/api/bookings/upcoming`);
    const upcoming = await upcomingResponse.json();
    expect(upcoming.items).toHaveLength(1);
    expect(upcoming.items[0].id).toBe(booking.id);
    expect(upcoming.items[0].startsAt).toBe(booking.startsAt);
    expect(upcoming.items[0].endsAt).toBe(booking.endsAt);
  } finally {
    await backend.close();
  }
});

test('a valid query string with non-zero seconds or sub-second fractions is rejected', async () => {
  const backend = await startCalendar('2026-11-09T05:00:00.000Z');
  try {
    const item = await publish(backend.url, 30);
    for (const startsAt of [
      '2026-11-09T06:00:01Z',
      '2026-11-09T06:00:00.001Z',
    ]) {
      const response = await fetch(`${backend.url}/api/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          meetingTypeId: item.id,
          startsAt,
          guestName: 'Лишнее',
          guestEmail: 'extra@example.com',
        }),
      });
      expect(response.status, startsAt).toBe(400);
      const error = await response.json();
      expect(error.code).toBe('INVALID_TIME');
    }
  } finally {
    await backend.close();
  }
});
