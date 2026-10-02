import { byText } from '../order.js';
import { TextMatching } from '../matching.js';
import { termKindIdentity, type IDiagnostic } from '../syntax-module/index.js';
import type { ITermDeclarationView } from './projection.js';

export type SearchMode = 'lexical' | 'semantic' | 'hybrid';
export interface IDiscoveryChunk {
  readonly term: string;
  readonly name: string;
  readonly knowledge: string;
  readonly termKind: string;
  readonly definition: string;
  readonly section: string;
  readonly file: string;
  readonly line: number;
  readonly endLine: number;
  readonly excerpt: string;
  readonly input: string;
}
export interface IDiscoveryEvidence {
  readonly termKind: string;
  readonly section: string;
  readonly file: string;
  readonly line: number;
  readonly endLine: number;
  readonly excerpt: string;
  readonly lexicalScore?: number;
  readonly cosineDistance?: number;
}
export interface IDiscoveryCandidate {
  readonly rank: number;
  readonly id: string;
  readonly name: string;
  readonly knowledge: string;
  readonly termKinds: readonly string[];
  readonly definitions: readonly { readonly termKind: string; readonly text: string }[];
  readonly score: number;
  readonly exactName: boolean;
  readonly evidence: readonly IDiscoveryEvidence[];
}
export interface IDiscoveryResult {
  readonly operation: 'discover';
  readonly question: string;
  readonly mode: SearchMode;
  readonly searchSections?: readonly string[];
  readonly limit: number;
  readonly corpusFingerprint: string;
  readonly eligibleTerms: number;
  readonly totalCandidates: number;
  readonly truncated: boolean;
  readonly candidates: readonly IDiscoveryCandidate[];
  readonly warnings: readonly IDiagnostic[];
}

/** _aterm:Discover_Terms_: source sections stay separate; no dependency expansion. */
export function discoveryChunks(
  termDeclarations: readonly ITermDeclarationView[],
  includeRemarks = true,
  searchSections?: readonly string[],
): IDiscoveryChunk[] {
  return termDeclarations.flatMap((termDeclaration) => {
    const termKind = termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint);
    const label = `${termDeclaration.id} (${termKind})`;
    const definition =
      !searchSections || searchSections.includes('definition')
        ? Array.from(termDeclaration.definition.replace(/\s+/g, ' ')).slice(0, 192).join('')
        : '';
    return termDeclaration.sections.flatMap((section, index) => {
      if (!includeRemarks && section.key === 'remarks') return [];
      if (searchSections && !searchSections.includes(section.key)) return [];
      const characters = Array.from(section.content);
      const chunks: IDiscoveryChunk[] = [];
      // Bound model input while retaining every source character across chunks.
      for (let start = 0; start < characters.length; start += 384) {
        const excerpt = characters.slice(start, start + 384).join('');
        if (!excerpt.trim()) continue;
        chunks.push({
          term: termDeclaration.id,
          name: termDeclaration.name,
          knowledge: termDeclaration.knowledge,
          termKind,
          definition: termDeclaration.definition,
          section: section.key,
          file: termDeclaration.file,
          line: section.line,
          endLine: Math.max(
            section.line,
            (termDeclaration.sections[index + 1]?.line ?? termDeclaration.endLine) - 1,
          ),
          excerpt,
          input: `${label}\n${definition}\n${section.key}: ${excerpt}`,
        });
      }
      return chunks;
    });
  });
}

