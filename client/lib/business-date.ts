/**
 * Business timezone date helpers shared by the production pages.
 *
 * The server keeps every business date in a fixed business timezone (the
 * `people.timeZone` configuration, which defaults to Asia/Shanghai), while
 * `new Date().toISOString()` reads UTC. Between 00:00 and 08:00 Shanghai
 * time the UTC date is still the previous day, so pages that sliced ISO
 * strings showed a date one day behind. These helpers read the wall clock
 * in the business timezone instead.
 */

/** Business timezone; keep in sync with the server `people.timeZone` default. */
export const businessTimeZone = 'Asia/Shanghai';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: businessTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: businessTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: businessTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

/** Today's date in the business timezone, as YYYY-MM-DD. */
export function businessDate(at: Date = new Date()): string {
  return dateFormatter.format(at);
}

/** Current wall-clock HH:mm in the business timezone. */
export function businessClock(at: Date = new Date()): string {
  return clockFormatter.format(at);
}

/** Format an instant as YYYY/MM/DD HH:mm in the business timezone. */
export function businessDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** YYYY-MM-DDTHH:mm default for datetime-local inputs, in the business timezone. */
export function businessDateTimeInput(at: Date = new Date()): string {
  return `${businessDate(at)}T${businessClock(at)}`;
}

/** UTC offset of the business timezone at the given instant, in milliseconds. */
function businessOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * ISO instant for a wall-clock date and time (YYYY-MM-DD, HH:mm) read in the
 * business timezone. The offset is resolved through Intl, so it follows the
 * timezone database instead of a hardcoded +08:00.
 */
export function businessInstant(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = (time || '00:00').split(':').map(Number);
  const provisional = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(provisional - businessOffsetMs(new Date(provisional))).toISOString();
}
