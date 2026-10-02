import { expect, test } from 'vitest';
import { stringify } from 'yaml';
import { fixture } from './fixture.js';

async function setup() {
  const f = await fixture('sources: [docs]\nviewpoints:\n  trip: ./trip.md\n');
  await f.write(
    '.aterm/trip.md',
    `---\n${stringify({
      name: 'trip',
      description: 'Travel.',
      termKinds: ['day', 'transport'].map((name) => ({
        name,
        description: name,
        sections: [
          { name: 'definition', type: 'md' },
          { name: 'schedule', type: 'json' },
          { name: 'booking', type: 'yaml' },
        ],
      })),
    })}---\n`,
  );
  await f.write(
    'docs/trip.trm',
    `@knowledge japan_trip
@viewpoints trip
@description {
  A travel fixture.
}
day _Day_ = {
  Departure day using _Train_B_.
.relations
  uses _Train_B_
.schedule
  {"date":"2026-10-28"}
}
transport _Train_A_ = {
  Later confirmed train.
.schedule
  {"date":"2026-10-29","departure":"10:00"}
.booking
  status: confirmed
}
transport _Train_B_ = {
  Earlier pending train.
.schedule
  {"date":"2026-10-28","departure":"12:00"}
.booking
  status: pending
}
transport _Train_C_ = {
  Earlier morning train, no booking record.
.schedule
  {"date":"2026-10-28","departure":"08:00"}
}
transport _Train_D_ = { Unscheduled train. }
transport _Train_E_ = {
  Same date and departure as C.
.schedule
  {"date":"2026-10-28","departure":"08:00"}
.booking
  status: pending
}
`,
  );
  await f.write(
    'docs/other.trm',
    '@knowledge other\n@viewpoints trip\ntransport _Other_ = { Other knowledge. }\n',
  );
  const app = await f.app();
  const query = async (query: string, variables?: Record<string, unknown>) => {
    const result = await app.query({ operation: 'graphql', graphql: { query, variables } });
    if (!('operation' in result) || result.operation !== 'graphql') throw Error('Expected GraphQL');
    return JSON.parse(JSON.stringify(result.response));
  };
  return { f, query };
}

test('travel predicates filter parsed sections before stable multi-key sorting and pagination', async () => {
  const { query } = await setup();
  const document = `query($where: String!, $after: String) {
    terms(knowledge: "japan_trip", termKind: "trip.transport", where: $where,
      orderBy: [{key: ".schedule.date"}, {key: ".schedule.departure"}], first: 2, after: $after) {
      nodes { id termDeclarations { sections(keys: ["schedule"]) { content } } }
      totalCount pageInfo { endCursor hasNextPage }
    }
  }`;
  const where = '.schedule.date == "2026-10-28" and .booking.status != "confirmed"';
  const first = await query(document, { where });
  expect(first.errors).toBeUndefined();
  expect(first.data.terms.totalCount).toBe(3);
  expect(first.data.terms.nodes.map((v: { id: string }) => v.id)).toEqual([
    '_japan_trip:Train_C_',
    '_japan_trip:Train_E_',
  ]);
  const after = first.data.terms.pageInfo.endCursor;
  expect(first.data.terms.pageInfo.hasNextPage).toBe(true);
  expect(
    (await query(document, { where, after })).data.terms.nodes.map((v: { id: string }) => v.id),
  ).toEqual(['_japan_trip:Train_B_']);
  expect(
    (await query(document, { where: '.booking.status == "pending"', after })).errors[0].message,
  ).toContain('cursor');
  expect(
    (
      await query(
        document.replace('key: ".schedule.date"', 'key: ".schedule.date", direction: DESC'),
        { where, after },
      )
    ).errors[0].message,
  ).toContain('cursor');
  const strict = await query(document, {
    where: '.booking.status != null and .booking.status != "confirmed"',
  });
  expect(strict.data.terms.totalCount).toBe(2);
});

test('ascending and descending date order place null last by default and allow explicit nulls first', async () => {
  const { query } = await setup();
  const ordered = async (direction: string, nulls = 'LAST') => {
    const r = await query(`{ terms(knowledge:"japan_trip", termKind:"transport",
      orderBy:[{key:".schedule.date", direction:${direction}, nulls:${nulls}}]) {nodes{id}} }`);
    expect(r.errors).toBeUndefined();
    return r.data.terms.nodes.map((v: { id: string }) => v.id);
  };
  expect(await ordered('ASC')).toEqual([
    '_japan_trip:Train_B_',
    '_japan_trip:Train_C_',
    '_japan_trip:Train_E_',
    '_japan_trip:Train_A_',
    '_japan_trip:Train_D_',
  ]);
  expect(await ordered('DESC')).toEqual([
    '_japan_trip:Train_A_',
    '_japan_trip:Train_B_',
    '_japan_trip:Train_C_',
    '_japan_trip:Train_E_',
    '_japan_trip:Train_D_',
  ]);
  expect((await ordered('DESC', 'FIRST'))[0]).toBe('_japan_trip:Train_D_');
});

