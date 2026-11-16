export type CsvColumn<T> = {
  key: string;
  label: string;
  value?: (row: T) => string;
};

const cell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Builds a UTF-8 CSV (with BOM) so Excel opens Chinese headers correctly. */
export function buildCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const header = columns.map((column) => cell(column.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) =>
        cell(
          column.value
            ? column.value(row)
            : (row as Record<string, unknown>)[column.key],
        ),
      )
      .join(','),
  );
  return `\ufeff${[header, ...lines].join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
}
