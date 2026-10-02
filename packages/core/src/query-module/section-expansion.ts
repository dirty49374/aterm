import { SectionContext } from './section-context.js';
import { AtermError } from '../error.js';
import type { IAtermSection } from '../syntax-module/model.js';
import type { ITermDeclarationView } from './projection.js';

/** Fence opaque code without allowing its own backticks to close the block. */
export function codeBlock(text: string, language = 'text'): string {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}`;
}

/** Pure section transclusion shared by Markdown readings and Guide composition. */
export class SectionExpansion {
  private readonly context: SectionContext<ITermDeclarationView>;
  constructor(
    termDeclarations: readonly ITermDeclarationView[],
    private readonly includeRemarks = true,
  ) {
    this.context = new SectionContext([
      ...new Map(
        termDeclarations.map((termDeclaration) => [`${termDeclaration.id}`, termDeclaration]),
      ).values(),
    ]);
  }
  render(
    termDeclaration: ITermDeclarationView,
    section: IAtermSection,
    stack: readonly string[] = [],
  ): string {
    const key = `${termDeclaration.id}.${section.key}`;
    if (stack.includes(key))
      throw new AtermError(
        'aterm.expansion',
        `Section expansion cycle: ${[...stack, key].join(' -> ')}.`,
      );
    if (section.filetype !== 'md') return codeBlock(section.content, section.filetype);
    let content = section.content;
    const references = termDeclaration.references
      .filter((r) => r.section === section.key && r.targetSection && r.required)
      .sort((a, b) => b.contentOffset! - a.contentOffset!);
    for (const ref of references) {
      let replacement = '';
      if (this.includeRemarks || ref.targetSection !== 'remarks') {
        if (ref.contentOffset === undefined)
          throw new AtermError(
            'aterm.expansion',
            `Missing section content offset for ${ref.id}.${ref.targetSection}.`,
          );
        const target = this.context.target(ref);
        replacement = this.render(
          target,
          target.sections.find((s) => s.key === ref.targetSection)!,
          [...stack, key],
        );
      }
      const start = ref.contentOffset!;
      const length = ref.name.length + 1 + ref.targetSection!.length + 1;
      content = content.slice(0, start) + replacement + content.slice(start + length);
    }
    return content;
  }
}
