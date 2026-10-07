import { parse } from 'shell-quote';
import { AtermError, WorkspaceFiles, type IAtermHome } from '@garage49/aterm-core';
import { AtermProgram } from './program.js';
import { CommandInvocation, type ICommandExecutionContext } from './invocation.js';
import type { ICommandInputContext } from './contracts.js';

export interface ICommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Parse arguments, never shell programs. Expansion and operators are not command features. */
export function commandArguments(cmd: string): string[] {
  if (!cmd.trim())
    throw new AtermError(
      'command.empty',
      'Supply one Aterm command, without the executable prefix.',
    );
  const words = parse(cmd, (name) => '$' + name);
  if (words.some((word) => typeof word !== 'string'))
    throw new AtermError(
      'command.syntax',
      'Supply one command; shell operators, redirections, comments and globs must be quoted as literal arguments.',
    );
  return words as string[];
}

/** One invocation owns its parser, stdin, output and exit status. No process mutation. */
export class CommandRunner {
  constructor(
    private readonly home: IAtermHome,
    private readonly context: ICommandExecutionContext = {},
  ) {}

  async run(argv: readonly string[], stdin = ''): Promise<ICommandResult> {
    let stdout = '',
      stderr = '',
      exitCode = 0;
    const input: ICommandInputContext = {
      cwd: () => this.home.workspace,
      text: async (path) => {
        if (path === '-') return stdin;
        if (typeof path !== 'string')
          throw new AtermError('command.input', 'Expected an input path or stdin.');
        const raw = new WorkspaceFiles(this.home);
        return (await raw.read(await raw.path(path))).text;
      },
    };
    const streams = {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    };
    const program = new AtermProgram(
      new CommandInvocation(input, { ATERM_HOME: this.home.home }, streams, {
        ...this.context,
        home: this.home,
      }),
      (code) => {
        exitCode = code;
      },
    ).create();
    const configure = (command: typeof program) => {
      command
        .exitOverride()
        .configureOutput({ writeOut: streams.stdout, writeErr: streams.stderr });
      command.commands.forEach(configure);
    };
    configure(program);
    try {
      await program.parseAsync([...argv], { from: 'user' });
    } catch (error) {
      const failure = error as { code?: string; exitCode?: number; message?: string };
      if (failure.code === 'commander.helpDisplayed' || failure.code === 'commander.version')
        return { stdout, stderr, exitCode: 0 };
      exitCode = failure.exitCode || 1;
      if (!failure.code?.startsWith('commander.')) stderr += String(error) + '\n';
    }
    return { stdout, stderr, exitCode };
  }
}
