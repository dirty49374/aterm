import { buildSchema } from 'graphql';

/** _aterm:GraphQL_Query_: stable common vocabulary; Viewpoint Term Kinds remain data. */
export const graphqlSchema = buildSchema(`
  "A JSON value; jq returns an ordered stream of these values."
  scalar JSON
  enum SortDirection { ASC DESC }
  enum NullPlacement { FIRST LAST }
  input JqOrder { key: String!, direction: SortDirection = ASC, nulls: NullPlacement = LAST }
  type Query {
    jq(program: String!, bindings: JSON, knowledge: [ID!], caseSensitive: Boolean): [JSON]!
    knowledge(id: ID!, caseSensitive: Boolean): Knowledge
    knowledges(where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): KnowledgeConnection!
    term(id: ID!, knowledge: ID, caseSensitive: Boolean): Term
    terms(knowledge: ID, match: String, termKind: String, viewpoint: String, text: String, caseSensitive: Boolean,
      where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): TermConnection!
    relations(knowledge: ID, phrase: String, origin: RelationOrigin, type: String, structural: Boolean,
      includeRemarks: Boolean = true, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!],
      first: Int = 20, after: String): RelationConnection!
    viewpoints(knowledge: ID, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!],
      first: Int = 20, after: String): ViewpointConnection!
    termKinds(knowledge: ID, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!],
      first: Int = 20, after: String): TermKindConnection!
  }
  type Knowledge {
    id: ID!
    file: String!
    description: String
    scope: String
    readOnly: Boolean!
    viewpoints(where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): ViewpointConnection!
    terms(match: String, termKind: String, viewpoint: String, text: String, caseSensitive: Boolean,
      where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): TermConnection!
  }
  type Term {
    id: ID!
    name: String!
    knowledge: Knowledge!
    termDeclarations(termKind: String, viewpoint: String, caseSensitive: Boolean): [TermDeclaration!]!
    outgoing(knowledge: ID, phrase: String, origin: RelationOrigin, type: String, structural: Boolean,
      includeRemarks: Boolean = true, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): RelationConnection!
    incoming(knowledge: ID, phrase: String, origin: RelationOrigin, type: String, structural: Boolean,
      includeRemarks: Boolean = true, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): RelationConnection!
  }
  """The single Term Declaration describing a Term."""
  type TermDeclaration {
    id: ID!
    term: Term!
    termKind: TermKind!
    group: String
    definition: String!
    file: String!
    line: Int!
    endLine: Int!
    sections(keys: [String!], caseSensitive: Boolean): [Section!]!
    outgoing(knowledge: ID, phrase: String, origin: RelationOrigin, type: String, structural: Boolean,
      includeRemarks: Boolean = true, caseSensitive: Boolean, where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): RelationConnection!
  }
  type Section { key: String!, format: String!, content: String!, line: Int! }
  type Relation {
    source: Term!
    target: Term!
    phrase: String!
    origin: RelationOrigin!
    type: String!
    structural: Boolean!
    required: Boolean!
    section: String
    targetSection: String
    locations: [SourceLocation!]!
  }
  enum RelationOrigin { relation reference }
  type SourceLocation { file: String!, line: Int!, column: Int }
  "A Viewpoint binding in one Knowledge, including package-owned vocabularies."
  type Viewpoint { name: String!, knowledge: Knowledge!, termKinds(where: String, bindings: JSON, orderBy: [JqOrder!], first: Int = 20, after: String): TermKindConnection! }
  """A Viewpoint-owned Term Kind and its declaration schema."""
  type TermKind {
    name: String!
    qualifiedName: String!
    description: String!
    viewpoint: Viewpoint!
    sections: [SectionDefinition!]!
  }
  type SectionDefinition {
    key: String!
    format: String!
    description: String
    example: String
    questions: [Question!]!
  }
  type Question { ask: String!, frame: String }
  type ViewpointConnection { nodes: [Viewpoint!]!, totalCount: Int!, pageInfo: PageInfo! }
  type TermKindConnection { nodes: [TermKind!]!, totalCount: Int!, pageInfo: PageInfo! }
  type PageInfo { hasNextPage: Boolean!, endCursor: String }
  type KnowledgeConnection { nodes: [Knowledge!]!, totalCount: Int!, pageInfo: PageInfo! }
  type TermConnection { nodes: [Term!]!, totalCount: Int!, pageInfo: PageInfo! }
  type RelationConnection { nodes: [Relation!]!, totalCount: Int!, pageInfo: PageInfo! }
`);
