/** Civil business dates must not depend on the server's OS or a visitor's timezone. */
export function businessDate(
  timeZone = 'Asia/Shanghai',
  at = new Date(),
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Hour of the day (0-23) in the business timezone. */
export function businessHour(
  timeZone = 'Asia/Shanghai',
  at = new Date(),
): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return Number(hour);
}

/** The production shift in progress: 08:00-20:00 is the day shift. */
export function businessShift(
  timeZone = 'Asia/Shanghai',
  at = new Date(),
): 'day' | 'night' {
  const hour = businessHour(timeZone, at);
  return hour >= 8 && hour < 20 ? 'day' : 'night';
}

/**
 * The shift a report belongs to right now. The night shift starts at 20:00 and
 * runs past midnight, so a report filed at 02:00 still belongs to the previous
 * business day.
 */
export function businessShiftContext(
  timeZone = 'Asia/Shanghai',
  at = new Date(),
): { reportDate: string; shift: 'day' | 'night' } {
  const hour = businessHour(timeZone, at);
  const today = businessDate(timeZone, at);
  if (hour >= 8 && hour < 20) return { reportDate: today, shift: 'day' };
  return {
    reportDate: hour >= 20 ? today : shiftDate(today, -1),
    shift: 'night',
  };
}

function shiftDate(date: string, days: number): string {
  const start = Date.parse(`${date}T00:00:00Z`);
  return new Date(start + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
