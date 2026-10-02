import {
  termDeclarationIdentity,
  termKindIdentity,
  matchesTermKind,
} from '../../core/src/syntax-module/term-kind.js';

/** Shared Term Kind identities and selectors are also used by parser and authoring. */
export const termDeclarationTermKind = (termDeclaration) =>
  termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint);
export { matchesTermKind };
export { localTermKind } from '../../core/src/syntax-module/term-kind.js';
export { serverProtocol } from '../../core/src/server-module/protocol.js';
export { builtInRelations } from '../../core/src/syntax-module/relation.js';

/** Library scope never changes the corpus available to reading and graph exploration. */
export function scopedTermDeclarations(termDeclarations, knowledge = '') {
  return termDeclarations.filter(
    (termDeclaration) => !knowledge || termDeclaration.knowledge === knowledge,
  );
}
export function knowledgeCatalog(knowledges, termDeclarations) {
  return knowledges.map((knowledge) => {
    const owned = scopedTermDeclarations(termDeclarations, knowledge.id);
    return {
      ...knowledge,
      terms: new Set(owned.map((termDeclaration) => termDeclaration.id)).size,
      termDeclarations: owned.length,
    };
  });
}
export function libraryGroups(
  termDeclarations,
  { knowledge = '', termKind = '', viewpoint = '', q = '', matchNames = null } = {},
) {
  const groups = new Map();
  for (const termDeclaration of scopedTermDeclarations(termDeclarations, knowledge)) {
    if (
      (termKind &&
        !matchesTermKind(termKind, termDeclaration.termKind, termDeclaration.viewpoint)) ||
      (viewpoint && viewpoint !== termDeclaration.viewpoint)
    )
      continue;
    if (
      q &&
      !(matchNames
        ? matchNames.has(termDeclarationKey(termDeclaration))
        : (termDeclaration.name + ' ' + termDeclaration.id + ' ' + termDeclaration.definition)
            .toLowerCase()
            .includes(q.toLowerCase()))
    )
      continue;
    if (!groups.has(termDeclaration.id)) groups.set(termDeclaration.id, []);
    groups.get(termDeclaration.id).push(termDeclaration);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Term Declaration identity excludes its organization path. */
export const termDeclarationKey = termDeclarationIdentity;

// Bundled for the browser; CLI, library and Graph use the same authored hierarchy.
export { groupTree } from '../../core/src/query-module/group-tree.js';
