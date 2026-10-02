import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { AtermError } from '../error.js';

/** Rebuildable vectors only; source identities and locations are supplied by each query. */
export class VectorCache {
  private readonly database: DatabaseSync;
  constructor(
    readonly path: string,
    private readonly dimensions: number,
    readonlyMode = false,
  ) {
    this.database = new DatabaseSync(path, { readOnly: readonlyMode, allowExtension: true });
    try {
      this.database.exec('PRAGMA busy_timeout=5000');
      sqliteVec.load(this.database);
      this.database.enableLoadExtension(false);
      if (!readonlyMode)
        this.database.exec(
          'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS embeddings (key TEXT PRIMARY KEY, vector BLOB NOT NULL)',
        );
      this.database.prepare('SELECT key, vector FROM embeddings LIMIT 0');
    } catch (error) {
      this.database.close();
      throw error;
    }
  }
  read(keys: readonly string[]): Map<string, number[]> {
    const read = this.database.prepare('SELECT vector FROM embeddings WHERE key=?');
    const result = new Map<string, number[]>();
    for (const key of new Set(keys)) {
      const row = read.get(key);
      if (!row) continue;
      const blob = row.vector;
      if (!(blob instanceof Uint8Array) || blob.byteLength !== this.dimensions * 4) continue;
      const vector = Array.from(new Float32Array(Uint8Array.from(blob).buffer));
      if (this.valid(vector)) result.set(key, vector);
    }
    return result;
  }
  put(vectors: ReadonlyMap<string, readonly number[]>): void {
    const insert = this.database.prepare(
      'INSERT INTO embeddings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET vector=excluded.vector',
    );
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, vector] of vectors) {
        if (!this.valid(vector))
          throw new AtermError('search.vector', 'Invalid Embedding dimensions or values.');
        insert.run(key, this.bytes(vector));
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  distances(vectors: readonly (readonly number[])[], query: readonly number[]): number[] {
    if (!this.valid(query)) throw new AtermError('search.vector', 'Invalid query Embedding.');
    const distance = this.database.prepare('SELECT vec_distance_cosine(?, ?) AS distance');
    const target = this.bytes(query);
    return vectors.map((vector) => {
      if (!this.valid(vector)) throw new AtermError('search.vector', 'Invalid source Embedding.');
      const value = distance.get(this.bytes(vector), target)?.distance;
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new AtermError('search.vector', 'Non-finite vector distance.');
      return value;
    });
  }
  close(): void {
    this.database.close();
  }
  private bytes(vector: readonly number[]): Uint8Array {
    return new Uint8Array(new Float32Array(vector).buffer);
  }
  private valid(vector: readonly number[]): boolean {
    const stored = new Float32Array(vector);
    return (
      vector.length === this.dimensions &&
      stored.every(Number.isFinite) &&
      stored.some((value) => value !== 0)
    );
  }
}
