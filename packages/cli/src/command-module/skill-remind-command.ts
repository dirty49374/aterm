import { shippedConfig, type AtermQuery, type IAtermConfig } from '@aterm/core';
import type { ICommandDefinition } from '../contracts.js';

export class SkillRemindCommand implements ICommandDefinition {
  readonly name = 'skill remind';
  readonly argument = '<term...>';
  readonly options = [] as const;
  readonly help = {
    summary: 'Read authored recall cues for selected Skills',
    behavior:
      "Prints each selected Skill's Markdown reminder and full-reading command. Does not expand prerequisite reminders, summarize the body or execute actions. A missing reminder is reported explicitly; use view for complete guidance.",
    example: 'aterm skill remind _aterm_skills:Corpus_Maintenance_Skill_',
  };
  readonly action = 'query' as const;
  fallback(): Promise<IAtermConfig> {
    return shippedConfig();
  }
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'skill-remind', skillTerms: args[0] as string[] };
  }
}
