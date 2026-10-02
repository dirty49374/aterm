import { join } from 'node:path';
import { byText } from '../order.js';
import type { ISkillDocument } from './catalog.js';
import type { SkillManifest, SkillFileRecord } from './installation-manifest.js';

/** Pure desired inventory, recovery journal and file-change classification. */
export class InstallationPlan {
  readonly texts: ReadonlyMap<string, string>;
  readonly desired: SkillFileRecord[];
  readonly prior: ReadonlyMap<string, SkillFileRecord>;
  readonly paths: string[];
  readonly desiredNames: string[];
  readonly possiblyDeployed: string[];
  readonly removedNames: string[];
  readonly journal: SkillFileRecord[];
  constructor(
    pointers: readonly ISkillDocument[],
    old: SkillManifest | undefined,
    commands: SkillManifest['commands'],
    hash: (text: string) => string,
  ) {
    const texts = new Map<string, string>();
    for (const pointer of pointers) texts.set(`${pointer.name}/SKILL.md`, pointer.text);
    const desired: SkillFileRecord[] = [...texts]
      .map(([path, text]) => ({
        name: path.split('/')[0]!,
        path,
        term: pointers.find((p) => `${p.name}/SKILL.md` === path)?.term ?? null,
        hashes: [hash(text)],
      }))
      .sort((a, b) => byText(a.path, b.path));
    const prior = new Map((old?.files ?? []).map((record) => [record.path, record]));
    const paths = [...new Set([...prior.keys(), ...texts.keys()])].sort(byText);
    const desiredNames = desired.map((record) => record.name).sort(byText);
    // Keep all names whose deployment might have partially succeeded until a command completes.
    const possiblyDeployed = [
      ...new Set([...(old?.deployed ?? []), ...(commands ? desiredNames : [])]),
    ].sort(byText);
    const removedNames = possiblyDeployed.filter((name) => !desiredNames.includes(name));
    const journal = new Map(prior);
    for (const record of desired)
      journal.set(record.path, {
        ...record,
        hashes: [...new Set([...(prior.get(record.path)?.hashes ?? []), ...record.hashes])],
      });

    this.texts = texts;
    this.desired = desired;
    this.prior = prior;
    this.paths = paths;
    this.desiredNames = desiredNames;
    this.possiblyDeployed = possiblyDeployed;
    this.removedNames = removedNames;
    this.journal = [...journal.values()].sort((a, b) => byText(a.path, b.path));
  }
  changes(directory: string, current: ReadonlyMap<string, Buffer | undefined>) {
    const result = {
      added: [] as string[],
      updated: [] as string[],
      removed: [] as string[],
      unchanged: [] as string[],
    };
    for (const path of this.paths) {
      const before = current.get(path),
        after = this.texts.get(path);
      const absolute = join(directory, path);
      if (after === undefined) {
        if (before) result.removed.push(absolute);
      } else if (!before) result.added.push(absolute);
      else if (before.equals(Buffer.from(after))) result.unchanged.push(absolute);
      else result.updated.push(absolute);
    }
    return result;
  }
}
