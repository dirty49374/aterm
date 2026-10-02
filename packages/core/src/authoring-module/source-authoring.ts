import { relative } from 'node:path';
import { AtermError } from '../error.js';
import { AtermConfigReader, type IAtermHome } from '../home-module/index.js';
import { AtermScanner, type IScanResult } from '../corpus-module/index.js';
import { DerivationIndex } from '../query-module/derivation.js';
import { knowledgePattern } from '../syntax-module/identity.js';
import { viewpointNamePattern } from '../syntax-module/term-kind.js';
import { WorkspaceFiles } from './workspace-files.js';
import { KnowledgeSourcePlan } from './knowledge-source-plan.js';
import { ViewpointSourcePlan } from './viewpoint-source-plan.js';
import { SourceSave } from './source-save.js';
import { checkCorpus, requireValidCorpus } from './source-validation.js';
import type { ISourceAuthoringRequest, ISourceAuthoringResult } from './source-plan.js';

export { checkCorpus } from './source-validation.js';
export type { ISourceAuthoringRequest, ISourceAuthoringResult } from './source-plan.js';

/** _aterm:Source_Authoring_: validate a complete proposed state before guarded writes. */
export class SourceAuthoring {
  private readonly raw: WorkspaceFiles;
  constructor(private readonly home: IAtermHome) {
    this.raw = new WorkspaceFiles(home);
  }
  async execute(request: ISourceAuthoringRequest): Promise<ISourceAuthoringResult> {
    return this.raw.files.exclusive(this.home.home, async () => {
      const config = await new AtermConfigReader().read(this.home);
      const scanner = new AtermScanner();
      const baseline = await scanner.scan(config);
      const initial = await checkCorpus(config, baseline);
      requireValidCorpus(initial.diagnostics);
      const viewpoint = request.operation.startsWith('viewpoint-');
      const remove = request.operation.endsWith('-delete');
      if (
        !new RegExp(`^${viewpoint ? viewpointNamePattern : knowledgePattern}$`).test(request.name)
      )
        throw new AtermError(
          'authoring.name',
          `Invalid ${viewpoint ? 'Viewpoint' : 'Knowledge'} name: ${request.name}`,
        );
      if (!remove && request.text === undefined)
        throw new AtermError(
          'authoring.content',
          'Supply the complete source through --file or stdin.',
        );
      const plan = viewpoint
        ? await new ViewpointSourcePlan(this.raw).build(config, request)
        : await new KnowledgeSourcePlan(this.raw).build(config, baseline, request);
      const candidate = await scanner.scan(plan.config, plan.overrides);
      if (
        !viewpoint &&
        !remove &&
        candidate.trmFiles.find((d) => d.absolutePath === plan.target)?.parsed?.knowledge !==
          request.name
      )
        throw new AtermError(
          'knowledge.identity',
          'Knowledge @knowledge must match the requested ID; use knowledge rename to change identity.',
        );
      const checked = await checkCorpus(plan.config, candidate);
      requireValidCorpus(checked.diagnostics);
      const derivedImpacts = this.derivedImpacts(baseline, initial, checked);
      const saves = plan.files.filter((file) => file.before !== file.after);
      await new SourceSave(this.raw).apply(saves, request.dryRun ?? false);
      return {
        operation: request.operation,
        name: request.name,
        dryRun: request.dryRun ?? false,
        saved: !request.dryRun,
        files: saves.map((f) => ({
          ...f,
          path: relative(this.home.workspace, f.path).split('\\').join('/'),
        })),
        derivedImpacts,
      };
    });
  }
  private derivedImpacts(
    baseline: IScanResult,
    initial: Awaited<ReturnType<typeof checkCorpus>>,
    checked: Awaited<ReturnType<typeof checkCorpus>>,
  ) {
    const changed = initial.termDeclarations
      .filter((e) => {
        const next = checked.termDeclarations.find(
          (n) => n.id === e.id && n.termKind === e.termKind && n.viewpoint === e.viewpoint,
        );
        return (
          !next ||
          JSON.stringify(e.sections.map((s) => [s.key, s.content])) !==
            JSON.stringify(next.sections.map((s) => [s.key, s.content]))
        );
      })
      .map((e) => e.id);
    const derivedImpacts = new DerivationIndex(
      baseline.trmFiles.flatMap((d) => d.parsed?.relations ?? []),
    ).impacts([...new Set(changed)]);
    return derivedImpacts;
  }
}
