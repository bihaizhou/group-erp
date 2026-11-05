import { normalizeDecimal } from './material-model.js';
import { inventoryError, stockMicros } from './inventory-quantity.js';

/**
 * Order money is derived once, when the document is saved, and stored on the
 * row. Quantities are fixed-point at 6 decimals, unit prices at 8; the amount
 * is rounded half-up to the currency's 2 decimals so a later price change can
 * never rewrite an approved order.
 */
const priceScale = 100_000_000n;
const centScale = 100n;
const divisor = 1_000_000_000_000n;
const maxWhole = 999_999_999_999_999_999n;

function formatCents(cents: bigint): string {
  const integer = cents / centScale;
  if (integer > maxWhole)
    return inventoryError('STOCK_AMOUNT_OVERFLOW', 'unitPrice');
  const fraction = (cents % centScale).toString().padStart(2, '0');
  return normalizeDecimal(`${integer}.${fraction}`);
}

export function orderAmount(
  quantity: string,
  unitPrice: string | null,
): string | null {
  if (unitPrice === null) return null;
  const [whole, fraction = ''] = unitPrice.split('.');
  const price = BigInt(whole) * priceScale + BigInt(fraction.padEnd(8, '0'));
  const product = stockMicros(quantity) * price;
  let cents = product / divisor;
  if ((product % divisor) * 2n >= divisor) cents += 1n;
  return formatCents(cents);
}

export function orderTotal(amounts: (string | null)[]): string | null {
  if (amounts.every((amount) => amount === null)) return null;
  let cents = 0n;
  for (const amount of amounts) {
    if (amount === null) continue;
    const [whole, fraction = ''] = amount.split('.');
    cents += BigInt(whole) * centScale + BigInt(fraction.padEnd(2, '0'));
  }
  return formatCents(cents);
}
