import type { OrgOptions } from './model.js';
function scalar(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
}
export function displayValue(
  key: string,
  value: unknown,
  options: OrgOptions | undefined,
  t: (key: string) => string,
  locale: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'type' || key === 'productionRole')
    return t(`org.types.${scalar(value)}`);
  if (key === 'status')
    return t(value === 'active' ? 'org.active' : 'org.inactive');
  if (key === 'sourceKind' || key === 'targetKind' || key === 'kind')
    return t(`org.${scalar(value)}`);
  if (key.endsWith('Id'))
    return (
      Object.values(options ?? {})
        .flatMap((v) => v.rows)
        .find((row) => row.id === value)?.name ?? scalar(value)
    );
  if (typeof value === 'number') return value.toLocaleString(locale);
  if (Array.isArray(value))
    return value.map(scalar).filter(Boolean).join('、') || '—';
  return scalar(value) || '—';
}
