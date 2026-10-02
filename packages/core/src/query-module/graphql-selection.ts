import { AtermError } from '../error.js';
import { jqLimits, jqBindings, type JsonValue } from './jq-request.js';
import type { JqEvaluator } from './jq.js';

export interface CollectionSelection {
  bindings?: Record<string, JsonValue> | null;
  where?: string | null;
  orderBy?:
    | readonly {
        key: string;
        direction?: 'ASC' | 'DESC' | null;
        nulls?: 'FIRST' | 'LAST' | null;
      }[]
    | null;
}
export interface GraphQLContext {
  evaluate: JqEvaluator;
}

/** One bounded evaluation per collection, never a worker per candidate. */
export async function selectCollection<T>(
  values: readonly T[],
  args: CollectionSelection,
  project: (value: T) => unknown,
  context: GraphQLContext,
): Promise<readonly T[]> {
  const bindings = jqBindings.parse(args.bindings ?? {});
  if (Buffer.byteLength(JSON.stringify(bindings)) > jqLimits.programBytes)
    throw new AtermError('jq.limit', 'jq bindings exceed 64 KiB.');
  const orders = args.orderBy ?? [];
  if (args.where == null && !orders.length) return values;
  for (const expression of [args.where, ...orders.map((order) => order.key)]) {
    if (expression == null) continue;
    if (!expression.trim())
      throw new AtermError('jq.program', 'Collection expressions must not be blank.');
    if (Buffer.byteLength(expression) > jqLimits.programBytes)
      throw new AtermError('jq.limit', 'Collection expression exceeds 64 KiB.');
  }
  const definitions = [args.where ?? 'true', ...orders.map((order) => order.key)]
    .map((expression, i) => `def aterm_expr_${i}: (\n${expression}\n);`)
    .join('\n');
  const keys = orders
    .map(
      (_, i) =>
        `([aterm_expr_${i + 1}] | if length == 1 and (.[0] | type | IN("null", "boolean", "number", "string")) then .[0] else error("orderBy key must emit exactly one scalar or null") end)`,
    )
    .join(',');
  const program = `${definitions}
    to_entries[] | .key as $index | .value |
    [aterm_expr_0] as $keep |
    if ($keep | length) != 1 or ($keep[0] | type) != "boolean" then
      error("where must emit exactly one boolean")
    elif $keep[0] then {index: $index, keys: [${keys}]} else empty end`;
  if (Buffer.byteLength(program) > jqLimits.programBytes)
    throw new AtermError('jq.limit', 'Combined collection program exceeds 64 KiB.');
  const records: string[] = [];
  let bytes = 2;
  for (const value of values) {
    const record = JSON.stringify(project(value), (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new AtermError(
          'jq.input',
          'Non-finite collection value cannot be represented as JSON.',
        );
      return value;
    });
    bytes += Buffer.byteLength(record) + (records.length ? 1 : 0);
    if (bytes > jqLimits.inputBytes)
      throw new AtermError('jq.limit', 'Collection input exceeds 16 MiB; narrow the collection.');
    records.push(record);
  }
  const input = '[' + records.join(',') + ']';
  const output = await context.evaluate(input, program, bindings);
  const seen = new Set<number>();
  const rows = output.map((row) => {
    if (
      !row ||
      Array.isArray(row) ||
      typeof row !== 'object' ||
      typeof row.index !== 'number' ||
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      row.index >= values.length ||
      seen.has(row.index) ||
      !Array.isArray(row.keys) ||
      row.keys.length !== orders.length ||
      row.keys.some((key) => key !== null && !['boolean', 'number', 'string'].includes(typeof key))
    )
      throw new AtermError('jq.program', 'Invalid collection expression result.');
    seen.add(row.index);
    return { index: row.index, keys: row.keys };
  });
  rows.sort((a, b) => {
    for (let i = 0; i < orders.length; i++) {
      const left = a.keys[i]!,
        right = b.keys[i]!;
      if (left === right) continue;
      const order = orders[i]!;
      if (left === null || right === null)
        return (left === null ? -1 : 1) * (order.nulls === 'FIRST' ? 1 : -1);
      const compared = compareScalar(left, right);
      if (compared) return compared * (order.direction === 'DESC' ? -1 : 1);
    }
    return a.index - b.index;
  });
  return rows.map((row) => values[row.index]!);
}

function compareScalar(a: JsonValue, b: JsonValue): number {
  const rank = (value: JsonValue) =>
    typeof value === 'boolean' ? 0 : typeof value === 'number' ? 1 : 2;
  const type = rank(a) - rank(b);
  if (type) return type;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  // Compare Unicode code points, independent of the server locale.
  const left = Array.from(a as string),
    right = Array.from(b as string);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}
