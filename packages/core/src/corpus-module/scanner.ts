import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { FileAccess } from '../file-module/index.js';
import { composeTermKinds, type IAtermConfig } from '../home-module/index.js';
import { AtermParser, readViewpointsDirective } from '../syntax-module/index.js';
import { byText } from '../order.js';
import { isDefaultResource } from '../home-module/defaults.js';
import { shippedConfig } from '../home-module/package.js';
import type { IAtermDiagnostic, ITrmFile } from './trm-file.js';

export const EXTENSION = 'trm';

export interface IScanResult {
  readonly trmFiles: readonly ITrmFile[];
  /** Every message about the scan itself; a Term Declaration's own diagnostics stay in its parse. */
  readonly diagnostics: readonly IAtermDiagnostic[];
}

/** A supplied snapshot wins for the same physical file; identities are checked by the index. */
export function mergeScans(...scans: readonly IScanResult[]): IScanResult {
  const trmFiles = new Map<string, ITrmFile>();
  const diagnostics = new Map<string, IAtermDiagnostic>();
  for (const scan of scans) {
    for (const trmFile of scan.trmFiles) trmFiles.set(trmFile.absolutePath, trmFile);
    for (const issue of scan.diagnostics) diagnostics.set(JSON.stringify(issue), issue);
  }
  return {
    trmFiles: [...trmFiles.values()].sort((a, b) => byText(a.path, b.path)),
    diagnostics: [...diagnostics.values()].sort((a, b) => byText(a.file, b.file)),
  };
}

/** Reads every `.trm` file under the configured sources; each Knowledge's `@viewpoints` line selects its vocabulary. */
export class AtermScanner {
  private readonly files = new FileAccess();

  async scan(
    config: IAtermConfig,
    overrides: ReadonlyMap<string, string | null> = new Map(),
  ): Promise<IScanResult> {
    const home = await this.scanSources(config, overrides);
    if (!config.useDefaultKnowledge) return home;
    const packaged = await this.scanSources(await shippedConfig());
    return mergeScans(
      {
        ...packaged,
        trmFiles: packaged.trmFiles
          .filter((trmFile) => overrides.get(trmFile.absolutePath) !== null)
          .map((trmFile) => ({
            ...trmFile,
            path: relative(config.home.workspace, trmFile.absolutePath).split('\\').join('/'),
            readOnly: !config.allowDefaultWrites,
          })),
      },
      home,
    );
  }

  private async scanSources(
    config: IAtermConfig,
    overrides: ReadonlyMap<string, string | null> = new Map(),
  ): Promise<IScanResult> {
    const trmFiles: ITrmFile[] = [];
    const diagnostics: IAtermDiagnostic[] = [];
    const seen = new Set<string>();
    for (const source of config.sources)
      await this.visit(source, source, config, seen, trmFiles, diagnostics);
    for (const [file, text] of overrides) {
      const at = trmFiles.findIndex((trmFile) => trmFile.absolutePath === file);
      if (at >= 0) trmFiles.splice(at, 1);
      for (let i = diagnostics.length - 1; i >= 0; i--)
        if (diagnostics[i]!.file === file) diagnostics.splice(i, 1);
      if (text === null) continue;
      const source = config.sources.find((root) => this.files.inside(root, file));
      if (!source) throw new Error('Candidate is outside configured sources: ' + file);
      trmFiles.push(
        this.parseText(
          file,
          relative(config.home.workspace, file).split('\\').join('/'),
          source,
          text,
          config,
          diagnostics,
        ),
      );
    }
    const order = (a: { path?: string; file: string }, b: { path?: string; file: string }) =>
      byText(a.file, b.file);
    trmFiles.sort((a, b) => byText(a.path, b.path));
    diagnostics.sort(order);
    return { trmFiles, diagnostics };
  }