test('Relation roots and nested traversal filter endpoint sections with the same shape', async () => {
  const { query } = await setup();
  const r = await query(
    `query($where: String!) {
    relations(origin:relation, where:$where) { nodes { phrase source{id} target{id} } totalCount }
    term(id:"_japan_trip:Day_") {
      outgoing(origin:relation, where:$where) { nodes { phrase source{id} target{id} } totalCount }
      termDeclarations { outgoing(origin:relation, where:$where) { totalCount } }
    }
  }`,
    { where: '.source.schedule.date == "2026-10-28" and .target.booking.status != "confirmed"' },
  );
  expect(r.errors).toBeUndefined();
  expect(r.data.relations).toEqual(r.data.term.outgoing);
  expect(r.data.relations.totalCount).toBe(1);
  expect(r.data.relations.nodes[0].target.id).toBe('_japan_trip:Train_B_');
  expect(r.data.term.termDeclarations[0].outgoing.totalCount).toBe(1);
  const reverse = await query(`{term(id:"_japan_trip:Train_B_") { incoming(origin: relation,
    where:".source.schedule.date != null") {nodes{source{id}}} }}`);
  expect(reverse.data.term.incoming.nodes).toEqual([{ source: { id: '_japan_trip:Day_' } }]);
});

test('all five collection roots share predicates, sorting and connections with Knowledge-scoped vocabulary', async () => {
  const { query } = await setup();
  const r = await query(
    `{
    knowledges(where: ".description != null", orderBy:[{key:".id",direction:DESC}]) {nodes{id} totalCount}
    viewpoints(where: ".knowledge.id == \\"japan_trip\\"", orderBy:[{key:".name"}]) {nodes{name knowledge{id}} totalCount}
    termKinds(where: ".viewpoint.knowledge.id == \\"japan_trip\\" and .name == \\"transport\\"") {nodes{qualifiedName sections{key}} totalCount}
  }`,
  );
  expect(r.errors).toBeUndefined();
  expect(r.data.knowledges.nodes).toEqual([{ id: 'japan_trip' }]);
  expect(r.data.viewpoints.nodes).toEqual([{ name: 'trip', knowledge: { id: 'japan_trip' } }]);
  expect(r.data.termKinds.totalCount).toBe(1);
  expect(r.data.termKinds.nodes[0].qualifiedName).toBe('trip.transport');
  const nested = await query(
    `query($p:String!) {knowledge(id:"japan_trip") {
    terms(where:$p) {totalCount}
    viewpoints(where:".name == \\"trip\\"") {nodes {termKinds(where:".name == \\"transport\\"") {totalCount}}}
  }}`,
    { p: '.["@termKind"] == "trip.transport"' },
  );
  expect(nested.errors).toBeUndefined();
  expect(nested.data.knowledge.terms.totalCount).toBe(5);
  expect(nested.data.knowledge.viewpoints.nodes[0].termKinds.totalCount).toBe(1);
  const all = await query('{viewpoints{totalCount} termKinds{totalCount}}');
  expect(all.data).toEqual({ viewpoints: { totalCount: 2 }, termKinds: { totalCount: 4 } });
});

test('where keeps jq case semantics and rejects nonboolean or multiple emissions', async () => {
  const { query } = await setup();
  for (const where of ['null', 'empty', 'true, false', '1', 'error("bad")', '']) {
    const r = await query('query($p:String!){terms(where:$p){totalCount}}', { p: where });
    expect(r.errors?.[0].extensions.code).toBe('jq.program');
  }
  const r = await query(
    `query($p:String!){terms(knowledge:"JAPAN_TRIP",caseSensitive:false,where:$p){totalCount}}`,
    { p: '(.definition // "") | test("EARLIER"; "i")' },
  );
  expect(r.data.terms.totalCount).toBe(2);
  expect(
    (
      await query('query($p:String!){terms(where:$p){totalCount}}', {
        p: '.definition | contains("EARLIER")',
      })
    ).data.terms.totalCount,
  ).toBe(0);
});

test('bad sort keys, shared execution demand and worker timeouts fail without partial demand results', async () => {
  const { query } = await setup();
  for (const key of ['empty', '.schedule', '1, 2', '[1]', '']) {
    const r = await query('query($key:String!){terms(orderBy:[{key:$key}]){totalCount}}', { key });
    expect(r.errors?.[0].extensions.code).toBe('jq.program');
  }
  const limited = await query(
    '{ a:jq(program:"0") b:terms(where:"true"){totalCount} c:knowledges(where:"true"){totalCount} d:viewpoints(where:"true"){totalCount} e:termKinds(where:"true"){totalCount} }',
  );
  expect(limited.data).toBeUndefined();
  expect(limited.errors[0].extensions.code).toBe('graphql.limit');
  const timeout = await query('{terms(where:"def loop: loop; loop"){totalCount}}');
  expect(timeout.data).toBeUndefined();
  expect(timeout.errors[0].extensions.code).toBe('jq.limit');
  expect((await query('{terms(where:"true"){totalCount}}')).data.terms.totalCount).toBe(7);
}, 15000);

