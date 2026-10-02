import stringWidth from 'string-width';

export interface ITable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** One row per item; pad by terminal columns, including wide Unicode characters. */
export function alignedTable(table: ITable, markdown = false): string {
  const cell = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    return markdown ? text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|') : text;
  };
  const rows = [
    table.headers.map((header) => (markdown ? header : header.toUpperCase())),
    ...table.rows,
  ].map((row) => row.map(cell));
  const widths = table.headers.map((_, column) =>
    rows.reduce((width, row) => Math.max(width, stringWidth(row[column] ?? '')), markdown ? 3 : 0),
  );
  if (markdown)
    rows.splice(
      1,
      0,
      widths.map((width) => '-'.repeat(width)),
    );
  return rows
    .map((row) => {
      const cells = row.map(
        (value, column) => value + ' '.repeat(widths[column]! - stringWidth(value)),
      );
      return markdown ? `| ${cells.join(' | ')} |` : cells.join('  ').trimEnd();
    })
    .join('\n');
}
