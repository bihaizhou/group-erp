/** Exact display only. Quantity input and transport remain decimal strings. */
export function formatStockQuantity(value: string, locale: string) {
  if (!/^-?(0|[1-9]\d*)(\.\d{1,6})?$/u.test(value)) return '—';
  const [whole, fraction] = value.split('.'),
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    integer = formatter.format(BigInt(whole));
  if (!fraction) return integer;
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.';
  return `${whole === '-0' ? '-' : ''}${integer}${separator}${fraction}`;
}
