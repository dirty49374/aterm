import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/index.js';
import { AtermConfigReader, AtermHomeDiscovery, type IAtermHome } from '../home-module/index.js';
import type { IAtermOpenOptions } from '../application.js';
import { SkillCatalog } from './catalog.js';
import { runSkillCommand, type ISkillCommandResult } from './command.js';
import {
  InstallationManifest,
  skillManifestName,
  type SkillManifest,
} from './installation-manifest.js';
import { InstallationPlan } from './installation-plan.js';
import { InstallationFiles } from './installation-files.js';
export { skillManifestName } from './installation-manifest.js';

export interface ISkillInstallationRequest {
  readonly operation: 'install' | 'update' | 'uninstall';
}
export interface ISkillInstallation {
  readonly operation: ISkillInstallationRequest['operation'];
  readonly directory: string;
  readonly manifest: string;
  readonly command?: ISkillCommandResult;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
}

/** Manifest-owned Skill documents; a write-ahead inventory keeps interrupted updates recoverable. */
export class SkillInstallation {
  constructor(private readonly access = new FileAccess()) {}

  /** Manifest ownership only; does not claim that any external Agent copy is current. */
  async inventory(home: IAtermHome): Promise<{ names: readonly string[]; pending: boolean }> {
    const store = new InstallationManifest(join(home.home, 'skills'), this.access);
    const manifest = await store.read(home);
    return manifest
      ? { names: manifest.files.map((file) => file.name), pending: manifest.pending }
      : { names: [], pending: false };
  }

  install(options: IAtermOpenOptions = {}): Promise<ISkillInstallation> {
    return this.apply({ operation: 'install' }, options);
  }
  update(options: IAtermOpenOptions = {}): Promise<ISkillInstallation> {
    return this.apply({ operation: 'update' }, options);
  }
  uninstall(options: IAtermOpenOptions = {}): Promise<ISkillInstallation> {
    return this.apply({ operation: 'uninstall' }, options);
  }

  async apply(
    request: ISkillInstallationRequest,
    options: IAtermOpenOptions = {},
  ): Promise<ISkillInstallation> {
    const home = await new AtermHomeDiscovery(options.env ?? process.env).discover(
      options.cwd ?? process.cwd(),
      options.home,
    );
    const directory = join(home.home, 'skills');
    if ((await this.access.canonical(directory)) !== directory)
      throw new AtermError(
        'skill.symlink',
        `Skill installation directory must not contain symlinks: ${directory}`,
      );
    if (request.operation !== 'install' && !(await this.access.exists(directory)))
      throw new AtermError(
        'skill.manifest',
        `No installation manifest at ${join(directory, skillManifestName)}.`,
      );
    await mkdir(directory, { recursive: true });
    return this.access.exclusive(directory, () =>
      this.synchronize(directory, request.operation, home, options),
    );
  }

  private async synchronize(
    directory: string,
    operation: ISkillInstallationRequest['operation'],
    home: IAtermHome,
    options: IAtermOpenOptions,
  ): Promise<ISkillInstallation> {
    const store = new InstallationManifest(directory, this.access);
    await this.access.guard(directory, store.path);
    const old = await store.read(home);
    if (operation === 'install' && old)
      throw new AtermError(
        'skill.installed',
        `Installation already exists at ${directory}; use aterm skill update.`,
      );
    if (operation !== 'install' && !old)
      throw new AtermError(
        'skill.manifest',
        `No installation manifest at ${store.path}; no files were removed.`,
      );
    const { commands, plan } = await this.prepare(operation, home, old);
    const files = new InstallationFiles(directory, this.access);
    const current = await files.inspect(plan);
    const result = {
      operation,
      directory,
      manifest: store.path,
      ...plan.changes(directory, current),
      command: undefined as ISkillCommandResult | undefined,
    };
    // Record both hashes before mutation. A failed journal write is not a partial pointer write.
    await store.write({
      version: 2,
      commands,
      deployed: plan.possiblyDeployed,
      home: home.home,
      pending: true,
      files: plan.journal,
    });
    const changed: string[] = [];
    try {
      await files.apply(plan, current, changed);
      result.command = await this.deploy(operation, commands, plan, home, directory, options);
      if (operation === 'uninstall') await store.remove();
      else
        await store.write({
          version: 2,
          home: home.home,
          commands,
          deployed: commands ? plan.desiredNames : [],
          pending: false,
          files: plan.desired,
        });
    } catch (error) {
      throw new AtermError(
        'skill.partial',
        `${String(error)}\nChanged files: ${changed.join(', ') || 'none'}. Manifest retained; retry update or uninstall after resolving the failure.`,
      );
    }
    return result;
  }

  private async prepare(
    operation: ISkillInstallationRequest['operation'],
    home: IAtermHome,
    old: SkillManifest | undefined,
  ) {
    const config = operation === 'uninstall' ? undefined : await new AtermConfigReader().read(home);
    const configuredCommands =
      config?.skills?.sync && config.skills.uninstall
        ? { sync: config.skills.sync, uninstall: config.skills.uninstall }
        : undefined;
    if (operation === 'update' && old?.commands && !configuredCommands)
      throw new AtermError(
        'skill.command',
        'Restore skills commands to update, or uninstall using the recorded commands first.',
      );
    const commands = operation === 'uninstall' ? old?.commands : configuredCommands;
    const pointers = config ? await new SkillCatalog().read(config) : [];
    return {
      commands,
      plan: new InstallationPlan(pointers, old, commands, (text) => this.access.hash(text)),
    };
  }

  private async deploy(
    operation: ISkillInstallationRequest['operation'],
    commands: SkillManifest['commands'],
    plan: InstallationPlan,
    home: IAtermHome,
    directory: string,
    options: IAtermOpenOptions,
  ): Promise<ISkillCommandResult | undefined> {
    if (commands) {
      const kind = operation === 'uninstall' ? 'uninstall' : 'sync';
      return await runSkillCommand(kind, commands[kind], home.workspace, {
        ...process.env,
        ...options.env,
        ATERM_HOME: home.home,
        ATERM_WORKSPACE: home.workspace,
        ATERM_SKILLS_DIR: directory,
        ATERM_SKILL_OPERATION: operation,
        ATERM_SKILL_NAMES: plan.desiredNames.join('\n'),
        ATERM_REMOVED_SKILL_NAMES: plan.removedNames.join('\n'),
      });
    }
    return undefined;
  }
}
