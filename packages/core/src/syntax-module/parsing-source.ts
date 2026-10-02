import type { AtermFiletype } from './schema.js';

export type ParseIssue = (line: number, message: string) => void;

export interface ISourceLine {
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** Section text before normalization, with coordinates for authored references. */
export interface ISectionSource {
  readonly key: string;
  readonly filetype: AtermFiletype;
  readonly line: number;
  readonly lines: ISourceLine[];
}

/** One owner of input position; peek leaves a line for the caller, take consumes it. */
export class SourceCursor {
  private readonly lines: readonly string[];
  private offset = 0;

  constructor(text: string) {
    this.lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  }

  get done(): boolean {
    return this.offset >= this.lines.length;
  }
  get position(): number {
    return this.offset;
  }
  peek(): string {
    return this.lines[this.offset]!;
  }
  take(): ISourceLine {
    return { text: this.lines[this.offset++]!, line: this.offset, column: 1 };
  }

  consumedFrom(start: number): { line: number; text: string }[] {
    return this.lines
      .slice(start - 1, this.offset)
      .map((text, offset) => ({ line: start + offset, text }));
  }
}

export function sectionContent(lines: readonly string[]): string {
  return lines.join('\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
}
