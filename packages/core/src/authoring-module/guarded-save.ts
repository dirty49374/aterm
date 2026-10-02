import { AtermError } from '../error.js';
import { FileAccess, type ITextFile } from '../file-module/index.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';
import type { IAtermConfig } from '../home-module/index.js';
import { assertDefaultWritable, assertWritableTrmFile } from './writable.js';

/** Source policy, version preflight and ordered writes for a Declaration edit. */
export class GuardedSave {
  constructor(
    private readonly files: FileAccess,
    private readonly config: IAtermConfig,
    private readonly documents: readonly ITrmFile[],
  ) {}
  async guard(doc: ITextFile): Promise<void> {
    assertWritableTrmFile(
      this.documents.find((termDeclaration) => termDeclaration.absolutePath === doc.absolutePath),
    );
    assertDefaultWritable(doc.absolutePath, this.config.allowDefaultWrites);
    this.files.assertWritable(doc.absolutePath);
    const target = await this.files.guard(doc.source, doc.absolutePath);
    if (target !== doc.absolutePath)
      throw new AtermError('aterm.path', 'Write cannot leave the selected sources.');
  }
  async preflight(changes: readonly ITextFile[]): Promise<void> {
    // Preflight every current source before the first write, including external editor changes.
    for (const doc of changes) {
      await this.guard(doc);
      if (this.files.hash(await this.files.readBytes(doc.absolutePath)) !== doc.version)
        throw new AtermError('file.conflict', `Source changed; re-read ${doc.path}.`);
    }
  }
  async save(changes: readonly ITextFile[], texts: ReadonlyMap<string, string>): Promise<void> {
    const written: string[] = [];
    for (const doc of changes) {
      try {
        await this.guard(doc);
        await this.files.write(doc.absolutePath, texts.get(doc.absolutePath)!, doc.version);
        written.push(doc.path);
      } catch (error) {
        throw new AtermError(
          'aterm.write',
          `${String(error)}; saved files: ${written.join(', ') || 'none'}. Multi-file writes are not crash-atomic.`,
        );
      }
    }
  }
}
