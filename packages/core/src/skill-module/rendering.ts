import { stringify } from 'yaml';

export function skillDocument(name: string, description: string, body: string): string {
  return `---\n${stringify({ name, description })}---\n\n${body}`;
}
