import {
  AtermApplication,
  WorkspaceFiles,
  SourceAuthoring,
  type IAtermHome,
  type IFileRequest,
  type ISourceAuthoringRequest,
  type IWorkspaceFileResult,
  type ISourceAuthoringResult,
} from '@agent-workshop/aterm-core';
import type { ICommandExecutionContext } from './invocation.js';
import type { CliOutput } from './presentation-module/index.js';

/** Executes Workspace requests and publishes even when an attempted write fails. */
export async function executeWorkspace(
  home: IAtermHome,
  request: IFileRequest | ISourceAuthoringRequest,
  output: CliOutput,
  context: ICommandExecutionContext,
  publish: () => Promise<void>,
): Promise<number> {
  const raw = new WorkspaceFiles(home);
  let result;
  try {
    await context.usage?.phase('execute', { operationId: request.operation });
    result =
      'name' in request
        ? await new SourceAuthoring(home).execute(request)
        : await raw.execute(request);
    await context.usage?.phase('executed', {
      saved: 'saved' in result ? result.saved : undefined,
    });
  } finally {
    if (!request.dryRun && !['file-list', 'file-read'].includes(request.operation)) await publish();
  }
  await context.usage?.phase('validate');
  const diagnostics = await savedDiagnostics(home, result);
  await context.usage?.phase('render');
  output.workspace(result, diagnostics, request.dryRun);
  return 0;
}

async function savedDiagnostics(
  home: IAtermHome,
  result: IWorkspaceFileResult | ISourceAuthoringResult,
): Promise<string[]> {
  const diagnostics: string[] = [];
  if ('saved' in result && result.saved) {
    try {
      const app = await AtermApplication.open({ home: home.home });
      const checked = await app.query({ operation: 'check' });
      if ('diagnostics' in checked)
        diagnostics.push(...checked.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`));
    } catch (error) {
      diagnostics.push(String(error));
    }
  }
  return diagnostics;
}
