import { extname, relative } from 'node:path';
import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import type { IScanResult } from '../corpus-module/index.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';
import { AtermParser } from '../syntax-module/index.js';
import { ContextPatch } from './patch.js';
import { WorkspaceFiles } from './workspace-files.js';
import { assertDefaultWritable, assertWritableTrmFile } from './writable.js';
import { matchSourceVersion, requireValidCorpus } from './source-validation.js';
import type { ISourceAuthoringRequest, ISourcePlan, IPlannedSourceFile } from './source-plan.js';

/** Plans Knowledge creation/replacement/deletion, including bounded header patches. */
export class KnowledgeSourcePlan {
  constructor(private readonly raw: WorkspaceFiles) {}
  async build(
    config: IAtermConfig,
    baseline: IScanResult,
    request: ISourceAuthoringRequest,
  ): Promise<ISourcePlan> {
    const home = this.raw.home;
    const create = request.operation.endsWith('-create');
    const remove = request.operation.endsWith('-delete');
    const planned: IPlannedSourceFile[] = [];
    const overrides = new Map<string, string | null>();
    const found = baseline.trmFiles.find((d) => d.parsed?.knowledge === request.name);
    if (!create) assertWritableTrmFile(found);
    if (create === !!found)
      throw new AtermError(
        create ? 'knowledge.exists' : 'knowledge.missing',
        `Knowledge ${request.name} ${create ? 'already exists' : 'does not exist'}.`,
      );
    if (create && !request.path)
      throw new AtermError(
        'knowledge.path',
        'knowledge create requires --path under a configured source directory.',
      );
    const target = found?.absolutePath ?? (await this.raw.path(request.path!));
    assertDefaultWritable(target, config.allowDefaultWrites);
    await this.raw.path(relative(home.workspace, target));
    if (
      extname(target).toLowerCase() !== '.trm' ||
      !config.sources.some((source) => this.raw.files.inside(source, target))
    )
      throw new AtermError(
        'knowledge.path',
        'Knowledge path must be a .trm file under a configured source.',
      );
    if (
      relative(home.workspace, target)
        .split(/[\\/]/)
        .some((part) => part === '.git' || part === 'node_modules' || part.startsWith('.aterm'))
    )
      throw new AtermError('knowledge.path', 'Knowledge path is excluded from source scanning.');
    if (create && (await this.raw.files.exists(target)))
      throw new AtermError('file.exists', 'File already exists: ' + target);
    matchSourceVersion(request.ifMatch, found?.version);
    let after = request.text;
    if (!create && !remove && after?.startsWith('*** Begin Patch'))
      after = this.patchHeader(found!, target, request.name, after);
    planned.push({
      path: target,
      before: found?.text,
      version: found?.version,
      after: remove ? undefined : after,
    });
    overrides.set(target, remove ? null : after!);
    return { config, target, files: planned, overrides };
  }
  private patchHeader(found: ITrmFile, target: string, name: string, text: string): string {
    const patcher = new ContextPatch('Knowledge');
    const patches = patcher.parse(text);
    if (patches.some((patch) => patch.target !== name))
      throw new AtermError(
        'knowledge.identity',
        'Every Update Knowledge target must match the requested ID.',
      );
    const original = found.text;
    const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
    const source = original.slice(bom.length);
    const lines = source.split(/\r?\n/);
    const first = found.parsed!.termDeclarations[0];
    const boundary = first ? first.line - 1 : lines.length;
    // Keep the suffix as original bytes, even with mixed line endings.
    let offset = 0;
    for (let line = 0; first && line < boundary; line++) offset = source.indexOf('\n', offset) + 1;
    let header = lines.slice(0, boundary);
    for (const patch of patches) header = patcher.apply(header, patch);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const headerText = header.join(eol) + (first ? eol : '');
    const parsedHeader = new AtermParser(found.parsed!.termKinds).parse(target, headerText);
    if (parsedHeader.termDeclarations.length)
      throw new AtermError(
        'knowledge.header',
        'Knowledge header patches cannot add Term Declarations; use term edit.',
      );
    requireValidCorpus(parsedHeader.diagnostics);
    return header.join('\n') === lines.slice(0, boundary).join('\n')
      ? original
      : bom + headerText + (first ? source.slice(offset) : '');
  }
}
