import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { AtermError } from '../error.js';
import { AtermSchema, type AtermTermKind, type AtermQuestion } from '../syntax-module/index.js';
import { localTermKindPattern, viewpointNamePattern } from '../syntax-module/term-kind.js';

/** _aterm:Viewpoint_ is one reusable vocabulary, its sections, and the guidance for writing in it. */
export interface IAtermViewpoint {
  /** Package paths are protected unless allowDefaultWrites is enabled, including explicit bindings. */
  readonly readOnly?: boolean;
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly termKinds: readonly AtermTermKind[];
  /** The Markdown body: the explanation and the instructions for writing in this Viewpoint. */
  readonly body: string;
  /** Original Markdown, including frontmatter, whitespace and line endings. */
  readonly source: string;
}

const declaration = z
  .object({
    name: z.string().regex(new RegExp(`^${viewpointNamePattern}$`), 'Viewpoint identifier'),
    description: z.string().min(1),
    termKinds: z
      .array(
        z
          .object({
            name: z.string().regex(new RegExp(`^${localTermKindPattern}$`), 'lowercase identifier'),
            description: z.string().min(1),
            sections: z
              .array(
                z
                  .object({
                    name: z.string().min(1),
                    type: z.enum(['md', 'ts', 'yaml', 'json']),
                    description: z.string().min(1).optional(),
                    question: z.string().min(1).optional(),
                    example: z.string().min(1).optional(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** One question per line; the text up to the first `?` is the question, the rest is its frame. */
export function readQuestions(text: string): AtermQuestion[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf('?');
      if (at < 0) return { ask: line };
      const frame = line.slice(at + 1).trim();
      return frame ? { ask: line.slice(0, at + 1), frame } : { ask: line.slice(0, at + 1) };
    });
}

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Reads one Viewpoint document: YAML frontmatter, then the Markdown body. */
export class AtermViewpointReader {
  constructor(private readonly userHome: string = homedir()) {}

  /** `~` against the user home, a relative path against the Aterm home, otherwise as given. */
  resolvePath(home: string, path: string): string {
    if (path === '~') return this.userHome;
    if (path.startsWith('~/')) return resolve(this.userHome, path.slice(2));
    return isAbsolute(path) ? path : resolve(home, path);
  }

  async read(name: string, home: string, path: string): Promise<IAtermViewpoint> {
    const file = this.resolvePath(home, path);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AtermError('viewpoint.missing', `Missing Viewpoint ${name}: ${file}`);
      throw error;
    }
    return this.parse(name, file, text);
  }

  parse(name: string, file: string, text: string): IAtermViewpoint {
    const match = frontmatter.exec(text);
    if (!match)
      throw new AtermError(
        'viewpoint.frontmatter',
        `Viewpoint ${name} must begin with a YAML frontmatter block: ${file}`,
      );
    const document = parseDocument(match[1]!, { uniqueKeys: true });
    if (document.errors.length)
      throw new AtermError('viewpoint.invalid', `${file}: ${document.errors[0]!.message}`);
    const parsed = declaration.safeParse(document.toJS({ maxAliasCount: 100 }) ?? {});
    if (!parsed.success)
      throw new AtermError(
        'viewpoint.invalid',
        `${file}: ` +
          parsed.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; '),
      );
    const value = parsed.data;
    if (value.name !== name)
      throw new AtermError(
        'viewpoint.name',
        `Viewpoint bound as ${name} names itself ${value.name}: ${file}`,
      );
    const invalid = (message: string) => new AtermError('viewpoint.invalid', `${file}: ${message}`);
    const names = new Set<string>();
    for (const termKind of value.termKinds) {
      if (names.has(termKind.name)) throw invalid(`duplicate Term Kind ${termKind.name}`);
      names.add(termKind.name);
    }
    const termKinds = value.termKinds.map((termKind): AtermTermKind => {
      try {
        const schema = new AtermSchema(
          termKind.description,
          termKind.sections.map(({ question, example, ...section }) => ({
            ...section,
            ...(question === undefined ? {} : { questions: readQuestions(question) }),
            ...(example === undefined ? {} : { example: example.trim() }),
          })),
        );
        return { name: termKind.name, description: termKind.description, viewpoint: name, schema };
      } catch (error) {
        throw new AtermError(
          'viewpoint.invalid',
          `${file}: Term Kind ${termKind.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    return {
      name,
      path: file,
      description: value.description,
      termKinds,
      body: text.slice(match[0].length),
      source: text,
    };
  }
}
