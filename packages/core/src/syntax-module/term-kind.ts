import type { AtermTermKind } from './schema.js';
import { TextMatching } from '../matching.js';

/** _aterm:Term_Kind_ has a local name owned by one Viewpoint. */
export const viewpointNamePattern = '[A-Za-z][A-Za-z0-9-]*';
export const localTermKindPattern = '[a-z][a-z0-9-]*';
export const termKindPattern = `(?:${viewpointNamePattern}\\.)?${localTermKindPattern}`;

export function localTermKind(spelling: string): string {
  return spelling.slice(spelling.lastIndexOf('.') + 1);
}

/** Preserve authored spelling separately; identity always includes the resolved owner. */
export function termKindIdentity(spelling: string, viewpoint?: string): string {
  return spelling.includes('.') || !viewpoint ? spelling : `${viewpoint}.${spelling}`;
}

export function matchesTermKind(
  selector: string,
  spelling: string,
  viewpoint?: string,
  caseSensitive = true,
): boolean {
  const matching = new TextMatching(caseSensitive);
  return selector.includes('.')
    ? matching.equals(selector, termKindIdentity(spelling, viewpoint))
    : matching.equals(selector, localTermKind(spelling));
}

export function resolveTermKind(
  termKinds: readonly AtermTermKind[],
  spelling: string,
  caseSensitive = true,
): AtermTermKind {
  const candidates = termKinds.filter((termKind) =>
    matchesTermKind(spelling, termKind.name, termKind.viewpoint, caseSensitive),
  );
  if (candidates.length === 1) return candidates[0]!;
  const names = (candidates.length ? candidates : termKinds)
    .map((termKind) => termKindIdentity(termKind.name, termKind.viewpoint))
    .join(', ');
  throw new Error(
    candidates.length
      ? `Ambiguous Term Kind ${spelling}; qualify it with its Viewpoint: ${names}.`
      : `Unknown Term Kind ${spelling}; expected ${names}.`,
  );
}

/** A Term has one Term Declaration; Term Kind and Group are attributes, not identity components. */
export function termDeclarationIdentity(termDeclaration: { id: string }): string {
  return termDeclaration.id;
}
