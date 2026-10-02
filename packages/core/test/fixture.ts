import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AtermQuery,
  IAtermEditResult,
  ITermDeclarationDiff,
  ITermDeclarationResult,
} from '../src/index.js';
import { AtermApplication } from '../src/index.js';

/** One Viewpoint offering the default vocabulary; the fixture binds it under three names. */
export const specViewpoint = (name: string) => `---
name: ${name}
description: Fixture vocabulary.
termKinds:
  - name: concept
    description: A thing.
    sections: &sections
      - name: definition
        type: md
      - name: contract
        type: md
      - name: remarks
        type: md
  - name: procedure
    description: An operation.
    sections: *sections
  - name: undecided
    description: Deferred.
    sections: *sections
---

# Fixture viewpoint
`;

/** Two sources, `docs` and `shared`, and three Viewpoints a Knowledge may declare. */
export const defaultConfig = `sources: [docs, shared]
viewpoints:
  spec: ./viewpoint-spec.md
  guide: ./viewpoint-guide.md
  other: ./viewpoint-other.md`;

/** The Viewpoint a fixture file declares, from its filename prefix, so tests read as before. */
export const declaredViewpoint = (path: string): string | undefined => {
  const name = path.split('/').pop()!.toLowerCase();
  for (const [prefix, viewpoint] of [
    ['spec-', 'spec'],
    ['guide-', 'guide'],
    ['other-', 'other'],
  ] as const)
    if (name.startsWith(prefix)) return viewpoint;
  return undefined;
};

export interface IFixture {
  readonly workspace: string;
  readonly docs: string;
  readonly shared: string;
  readonly home: string;
  app(): Promise<AtermApplication>;
  write(path: string, text: string): Promise<void>;
  /** Runs a read query and narrows the union to the read result. */
  read(query: AtermQuery): Promise<ITermDeclarationResult>;
  /** Runs an authoring query and narrows the union to the edit result. */
  author(query: AtermQuery): Promise<IAtermEditResult>;
  /** Runs `changes` and narrows the union to the diff result. */
  diff(query: AtermQuery): Promise<ITermDeclarationDiff>;
}

export async function fixture(config = defaultConfig): Promise<IFixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-'));
  const home = join(workspace, '.aterm');
  const docs = join(workspace, 'docs');
  const shared = join(workspace, 'shared');
  await mkdir(home);
  await mkdir(docs);
  await mkdir(shared);
  // Most fixtures isolate authored test data; default-Knowledge scenarios opt in explicitly.
  await writeFile(
    join(home, 'aterm.yaml'),
    (/^useViewpoints:/m.test(config) ? '' : 'useViewpoints: []\n') +
      (/^useDefaultKnowledge:/m.test(config) ? config : 'useDefaultKnowledge: false\n' + config),
  );
  for (const name of ['spec', 'guide', 'other'])
    await writeFile(join(home, `viewpoint-${name}.md`), specViewpoint(name));
  const app = () => AtermApplication.open({ cwd: workspace, env: {} });
  const query = async (input: AtermQuery, key: 'termDeclarations' | 'terms' | 'diff') => {
    const result = await (await app()).query(input);
    if (!(key in result)) throw new Error(`Expected a ${key} result from ${input.operation}.`);
    return result;
  };
  return {
    workspace,
    docs,
    shared,
    home,
    app,
    write: async (path, text) => {
      await mkdir(join(workspace, path, '..'), { recursive: true });
      // A `.trm` fixture declares the Viewpoint its prefix names, unless the text already does.
      const viewpoint = declaredViewpoint(path);
      const declared =
        /\.trm$/i.test(path) &&
        viewpoint &&
        !/^\uFEFF?@(?:viewpoints|knowledge)/.test(text) &&
        !text.startsWith('@viewpoints') &&
        !text.startsWith('@knowledge')
          ? `@viewpoints ${viewpoint}\n` + text
          : text;
      const knowledge = path
        .replace(/\.trm$/i, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toLowerCase();
      const knowledgeSource =
        /\.trm$/i.test(path) && !/@knowledge(?:[ \t]|$)/m.test(declared)
          ? declared.replace(/^(\uFEFF)?/, (_match, bom = '') => bom + `@knowledge ${knowledge}\n`)
          : declared;
      await writeFile(join(workspace, path), knowledgeSource);
    },
    read: (input) => query(input, 'termDeclarations') as Promise<ITermDeclarationResult>,
    author: (input) => query(input, 'terms') as Promise<IAtermEditResult>,
    diff: (input) => query(input, 'diff') as Promise<ITermDeclarationDiff>,
  };
}
