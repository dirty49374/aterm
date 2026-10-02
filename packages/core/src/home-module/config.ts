import { externalSelectionShape } from '../external-module/selection.js';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { AtermError } from '../error.js';
import { termKindIdentity, type AtermTermKind } from '../syntax-module/index.js';
import type { IAtermHome } from './home.js';
import { AtermViewpointReader, type IAtermViewpoint } from './viewpoint.js';
import { installedViewpoints, viewpointSource, isDefaultResource } from './defaults.js';

export const skillCommandsSchema = z
  .object({
    sync: z.string().refine((value) => value.trim().length > 0, 'Command must not be blank.'),
    uninstall: z.string().refine((value) => value.trim().length > 0, 'Command must not be blank.'),
  })
  .strict()
  .optional();

const skillSettingsSchema = skillCommandsSchema
  .unwrap()
  .partial()
  .refine(
    (settings) => (settings.sync === undefined) === (settings.uninstall === undefined),
    'Provide both skills.sync and skills.uninstall, or neither.',
  )
  .optional();

export const serverSettingsSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    host: z
      .string()
      .refine(
        (host) => host === 'localhost' || (isIP(host) !== 0 && !host.includes('%')),
        'Expected an IPv4 or IPv6 address, or localhost; omit brackets and port.',
      )
      .default('127.0.0.1'),
    debounceMs: z.number().int().min(0).max(60000).default(200),
    watchExternal: z.boolean().default(true),
    publicOrigin: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
      }, 'Expected an HTTP(S) origin without a path.')
      .optional(),
    controlToken: z.string().min(32).optional(),
  })
  .strict();

