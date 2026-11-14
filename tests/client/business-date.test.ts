import { describe, expect, it } from 'vitest';
import {
  businessClock,
  businessDate,
  businessDateTime,
  businessDateTimeInput,
  businessInstant,
  businessTimeZone,
} from '../../client/lib/business-date.js';

// Asia/Shanghai is UTC+8: the business day rolls over at 16:00Z.
describe('business-date helpers', () => {
  it('reads the business timezone instead of UTC for dates', () => {
    // 2026-10-21T16:30Z is 2026-10-22 00:30 in Asia/Shanghai, so slicing
    // toISOString() would report the previous day.
    expect(businessDate(new Date('2026-10-21T16:30:00.000Z'))).toBe(
      '2026-10-22',
    );
    expect(businessDate(new Date('2026-10-21T15:59:00.000Z'))).toBe(
      '2026-10-21',
    );
    expect(businessDate(new Date('2026-10-21T08:30:00.000Z'))).toBe(
      '2026-10-21',
    );
  });

  it('formats the wall clock in the business timezone', () => {
    expect(businessClock(new Date('2026-10-21T16:30:00.000Z'))).toBe('00:30');
    expect(businessDateTime('2026-10-21T02:00:00.000Z')).toMatch(
      /10:00$/,
    );
    expect(businessDateTimeInput(new Date('2026-10-21T16:30:00.000Z'))).toBe(
      '2026-10-22T00:30',
    );
  });

  it('resolves instants from business wall-clock times', () => {
    expect(businessInstant('2026-10-21', '10:00')).toBe(
      '2026-10-21T02:00:00.000Z',
    );
    expect(businessInstant('2026-10-21', '00:30')).toBe(
      '2026-10-20T16:30:00.000Z',
    );
  });

  it('declares the fixed business timezone matching the server default', () => {
    expect(businessTimeZone).toBe('Asia/Shanghai');
  });
});
