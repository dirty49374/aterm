import { parse, getOperationAST, print, valueFromASTUntyped } from 'graphql';

export function queryParameters(query, operationName) {
  const document = parse(query, { maxTokens: 5000 });
  const operation = getOperationAST(document, operationName || undefined);
  if (!operation) throw new Error('Choose an operation name for this document.');
  if (operation.operation !== 'query') throw new Error('Only read-only queries are supported.');
  return (operation.variableDefinitions || []).map((v) => ({
    name: v.variable.name.value,
    type: print(v.type),
    scalar: v.type.kind === 'NonNullType' ? v.type.type.name?.value : v.type.name?.value,
    required: v.type.kind === 'NonNullType' && !v.defaultValue,
    ...(v.defaultValue ? { defaultValue: valueFromASTUntyped(v.defaultValue) } : {}),
  }));
}
export function parseVariables(text) {
  const value = JSON.parse(text || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('Variables must be a JSON object.');
  return value;
}
// Only recognized identity fields (or jq's emitted canonical IDs) become Term results.
export function queryResultTerms(data, available) {
  const ids = new Set();
  const visit = (value, acceptString = false) => {
    if (typeof value === 'string') {
      if (acceptString && available.has(value)) ids.add(value);
    } else if (Array.isArray(value)) value.forEach((v) => visit(v, true));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, ['id', '@term'].includes(key));
    }
  };
  visit(data);
  return [...ids];
}
export function incompleteQueryResults(data) {
  let pages = 0;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.pageInfo?.hasNextPage === true) pages++;
    for (const child of Object.values(value)) visit(child);
  };
  visit(data);
  return pages;
}
export const queryExamples = [
  {
    name: 'Terms by Knowledge',
    query: `query Terms($knowledge: ID!, $after: String) {
  terms(knowledge: $knowledge, first: 100, after: $after) {
    nodes { id termDeclarations { definition } }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`,
    variables: { knowledge: 'vending_machine' },
  },
  {
    name: 'Trip date and related Terms',
    query: `# Matches a date anywhere in structured sections, then follows direct connections.
# The related collection includes incoming/outgoing Relations and References.
query TripDate($knowledge: ID!, $date: String!, $after: String, $relatedAfter: String) {
  dated: terms(knowledge: $knowledge,
    where: "any(.. | scalars; . == $date)", bindings: {date: $date},
    first: 100, after: $after) {
    nodes { id termDeclarations { definition } }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
  related: relations(knowledge: $knowledge,
    where: "(.source[\\"@knowledge\\"] == $knowledge and any(.source | .. | scalars; . == $date)) or (.target[\\"@knowledge\\"] == $knowledge and any(.target | .. | scalars; . == $date))",
    bindings: {knowledge: $knowledge, date: $date},
    first: 100, after: $relatedAfter) {
    nodes { phrase source { id } target { id } }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`,
    variables: { knowledge: 'japan_trip', date: '2026-10-28' },
  },
];
