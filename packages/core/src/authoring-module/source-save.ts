import { relative } from 'node:path';
import { AtermError } from '../error.js';
import { WorkspaceFiles } from './workspace-files.js';
import type { IPlannedSourceFile } from './source-plan.js';

/** Saves a validated whole-source plan; reports partial saves without rollback. */
export class SourceSave {
  constructor(private readonly raw: WorkspaceFiles) {}
  async apply(saves: readonly IPlannedSourceFile[], dryRun: boolean): Promise<void> {
    for (const file of saves) this.raw.files.assertWritable(file.path);
    if (!dryRun) {
      const written: string[] = [];
      try {
        // Verify every baseline before the first change. Multi-file writes are not crash-atomic.
        for (const f of saves) {
          await this.raw.path(relative(this.raw.home.workspace, f.path));
          const current = (await this.raw.files.exists(f.path))
            ? await this.raw.read(f.path)
            : undefined;
          if (current?.version !== f.version)
            throw new AtermError('file.conflict', 'File changed before save: ' + f.path);
        }
        for (const f of saves) {
          if (f.after === undefined) await this.raw.files.remove(f.path, f.version!);
          else await this.raw.files.write(f.path, f.after, f.version);
          written.push(relative(this.raw.home.workspace, f.path));
        }
      } catch (error) {
        throw new AtermError(
          'authoring.save',
          `${String(error)}; saved files: ${written.join(', ') || 'none'}. Read these files before retrying.`,
        );
      }
    }
  }
}
