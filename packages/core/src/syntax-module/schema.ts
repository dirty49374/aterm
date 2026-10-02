export type AtermFiletype = 'md' | 'ts' | 'yaml' | 'json';

/**
 * One question a section asks of a Term: the question, and a frame that fixes the subject and
 * leaves the predicate blank. The answer is written into the section that asks.
 */
export interface AtermQuestion {
  readonly ask: string;
  readonly frame?: string;
}

/** One ordered section of a Term Declaration: its key, its fixed filetype, what it is for, and what it asks. */
export interface AtermSectionSpec {
  readonly name: string;
  readonly type: AtermFiletype;
  readonly description?: string;
  /** The questions to answer before writing this section; none, or one, is the usual number. */
  readonly questions?: readonly AtermQuestion[];
  /** One answer from the Viewpoint's worked example, with how its shape is read. */
  readonly example?: string;
}

/**
 * The ordered section contract of one _aterm:Term_Kind_; independent of declaration syntax.
 * Every Schema includes the reserved relations section after definition. Viewpoints supply
 * ordinary content sections; they cannot rename or redefine the structural declaration section.
 */
export class AtermSchema {
  readonly sections: readonly AtermSectionSpec[];
  constructor(
    readonly description: string,
    sections: readonly AtermSectionSpec[],
  ) {
    if (!description.trim() || !sections.length)
      throw new Error('Aterm Schema requires a description and at least one section.');
    if (sections[0]!.name !== 'definition')
      throw new Error('Every Aterm Schema must begin with the definition section.');
    if (sections.some((section) => section.name === 'relations'))
      throw new Error('Aterm Schema section relations is reserved and must not be declared.');
    const keys = new Set<string>();
    this.sections = Object.freeze(
      [
        sections[0]!,
        {
          name: 'relations',
          type: 'md' as const,
          description: 'Declared connections to other Terms: one phrase and Target per line.',
        },
        ...sections.slice(1),
      ].map((section) => {
        const { name, type, description, questions, example } = section;
        if (!/^[a-z][a-z0-9_]*$/.test(name) || keys.has(name))
          throw new Error('Invalid or duplicate Aterm Schema key: ' + name);
        keys.add(name);
        if (!['md', 'ts', 'yaml', 'json'].includes(type))
          throw new Error('Invalid filetype for Aterm Schema key: ' + name);
        return Object.freeze({
          name,
          type,
          ...(description === undefined ? {} : { description }),
          ...(questions?.length ? { questions: Object.freeze([...questions]) } : {}),
          ...(example === undefined ? {} : { example }),
        });
      }),
    );
    Object.freeze(this);
  }

  allows(key: string, filetype: AtermFiletype): boolean {
    return this.sections.find((field) => field.name === key)?.type === filetype;
  }
}

/** _aterm:Term_Kind_ is one classification label and the Schema its Term Declarations follow. */
export interface AtermTermKind {
  readonly name: string;
  readonly description: string;
  /** The Viewpoint that supplies this kind; `default` for the built-in vocabulary. */
  readonly viewpoint: string;
  readonly schema: AtermSchema;
}

export const specSchema = new AtermSchema(
  'A concept identity, normative Contract and informative Remarks.',
  [
    { name: 'definition', type: 'md', description: 'What the Term is, and what distinguishes it.' },
    { name: 'contract', type: 'md', description: 'The obligations the Term carries.' },
    { name: 'remarks', type: 'md', description: 'Rationale, background and examples.' },
  ],
);

/** The built-in kinds a parser uses when no Viewpoint is given, as in unit tests. */
export const specTermKinds: readonly AtermTermKind[] = Object.freeze([
  {
    name: 'concept',
    description: 'A thing, a data shape, a state or a rule set.',
    viewpoint: 'default',
    schema: specSchema,
  },
  {
    name: 'procedure',
    description: 'An operation with inputs, decisions, effects and outcomes.',
    viewpoint: 'default',
    schema: specSchema,
  },
  {
    name: 'undecided',
    description: 'A Term whose classification is deliberately deferred.',
    viewpoint: 'default',
    schema: specSchema,
  },
]);
