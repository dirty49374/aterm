import { AtermError } from '../error.js';

export type ITermPatch =
  | { readonly operation: 'update'; readonly target: string; readonly hunks: readonly IPatchHunk[] }
  | { readonly operation: 'add'; readonly target: string; readonly lines: readonly string[] }
  | { readonly operation: 'delete'; readonly target: string };
interface IPatchHunk {
  readonly anchor?: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly end: boolean;
}

interface MutableHunk {
  anchor?: string;
  before: string[];
  after: string[];
  end: boolean;
}
interface PatchBlock {
  operation: 'add' | 'update' | 'delete';
  target: string;
  hunks: MutableHunk[];
  lines: string[];
}

/** One context-hunk grammar and matcher for bounded source edits. */
export class ContextPatch {
  constructor(private readonly subject: 'Term' | 'Knowledge' = 'Term') {}
  parse(text: string): ITermPatch[] {
    const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
    if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch')
      this.fail('Expected *** Begin Patch and *** End Patch.');
    const result: PatchBlock[] = [];
    let current: PatchBlock | undefined;
    let hunk: MutableHunk | undefined;
    for (const line of lines) {
      const header = this.patchHeader(line);
      if (header) {
        current = header;
        result.push(current);
        hunk = undefined;
      } else hunk = this.patchLine(line, current, hunk);
    }
    if (!result.length) this.fail(`Patch must contain at least one ${this.subject} operation.`);
    return result.map((block) => this.finishBlock(block));
  }

  private patchHeader(line: string): PatchBlock | undefined {
    const header = line.match(new RegExp(`^\\*\\*\\* (Add|Update|Delete) ${this.subject}: (.+)$`));
    if (header) {
      if (this.subject === 'Knowledge' && header[1] !== 'Update')
        this.fail('Knowledge patches accept only Update Knowledge blocks.');
      return {
        operation: header[1]!.toLowerCase() as 'add' | 'update' | 'delete',
        target: header[2]!,
        hunks: [],
        lines: [],
      };
    }
    return undefined;
  }
  private patchLine(
    line: string,
    current: PatchBlock | undefined,
    hunk: MutableHunk | undefined,
  ): MutableHunk | undefined {
    if (current?.operation === 'add') {
      if (!line.startsWith('+'))
        this.fail('Add Term lines require + prefixes and one complete Term Declaration.');
      current.lines.push(line.slice(1));
    } else if (line === '@@' || line.startsWith('@@ ')) {
      if (current?.operation !== 'update')
        this.fail(`A hunk requires *** Update ${this.subject}: <selector>.`);
      hunk = {
        ...(line.length > 2 ? { anchor: line.slice(3) } : {}),
        before: [],
        after: [],
        end: false,
      };
      current!.hunks.push(hunk);
    } else if (line === '*** End of File') {
      if (!hunk) this.fail('End of File requires a hunk.');
      hunk.end = true;
    } else {
      if (current?.operation === 'delete')
        this.fail('Delete Term accepts only its selector, without a body.');
      if (!hunk || hunk.end) this.fail(`Expected a ${this.subject} patch header or @@ hunk.`);
      this.appendHunkLine(line, hunk!);
    }
    return hunk;
  }
  private appendHunkLine(line: string, hunk: MutableHunk): void {
    const prefix = line[0];
    if (prefix === ' ' || prefix === '-') hunk!.before.push(line.slice(1));
    if (prefix === ' ' || prefix === '+') hunk!.after.push(line.slice(1));
    if (![' ', '-', '+'].includes(prefix ?? ''))
      this.fail('Hunk lines require space, - or + prefixes.');
  }
  private finishBlock(p: PatchBlock): ITermPatch {
    if (p.operation === 'add') {
      if (!p.lines.some((line) => line.trim()))
        this.fail('Add Term requires one complete Term Declaration.');
      return { operation: 'add', target: p.target, lines: p.lines };
    }
    if (p.operation === 'delete') return { operation: 'delete', target: p.target };
    if (!p.hunks.length || p.hunks.some((h) => !h.before.length && !h.after.length))
      this.fail(`Update ${this.subject} must contain nonempty hunks.`);
    return { operation: 'update', target: p.target, hunks: p.hunks };
  }

  apply(source: readonly string[], patch: ITermPatch): string[] {
    if (patch.operation !== 'update') this.fail('Context hunks require an Update Term patch.');
    const result = [...source];
    let cursor = 0;
    for (const hunk of patch.hunks) {
      if (hunk.anchor !== undefined)
        cursor = this.locate(result, [hunk.anchor], cursor, false, patch.target) + 1;
      const at = hunk.before.length
        ? this.locate(result, hunk.before, cursor, hunk.end, patch.target)
        : result.length;
      result.splice(at, hunk.before.length, ...hunk.after);
      cursor = at + hunk.after.length;
    }
    return result;
  }

  private locate(
    lines: readonly string[],
    before: readonly string[],
    start: number,
    end: boolean,
    target: string,
  ): number {
    for (const normalize of [
      (s: string) => s,
      (s: string) => s.trimEnd(),
      (s: string) => s.trim(),
    ]) {
      const positions: number[] = [];
      for (let i = start; i <= lines.length - before.length; i++) {
        if (end && i + before.length !== lines.length) continue;
        if (before.every((line, j) => normalize(line) === normalize(lines[i + j]!)))
          positions.push(i);
      }
      if (positions.length > 1)
        this.fail(`Ambiguous context in ${target}; include more surrounding lines.`);
      if (positions.length === 1) return positions[0]!;
    }
    return this.fail(
      `Context not found in ${target}; read the current ${this.subject} before editing.`,
    );
  }
  private fail(message: string): never {
    throw new AtermError('aterm.patch', message);
  }
}

/** Term-addressed public API, using the shared context-patch mechanism. */
export class TermPatch extends ContextPatch {}
