import { ApiError } from '@nocobase/app-server/router';
import { decimalText, normalizeDecimal } from './material-model.js';

const scale = 1_000_000n;
const limit = 10n ** 24n - 1n;
export function inventoryError(reason: string, field?: string): never {
  throw new ApiError({
    status:
      reason.endsWith('_CONFLICT') || reason.endsWith('_KEY_REUSED')
        ? 'ABORTED'
        : reason.endsWith('_FORBIDDEN')
          ? 'PERMISSION_DENIED'
          : reason.endsWith('_NOT_FOUND')
            ? 'NOT_FOUND'
            : 'FAILED_PRECONDITION',
    domain: 'inventory',
    reason,
    message: 'The inventory operation could not be completed.',
    ...(field ? { fieldViolations: [{ field, description: reason }] } : {}),
  });
}
/** Quantity arithmetic is always fixed-point; Number is only used for precision. */
export function stockMicros(value: string): bigint {
  const parsed = decimalText.safeParse(value);
  if (!parsed.success)
    return inventoryError('STOCK_QUANTITY_INVALID', 'quantity');
  const [whole, fraction = ''] = parsed.data.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
}
export function stockQuantity(value: bigint): string {
  if (value < 0n) return inventoryError('STOCK_INSUFFICIENT');
  if (value > limit) return inventoryError('STOCK_QUANTITY_OVERFLOW');
  return normalizeDecimal(
    `${value / scale}.${String(value % scale).padStart(6, '0')}`,
  );
}
export function stockDelta(value: bigint): string {
  return value < 0n ? `-${stockQuantity(-value)}` : stockQuantity(value);
}
export function stockDeltaMicros(value: string): bigint {
  return value.startsWith('-')
    ? -stockMicros(value.slice(1))
    : stockMicros(value);
}
export function stockPrecision(value: bigint, precision: number): void {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 6 ||
    value % 10n ** BigInt(6 - precision) !== 0n
  )
    inventoryError('STOCK_QUANTITY_PRECISION', 'quantity');
}
