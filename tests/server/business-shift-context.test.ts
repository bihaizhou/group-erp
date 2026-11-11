// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { businessShiftContext } from '../../server/providers/business-date.js';

describe('businessShiftContext', () => {
  it('uses the civil day for the day shift', () => {
    const at = new Date('2026-11-09T02:30:00Z'); // 10:30 in Shanghai
    expect(businessShiftContext('Asia/Shanghai', at)).toEqual({
      reportDate: '2026-11-09',
      shift: 'day',
    });
  });

  it('starts the night shift at 20:00 on the same civil day', () => {
    const at = new Date('2026-11-09T12:30:00Z'); // 20:30 in Shanghai
    expect(businessShiftContext('Asia/Shanghai', at)).toEqual({
      reportDate: '2026-11-09',
      shift: 'night',
    });
  });

  it('keeps a night shift filed after midnight on the day it started', () => {
    const at = new Date('2026-11-09T18:30:00Z'); // 02:30 on the 10th in Shanghai
    expect(businessShiftContext('Asia/Shanghai', at)).toEqual({
      reportDate: '2026-11-09',
      shift: 'night',
    });
  });
});
