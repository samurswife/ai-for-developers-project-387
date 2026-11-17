import type { MeetingType } from '@calendar/api-sdk';

function dayLabel(timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, dateStyle: 'long' });
}
function timeLabel(timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function BookingDetails({
  meetingType,
  startsAt,
  endsAt,
  primaryTimeZone,
  primaryZoneLabel,
  secondaryTimeZone,
  secondaryZoneLabel,
}: {
  meetingType: MeetingType;
  startsAt: string;
  endsAt: string;
  primaryTimeZone: string;
  primaryZoneLabel: string;
  secondaryTimeZone?: string;
  secondaryZoneLabel?: string;
}) {
  return (
    <div className="space-y-2 break-words">
      <p className="text-xl font-semibold">{meetingType.name}</p>
      <p>{dayLabel(primaryTimeZone).format(new Date(startsAt))}</p>
      <p>
        {timeLabel(primaryTimeZone).format(new Date(startsAt))} –{' '}
        {timeLabel(primaryTimeZone).format(new Date(endsAt))}
      </p>
      <p>{meetingType.durationMinutes} мин</p>
      <p className="font-medium">{primaryZoneLabel}</p>
      {secondaryTimeZone && secondaryZoneLabel && (
        <div className="mt-3 border-t border-border pt-2 text-sm text-muted-foreground">
          <p>{dayLabel(secondaryTimeZone).format(new Date(startsAt))}</p>
          <p>
            {timeLabel(secondaryTimeZone).format(new Date(startsAt))} –{' '}
            {timeLabel(secondaryTimeZone).format(new Date(endsAt))}
          </p>
          <p className="font-medium">{secondaryZoneLabel}</p>
        </div>
      )}
    </div>
  );
}
