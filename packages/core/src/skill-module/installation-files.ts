import { rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/index.js';
import type { InstallationPlan } from './installation-plan.js';

export async function optionalSkillBytes(
  access: FileAccess,
  path: string,
): Promise<Buffer | undefined> {
  return access.readBytes(path).catch((error: unknown) => {
    if (access.missing(error)) return undefined;
    throw error;
  });
}

/** Preflights ownership before journaling, then checks versions again before each mutation. */
export class InstallationFiles {
  constructor(
    private readonly directory: string,
    private readonly access: FileAccess,
  ) {}
  async inspect(plan: InstallationPlan): Promise<Map<string, Buffer | undefined>> {
    const current = new Map<string, Buffer | undefined>();
    // Validate ownership and every conflict before changing any managed file.
    for (const path of plan.paths) {
      const absolute = join(this.directory, path);
      await this.access.guard(this.directory, absolute);
      const bytes = await optionalSkillBytes(this.access, absolute);
      const owned = plan.prior.get(path);
      if (bytes && (!owned || !owned.hashes.includes(this.access.hash(bytes))))
        throw new AtermError(
          'skill.conflict',
          `Unmanaged or modified skill file: ${absolute}. Move or restore it before retrying.`,
        );
      current.set(path, bytes);
    }
    return current;
  }
  async apply(
    plan: InstallationPlan,
    current: ReadonlyMap<string, Buffer | undefined>,
    changed: string[],
  ): Promise<void> {
    for (const path of plan.paths) {
      const absolute = join(this.directory, path),
        before = current.get(path),
        after = plan.texts.get(path);
      if (after !== undefined && before?.equals(Buffer.from(after))) continue;
      if (after === undefined && !before) continue;
      await this.access.guard(this.directory, absolute);
      const now = await optionalSkillBytes(this.access, absolute);
      if (
        (now ? this.access.hash(now) : undefined) !==
        (before ? this.access.hash(before) : undefined)
      )
        throw new AtermError(
          'skill.conflict',
          `Skill file changed during synchronization: ${absolute}`,
        );
      if (after !== undefined) {
        await this.access.write(absolute, after, before && this.access.hash(before));
        changed.push(absolute);
      } else {
        await unlink(absolute);
        changed.push(absolute);
        await rmdir(join(this.directory, path.split('/')[0]!)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
          },
        );
      }
    }
  }
}
