import { expect, test } from 'vitest';
import { formatStockQuantity } from '../../client/lib/stock-quantity.js';
test('quantity display retains values above Number safe integer, six decimal places and negative fractions in both supported languages', () => {
  expect(formatStockQuantity('9007199254740993.000001', 'en-US')).toBe(
    '9,007,199,254,740,993.000001',
  );
  expect(formatStockQuantity('9007199254740993.000001', 'zh-CN')).toBe(
    '9,007,199,254,740,993.000001',
  );
  expect(formatStockQuantity('-0.000001', 'en-US')).toBe('-0.000001');
  expect(formatStockQuantity('12.340000', 'de-DE')).toBe('12,340000');
});
