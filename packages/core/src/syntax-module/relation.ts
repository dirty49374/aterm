/** Built-in Relation semantics are independent of Term Kind, Viewpoint and edge origin. */
export interface IRelationSemantics {
  readonly type:
    | 'generalization'
    | 'instantiation'
    | 'parthood'
    | 'membership'
    | 'state_membership'
    | 'property'
    | 'dependency'
    | 'derivation'
    | 'realization'
    | 'reference'
    | 'association';
  readonly structural: boolean;
}

export const builtInRelations = {
  is_a: { type: 'generalization', structural: true },
  instance_of: { type: 'instantiation', structural: false },
  has_part: { type: 'parthood', structural: true },
  has_member: { type: 'membership', structural: true },
  has_state: { type: 'state_membership', structural: true },
  has_property: { type: 'property', structural: false },
  derived_from: { type: 'derivation', structural: false },
  depends_on: { type: 'dependency', structural: false },
  realizes: { type: 'realization', structural: false },
  references: { type: 'reference', structural: false },
} as const satisfies Record<string, IRelationSemantics>;

/** An underscore spelling is reserved; ordinary phrases remain associations. */
export function relationSemantics(phrase: string): IRelationSemantics | undefined {
  if (Object.hasOwn(builtInRelations, phrase))
    return builtInRelations[phrase as keyof typeof builtInRelations];
  return phrase.includes('_') ? undefined : { type: 'association', structural: false };
}
