/** Render a date-only or timestamp value in the reader's locale. */
export function formatDashboardDate(
  value: string | null | undefined,
  language: string,
): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(language);
}
