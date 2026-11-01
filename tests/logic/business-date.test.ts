// @vitest-environment node
import { expect, test } from 'vitest';
import { businessDate } from '../../server/providers/business-date.js';

test('uses the configured company calendar at UTC and local midnight boundaries', () => {
  const instant = new Date('2026-10-16T17:30:00Z');
  expect(businessDate('Asia/Shanghai', instant)).toBe('2026-10-17');
  expect(businessDate('America/Phoenix', instant)).toBe('2026-10-16');
  expect(businessDate('Asia/Shanghai', new Date('2026-10-16T15:59:59Z'))).toBe(
    '2026-10-16',
  );
  expect(businessDate('Asia/Shanghai', new Date('2026-10-16T16:00:00Z'))).toBe(
    '2026-10-17',
  );
  expect(() => businessDate('Invalid/Zone', instant)).toThrow();
});
