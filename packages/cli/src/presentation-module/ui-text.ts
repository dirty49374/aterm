import type { UIResult } from '@aterm/core';
import { alignedTable } from './table.js';

export class UIText {
  render(result: UIResult, markdown = false): string {
    if ('sessions' in result)
      return alignedTable(
        {
          headers: ['Session', 'Status', 'Visibility', 'Location', 'Last active', 'Last seen'],
          rows: result.sessions.map((s) => [
            s.shortId,
            s.status,
            s.state.visible ? 'visible' : 'hidden',
            s.state.location,
            s.lastActiveAt,
            s.lastSeenAt,
          ]),
        },
        markdown,
      );
    if ('session' in result) {
      const s = result.session;
      return alignedTable(
        {
          headers: ['Field', 'Value'],
          rows: [
            ['Session', s.id],
            ['Status', s.status],
            ['Location', s.state.location],
            ['Term', s.state.term],
            ['Mode', s.state.mode],
            ['Terms', s.state.terms.join(', ')],
            ['Selection', s.state.selection.join(', ')],
            ['Notes', `${s.state.notes.count} cached; ${s.state.notes.open ? 'open' : 'closed'}`],
            ['Active Note', s.state.notes.active || ''],
            ['UI revision', String(s.state.revision)],
            ['Corpus revision', String(s.state.corpusRevision)],
            ['Visibility', s.state.visible ? 'visible' : 'hidden'],
            ['Created', s.createdAt],
            ['Last active', s.lastActiveAt],
            ['Last seen', s.lastSeenAt],
          ],
        },
        markdown,
      );
    }
    const c = result.command;
    return [
      `${c.status}: ${c.request.operation}`,
      `Command: ${c.id}`,
      `Session: ${c.session}`,
      ...(c.state
        ? [
            `Location: ${c.state.location}`,
            `Explore: ${c.state.terms.length} Terms`,
            ...(c.request.operation === 'note-send'
              ? [`Active Note: ${c.state.notes.active || 'none'}`, `Notes: ${c.state.notes.count} cached`]
              : []),
            `UI revision: ${c.state.revision}`,
          ]
        : []),
      ...(c.error ? [`${c.error.code}: ${c.error.message}`] : []),
    ].join('\n');
  }
}
