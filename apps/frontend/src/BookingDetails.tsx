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
  timeZone,
  zoneLabel,
}: {
  meetingType: MeetingType;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  zoneLabel: string;
}) {
  return (
    <div className="space-y-2 break-words">
      <p className="text-xl font-semibold">{meetingType.name}</p>
      <p>{dayLabel(timeZone).format(new Date(startsAt))}</p>
      <p>
        {timeLabel(timeZone).format(new Date(startsAt))} –{' '}
        {timeLabel(timeZone).format(new Date(endsAt))}
      </p>
      <p>{meetingType.durationMinutes} мин</p>
      <p className="font-medium">{zoneLabel}</p>
    </div>
  );
}
