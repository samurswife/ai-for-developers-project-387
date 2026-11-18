import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';
import type { CalendarSettingsBody, UpdateCalendarSettingsRequest } from '@calendar/api-sdk';
import type { CalendarSettingsControllerMethods } from '@calendar/api-sdk/nestjs';
import { calendar, isValidIanaTimeZone } from './calendar.js';
import { CalendarSettingsInputPipe } from './calendar-settings-input.pipe.js';

@Controller('api/calendar-settings')
export class CalendarSettingsController implements CalendarSettingsControllerMethods {
  @Get()
  async calendarSettingsGetCalendarSettings(): Promise<CalendarSettingsBody> {
    return { timeZone: calendar.timeZone };
  }

  @Put()
  async calendarSettingsUpdateCalendarSettings(
    @Body(CalendarSettingsInputPipe) body: UpdateCalendarSettingsRequest,
  ): Promise<CalendarSettingsBody> {
    if (!isValidIanaTimeZone(body.timeZone)) {
      throw new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте поля запроса.',
          fieldErrors: [
            {
              field: 'timeZone',
              code: 'VALIDATION_ERROR',
              message: 'Ожидается корректный IANA-идентификатор часового пояса.',
            },
          ],
        },
        400,
      );
    }
    calendar.timeZone = body.timeZone;
    return { timeZone: calendar.timeZone };
  }
}