  private async visit(
    directory: string,
    source: string,
    config: IAtermConfig,
    seen: Set<string>,
    trmFiles: ITrmFile[],
    diagnostics: IAtermDiagnostic[],
  ): Promise<void> {
    let termDeclarations;
    try {
      termDeclarations = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        code: this.files.missing(error) ? 'source.missing' : 'source.unreadable',
        severity: 'warning',
        file: directory,
        line: 1,
        message: String(error),
      });
      return;
    }
    for (const termDeclaration of termDeclarations.sort((a, b) => byText(a.name, b.name))) {
      if (
        termDeclaration.name === '.git' ||
        termDeclaration.name === 'node_modules' ||
        termDeclaration.name.startsWith('.aterm')
      )
        continue;
      const absolutePath = join(directory, termDeclaration.name);
      const path = relative(config.home.workspace, absolutePath).split('\\').join('/');
      if (termDeclaration.isSymbolicLink()) {
        diagnostics.push({
          code: 'source.symlink',
          severity: 'warning',
          file: absolutePath,
          line: 1,
          message: 'Symbolic links are not followed; ignored: ' + path,
        });
        continue;
      }
      if (termDeclaration.isDirectory()) {
        await this.visit(absolutePath, source, config, seen, trmFiles, diagnostics);
        continue;
      }
      if (
        !termDeclaration.isFile() ||
        extname(termDeclaration.name).slice(1).toLowerCase() !== EXTENSION
      )
        continue;
      if (seen.has(absolutePath)) continue;
      seen.add(absolutePath);
      const trmFile = await this.read(absolutePath, path, source, config, diagnostics);
      if (trmFile) trmFiles.push(trmFile);
    }
  }

  private async read(
    absolutePath: string,
    path: string,
    source: string,
    config: IAtermConfig,
    diagnostics: IAtermDiagnostic[],
  ): Promise<ITrmFile | undefined> {
    const bytes = await readFile(absolutePath);
    const text = bytes.toString('utf8');
    const version = this.files.hash(bytes);
    const trmFile = {
      path,
      absolutePath,
      source,
      text,
      version,
      ...(isDefaultResource(absolutePath) && !config.allowDefaultWrites ? { readOnly: true } : {}),
    };
    if (!Buffer.from(text).equals(bytes)) {
      diagnostics.push({
        code: 'trm.encoding',
        severity: 'error',
        file: absolutePath,
        line: 1,
        message: 'Invalid UTF-8: ' + path,
      });
      return trmFile;
    }
    return this.parseText(absolutePath, path, source, text, config, diagnostics);
  }

  private parseText(
    absolutePath: string,
    path: string,
    source: string,
    text: string,
    config: IAtermConfig,
    diagnostics: IAtermDiagnostic[],
  ): ITrmFile {
    const trmFile = {
      path,
      absolutePath,
      source,
      text,
      version: this.files.hash(text),
      ...(isDefaultResource(absolutePath) && !config.allowDefaultWrites ? { readOnly: true } : {}),
    };
    const declared = readViewpointsDirective(text);
    if (!declared || !declared.names.length) {
      diagnostics.push({
        code: 'trm.viewpoints',
        severity: 'error',
        file: absolutePath,
        line: declared?.line ?? 1,
        message:
          'Knowledge declares no @viewpoints line, so its Term Declarations have no vocabulary: ' +
          path,
      });
      return trmFile;
    }
    const viewpoints = [];
    for (const name of declared.names) {
      const found = config.viewpoints.find((viewpoint) => viewpoint.name === name);
      if (!found) {
        diagnostics.push({
          code: 'trm.viewpoint',
          severity: 'error',
          file: absolutePath,
          line: declared.line,
          message: `Unbound Viewpoint ${name}; ${config.home.configPath} binds ${config.viewpoints.map((v) => v.name).join(', ') || 'none'}: ${path}`,
        });
        return trmFile;
      }
      viewpoints.push(found);
    }
    let termKinds;
    try {
      termKinds = composeTermKinds(viewpoints);
    } catch (error) {
      diagnostics.push({
        code: 'trm.termKinds',
        severity: 'error',
        file: absolutePath,
        line: declared.line,
        message: (error instanceof Error ? error.message : String(error)) + ': ' + path,
      });
      return trmFile;
    }
    return {
      ...trmFile,
      viewpoints: declared.names,
      parsed: new AtermParser(termKinds).parse(absolutePath, text),
    };
  }
}