test('GraphQL variables bind jq values without interpolating executable text', async () => {
  const { query } = await setup();
  const document = `query($date: String!, $after: String) {
    terms(knowledge:"japan_trip", where:".schedule.date == $date", bindings:{date:$date}, first:2, after:$after) {
      nodes{id} totalCount pageInfo{endCursor hasNextPage}
    }
  }`;
  const result = await query(document, { date: '2026-10-28' });
  expect(result.errors).toBeUndefined();
  expect(result.data.terms.totalCount).toBe(4);
  expect(
    (await query(document, { date: '2026-10-29', after: result.data.terms.pageInfo.endCursor }))
      .errors[0].message,
  ).toContain('cursor');
  // Identical selected rows still belong to the parameter set that produced the cursor.
  const sameRows = document.replace('.schedule.date == $date', '$date != null');
  const all = await query(sameRows, { date: '2026-10-28' });
  expect(
    (
      await query(sameRows, {
        date: '2026-10-29',
        after: all.data.terms.pageInfo.endCursor,
      })
    ).errors[0].message,
  ).toContain('cursor');
  const injected = await query(document, { date: '2026-10-28" or true #' });
  expect(injected.errors).toBeUndefined();
  expect(injected.data.terms.totalCount).toBe(0);
  const literal = await query(
    `query($values:JSON!){ jq(program:"$values",bindings:{values:$values}) }`,
    { values: { date: '" | error("injected")', count: 2, active: true, absent: null } },
  );
  expect(literal.errors).toBeUndefined();
  expect(literal.data.jq).toEqual([
    { date: '" | error("injected")', count: 2, active: true, absent: null },
  ]);
});

test('bindings work in nested selections and reject invalid names and oversized values', async () => {
  const { query } = await setup();
  const result = await query(
    `query($date:String!) { term(id:"_japan_trip:Day_") {
    outgoing(where:".target.schedule.date == $date", bindings:{date:$date}) {nodes{target{id}}}
  } }`,
    { date: '2026-10-28' },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.term.outgoing.nodes).toHaveLength(2);
  for (const bindings of [{ 'bad-name': 1 }, ['bad'], { value: 'x'.repeat(65536) }]) {
    const invalid = await query(`query($bindings:JSON){ terms(bindings:$bindings){totalCount} }`, {
      bindings,
    });
    expect(invalid.errors).toBeDefined();
  }
});

test('the browser trip example returns dated Terms and their direct connections', async () => {
  // @ts-expect-error Native browser module.
  const { queryExamples } = await import('../../webapp/src/query-model.js');
  const { query } = await setup();
  const result = await query(queryExamples[1].query, queryExamples[1].variables);
  expect(result.errors).toBeUndefined();
  expect(result.data.dated.totalCount).toBe(4);
  expect(result.data.related.nodes.map((r: any) => r.target.id)).toContain('_japan_trip:Train_B_');
});

test('Relation Knowledge filters keep either endpoint, including cross-Knowledge edges and nested traversal', async () => {
  const { f, query } = await setup();
  await f.write(
    'docs/other.trm',
    '@knowledge other\n@viewpoints trip\ntransport _Other_ = {\n  Other knowledge.\n.relations\n  references _japan_trip:Day_\n}\n',
  );
  const result = await query(`{
    relations(knowledge:"JAPAN_TRIP", origin:relation) {nodes{source{id} target{id}} totalCount}
    term(id:"_japan_trip:Day_") {
      incoming(knowledge:"other",where:"true") {nodes{source{id}}}
      outgoing(knowledge:"other") {totalCount}
      termDeclarations {outgoing(knowledge:"other") {totalCount}}
    }
  }`);
  expect(result.errors).toBeUndefined();
  expect(result.data.relations.totalCount).toBe(2);
  expect(result.data.term.incoming.nodes).toEqual([{ source: { id: '_other:Other_' } }]);
  expect(result.data.term.outgoing.totalCount).toBe(0);
  expect(result.data.term.termDeclarations[0].outgoing.totalCount).toBe(0);
  for (const argument of ['knowledge:"missing"', 'knowledge:"JAPAN_TRIP",caseSensitive:true'])
    expect((await query(`{relations(${argument}){totalCount}}`)).errors).toBeDefined();
});

test('Relation Knowledge selection precedes bounded jq materialization', async () => {
  const { f, query } = await setup();
  await f.write(
    'docs/other.trm',
    `@knowledge other
@viewpoints trip
transport _Source_ = {
  Unrelated source.
.relations
${Array.from({ length: 12 }, (_, i) => `  edge ${String.fromCharCode(97 + i)} _Target_`).join('\n')}
}
transport _Target_ = {
  Unrelated large record.
.schedule
  ${JSON.stringify({ payload: 'x'.repeat(1500000) })}
}
`,
  );
  expect((await query('{relations(where:"true"){totalCount}}')).errors[0].message).toContain(
    '16 MiB',
  );
  const scoped = await query('{relations(knowledge:"japan_trip",where:"true"){totalCount}}');
  expect(scoped.errors).toBeUndefined();
  expect(scoped.data.relations.totalCount).toBe(2);
}, 30000);