const declaration = z
  .object({
    skills: skillSettingsSchema,
    allowDefaultWrites: z.boolean().default(false),
    useDefaultKnowledge: z.boolean().default(true),
    useViewpoints: z.array(z.enum(installedViewpoints)).default([...installedViewpoints]),
    ...externalSelectionShape,
    server: serverSettingsSchema.optional(),
    sources: z.array(z.string().min(1)).min(1),
    viewpoints: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

/** _aterm:Configuration_ is the parsed `aterm.yaml` with every source and Viewpoint resolved. */
export interface IAtermConfig {
  readonly allowDefaultWrites: boolean;
  readonly useDefaultKnowledge: boolean;
  readonly useViewpoints: readonly string[];
  readonly skills?: z.infer<typeof skillSettingsSchema>;
  readonly server?: {
    readonly port: number;
    readonly host: string;
    readonly debounceMs: number;
    readonly watchExternal: boolean;
    readonly publicOrigin?: string;
    readonly controlToken?: string;
  };
  readonly externalSources?: Readonly<Record<string, string>>;
  readonly home: IAtermHome;
  readonly sources: readonly string[];
  readonly viewpoints: readonly IAtermViewpoint[];
}

export class AtermConfigReader {
  constructor(private readonly viewpoints = new AtermViewpointReader()) {}

  async read(
    home: IAtermHome,
    observeViewpoints?: (paths: readonly string[]) => Promise<void>,
  ): Promise<IAtermConfig> {
    let text: string;
    try {
      text = await readFile(home.configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AtermError('config.missing', `Missing ${home.configPath}; run aterm init.`);
      throw error;
    }
    const declared = this.declaration(home, text);
    const bindings = new Map<string, string>(
      declared.useViewpoints.map((name) => [name, resolve(viewpointSource, `${name}.md`)]),
    );
    for (const [name, path] of Object.entries(declared.viewpoints ?? {})) bindings.set(name, path);
    // Install observation before reading bindings, including missing or invalid files.
    await observeViewpoints?.(
      [...bindings.values()].map((path) => this.viewpoints.resolvePath(home.home, path)),
    );
    const loaded = new Map<string, IAtermViewpoint>();
    for (const [name, path] of bindings)
      loaded.set(name, await this.viewpoints.read(name, home.home, path));
    return this.compose(home, declared, loaded);
  }

  /** Read write policy without loading possibly damaged Viewpoint or Knowledge files. */
  async allowsDefaultWrites(home: IAtermHome): Promise<boolean> {
    return this.declaration(home, await readFile(home.configPath, 'utf8')).allowDefaultWrites;
  }

  /** Parses without loading Viewpoints; every named Viewpoint must be supplied. */
  parse(
    home: IAtermHome,
    text: string,
    loaded: ReadonlyMap<string, IAtermViewpoint> = new Map(),
  ): IAtermConfig {
    return this.compose(home, this.declaration(home, text), loaded);
  }

  private declaration(home: IAtermHome, text: string): z.infer<typeof declaration> {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length)
      throw new AtermError('config.invalid', `${home.configPath}: ${document.errors[0]!.message}`);
    const value = document.toJS({ maxAliasCount: 100 }) ?? {};
    if (Object.hasOwn(value, 'defaultTerms'))
      throw new AtermError(
        'config.invalid',
        `${home.configPath}: defaultTerms was renamed to useDefaultKnowledge; replace the configuration key.`,
      );
    if (value?.skills && Object.hasOwn(value.skills, 'source'))
      throw new AtermError(
        'config.invalid',
        `${home.configPath}: skills.source was removed; remove it to use the unified Skill catalog.`,
      );
    const result = declaration.safeParse(value);
    if (!result.success)
      throw new AtermError(
        'config.invalid',
        `${home.configPath}: ` +
          result.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; '),
      );
    return result.data;
  }

  private compose(
    home: IAtermHome,
    declared: z.infer<typeof declaration>,
    loaded: ReadonlyMap<string, IAtermViewpoint>,
  ): IAtermConfig {
    const names = [
      ...new Set([...declared.useViewpoints, ...Object.keys(declared.viewpoints ?? {})]),
    ];
    const viewpoints = names.map((name) => {
      const viewpoint = loaded.get(name);
      if (!viewpoint)
        throw new AtermError(
          'config.invalid',
          `Viewpoint ${name} was not loaded for ${home.configPath}.`,
        );
      const { readOnly: _previous, ...content } = viewpoint;
      return {
        ...content,
        ...(isDefaultResource(viewpoint.path) && !declared.allowDefaultWrites
          ? { readOnly: true }
          : {}),
      };
    });
    const sources = [
      ...new Set(
        declared.sources.map((source) =>
          isAbsolute(source) ? resolve(source) : resolve(home.workspace, source),
        ),
      ),
    ];
    return {
      home,
      ...(declared.skills ? { skills: declared.skills } : {}),
      ...(declared.server ? { server: declared.server } : {}),
      externalSources: declared.externalSources,
      sources,
      allowDefaultWrites: declared.allowDefaultWrites,
      useDefaultKnowledge: declared.useDefaultKnowledge,
      useViewpoints: [...new Set(declared.useViewpoints)],
      viewpoints,
    };
  }
}

/**
 * Composes the kinds of the Viewpoints a Knowledge declares, in the order it names them.
 * Each Viewpoint owns its Term Kind names; overlapping local names require qualified use.
 */
export function composeTermKinds(
  viewpoints: readonly IAtermViewpoint[],
  fail: (message: string) => Error = (message) => new AtermError('config.invalid', message),
): readonly AtermTermKind[] {
  const termKinds = new Map<string, { termKind: AtermTermKind; from: IAtermViewpoint }>();
  for (const viewpoint of viewpoints)
    for (const termKind of viewpoint.termKinds) {
      const identity = termKindIdentity(termKind.name, termKind.viewpoint);
      const seen = termKinds.get(identity);
      if (seen && !sameTermKind(seen.termKind, termKind))
        throw fail(
          `Term Kind ${identity} is declared differently in ${seen.from.path} and ${viewpoint.path}.`,
        );
      if (!seen) termKinds.set(identity, { termKind, from: viewpoint });
    }
  return [...termKinds.values()].map((entry) => entry.termKind);
}

/** Term Kind compatibility requires both the same owner/name and the same declared content. */
export function sameTermKind(a: AtermTermKind, b: AtermTermKind): boolean {
  return (
    termKindIdentity(a.name, a.viewpoint) === termKindIdentity(b.name, b.viewpoint) &&
    a.description === b.description &&
    a.schema.sections.length === b.schema.sections.length &&
    a.schema.sections.every((field, at) => {
      const other = b.schema.sections[at]!;
      return (
        field.name === other.name &&
        field.type === other.type &&
        field.description === other.description
      );
    })
  );
}
