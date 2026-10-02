import type { IDiscoveryResult, ISemanticIndexResult } from '@aterm/core';
import { alignedTable } from './table.js';

/** Ranked summaries share the table renderer; Definitions and evidence are opt-in. */
export class DiscoveryText {
  render(
    result: IDiscoveryResult | ISemanticIndexResult,
    detail = false,
    markdown = false,
  ): string {
    if (result.operation !== 'discover')
      return (
        `${result.ready ? 'Ready' : 'Not ready'}: ${result.cachedChunks}/${result.chunks} chunks cached; ${result.missingChunks} missing\nModel: ${result.model.name} @ ${result.model.revision}\nCache: ${result.cache}\n${result.modelReady ? 'Model prepared.' : 'Run aterm corpus index build to prepare the Model.'}\n` +
        result.warnings
          .map((warning) => `Warning: ${warning.file}:${warning.line}: ${warning.message}\n`)
          .join('')
      );
    const summary = detail
      ? result.candidates
          .map(
            (candidate) =>
              `## ${candidate.id} score=${candidate.score.toFixed(4)}\n` +
              [
                ...new Set(candidate.definitions.map((definition) => definition.text.trimEnd())),
              ].join('\n\n'),
          )
          .join('\n\n') || 'No matching Terms.'
      : alignedTable(
          {
            headers: ['Term', 'Score'],
            rows: result.candidates.map((candidate) => [candidate.id, candidate.score.toFixed(4)]),
          },
          markdown,
        );
    const items = detail
      ? result.candidates.map((candidate) =>
          [
            `${candidate.rank}. ${candidate.id}  ${candidate.termKinds.join(', ')}  score=${candidate.score.toFixed(4)}`,
            ...candidate.evidence.map(
              (evidence) =>
                `   ${evidence.termKind}.${evidence.section} — ${evidence.file}:${evidence.line}\n   ${evidence.excerpt.trim().replaceAll('\n', '\n   ')}`,
            ),
          ].join('\n'),
        )
      : [];
    return (
      [
        summary,
        ...(detail
          ? [
              `${result.mode}: ${result.candidates.length}/${result.totalCandidates} candidates${result.truncated ? ' (limited)' : ''}`,
            ]
          : []),
        ...items,
        ...result.warnings.map(
          (warning) => `Warning: ${warning.file}:${warning.line}: ${warning.message}`,
        ),
      ].join('\n\n') + '\n'
    );
  }
}
