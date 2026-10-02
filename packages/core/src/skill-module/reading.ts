import { skillMetadata } from './metadata.js';
import { AtermError } from '../error.js';
import { TextMatching } from '../matching.js';
import { byText } from '../order.js';
import { localTermKind } from '../syntax-module/term-kind.js';
import type { IAtermRelation } from '../syntax-module/model.js';
import type { ITermDeclarationView } from '../query-module/projection.js';
import { SectionExpansion } from '../query-module/section-expansion.js';

export interface ISkillResult {
  readonly operation: 'skill-list' | 'skill-toc' | 'skill-view' | 'skill-remind';
  readonly skills: readonly {
    readonly term: string;
    readonly description: string;
    readonly hasReminder: boolean;
    /** Dependency-first order, excluding this Skill. Reading never executes a procedure. */
    readonly prerequisites: readonly string[];
    readonly markdown?: string;
  }[];
}

/** _aterm:Skill_Reading_: one Term Kind, ordered prerequisites and Markdown. */
export class SkillReading {
  private readonly skills = new Map<string, ITermDeclarationView>();
  private readonly dependencies = new Map<string, string[]>();
  private readonly expansion: SectionExpansion;

  constructor(
    termDeclarations: readonly ITermDeclarationView[],
    relations: readonly IAtermRelation[],
  ) {
    skillMetadata(termDeclarations);
    this.expansion = new SectionExpansion(termDeclarations);
    for (const termDeclaration of termDeclarations) {
      if (localTermKind(termDeclaration.termKind) !== 'skill') continue;
      if (this.skills.has(termDeclaration.id))
        this.fail(`More than one skill Term Declaration defines ${termDeclaration.id}.`);
      for (const key of ['description', 'body'])
        if (!termDeclaration.sections.some((s) => s.key === key && s.content.trim()))
          this.fail(`${termDeclaration.id} requires a nonempty .${key} section.`);
      const reminder = termDeclaration.sections.find((s) => s.key === 'reminder');
      if (reminder && !reminder.content.trim())
        this.fail(`${termDeclaration.id}: an authored .reminder section must be nonempty.`);
      this.skills.set(termDeclaration.id, termDeclaration);
    }
    for (const termDeclaration of this.skills.values()) {
      const targets = relations
        .filter(
          (r) =>
            r.source === termDeclaration.id &&
            r.file === termDeclaration.file &&
            r.line >= termDeclaration.line &&
            r.line <= termDeclaration.endLine &&
            r.phrase === 'requires',
        )
        .map((r) => r.target);
      for (const target of targets)
        if (!this.skills.has(target))
          this.fail(`${termDeclaration.id}: requires target ${target} must be a skill.`);
      this.dependencies.set(termDeclaration.id, [...new Set(targets)]);
    }
    // Validate all declarations, including Skills outside a selected Knowledge.
    const done = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string, path: string[]) => {
      if (active.has(id)) this.fail(`Prerequisite cycle: ${[...path, id].join(' -> ')}.`);
      if (done.has(id)) return;
      active.add(id);
      for (const target of this.dependencies.get(id)!) visit(target, [...path, id]);
      active.delete(id);
      done.add(id);
    };
    for (const id of this.skills.keys()) visit(id, []);
  }

  private fail(message: string): never {
    throw new AtermError('skill.invalid', message);
  }

  private prerequisites(id: string): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const visit = (target: string) => {
      if (seen.has(target)) return;
      seen.add(target);
      for (const dependency of this.dependencies.get(target)!) visit(dependency);
      ordered.push(target);
    };
    for (const target of this.dependencies.get(id)!) visit(target);
    return ordered;
  }

  read(
    operation: ISkillResult['operation'],
    selectors?: readonly string[],
    knowledge?: string,
    caseSensitive = false,
  ): ISkillResult {
    const matching = new TextMatching(caseSensitive);
    const available = [...this.skills.values()]
      .filter(
        (termDeclaration) => !knowledge || matching.equals(termDeclaration.knowledge, knowledge),
      )
      .sort((a, b) => byText(a.id, b.id));
    const selected =
      operation === 'skill-list'
        ? available
        : (selectors ?? []).map((selector) => {
            const matches = available.filter(
              (e) => matching.equals(e.id, selector) || matching.equals(e.name, selector),
            );
            if (matches.length !== 1)
              this.fail(
                `Skill ${selector} is ${matches.length ? 'ambiguous' : 'unknown'}; use a qualified Term from skill list or --case-sensitive.`,
              );
            return matches[0]!;
          });
    if (operation !== 'skill-list' && !selected.length)
      this.fail('Select at least one Term from skill list.');
    return {
      operation,
      skills: [...new Map(selected.map((e) => [e.id, e])).values()].map((termDeclaration) => {
        const prerequisites = this.prerequisites(termDeclaration.id);
        const description = termDeclaration.sections
          .find((s) => s.key === 'description')!
          .content.trim();
        const reminderSection = termDeclaration.sections.find((s) => s.key === 'reminder');
        const descriptor = {
          term: termDeclaration.id,
          description,
          prerequisites,
          hasReminder: !!reminderSection,
        };
        if (operation === 'skill-list') return descriptor;
        if (operation === 'skill-toc') {
          const markdown =
            [
              `# ${termDeclaration.id}`,
              termDeclaration.definition,
              '## Prerequisite reading',
              ...(prerequisites.length
                ? [
                    'Read unfamiliar or forgotten Skills in this order. Skip those you still understand. Reading is not execution.',
                    prerequisites.map((id, index) => `${index + 1}. ${id}`).join('\n'),
                  ]
                : ['No prerequisite Skills.']),
              '## Skill reading',
              termDeclaration.id,
              '## How to read Skills',
              'Read the Skills you need together, in the order above, with the selected Skill last. Omit prerequisites you already understand from this example command.',
              '```sh\naterm skill view ' +
                [...prerequisites, termDeclaration.id].join(' ') +
                '\n```',
            ]
              .join('\n\n')
              .trimEnd() + '\n\n\n';
          return { ...descriptor, markdown };
        }
        const reminder = reminderSection
          ? this.expansion.render(termDeclaration, reminderSection).trimEnd()
          : undefined;
        if (operation === 'skill-remind') {
          const markdown =
            [
              `# ${termDeclaration.id}`,
              reminder ?? 'No Reminder is authored for this Skill.',
              ...(reminderSection
                ? [
                    'Read unfamiliar or forgotten guidance before proceeding. Remembering instructions is not execution.',
                  ]
                : []),
              `Full reading: aterm skill view ${termDeclaration.id}`,
            ]
              .join('\n\n')
              .trimEnd() + '\n\n\n';
          return { ...descriptor, markdown };
        }
        const body = this.expansion
          .render(termDeclaration, termDeclaration.sections.find((s) => s.key === 'body')!)
          .trimEnd();
        const markdown =
          [
            `# ${termDeclaration.id}`,
            termDeclaration.definition,
            body,
            ...(reminderSection ? ['## Reminder', reminder!] : []),
          ]
            .join('\n\n')
            .trimEnd() + '\n\n\n';
        return { ...descriptor, markdown };
      }),
    };
  }
}
