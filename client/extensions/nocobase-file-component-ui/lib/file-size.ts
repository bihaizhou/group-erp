export function formatFileSize(value: string | number, locale: string): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return '—';
  const divisor = size >= 1024 * 1024 ? 1024 * 1024 : size >= 1024 ? 1024 : 1;
  const unit = divisor === 1024 * 1024 ? 'MiB' : divisor === 1024 ? 'KiB' : 'B';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / divisor)} ${unit}`;
}
