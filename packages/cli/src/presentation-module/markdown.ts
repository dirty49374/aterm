/** Two empty lines after the final content line, including redirected output. */
export function markdownEnd(text: string): string {
  return text.replace(/\s+$/, '') + '\n\n\n';
}

export { codeBlock } from '@aterm/core';

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (text: string) =>
    text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return [headers, headers.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
}
