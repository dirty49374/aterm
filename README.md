# Aterm

Aterm helps people and agents build a shared model using precise, connected Terms.
Define what a Term means, connect it to other Terms, then use the same vocabulary
in specifications, explanations and implementation.

A Knowledge is a `.trm` file. A Viewpoint defines the Term Kinds and sections that
fit your work. The CLI, browser and MCP service read and edit the same corpus.

```trm
@knowledge shop
@viewpoints generic

term _Product_ = {
  An item offered for sale.
}

term _Order_ = {
  A customer's request to purchase one or more Products.
.relations
  contains _Product_
.description
  An _Order_ records the chosen _Product_ and quantity.
}
```

## Build and try

Requires Node.js 24 or later and pnpm 10.26.2.

```sh
git clone https://github.com/dirty49374/aterm.git
cd aterm
pnpm install --frozen-lockfile
pnpm build
pnpm aterm --help
pnpm aterm corpus check
pnpm aterm term view _aterm:Knowledge_
```

The public npm release targets are `@agent-workshop/aterm` and `@agent-workshop/aterm-core`. After a release
is published to npm, install the CLI with:

```sh
npm install -g @agent-workshop/aterm
aterm --version
```

The executable is `aterm`; Core is installed at the exact corresponding version.
Until the first public npm release is published, use the checkout commands above.

## Create a Knowledge

In a project directory:

```sh
aterm init
aterm knowledge create shop --path docs/shop.trm < shop.trm
aterm corpus check
aterm knowledge list
aterm term list --knowledge shop
aterm term view _shop:Order_
```

Put the example source above in `shop.trm` before running `knowledge create`.
Local references resolve within their Knowledge. Use `_shop:Order_` to refer to
a Term from another Knowledge. Each Term has one Term Declaration; its Term Kind
and optional Group are attributes rather than parts of its identity.

For all commands, use the local build as `pnpm aterm ...` when working in this
checkout. Executable selection does not change Home selection; pass
`--home /path/to/.aterm` to choose another Workspace explicitly.

## Find, read and change Terms

```sh
aterm term list '*Order*'
aterm corpus search 'purchase'
aterm term view _shop:Order_
aterm term list --knowledge shop --tree
aterm term rename _shop:Order_ _Purchase_Order_ --dry-run
```

Read selectors and literal searches are case-insensitive by default. Add
`--case-sensitive` for exact case. Writes use canonical spelling.

For targeted changes, `term edit` accepts a patch through stdin or `--file`:

```text
*** Begin Patch
*** Update Term: _shop:Order_
@@
-  A customer's request to purchase one or more Products.
+  A customer's request to purchase specified Products and quantities.
*** End Patch
```

```sh
aterm term edit --file change.patch --dry-run
aterm term edit --file change.patch
aterm corpus check
```

The patch language also supports `Add Term` and `Delete Term`. Use
`aterm term edit --help` for their contracts. Knowledge context patches change
Description, Scope or Viewpoints without replacing unrelated Term bodies;
`aterm knowledge edit --help` describes those patches and version guards.

## Agent Skills

Read canonical guidance directly from the corpus:

```sh
aterm skill list
aterm skill toc _aterm_skills:Modeling_Skill_
aterm skill view _aterm_skills:Naming_Skill_ _aterm_skills:Modeling_Skill_
aterm skill remind _aterm_skills:Modeling_Skill_
```

`toc` lists prerequisite reading; `view` returns the actual body; `remind`
provides a short reminder. Read unfamiliar prerequisites before applying a Skill.

To generate project Skill entrypoints and synchronize them with Claude Code and Codex:

```sh
aterm skill install
aterm skill update
aterm skill uninstall
```

Installation is optional for reading Skills. The Home's `skills.sync` and
`skills.uninstall` commands control external Agent synchronization.

## Browser and MCP

```sh
aterm server run
```

Open the configured server address (by default `http://localhost:43127`). The
browser includes Knowledge and Viewpoint reading, a shared Working Set,
References, Structure and Explore Graphs, and a GraphQL workspace with saved Queries
and variables. Agents can control connected browser Sessions and send Markdown Notes.

MCP supports three modes:

| Mode | Command or endpoint |
| --- | --- |
| Standalone stdio | `aterm mcp run` |
| stdio with an in-process server | `aterm mcp run --with-server` |
| Remote HTTP | `/mcp` on an `aterm server run` process |

Standalone reads use an existing compatible server or the filesystem. Hosted
writes publish a refreshed snapshot before returning. MCP offers the `aterm`
command tool, read-only `graphql`, and one tool per available Skill.

```json
{
  "command": "aterm",
  "args": ["--home", "/path/to/project/.aterm", "mcp", "run"]
}
```

Remote CLI uses the same endpoint:

```sh
aterm --server http://localhost:43127/mcp knowledge list
```

MCP callers can write the Workspace. Use an authenticating proxy when exposing a
server outside a trusted network. See [container deployment](deploy/container/README.md).

## GraphQL

```sh
aterm corpus query '{ knowledges { nodes { id description } } }'
aterm corpus query --file query.graphql --variables '{"knowledge":"shop"}'
```

```graphql
query Orders($knowledge: ID!) {
  terms(knowledge: $knowledge, match: "*Order*", first: 20) {
    nodes {
      id
      termDeclarations { definition }
      outgoing(origin: relation, first: 20) {
        nodes { phrase target { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Typed collections support filters, jq predicates, variables and ordering. The
`jq` root supports projections across structured sections. Introspection exposes
the current schema. Follow `pageInfo` for pagination and inspect `errors` even
when HTTP returns 200. HTTP `POST /graphql`, CLI and MCP use the same executor.

## Configuration

Aterm discovers `.aterm/aterm.yaml` from the current directory upwards, or uses
`--home` / `ATERM_HOME`. Source paths are Workspace-relative; Viewpoint paths are
Home-relative.

```yaml
sources: [docs]
useDefaultKnowledge: true
useViewpoints: [specification, generic, domain, skill]
server:
  host: 127.0.0.1
  port: 43127
  debounceMs: 200
  watchExternal: true
externalSources:
  app: src/**/*.ts
```

Packaged Knowledge and Viewpoints are read-only unless `allowDefaultWrites: true`.
Hiding defaults does not prevent Skill reading. The repository Home enables
packaged writes for development; ordinary project Homes should not enable them.

## Development and releases

```sh
pnpm check
pnpm test
pnpm aterm corpus check
pnpm complexity
pnpm release:pack
```

- `packages/core`: parser, corpus, authoring, queries, server and shipped Knowledge.
- `packages/cli`: commands, MCP invocation and presentation.
- `packages/webapp`: browser source; built assets ship with Core.
- `docs`: repository development model and Skill foundations.
- `tooling`: build, license packaging and complexity reporting.

Local trials, review evidence, temporary files and archived configuration belong
under ignored `.local/`. Generated Agent Skills, caches and local settings are
also ignored. Do not commit `.npmrc` or credentials.

See [release instructions](docs/releasing.md), [AGENTS.md](AGENTS.md) and command
`--help`. `CLAUDE.md` links to the same repository instructions.

## License

Original Aterm code and documentation are available under [0BSD](LICENSE).
Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
