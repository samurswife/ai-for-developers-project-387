import { expect, test } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import openapi from '../../specs/generated/openapi.json' with { type: 'json' };
import { startBackend } from './apps.js';

const ajv = new Ajv2020({ allErrors: true, strictSchema: false });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat('int32', { type: 'number', validate: Number.isInteger });
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => /Z$/.test(value) && Number.isFinite(Date.parse(value)),
});
const document = ajv.addSchema(openapi, 'api');

async function settingsResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
  const validate = document.compile({
    $ref: `api#/paths/~1api~1calendar-settings/${response.url.endsWith('/api/calendar-settings') && response.body ? 'put' : 'get'}/responses/${status}/content/application~1json/schema`,
  });
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

test('a fresh server returns the default owner time zone', async () => {
  const backend = await startBackend();
  const response = await fetch(`${backend.url}/api/calendar-settings`);
  await settingsResponse(response, 200);
  expect(await response.json()).toEqual({ timeZone: 'Europe/Moscow' });
  await backend.close();
});