function tokens(text: string, caseSensitive = false): string[] {
  return new TextMatching(caseSensitive).normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** BM25 scores source chunks; absent words do not create lexical candidates. */
export function lexicalScores(
  chunks: readonly IDiscoveryChunk[],
  question: string,
  includeNames = true,
  caseSensitive = false,
): number[] {
  const words = [...new Set(tokens(question, caseSensitive))];
  const corpus = chunks.map((chunk) =>
    tokens(`${includeNames ? chunk.name : ''} ${chunk.excerpt}`, caseSensitive),
  );
  const average = corpus.reduce((sum, item) => sum + item.length, 0) / (corpus.length || 1);
  const frequencies = words.map((word) => corpus.filter((item) => item.includes(word)).length);
  return corpus.map((item) =>
    words.reduce((score, word, index) => {
      const frequency = item.filter((token) => token === word).length;
      const idf = Math.log(
        1 + (corpus.length - frequencies[index]! + 0.5) / (frequencies[index]! + 0.5),
      );
      return (
        score +
        (frequency
          ? (idf * frequency * 2.2) /
            (frequency + 1.2 * (0.25 + (0.75 * item.length) / (average || 1)))
          : 0)
      );
    }, 0),
  );
}

/** Rank Terms once per channel before fusion, so long Term Declarations gain no extra votes. */
export function rankDiscovery(
  chunks: readonly IDiscoveryChunk[],
  question: string,
  mode: SearchMode,
  limit: number,
  corpusFingerprint: string,
  distances?: readonly number[],
  warnings: readonly IDiagnostic[] = [],
  searchSections?: readonly string[],
  caseSensitive = false,
): IDiscoveryResult {
  const lexical =
    mode === 'semantic'
      ? chunks.map(() => 0)
      : lexicalScores(chunks, question, !searchSections, caseSensitive);
  const groups = new Map<string, number[]>();
  chunks.forEach((chunk, index) =>
    groups.set(chunk.term, [...(groups.get(chunk.term) ?? []), index]),
  );
  const matching = new TextMatching(caseSensitive);
  const normalized = matching.normalize(question.trim());
  const exact = (id: string) => {
    if (searchSections) return false;
    const chunk = chunks[groups.get(id)![0]!]!;
    return [chunk.term, chunk.name, chunk.name.slice(1, -1).replaceAll('_', ' ')].some(
      (name) => matching.normalize(name) === normalized,
    );
  };
  const lexicalTerms = [...groups]
    .map(([id, indexes]) => ({ id, score: Math.max(...indexes.map((i) => lexical[i]!)) }))
    .filter((item) => item.score > 0 || exact(item.id))
    .sort(
      (a, b) =>
        Number(exact(b.id)) - Number(exact(a.id)) || b.score - a.score || byText(a.id, b.id),
    );
  const semanticTerms = distances
    ? [...groups]
        .map(([id, indexes]) => ({ id, score: Math.min(...indexes.map((i) => distances[i]!)) }))
        .sort((a, b) => a.score - b.score || byText(a.id, b.id))
    : [];
  const ranks = (items: { id: string }[]) =>
    new Map(items.map((item, index) => [item.id, index + 1]));
  const lr = ranks(lexicalTerms),
    sr = ranks(semanticTerms);
  const ids =
    mode === 'lexical'
      ? [...lr.keys()]
      : mode === 'semantic'
        ? [...sr.keys()]
        : [...new Set([...lr.keys(), ...sr.keys()])];
  const candidates = ids
    .map((id) => {
      const indexes = groups.get(id)!;
      const chunk = chunks[indexes[0]!]!;
      const score =
        mode === 'lexical'
          ? Math.max(...indexes.map((i) => lexical[i]!))
          : mode === 'semantic'
            ? 1 - Math.min(...indexes.map((i) => distances![i]!))
            : (lr.has(id) ? 1 / (60 + lr.get(id)!) : 0) + (sr.has(id) ? 1 / (60 + sr.get(id)!) : 0);
      const lexicalOrder = [...indexes].sort((a, b) => lexical[b]! - lexical[a]! || a - b);
      const semanticOrder = [...indexes].sort(
        (a, b) => (distances?.[a] ?? 0) - (distances?.[b] ?? 0) || a - b,
      );
      const evidenceOrder =
        mode === 'lexical'
          ? lexicalOrder
          : mode === 'semantic'
            ? semanticOrder
            : [
                ...new Set([
                  ...(lr.has(id) ? lexicalOrder.slice(0, 1) : []),
                  ...semanticOrder,
                  ...lexicalOrder,
                ]),
              ];
      return {
        id,
        name: chunk.name,
        knowledge: chunk.knowledge,
        termKinds: [...new Set(indexes.map((i) => chunks[i]!.termKind))].sort(byText),
        definitions: [
          ...new Map(indexes.map((i) => [chunks[i]!.termKind, chunks[i]!.definition])).entries(),
        ]
          .sort(([a], [b]) => byText(a, b))
          .map(([termKind, text]) => ({ termKind, text })),
        score,
        exactName: exact(id),
        evidence: evidenceOrder.slice(0, 3).map((i) => {
          const { termKind, section, file, line, endLine, excerpt } = chunks[i]!;
          return {
            termKind,
            section,
            file,
            line,
            endLine,
            excerpt,
            ...(mode !== 'semantic' ? { lexicalScore: lexical[i]! } : {}),
            ...(distances ? { cosineDistance: distances[i]! } : {}),
          };
        }),
      };
    })
    .sort(
      (a, b) =>
        (mode === 'semantic' ? 0 : Number(b.exactName) - Number(a.exactName)) ||
        b.score - a.score ||
        byText(a.id, b.id),
    );
  return {
    operation: 'discover',
    question,
    mode,
    ...(searchSections ? { searchSections } : {}),
    limit,
    corpusFingerprint,
    eligibleTerms: groups.size,
    totalCandidates: candidates.length,
    truncated: candidates.length > limit,
    candidates: candidates
      .slice(0, limit)
      .map((candidate, index) => ({ rank: index + 1, ...candidate })),
    warnings,
  };
}
