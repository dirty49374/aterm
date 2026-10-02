# Aterm

Model connected concepts as Terms, read and edit `.trm` Knowledges, explore their
Graph in the browser, and expose the same commands through MCP.

Requires Node.js 24 or later.

```sh
npm install -g @aterm/cli
aterm init
aterm corpus check
aterm skill list
aterm skill toc _aterm_skills:Aterm_Basics_Skill_
aterm skill view _aterm_skills:Aterm_Basics_Skill_
aterm skill remind _aterm_skills:Aterm_Basics_Skill_
```

The executable is `aterm`. The exact matching `@aterm/core` release supplies the
shipped Knowledge, Viewpoints, Skills and browser assets. Packaged Skills remain
readable when `useDefaultKnowledge` or `useViewpoints` hides their vocabulary from
ordinary queries. Read unfamiliar prerequisite Skills with `skill view`.

```sh
aterm --help
aterm term list '*Knowledge*'
aterm term view _aterm:Knowledge_
aterm corpus query '{ knowledges { nodes { id description } } }'
aterm server run
aterm mcp run
aterm mcp run --with-server
```

Run inside the intended Workspace or pass `--home /project/.aterm`. The server
provides HTTP, the browser and `/mcp`; standalone stdio uses normal CLI dispatch.
`--server URL` selects a remote MCP endpoint. Reads ignore case by default;
`--case-sensitive` enables exact case. Writes require canonical spelling.

Use `term edit` patches for Term changes, and Knowledge context patches for
metadata changes. Read command `--help`, preview writes and inspect saved status
and corpus diagnostics separately.

See the [repository](https://github.com/dirty49374/aterm) for usage, configuration
and build instructions. Original Aterm code is 0BSD; dependencies retain their
own licenses, described in THIRD_PARTY_NOTICES.md.
