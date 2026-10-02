import { readFile } from 'node:fs/promises';
import type { ICommandInputContext } from './contracts.js';

/** Adapter-owned file/stdin reads stay deferred until a command runs. */
export class CommandInputContext implements ICommandInputContext {
  async text(path: unknown): Promise<string> {
    if (typeof path !== 'string') throw new Error('--file is required');
    return path === '-' ? (await this.stdin()).toString('utf8') : readFile(path, 'utf8');
  }
  cwd(): string {
    return process.cwd();
  }
  private async stdin(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
