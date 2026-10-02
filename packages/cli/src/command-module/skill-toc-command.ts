import { shippedConfig, type AtermQuery, type IAtermConfig } from '@agent-workshop/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class SkillTocCommand implements ICommandDefinition {
  readonly name = 'skill toc';
  readonly argument = '<term...>';
  readonly options = [] as const;
  readonly help = {
    summary: 'Read SKILL.md entrypoints for Skills',
    behavior:
      'Prints a Markdown entrypoint for each selected Skill: its Definition, prerequisite reading order, selected identity and a batch view command with that Skill last. Bodies and reminders are read separately through view and remind. Does not write or install SKILL.md files.',
    example: 'aterm skill toc _aterm_skills:Corpus_Reading_Skill_',
  };
  readonly action = 'query' as const;
  fallback(): Promise<IAtermConfig> {
    return shippedConfig();
  }
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'skill-toc', skillTerms: args[0] as string[] };
  }
}
