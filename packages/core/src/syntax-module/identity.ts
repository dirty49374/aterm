/** Shared grammar for authored spellings and canonical Term identities. */
export const knowledgePattern = '[a-z][a-z0-9]*(?:_[a-z0-9]+)*';
export const groupPathPattern = `${knowledgePattern}(?:\\.${knowledgePattern})*`;
const localBody = '[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*';
export const localTermPattern = `_${localBody}_`;
export const qualifiedTermPattern = `_(${knowledgePattern}):(${localBody})_`;
export const referencePattern = `_(?:${knowledgePattern}:)?${localBody}_`;

export function termIdentity(spelling: string, knowledge: string): string {
  return spelling.includes(':') ? spelling : `_${knowledge}:${spelling.slice(1)}`;
}

export function localTerm(spelling: string): string {
  return spelling.includes(':') ? '_' + spelling.slice(spelling.indexOf(':') + 1) : spelling;
}

export function termKnowledge(id: string): string | undefined {
  return id.includes(':') ? id.slice(1, id.indexOf(':')) : undefined;
}

/** Context controls boundary rules; every context uses the same Term grammar. */
export function termTokens(context: 'trm' | 'external'): RegExp {
  return context === 'external'
    ? new RegExp(`(?<![\\p{ID_Continue}$:])${qualifiedTermPattern}(?![\\p{ID_Continue}$:])`, 'gu')
    : new RegExp(`(?<![A-Za-z0-9_\\\\:])${referencePattern}(?![A-Za-z0-9_:])`, 'g');
}
