import { isAlias, isScalar, parseDocument, visit } from 'yaml';
import { termTokens } from './identity.js';

export interface IStructuredReference {
  readonly name: string;
  readonly offset: number;
  readonly targetSection?: string;
}

/** Structured values keep literal Term tokens addressable in their authored source. */
export function readStructured(
  content: string,
  format: 'yaml' | 'json',
): {
  readonly value: unknown;
  readonly references: readonly IStructuredReference[];
} {
  if (format === 'json') JSON.parse(content);
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      [...document.errors, ...document.warnings].map((issue) => issue.message).join('; '),
    );
  const references: IStructuredReference[] = [];
  visit(document, (_key, node) => {
    if (isAlias(node))
      throw new Error('Structured sections do not support YAML aliases; reference a Term instead.');
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return;
    const decoded = [...node.value.matchAll(termTokens('trm'))];
    const source = content.slice(node.range[0], node.range[1]);
    const literal = [...source.matchAll(termTokens('trm'))];
    if (
      decoded.length !== literal.length ||
      decoded.some((match, i) => match[0] !== literal[i]?.[0])
    )
      throw new Error(
        'Structured Term references must use their literal spelling, without encoded escapes.',
      );
    for (const match of literal) {
      const section = source
        .slice(match.index + match[0].length)
        .match(/^\.([a-z][a-z0-9_]*)(?![A-Za-z0-9_])/);
      references.push({
        name: match[0],
        offset: node.range[0] + match.index,
        ...(section ? { targetSection: section[1] } : {}),
      });
    }
  });
  return { value: document.toJS({ maxAliasCount: 0 }), references };
}
