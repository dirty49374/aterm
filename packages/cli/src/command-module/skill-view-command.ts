import { shippedConfig, type AtermQuery, type IAtermConfig } from '@aterm/core';
import type { ICommandDefinition } from '../contracts.js';

export class SkillViewCommand implements ICommandDefinition {
  readonly name = 'skill view';
  readonly argument = '<term...>';
  readonly options = [] as const;
  readonly help = {
    summary: 'Read selected Skill bodies',
    behavior:
      "Prints each selected Skill's Definition and authored body, including its Reminder when present. Does not repeat prerequisite navigation or automatically include prerequisite bodies. Use skill toc for the SKILL.md entrypoint and reading order; view accepts all needed Skills together.",
    example: 'aterm skill view _aterm_skills:Corpus_Maintenance_Skill_',
  };
  readonly action = 'query' as const;
  fallback(): Promise<IAtermConfig> {
    return shippedConfig();
  }
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'skill-view', skillTerms: args[0] as string[] };
  }
}
