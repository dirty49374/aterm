import { CommandTextInput } from './text-input.js';
import { jqRequest, type AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class JqCommand implements ICommandDefinition {
  readonly textInput = new CommandTextInput({ index: 0, label: 'jq program' });
  readonly name = 'corpus jq';
  readonly argument = '[program]';
  readonly options = [
    ['--file <path>', 'jq program; - or omitted reads stdin when no inline program is supplied'],
    [
      '--knowledges <id...>',
      'Select the input Knowledges (OR); omission reads the complete corpus',
    ],
  ] as const;
  readonly help = {
    summary: 'Query and transform corpus JSON with embedded jq',
    behavior:
      'Run jq once over an identity-ordered array of Terms. @term, @knowledge, @viewpoint, @termKind and @group are metadata; JSON/YAML sections are values and other sections are strings. Output is always the array of jq output values, including [] for no output and [null] for null. --case-sensitive controls Knowledge selection; jq retains its own matching semantics. No input pagination, shell, host files or environment. Limits: 64 KiB program, 16 MiB input, 2 MiB output, 5 seconds, 128 MiB WASM memory, four concurrent executions. Use --knowledges rather than the singular global --knowledge.',
    example: `aterm corpus jq '.[] | select(.schedule.stay_booking_status == "confirmed") | {term: .["@term"], date: .schedule.date}' --knowledges japan_trip`,
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'jq',
      jq: jqRequest.parse({
        program: await this.textInput.read(args, options, input),
        ...(options.knowledges === undefined ? {} : { knowledge: options.knowledges }),
      }),
    };
  }
}
