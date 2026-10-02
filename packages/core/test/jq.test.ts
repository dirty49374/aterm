import { expect, test } from 'vitest';
import { stringify } from 'yaml';
import { fixture } from './fixture.js';
import { executeJq } from '../src/jq-module/index.js';

async function setup() {
  const f = await fixture('sources: [docs, shared]\nviewpoints:\n  trip: ./trip.md\n');
  await f.write(
    '.aterm/trip.md',
    `---\n${stringify({
      name: 'trip',
      description: 'Trip data.',
      termKinds: [
        {
          name: 'day',
          description: 'A day.',
          sections: [
            { name: 'definition', type: 'md' },
            { name: 'schedule', type: 'json' },
            { name: 'settings', type: 'yaml' },
          ],
        },
      ],
    })}---\n`,
  );
  await f.write(
    'docs/trip.trm',
    `@knowledge japan_trip
@viewpoints trip
day _Day_2026_10_28_ in days = {
  Stay in Takayama.
.schedule
  {"date":"2026-10-28","stay_booking_status":"confirmed","draft_plan":{"events":[{"kind":"meal"}]}}
.settings
  enabled: true
  count: 2
}
day _Day_2026_10_29_ = { Continue the journey. }
`,
  );
  await f.write(
    'shared/other.trm',
    '@knowledge other\n@viewpoints trip\nday _Another_Day_ = { Another journey. }\n',
  );
  const app = await f.app();
  const jq = async (program: string, knowledge?: string[] | null, caseSensitive?: boolean) => {
    const result = await app.query({ operation: 'jq', jq: { program, knowledge }, caseSensitive });
    if (!('operation' in result) || result.operation !== 'jq') throw new Error('Expected jq');
    return result.values;
  };
  return { f, app, jq };
}

test('jq projects structured and text sections across Knowledges with canonical metadata', async () => {
  const { jq } = await setup();
  const values = await jq('.[] | select(.schedule.stay_booking_status == "confirmed")');
  expect(values).toEqual([
    {
      '@term': '_japan_trip:Day_2026_10_28_',
      '@knowledge': 'japan_trip',
      '@viewpoint': 'trip',
      '@termKind': 'trip.day',
      '@group': 'days',
      definition: 'Stay in Takayama.',
      schedule: {
        date: '2026-10-28',
        stay_booking_status: 'confirmed',
        draft_plan: { events: [{ kind: 'meal' }] },
      },
      settings: { enabled: true, count: 2 },
    },
  ]);
  expect(
    await jq('group_by(.["@knowledge"]) | map({knowledge: .[0]["@knowledge"], count: length})'),
  ).toEqual([
    [
      { knowledge: 'japan_trip', count: 2 },
      { knowledge: 'other', count: 1 },
    ],
  ]);
  expect(await jq('.[] | select(.definition | contains("Takayama")) | .schedule.date')).toEqual([
    '2026-10-28',
  ]);
  expect(
    await jq('.[] | select(any(.schedule.draft_plan.events[]?; .kind == "meal")) | .["@term"]'),
  ).toEqual(['_japan_trip:Day_2026_10_28_']);
});

test('jq distinguishes scope, output streams, null and array values', async () => {
  const { jq } = await setup();
  expect(await jq('length', ['JAPAN_TRIP', 'japan_trip'])).toEqual([2]);
  expect(await jq('length', [])).toEqual([0]);
  expect(await jq('length', null)).toEqual([3]);
  expect(await jq('empty')).toEqual([]);
  expect(await jq('null, []')).toEqual([null, []]);
  await expect(jq('.', ['missing'])).rejects.toThrow();
  await expect(jq('.', ['JAPAN_TRIP'], true)).rejects.toThrow();
  expect(await jq('.[] | select(.definition | contains("takayama"))')).toEqual([]);
});

test('GraphQL jq uses the same projection and explicit array scope', async () => {
  const { app, jq } = await setup();
  const program = '.[] | {term: .["@term"], date: .schedule.date}';
  const result = await app.query({
    operation: 'graphql',
    graphql: {
      query:
        'query($program: String!, $knowledge: [ID!]) { jq(program: $program, knowledge: $knowledge) }',
      variables: { program, knowledge: ['JAPAN_TRIP'] },
    },
  });
  expect(result).toMatchObject({ response: { data: { jq: await jq(program, ['japan_trip']) } } });
  const refused = await app.query({
    operation: 'graphql',
    graphql: { query: 'query($p: String!) { jq(program: $p) }', variables: { p: 'error("bad")' } },
  });
  expect(refused).toMatchObject({ response: { errors: [{ extensions: { code: 'jq.program' } }] } });
});

test('jq cannot read host environment or import host files, and errors discard partial output', async () => {
  process.env.ATERM_JQ_SECRET = 'must-not-leak';
  try {
    expect(await executeJq('[]', 'env')).toEqual([{}]);
  } finally {
    delete process.env.ATERM_JQ_SECRET;
  }
  for (const program of [
    'include "/etc/passwd"; .',
    '1, error("bad")',
    'halt_error(1)',
    '--rawfile /etc/passwd',
    'invalid syntax ???',
  ])
    await expect(executeJq('[]', program)).rejects.toThrow();
  expect(await executeJq('[]', 'inputs')).toEqual([]);
});

test('jq output and time bounds terminate execution and permit the next request', async () => {
  await expect(executeJq('[]', 'range(0;10000000)')).rejects.toMatchObject({ code: 'jq.limit' });
  await expect(executeJq('[]', 'def loop: loop; loop')).rejects.toMatchObject({ code: 'jq.limit' });
  expect(await executeJq('[]', '42')).toEqual([42]);
}, 15000);

test('jq refuses invalid corpus, overlong UTF-8 programs and non-JSON YAML numbers', async () => {
  const { f, app, jq } = await setup();
  await expect(jq('#' + '한'.repeat(23000))).rejects.toMatchObject({ code: 'jq.limit' });
  await expect(jq('#' + 'x'.repeat(65536))).rejects.toMatchObject({ code: 'jq.limit' });
  await f.write(
    'shared/other.trm',
    '@knowledge other\n@viewpoints trip\nday _Another_Day_ = {\n  Another day.\n.settings\n  value: .nan\n}\n',
  );
  await expect(app.query({ operation: 'jq', jq: { program: '.' } })).rejects.toThrow();
  await f.write(
    'shared/other.trm',
    '@knowledge other\n@viewpoints trip\nday _Broken_ = { Broken _Missing_. }\n',
  );
  await expect(
    app.query({ operation: 'jq', jq: { program: 'length', knowledge: ['japan_trip'] } }),
  ).rejects.toThrow();
});

test('jq bounds memory allocation and aggregate GraphQL demand', async () => {
  await expect(executeJq('[]', '[range(0;100000000)]')).rejects.toMatchObject({ code: 'jq.limit' });
  const { app } = await setup();
  const result = await app.query({
    operation: 'graphql',
    graphql: {
      query:
        '{ a: jq(program:"0") b: jq(program:"0") c: jq(program:"0") d: jq(program:"0") e: jq(program:"0") }',
    },
  });
  expect(result).toMatchObject({
    response: { errors: [{ extensions: { code: 'graphql.limit' } }] },
  });
  expect(result).not.toHaveProperty('response.data');
}, 15000);
