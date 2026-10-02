import { relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { AtermError } from '../error.js';
import {
  AtermConfigReader,
  AtermViewpointReader,
  type IAtermConfig,
} from '../home-module/index.js';
import { WorkspaceFiles } from './workspace-files.js';
import { assertDefaultWritable } from './writable.js';
import { matchSourceVersion } from './source-validation.js';
import type { ISourceAuthoringRequest, ISourcePlan, IPlannedSourceFile } from './source-plan.js';

/** Plans a Viewpoint document and its binding together; never writes either file. */
export class ViewpointSourcePlan {
  constructor(private readonly raw: WorkspaceFiles) {}
  async build(config: IAtermConfig, request: ISourceAuthoringRequest): Promise<ISourcePlan> {
    const home = this.raw.home;
    const create = request.operation.endsWith('-create');
    const remove = request.operation.endsWith('-delete');
    const planned: IPlannedSourceFile[] = [];
    const found = config.viewpoints.find((v) => v.name === request.name);
    if (found?.readOnly && !create)
      throw new AtermError(
        'viewpoint.readonly',
        `Built-in Viewpoint ${request.name} is read-only; set allowDefaultWrites: true to permit changes.`,
      );
    if (create === !!found)
      throw new AtermError(
        create ? 'viewpoint.exists' : 'viewpoint.missing',
        `Viewpoint ${request.name} ${create ? 'already exists' : 'is not bound'}.`,
      );
    const target = found?.path ?? resolve(home.home, 'viewpoints', request.name + '.md');
    assertDefaultWritable(target, config.allowDefaultWrites);
    await this.raw.path(relative(home.workspace, target));
    const before = found ? await this.raw.read(target) : undefined;
    if (!found && (await this.raw.files.exists(target)))
      throw new AtermError('file.exists', 'Viewpoint file already exists: ' + target);
    matchSourceVersion(request.ifMatch, before?.version);
    const loaded = new Map(config.viewpoints.map((v) => [v.name, v]));
    if (remove) loaded.delete(request.name);
    else
      loaded.set(
        request.name,
        new AtermViewpointReader().parse(request.name, target, request.text!),
      );
    planned.push({
      path: target,
      before: before?.text,
      version: before?.version,
      after: remove ? undefined : request.text,
    });
    const configFile = await this.raw.read(
      await this.raw.path(relative(home.workspace, home.configPath)),
    );
    let configText = configFile.text;
    if (create || remove) {
      const document = parseDocument(configText);
      if (remove) {
        document.deleteIn(['viewpoints', request.name]);
        document.set(
          'useViewpoints',
          config.useViewpoints.filter((name) => name !== request.name),
        );
      } else document.setIn(['viewpoints', request.name], './viewpoints/' + request.name + '.md');
      configText = document.toString();
      planned.push({
        path: home.configPath,
        before: configFile.text,
        version: configFile.version,
        after: configText,
      });
    }
    const candidateConfig = new AtermConfigReader().parse(home, configText, loaded);
    return { config: candidateConfig, target, files: planned, overrides: new Map() };
  }
}
