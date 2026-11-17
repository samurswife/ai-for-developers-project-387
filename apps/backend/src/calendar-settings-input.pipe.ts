import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { FieldError, UpdateCalendarSettingsRequest } from '@calendar/api-sdk';

@Injectable()
export class CalendarSettingsInputPipe implements PipeTransform<unknown, UpdateCalendarSettingsRequest> {
  transform(value: unknown): UpdateCalendarSettingsRequest {
    const fieldErrors: FieldError[] = [];
    const invalid = (field: string, message: string) =>
      fieldErrors.push({ field, code: 'VALIDATION_ERROR', message });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalid('body', 'Ожидается JSON-объект.');
    } else {
      const body = value as Record<string, unknown>;
      for (const key of Object.keys(body))
        if (!['timeZone'].includes(key)) invalid(key, 'Неизвестное поле.');
      if (typeof body.timeZone !== 'string' || !body.timeZone.trim())
        invalid('timeZone', 'Ожидается непустая строка IANA-зоны.');
      if (!fieldErrors.length) return { timeZone: (body.timeZone as string).trim() };
    }
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Проверьте поля запроса.',
      fieldErrors,
    });
  }
}
