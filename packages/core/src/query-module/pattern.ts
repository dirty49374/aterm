import { matchesGlob } from 'node:path';
import { TextMatching } from '../matching.js';

/** Whole-string glob rules. Internal identities and authoring stay exact by default. */
export class GlobPattern {
  readonly isGlob: boolean;

  constructor(
    readonly text: string,
    private readonly caseSensitive = true,
  ) {
    if (!text.trim()) throw new Error('A name or source pattern must not be empty.');
    this.isGlob = /[*?\[{}()]/.test(text);
  }

  matches(value: string): boolean {
    const matching = new TextMatching(this.caseSensitive);
    return this.isGlob
      ? matchesGlob(matching.normalize(value), matching.normalize(this.text))
      : matching.equals(value, this.text);
  }
}
