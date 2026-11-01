import { expect, test } from 'vitest';
import {
  stockMicros,
  stockQuantity,
  stockDelta,
  stockDeltaMicros,
  stockPrecision,
} from '../../server/providers/inventory-quantity.js';
test('inventory arithmetic retains fractional quantities above the safe integer boundary', () => {
  expect(
    stockQuantity(
      stockMicros('9007199254740993.125') - stockMicros('0.000001'),
    ),
  ).toBe('9007199254740993.124999');
  expect(stockQuantity(stockMicros('0.1') + stockMicros('0.2'))).toBe('0.3');
  expect(stockDelta(-stockMicros('1.250000'))).toBe('-1.25');
  expect(stockDeltaMicros('-1.25') + stockMicros('1.25')).toBe(0n);
  expect(stockQuantity(0n)).toBe('0');
});
test('inventory rejects negative stock, overflow and unsupported unit precision', () => {
  expect(() =>
    stockQuantity(stockMicros('1') - stockMicros('1.000001')),
  ).toThrow();
  expect(() =>
    stockQuantity(stockMicros('999999999999999999.999999') + 1n),
  ).toThrow();
  for (const value of ['1e3', '-1', '01', '0.0000001', 'NaN'])
    expect(() => stockMicros(value)).toThrow();
  expect(() => stockPrecision(stockMicros('1.5'), 0)).toThrow();
  expect(() => stockPrecision(stockMicros('1.25'), 2)).not.toThrow();
});
