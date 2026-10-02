import { Command } from 'commander';
import { commands } from './command-module/index.js';
import type { ICommandDefinition } from './contracts.js';
import { CommandInputContext } from './input-context.js';
import { CommandInvocation } from './invocation.js';
import { packageVersion } from './package-info.js';

const groups: Record<string, string> = {
  file: 'Read and repair Workspace text files, including invalid corpus files',
  corpus: 'Search, validate and compare the corpus',
  index: 'Prepare or inspect the local semantic index',
  knowledge: 'Discover, read, create, edit, delete and rename Knowledges',
  term: 'Find, read and change Terms and their Term Declarations',
  graph: 'Explore connections between Terms',
  viewpoint: 'Discover, read and author bound vocabularies',
  skill: 'Read prerequisite-based Skills and manage installed TOCs',
  server: 'Run the HTTP server for this Home',
  mcp: 'Run MCP over stdio, optionally with the HTTP server',
  ui: 'Inspect and control connected browser tabs',
  session: 'Inspect browser Sessions',
  command: 'Inspect UI command outcomes',
  explore: 'Set, add, remove or clear Explore membership',
  note: 'Send Markdown Notes to a browser Session',
};

export const homeHelp =
  'Home selection: --home, then ATERM_HOME, then the nearest .aterm directory from cwd upward, then ~/.aterm. Relative source paths in aterm.yaml resolve against the parent of .aterm.';

/** Mechanical Commander construction from each command definition; one action path for all. */
export class AtermProgram {
  constructor(
    private readonly invocation: CommandInvocation = new CommandInvocation(
      new CommandInputContext(),
    ),
    private readonly setExitCode: (code: number) => void = (code) => {
      process.exitCode = code;
    },
  ) {}

  create(): Command {
    const program = new Command()
      .name('aterm')
      .description('Aterm Terms: find, read, connect, check and change Term Declarations')
      .version(packageVersion)
      .option(
        '--case-sensitive',
        'Match read selectors and search text with exact case (default: case-insensitive)',
      )
      .option(
        '--knowledge <id>',
        'Select Terms within one Knowledge; use qualified Terms to select across Knowledges',
      )
      .option('--server <url>', 'Run remotely through this MCP endpoint; no local Home or fallback')
      .option('--home <path>', 'Aterm home (.aterm directory); precedes ATERM_HOME and discovery')
      .option(
        '--output <format>',
        'Output format: markdown, json or yaml (default: text)',
        (value: string, prior: string[] = []) => [...prior, value],
      )
      .addHelpText('after', '\n' + homeHelp);
    for (const constructor of commands) this.register(program, new constructor());
    program.on('command:*', (operands: string[]) => {
      const old = operands[0];
      const moved = commands
        .map((Constructor) => new Constructor())
        .find((definition) => definition.legacyName === old);
      program.error(
        moved
          ? `Command ${old} moved; use aterm ${moved.name}.`
          : `Unknown command ${old}. Run aterm --help.`,
      );
    });
    return program;
  }

  private register(program: Command, definition: ICommandDefinition): void {
    const parts = definition.name.split(' ');
    const leaf = parts.pop()!;
    let parent = program;
    for (const [index, part] of parts.entries()) {
      let group = parent.commands.find((command) => command.name() === part);
      if (!group) {
        const description = groups[part];
        if (!description) throw new Error(`Missing help description for command group ${part}.`);
        group = parent
          .command(part)
          .description(description)
          .allowExcessArguments(false)
          .showHelpAfterError(
            `Use aterm ${parts.slice(0, index + 1).join(' ')} <operation>; run aterm ${parts.slice(0, index + 1).join(' ')} --help for available subcommands.`,
          );
        group.action(() => {
          group!.outputHelp();
        });
      }
      parent = group;
    }
    const command = parent
      .command(leaf + (definition.argument ? ' ' + definition.argument : ''))
      .allowExcessArguments(false)
      .description(definition.help.summary)
      .addHelpText(
        'after',
        `\nBehavior and recovery: ${definition.help.behavior}\n\nOutput: Command-specific rows by default; finite results support --output markdown|json|yaml.\n\nExample:\n  ${definition.help.example}\n`,
      );
    for (const [flags, description] of definition.options) command.option(flags, description);
    command.action(async (...args: unknown[]) => {
      const current = args.at(-1) as Command;
      const values = args.slice(0, -2);
      this.setExitCode(
        await this.invocation.execute({
          definition,
          args: values,
          options: current.optsWithGlobals(),
        }),
      );
    });
  }
}
