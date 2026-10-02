import { z } from 'zod';
import { uiId, uiNoteInput, uiState } from '../../core/src/server-module/ui-protocol.ts';

const record = uiNoteInput
  .extend({
    id: uiId,
    title: uiNoteInput.shape.title.unwrap(),
    receivedAt: z.iso.datetime(),
    context: uiState.pick({ location: true, terms: true }),
  })
  .strict();
const fail = (code, message) => Object.assign(new Error(message), { code });

/** _aterm:Markdown_Note_: one key per Note avoids stale-array writes between tabs. */
export class NoteStore {
  constructor(home, storage = () => localStorage) {
    this.prefix = `aterm.ui.notes.v1:${encodeURIComponent(home)}:`;
    this.storage = storage;
  }
  read() {
    try {
      const storage = this.storage();
      const notes = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(this.prefix)) continue;
        let value;
        try {
          value = JSON.parse(storage.getItem(key));
        } catch {
          continue;
        }
        const parsed = record.safeParse(value);
        if (parsed.success && key === this.prefix + parsed.data.id) notes.push(parsed.data);
      }
      return notes.sort(
        (a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id),
      );
    } catch {
      throw fail(
        'ui.note-storage',
        'Notes could not be read from browser localStorage. Enable browser storage and retry.',
      );
    }
  }
  list() {
    return this.read().slice(0, 10);
  }
  receive(command, context, receivedAt = new Date().toISOString()) {
    const input = uiNoteInput.parse({
      markdown: command.markdown,
      ...(command.title !== undefined ? { title: command.title } : {}),
    });
    const title =
      input.title ??
      input.markdown
        .split(/\r?\n/)
        .find((line) => line.trim())
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .slice(0, 80);
    const existing = this.read().find((note) => note.id === command.id);
    if (existing) {
      if (existing.markdown !== input.markdown || existing.title !== title)
        throw fail(
          'ui.note-conflict',
          'This Note UUID already contains different Markdown or a different title.',
        );
      return existing;
    }
    const note = record.parse({ ...input, id: command.id, title, receivedAt, context });
    const storage = this.storage();
    try {
      // Save before eviction: a full/disabled store must not destroy the previous history.
      storage.setItem(this.prefix + note.id, JSON.stringify(note));
      for (const old of this.read().slice(10)) storage.removeItem(this.prefix + old.id);
    } catch {
      throw fail(
        'ui.note-storage',
        'Note could not be cached in browser localStorage. Free browser storage or enable it, then retry.',
      );
    }
    return note;
  }
}
