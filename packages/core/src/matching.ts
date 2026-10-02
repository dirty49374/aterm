/** Locale-independent matching of query text; never changes stored identity or output. */
export class TextMatching {
  constructor(readonly caseSensitive = false) {}

  normalize(text: string): string {
    return this.caseSensitive ? text : text.toLowerCase();
  }

  equals(left: string, right: string): boolean {
    return this.normalize(left) === this.normalize(right);
  }

  literal(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), this.caseSensitive ? 'u' : 'iu');
  }
}
