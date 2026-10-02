/**
 * The one ordering for every name, phrase and path a result presents. Code-unit order, not
 * `localeCompare`: the same _aterm_development:Corpus_Scan_Result_ must give the same _aterm_development:Query_Result_ on every machine,
 * and a runtime's default locale is not part of the corpus. Authored Relation lines use
 * this same comparison, so formatting and reading agree.
 */
export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
