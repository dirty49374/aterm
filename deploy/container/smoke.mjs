// Run from the checkout after building deploy/container. Own resources are removed.
import assert from 'node:assert/strict';
import { serverProtocol } from '../../packages/core/dist/index.js';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const requireCLI = createRequire(new URL('../../packages/cli/package.json', import.meta.url));
const { Client } = await import(pathToFileURL(requireCLI.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StreamableHTTPClientTransport } = await import(pathToFileURL(requireCLI.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
const image = process.argv[2];
if (!image) throw new Error('Usage: node deploy/container/smoke.mjs IMAGE');
const name = `aterm-container-smoke-${process.pid}`;
const volume = `${name}-data`;
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
}).trim();
let client;
let url;
let containerExists = false;
function http(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url + path, { headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
const run = async (cmd, stdin, expected = 0) => {
  const response = await client.callTool({ name: 'aterm', arguments: { cmd, ...(stdin === undefined ? {} : { stdin }) } });
  assert.ok(response.structuredContent, JSON.stringify(response));
  const result = response.structuredContent;
  assert.equal(result.exitCode, expected, `${cmd}: ${result.stderr}`);
  return result;
};
const read = async (path) => JSON.parse((await run(`file read ${path} --output json`)).stdout).text;
async function health() {
  const response = await fetch(url + '/api/health');
  assert.equal(response.status, 200);
  return response.json();
}
async function start(origin) {
  docker('run', '-d', '--name', name, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev',
    // Model the nested emptyDir used with an NFS Workspace in k3s.
    '--tmpfs', '/data/.aterm/cache/semantic:rw,uid=1000,gid=1000,nosuid,nodev',
    '--mount', `type=volume,src=${volume},dst=/data`,
    '-e', `ATERM_PUBLIC_ORIGIN=${origin}`, image);
  containerExists = true;
  // Reach only the private Docker bridge; do not publish a host port.
  url = `http://${JSON.parse(docker('inspect', name))[0].NetworkSettings.IPAddress}:43127`;
  let connected = false;
  for (let i = 0; i < 100; i++) {
    try { await health(); connected = true; break; } catch { await delay(100); }
  }
  assert.ok(connected, docker('logs', name));
  client = new Client({ name: 'container-smoke', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')));
}
async function stop() {
  await client?.close();
  docker('stop', '--time', '10', name);
  const state = JSON.parse(docker('inspect', name))[0].State;
  assert.equal(state.ExitCode, 0, JSON.stringify(state));
  assert.equal(state.OOMKilled, false);
  docker('rm', name);
  containerExists = false;
}
const viewpoint = `---
name: smoke-spec
description: Container smoke vocabulary.
termKinds:
  - name: concept
    description: One subject.
    sections:
      - name: definition
        type: md
---
Keep one subject per concept.
`;
const document = `@knowledge smoke
@viewpoints smoke-spec
@description {
  A persistent container test.
}
@scope {
  Verify the packaged MCP write path and restart persistence.
}
concept _Visibility_ = {
  The available visibility states.
.relations
  has_state _Hidden_
}
concept _Hidden_ = { The content is hidden. }
`;

docker('volume', 'create', volume);
try {
  await start('http://aterm.example.test');
  const expectedVersion = JSON.parse(docker('image', 'inspect', image))[0].Config.Labels['org.opencontainers.image.version'];
  assert.ok(expectedVersion);
  assert.equal(client.getServerVersion().version, expectedVersion);
  assert.equal(docker('exec', name, '/opt/aterm/node_modules/.bin/aterm', '--version'), expectedVersion);
  assert.equal(docker('exec', name, 'id', '-u'), '1000');
  console.log('PASS fresh nested-cache mount bootstrap, UID 1000, read-only rootfs');
  const config = await read('.aterm/aterm.yaml');
  assert.match(config, /publicOrigin: http:\/\/aterm.example.test/);
  assert.match(config, /useDefaultKnowledge: true/);
  assert.match(config, /allowDefaultWrites: false/);
  assert.match(config, /useViewpoints: \[\s*specification, generic, domain, skill\s*\]/);
  assert.doesNotMatch(config, /^skills:/m);
  assert.equal((await health()).ready, true);
  assert.equal((await health()).protocol, serverProtocol);
  const tools = (await client.listTools()).tools.map(t => t.name);
  const skills = JSON.parse((await run('skill list --output json')).stdout).skills;
  assert.equal(tools.filter(name => name.startsWith('skill_')).length, skills.length);
  assert.equal(tools.length, skills.length + 2);
  assert.ok(tools.includes('graphql'));
  assert.match((await client.callTool({ name: 'skill_aterm-skills-aterm-basics-skill', arguments: {} })).content[0].text, /_aterm_skills:Aterm_Basics_Skill_/);
  assert.deepEqual(JSON.parse((await run('knowledge list --output json')).stdout).knowledges.map(k => k.id), ['aterm', 'aterm_skills', 'vending_machine']);
  assert.match((await run('skill remind _aterm_skills:Runtime_Management_Skill_')).stdout, /Full reading: aterm skill view/);
  for (const asset of ['/', '/queries', '/app.js', '/graph.js', '/markdown.js', '/mermaid.js', '/force-layout-worker.js']) {
    const response = await http(asset, { Host: 'aterm.example.test', Origin: 'http://aterm.example.test' });
    assert.equal(response.status, 200, asset);
    assert.ok(response.body.byteLength > 0);
  }
  assert.equal((await http('/api/health', { Origin: 'https://untrusted.example.test' })).status, 403);
  assert.equal((await http('/api/health', { Origin: 'http://aterm.example.test' })).status, 200);
  console.log(`PASS ${tools.length} MCP tools, default Knowledges, canonical guidance, browser assets and proxy Origin rules`);
  await run('viewpoint create smoke-spec', viewpoint);
  await run('knowledge create smoke --path docs/smoke.trm', document);
  const updated = document.replace('The content is hidden.', 'The persistent content is hidden.');
  await run('knowledge edit smoke', updated);
  const headerPatch = `*** Begin Patch
*** Update Knowledge: smoke
@@
-  A persistent container test.
+  A header-only container test.
*** End Patch`;
  await run('knowledge edit smoke --dry-run', headerPatch);
  assert.equal(await read('docs/smoke.trm'), updated);
  await run('knowledge edit smoke', headerPatch);
  assert.equal(await read('docs/smoke.trm'), updated.replace('A persistent container test.', 'A header-only container test.'));
  assert.match((await run('knowledge list')).stdout, /A header-only container test/);
  await run('knowledge edit smoke', headerPatch.replace('-  A persistent container test.', '-  The persistent content is hidden.'), 1);
  await run('knowledge edit smoke', headerPatch.replace('-  A persistent container test.', '-  A header-only container test.').replace('+  A header-only container test.', '+  A persistent container test.'));
  assert.equal(await read('docs/smoke.trm'), updated);
  assert.match((await run('skill view _aterm_skills:Corpus_Authoring_Skill_')).stdout, /Update Knowledge:/);
  console.log('PASS Knowledge header patch dry-run/save, immediate metadata, Term-body guard and updated Skill');
  assert.match((await run('term view _smoke:Hidden_')).stdout, /persistent content/);
  const relations = JSON.parse((await run('graph relations _smoke:Visibility_ --output json')).stdout).relations;
  assert.equal(relations[0].type, 'state_membership');
  await run('file write probe.md', '# Persistent smoke\n');
  assert.equal(await read('probe.md'), '# Persistent smoke\n');
  await run('file delete probe.md');
  await run('file read probe.md', undefined, 1);
  await run('skill install', undefined, 1);
  await run('file read ../escape', undefined, 1);
  await run('term list | cat', undefined, 1);
  assert.match((await run('corpus check')).stdout, /No diagnostics/);
  console.log('PASS MCP Viewpoint/Knowledge CRUD, has_state, raw files, local-only and shell-operator refusals');

  const additions = `*** Begin Patch
*** Add Term: _smoke:Transient_
+concept _Transient_ = {
+  A temporary private source sentinel.
+.relations
+  uses _Transient_Peer_
+}
*** Add Term: _smoke:Transient_Peer_
+concept _Transient_Peer_ = { A temporary companion. }
*** End Patch`;
  await run('term edit --dry-run --output json', additions);
  assert.equal(await read('docs/smoke.trm'), updated);
  await run('term edit --output json', additions);
  await run('term edit', '*** Begin Patch\n*** Delete Term: _smoke:Transient_Peer_\n*** End Patch', 1);
  await run('term edit', '*** Begin Patch\n*** Delete Term: _smoke:Transient_\n*** Delete Term: _smoke:Transient_Peer_\n*** End Patch');
  const afterPatch = await read('docs/smoke.trm');
  assert.equal(afterPatch.trimEnd(), updated.trimEnd());
  const logText = await read('.aterm/usage.jsonl');
  const logRows = logText.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(logRows.some(row => row.kind === 'command' && row.operation === 'term edit' && row.event === 'finish' && row.outcome === 'ok'));
  assert.ok(logRows.some(row => row.kind === 'command' && row.operation === 'term edit' && row.event === 'finish' && row.outcome === 'error'));
  assert.ok(logRows.some(row => row.phase === 'published'));
  assert.ok(Buffer.byteLength(logText) <= 5 * 1024 * 1024);
  assert.ok(!logText.includes('private source sentinel'));
  console.log('PASS Add/Delete Term batches, dry-run, dangling-reference refusal and bounded payload-free usage evidence');

  const graphQL = {
    query: `query Read($id: ID!) {
      term(id: $id) {
        id
        outgoing(origin: relation, phrase: "has_*", first: 1) {
          nodes { phrase type target { id termDeclarations { definition } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    variables: { id: '_smoke:Visibility_' },
    operationName: 'Read',
  };
  const projected = await client.callTool({ name: 'graphql', arguments: graphQL });
  assert.equal(projected.isError, false, JSON.stringify(projected));
  const graphQLResponse = await fetch(url + '/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graphQL),
  });
  assert.equal(graphQLResponse.status, 200);
  assert.deepEqual(await graphQLResponse.json(), projected.structuredContent);
  const cliProjection = docker('exec', name, '/opt/aterm/node_modules/.bin/aterm', '--home', '/data/.aterm',
    'corpus', 'query', graphQL.query, '--variables', JSON.stringify(graphQL.variables), '--operation-name', 'Read');
  assert.deepEqual(JSON.parse(cliProjection), projected.structuredContent);
  const target = projected.structuredContent.data.term.outgoing.nodes[0].target;
  assert.equal(target.id, '_smoke:Hidden_');
  assert.equal(target.termDeclarations[0].definition, 'The persistent content is hidden.');
  const pageInput = { query: 'query($after: String){terms(knowledge: "smoke", first: 1, after: $after){nodes{id} pageInfo{hasNextPage endCursor}}}' };
  const page = (await client.callTool({ name: 'graphql', arguments: pageInput })).structuredContent.data.terms;
  assert.equal(page.pageInfo.hasNextPage, true);
  const next = (await client.callTool({ name: 'graphql', arguments: { ...pageInput, variables: { after: page.pageInfo.endCursor } } })).structuredContent.data.terms;
  assert.notEqual(page.nodes[0].id, next.nodes[0].id);
  assert.equal(next.pageInfo.hasNextPage, false);
  assert.equal((await client.callTool({ name: 'graphql', arguments: { query: 'mutation { __typename }' } })).isError, true);
  console.log('PASS GraphQL CLI/MCP/HTTP parity, variables, Relation traversal, pagination and mutation refusal');
  const collectionInput = { query: `{
    terms(knowledge:"smoke", where:""".definition | contains("hidden")""", orderBy:[{key:""".["@term"]""", direction:DESC}]) {
      nodes { id } totalCount
    }
    viewpoints(knowledge:"smoke") { nodes { name termKinds { nodes { qualifiedName } } } }
    jq(knowledge:["smoke"], program:"length")
  }` };
  const collectionResult = await client.callTool({name:'graphql', arguments:collectionInput});
  assert.equal(collectionResult.isError, false, JSON.stringify(collectionResult));
  assert.equal(collectionResult.structuredContent.data.terms.totalCount, 1);
  assert.equal(collectionResult.structuredContent.data.terms.nodes[0].id, '_smoke:Hidden_');
  assert.equal(collectionResult.structuredContent.data.viewpoints.nodes[0].termKinds.nodes[0].qualifiedName, 'smoke-spec.concept');
  assert.deepEqual(collectionResult.structuredContent.data.jq, [2]);
  const collectionHttp = await fetch(url + '/graphql', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(collectionInput),
  });
  assert.deepEqual(await collectionHttp.json(), collectionResult.structuredContent);
  assert.deepEqual(JSON.parse((await run('corpus jq length --knowledges smoke')).stdout), [2]);
  assert.match((await run('skill view _aterm_skills:Corpus_Reading_Skill_')).stdout, /Filter and sort typed GraphQL collections/);
  console.log('PASS packaged jq worker, typed collection predicates/orderBy, vocabulary connections and updated Skill');
  const boundInput = {
    query: `query($phrase:String!){ terms(knowledge:"smoke", where:".definition | contains($phrase)", bindings:{phrase:$phrase}) { nodes{id} } relations(knowledge:"SMOKE",origin:relation,where:"true"){totalCount} jq(knowledge:["smoke"], program:"$phrase", bindings:{phrase:$phrase}) }`,
    variables: {phrase:'hidden'},
  };
  const bound = await client.callTool({name:'graphql', arguments:boundInput});
  assert.equal(bound.isError, false, JSON.stringify(bound));
  assert.deepEqual(bound.structuredContent.data.terms.nodes, [{id:'_smoke:Hidden_'}]);
  assert.deepEqual(bound.structuredContent.data.jq, ['hidden']);
  assert.ok(bound.structuredContent.data.relations.totalCount > 0);
  const boundHTTP = await fetch(url + '/graphql', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(boundInput)});
  assert.deepEqual(await boundHTTP.json(), bound.structuredContent);
  assert.deepEqual(JSON.parse(docker('exec',name,'/opt/aterm/node_modules/.bin/aterm','corpus','query',boundInput.query,'--variables',JSON.stringify(boundInput.variables))),bound.structuredContent);
  assert.match((await run('skill view _aterm_skills:Corpus_Reading_Skill_')).stdout, /Pass reusable parameters/);
  assert.match((await run('skill view _aterm_skills:Explorer_Presentation_Skill_')).stdout, /Reuse a Query in the browser/);
  console.log('PASS GraphQL bindings CLI/MCP/HTTP parity, /queries assets and reviewed Skills');



  // An external write on this local test volume must trigger the normal watcher.
  docker('exec', name, 'node', '-e', "require('node:fs').writeFileSync('/data/docs/watched.trm', process.argv[1])",
    '@knowledge watched\n@viewpoints generic\nterm _Observed_ = { An external filesystem edit. }\n');
  let observed = false;
  for (let i = 0; i < 50; i++) {
    if ((await run('term list')).stdout.includes('_watched:Observed_')) { observed = true; break; }
    await delay(100);
  }
  assert.ok(observed);
  console.log('PASS local-volume filesystem watcher (does not claim cross-client NFS notifications)');
  // Seed hostile Git metadata as the test operator, never through the now-reserved MCP path.
  docker('exec', name, 'node', '-e', `
    const fs = require('node:fs'), { execFileSync } = require('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: '/data', encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', 'docs');
    git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@invalid', 'commit', '-qm', 'Fixture');
    fs.writeFileSync('/data/.git/fsmonitor-probe', "printf verified > /data/.git/executed\\nprintf '\\\\0'\\n");
    fs.writeFileSync('/data/.git/filter-probe', "printf verified > /data/.git/executed\\ncat\\n");
    git('config', 'core.fsmonitor', '/bin/sh /data/.git/fsmonitor-probe');
    git('config', 'filter.probe.clean', '/bin/sh /data/.git/filter-probe');
    fs.writeFileSync('/data/.gitattributes', '*.trm filter=probe\\n');
    fs.appendFileSync('/data/docs/watched.trm', '// changed\\n');
    git('diff', '--name-only');
    if (!fs.existsSync('/data/.git/executed')) throw new Error('Unsafe control did not execute');
    fs.unlinkSync('/data/.git/executed');
    console.log(git('--version').trim());
  `);
  for (const command of ['file write .git/config', 'file write .git/config --dry-run',
    'file write nested/.GIT/config', 'file delete .git/config', 'file delete .git/config --dry-run']) {
    assert.match((await run(command, 'blocked', 1)).stderr, /reserved/);
  }
  const safeDiff = await run('corpus diff');
  assert.match(safeDiff.stdout, /changed/);
  docker('exec', name, 'node', '-e', "if(require('node:fs').existsSync('/data/.git/executed')) throw new Error('Git executed repository configuration');");
  console.log('PASS Git fsmonitor/filter control reproduced; isolated MCP diff does not execute it; Git metadata writes/dry-runs refused');
  const native = docker('exec', '-w', '/opt/aterm', name, 'node', '-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/data/.aterm/cache/semantic/native-smoke.sqlite', { allowExtension: true });
    require('sqlite-vec').load(db);
    db.exec('PRAGMA journal_mode=WAL');
    console.log(JSON.stringify(db.prepare('SELECT vec_version() AS vec, sqlite_version() AS sqlite').get()));
    db.close();
    console.log(JSON.stringify(require('onnxruntime-node').env.versions));
  `);
  console.log('PASS native SQLite/WAL/sqlite-vec and ONNX load:', native);
  console.log('Runtime:', docker('exec', name, 'node', '--version'));
  console.log('Post-exercise snapshot:', docker('stats', '--no-stream', '--format', '{{json .}}', name));
  const persistedConfig = await read('.aterm/aterm.yaml');
  const persistedViewpoint = await read('.aterm/viewpoints/smoke-spec.md');
  // Cursors identify the full corpus snapshot, including the external write above.
  const persistedProjection = await client.callTool({ name: 'graphql', arguments: graphQL });
  assert.equal(persistedProjection.isError, false, JSON.stringify(persistedProjection));
  await stop();
  await start('http://different-origin.invalid');
  assert.equal(await read('.aterm/aterm.yaml'), persistedConfig);
  assert.equal(await read('.aterm/viewpoints/smoke-spec.md'), persistedViewpoint);
  assert.equal(await read('docs/smoke.trm'), afterPatch);
  assert.match((await run('term view _smoke:Hidden_')).stdout, /persistent content/);
  assert.deepEqual((await client.callTool({ name: 'graphql', arguments: graphQL })).structuredContent, persistedProjection.structuredContent);
  console.log('PASS clean SIGTERM, replacement container preserves configuration/Viewpoints/Knowledge, changed bootstrap env ignored');
  await run('file write .aterm/aterm.yaml', 'sources: [');
  assert.equal((await health()).ready, false);
  await stop();
  await start('http://different-origin.invalid');
  assert.equal(await read('.aterm/aterm.yaml'), 'sources: [');
  assert.equal((await health()).ready, false);
  await run('file write .aterm/aterm.yaml', persistedConfig);
  assert.equal((await health()).ready, true);
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...tools].sort());
  assert.match((await run('corpus check')).stdout, /No diagnostics/);
  console.log('PASS cold start with invalid YAML, health HTTP 200/ready=false and MCP-only repair');
  await run('knowledge delete smoke');
  await run('viewpoint delete smoke-spec');
  await run('knowledge delete watched');
  assert.deepEqual(JSON.parse((await run('knowledge list --output json')).stdout).knowledges.map(k => k.id), ['aterm', 'aterm_skills', 'vending_machine']);
  await stop();
  console.log(JSON.stringify({ image, status: 'passed', tools }));
} catch (error) {
  try { console.error(docker('logs', name)); } catch {}
  throw error;
} finally {
  await client?.close().catch(() => {});
  if (containerExists) docker('rm', '-f', name);
  docker('volume', 'rm', volume);
}
