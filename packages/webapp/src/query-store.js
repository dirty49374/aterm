import { z } from 'zod';

const savedQuery = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    query: z.string().max(65536),
    variables: z.string().max(65536),
    operationName: z.string().max(256),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** _aterm:Saved_GraphQL_Query_: separate records, scoped to this browser origin and Home. */
export class QueryStore {
  constructor(home, storage = () => localStorage) {
    this.prefix = `aterm.ui.queries.v1:${encodeURIComponent(home)}:`;
    this.storage = storage;
  }
  list() {
    try {
      const storage = this.storage(),
        queries = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(this.prefix)) continue;
        try {
          const parsed = savedQuery.safeParse(JSON.parse(storage.getItem(key)));
          if (parsed.success && key === this.prefix + parsed.data.id) queries.push(parsed.data);
        } catch {
          /* Preserve malformed records; never overwrite them while listing. */
        }
      }
      return queries.sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
    } catch {
      throw new Error('Saved queries could not be read. Enable browser storage and retry.');
    }
  }
  save(input, expected) {
    const record = savedQuery.parse(input);
    const storage = this.storage();
    const previous = storage.getItem(this.prefix + record.id);
    if (previous && JSON.parse(previous).updatedAt !== expected)
      throw new Error('This query changed in another tab. Reload it or save a copy.');
    if (!previous && expected)
      throw new Error('This query was deleted in another tab. Save a copy.');
    try {
      storage.setItem(this.prefix + record.id, JSON.stringify(record));
    } catch {
      throw new Error('Query was not saved. Free browser storage or enable it, then retry.');
    }
    return record;
  }
  remove(id, expected) {
    const storage = this.storage();
    const current = storage.getItem(this.prefix + id);
    if (current && JSON.parse(current).updatedAt !== expected)
      throw new Error('This query changed in another tab. Reload it before deleting.');
    storage.removeItem(this.prefix + id);
  }
}
