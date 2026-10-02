import { AtermScanner } from '../corpus-module/index.js';
import type { IAtermConfig } from '../home-module/index.js';
import { GuidanceCatalog } from './guidance-catalog.js';
import { SkillReading } from './reading.js';
import { skillMetadata } from './metadata.js';
import { skillDocument } from './rendering.js';

export interface ISkillDocument {
  readonly name: string;
  readonly term: string;
  readonly description: string;
  readonly text: string;
}

/** Installation and MCP entrypoints use the same TOC renderer as skill toc. */
export class SkillCatalog {
  async read(config: IAtermConfig): Promise<readonly ISkillDocument[]> {
    const catalog = await new GuidanceCatalog().read(config, () => new AtermScanner().scan(config));
    const metadata = skillMetadata(catalog.termDeclarations);
    const reading = new SkillReading(
      catalog.termDeclarations,
      catalog.scan.trmFiles.flatMap((file) => file.parsed?.relations ?? []),
    );
    return metadata.map(({ name, description, termDeclaration }) => ({
      name,
      description,
      term: termDeclaration.id,
      text: skillDocument(
        name,
        description,
        reading.read('skill-toc', [termDeclaration.id], undefined, true).skills[0]!.markdown!,
      ),
    }));
  }
}
