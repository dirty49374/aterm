import { AtermError } from '../error.js';
import { byText } from '../order.js';
import type { ITermDeclaration } from '../syntax-module/index.js';
import { termKindIdentity } from '../syntax-module/term-kind.js';
import { readStructured } from '../syntax-module/structured.js';
import type { IndexedCorpus } from './corpus.js';
import { jqLimits } from './jq-request.js';

/** Select an OR-set of exact Knowledge identities in an already validated snapshot. */
export function selectedKnowledges(
  corpus: IndexedCorpus,
  names?: readonly string[] | null,
  caseSensitive = false,
): readonly string[] | undefined {
  return names == null
    ? undefined
    : [...new Set(names.map((name) => corpus.index.requireKnowledge(name, caseSensitive)!))].sort(
        byText,
      );
}

/** Section keys are the authored namespace; @-prefixed keys are Term metadata. */
export function corpusJson(
  corpus: IndexedCorpus,
  knowledge?: readonly string[] | null,
  caseSensitive = false,
): string {
  const selected = selectedKnowledges(corpus, knowledge, caseSensitive);
  const records: string[] = [];
  let bytes = 2;
  for (const declaration of corpus.index.termDeclarations) {
    if (selected && !selected.includes(declaration.knowledge)) continue;
    const record = termJson(declaration);
    const json = JSON.stringify(record, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new AtermError(
          'jq.input',
          `Non-finite number in ${declaration.id} cannot be represented as JSON.`,
        );
      return value;
    });
    bytes += Buffer.byteLength(json) + (records.length ? 1 : 0);
    if (bytes > jqLimits.inputBytes)
      throw new AtermError('jq.limit', 'jq input exceeds 16 MiB; select fewer Knowledges.');
    records.push(json);
  }
  return '[' + records.join(',') + ']';
}

/** Shared section projection for jq roots and GraphQL collection predicates. */
export function termJson(declaration: ITermDeclaration): Record<string, unknown> {
  const record: Record<string, unknown> = Object.create(null);
  record['@term'] = declaration.id;
  record['@knowledge'] = declaration.knowledge;
  record['@viewpoint'] = declaration.viewpoint ?? null;
  record['@termKind'] = termKindIdentity(declaration.termKind, declaration.viewpoint);
  record['@group'] = declaration.group ?? null;
  for (const section of declaration.sections) {
    record[section.key] =
      section.filetype === 'json' || section.filetype === 'yaml'
        ? readStructured(section.content, section.filetype).value
        : section.content;
  }
  return record;
}
