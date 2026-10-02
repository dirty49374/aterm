import { AtermError } from '../error.js';
import type { IndexedCorpus } from './corpus.js';
import { corpusJson } from './corpus-json.js';
import { jqRequest, jqLimits, type JqRequest, type JsonValue } from './jq-request.js';

export type JqEvaluator = (
  input: string,
  program: string,
  bindings?: Record<string, JsonValue> | null,
) => Promise<readonly JsonValue[]>;

/** Project a supplied snapshot and delegate evaluation through an injected runtime. */
export function readJq(
  corpus: IndexedCorpus,
  input: JqRequest,
  evaluate: JqEvaluator,
  caseSensitive = false,
): Promise<readonly JsonValue[]> {
  const request = jqRequest.parse(input);
  if (Buffer.byteLength(request.program) > jqLimits.programBytes)
    throw new AtermError('jq.limit', 'jq program exceeds 64 KiB.');
  return evaluate(
    corpusJson(corpus, request.knowledge, caseSensitive),
    request.program,
    request.bindings,
  );
}
