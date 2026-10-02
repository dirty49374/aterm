import { spawn } from 'node:child_process';
import { AtermError } from '../error.js';

export interface ISkillCommandResult {
  readonly kind: 'sync' | 'uninstall';
  readonly stdout: string;
  readonly stderr: string;
}

/** Configured Bash owns external installation; its output remains data in the CLI result. */
export function runSkillCommand(
  kind: ISkillCommandResult['kind'],
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ISkillCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      ['--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', '-c', command],
      {
        cwd,
        env: { ...env, BASH_ENV: '/dev/null' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]).subarray(-65536);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(-65536);
    });
    child.on('error', (error) =>
      reject(new AtermError('skill.command', `skills.${kind}: ${error.message}`)),
    );
    child.on('close', (code, signal) => {
      const result = { kind, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
      if (code === 0) resolve(result);
      else
        reject(
          new AtermError(
            'skill.command',
            `skills.${kind} failed (${signal ? `signal ${signal}` : `exit ${code}`}):\n${result.stdout}${result.stderr}`,
          ),
        );
    });
  });
}
