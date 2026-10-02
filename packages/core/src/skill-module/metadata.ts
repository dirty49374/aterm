import { AtermError } from '../error.js';
import { byText } from '../order.js';
import type { ITermDeclarationView } from '../query-module/index.js';
import { localTermKind } from '../syntax-module/term-kind.js';

/** One identity mapping for TOCs, discovery, MCP and managed installation. */
export function skillMetadata(termDeclarations: readonly ITermDeclarationView[]) {
  const names = new Set<string>();
  return termDeclarations
    .filter((term) => localTermKind(term.termKind) === 'skill')
    .map((termDeclaration) => {
      const name = `${termDeclaration.knowledge}-${termDeclaration.name.slice(1, -1)}`
        .replaceAll('_', '-')
        .toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || names.has(name))
        throw new AtermError(
          'skill.name',
          `Skill ${termDeclaration.id} has an invalid or conflicting install name: ${name}`,
        );
      names.add(name);
      const description = termDeclaration.sections
        .find((section) => section.key === 'description')
        ?.content.trim();
      if (!description || [...description].length > 1024)
        throw new AtermError(
          'skill.description',
          `Skill ${termDeclaration.id} requires a nonempty .description of at most 1024 characters.`,
        );
      return { name, description, termDeclaration };
    })
    .sort((a, b) => byText(a.name, b.name));
}
