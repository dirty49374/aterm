import { unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/index.js';
import type { IAtermHome } from '../home-module/index.js';
import { skillCommandsSchema } from '../home-module/config.js';
import { optionalSkillBytes } from './installation-files.js';

export const skillManifestName = '.aterm-skills.json';
const skillName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const fileRecord = z
  .object({
    name: skillName,
    path: z.string(),
    term: z.string().nullable(),
    hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  })
  .strict()
  .refine((record) => record.path === `${record.name}/SKILL.md`, 'Invalid managed path.');
const manifestSchema = z
  .object({
    version: z.literal(2),
    home: z.string().refine(isAbsolute),
    commands: skillCommandsSchema,
    deployed: z.array(skillName),
    pending: z.boolean(),
    files: z.array(fileRecord),
  })
  .strict()
  .refine(
    (manifest) => new Set(manifest.files.map((f) => f.name)).size === manifest.files.length,
    'Duplicate managed names.',
  );
export type SkillManifest = z.infer<typeof manifestSchema>;
export type SkillFileRecord = SkillManifest['files'][number];

/** Tracks the exact manifest version owned by one locked installation operation. */
export class InstallationManifest {
  readonly path: string;
  private bytes: Buffer | undefined;
  constructor(
    private readonly directory: string,
    private readonly access: FileAccess,
  ) {
    this.path = join(directory, skillManifestName);
  }
  async read(home: IAtermHome): Promise<SkillManifest | undefined> {
    this.bytes = await optionalSkillBytes(this.access, this.path);
    return this.bytes ? this.parse(this.bytes, this.path, home) : undefined;
  }
  private parse(bytes: Buffer, path: string, home: IAtermHome): SkillManifest {
    let manifest: SkillManifest;
    try {
      manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    } catch {
      throw new AtermError('skill.manifest', `Invalid installation manifest: ${path}`);
    }
    if (manifest.home !== home.home)
      throw new AtermError(
        'skill.home',
        `Installation is bound to manifest Home ${manifest.home}, not ${home.home}.`,
      );
    return manifest;
  }

  async write(value: SkillManifest): Promise<void> {
    await this.access.guard(this.directory, this.path);
    const text = JSON.stringify(value, null, 2) + '\n';
    await this.access.write(this.path, text, this.bytes && this.access.hash(this.bytes));
    this.bytes = Buffer.from(text);
  }
  async remove(): Promise<void> {
    await this.access.guard(this.directory, this.path);
    const now = await optionalSkillBytes(this.access, this.path);
    if (!now || !now.equals(this.bytes!))
      throw new AtermError('skill.conflict', `Manifest changed: ${this.path}`);
    await unlink(this.path);
  }
}
