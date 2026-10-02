# Working on aterm

`AGENTS.md` is the shared instruction source. `CLAUDE.md` is a relative symlink
to it; edit this file rather than creating a second set of instructions.

## Language and consistency

- Think in English. Keep canonical terms literally in English, including in
  Korean prose; do not transliterate or back-translate them.
- Propose the industry-standard term when a name is inconsistent or imprecise.
- Use one mechanism consistently across the project. Do not introduce local
  exceptions; propose correcting the shared mechanism instead.
- Follow existing ownership and file placement rules. Report inconsistencies
  in terminology, structure and behavior as soon as they are found.
- Preserve existing working-tree changes and coordinate file ownership with
  other agents before editing shared files.
- Name the subject identified by the Definition: noun phrases for subjects and
  criteria, verb phrases for behavior. Retain meaningful heads such as Principle,
  Command, Event, Procedure, Workflow and Skill; declaration Term Kind and surrounding
  invoke/follow/read must not supply a missing identity. Do not create extra
  subjects merely to fill these roles. Separate words with underscores and
  capitalize each word; preserve proper names and established acronyms.
- Let the Knowledge ID supply the namespace. Keep meaningful modifiers such as
  `Graph_Node` and `Query_Result`; avoid routine project and Term Kind prefixes.
  Write role names in English order, such as `Git_Adapter` and `Query_Module`.

## Analyze through aterm

Use the local CLI to understand this project before changing it. The active
`.trm` corpus is the source of truth for terminology and contracts; implementation
is evidence to compare with it, not permission to silently redefine it.

From the repository root:

```sh
pnpm build
pnpm aterm skill toc _aterm_skills:Aterm_Basics_Skill_
pnpm aterm skill view _aterm_skills:Aterm_Basics_Skill_
pnpm aterm corpus check
pnpm aterm term list '*Knowledge*'
pnpm aterm term view _aterm:Knowledge_
```

Installed `SKILL.md` files are generated TOC entrypoints for the skill Term Declarations in
`packages/core/docs/skills.trm`. Read unfamiliar prerequisite bodies and the selected Skill
with `skill view`; change the source Term Declarations, not the installed snapshots.
All skill Term Declarations participate in the managed
`skill install/update/uninstall` lifecycle and Claude Code/Codex synchronization.
When the Skill says `aterm`, use the local
invocation described below.

Before starting or changing a task pattern, run `aterm-dev skill list` and
`aterm-dev skill remind <qualified Skill Term>`. Use `skill toc` for reading order
and `skill view <Skill...>` for unfamiliar or forgotten bodies. Runtime inputs and
verification evidence must be current. Prerequisites are authored requires Relations;
guidance is Markdown body/reminder, with derived*from provenance. Do not add task-name
branches or a second authored TOC to TypeScript. Skill has no Workflow or export/review command.

All changes to Aterm-provided Skills require an independent **Aterm Skill Reviewer**
`pass` before authoritative apply, accepted commit, installation or publication.
This includes additions, deletions, TOC/description/body/reminder changes and changes
to shared sources or rendering that affect consumer guidance. User-authored Skills
are exempt unless the user or their project policy requests review.

Follow the Independent review section of `packages/core/viewpoints/skill.md`
(read it with `aterm-dev viewpoint view skill`).
The reviewer role is `.agents/reviewers/aterm-skill-reviewer.md`; native entrypoints
are `.codex/agents/aterm-skill-reviewer.toml` and
`.claude/agents/aterm-skill-reviewer.md`. If a session cannot load the native role,
spawn a fresh subagent with the shared role file and frozen packet. Do not substitute
self-review. Reviewers inspect intent, baseline and candidate, distinguish intentional
removals from accidental omissions, and return `pass` or `revise` on the exact packet.
Retain packets and reports under `.local/trials/skill-reviews/<change>/`; changed candidates
need fresh affected reviews. This is a repository authoring gate, not a restriction
on user Skills or an automatic CLI review service.

Viewpoint-specific authoring instructions belong in the corresponding Viewpoint Markdown.
Read its full schema and explanatory body before modeling, writing or reviewing its Terms.
Selected Viewpoint guidance takes precedence over general Skill guidance within its vocabulary;
preserve user instructions, Knowledge Scope, structural validation and repository review.

The shared Skills
group related work; choose the applicable body section instead of performing every
operation in a Skill. Read additional guidance on a conditional route when that
condition holds, then return to the original task with its required evidence.

When using or changing Aterm Skills, record new findings and status
updates in `.local/trials/skill-workflow-findings.md` as they arise. Keep evidence, proposed
changes and verified fixes distinct; distinguish guidance gaps from execution errors.

- Store each Knowledge in one `.trm` file. Declare a unique `@knowledge <lowercase_snake_case_id>`
  before `@viewpoints`; filenames are independent of Knowledge identity.
- Each Term has exactly one Term Declaration within its Knowledge. Term Kind and Group are attributes,
  not identity components; a second declaration is always an error.
- Each Term Kind belongs to its Viewpoint. Use `skill.procedure _Term_ = { ... }` when
  declared Viewpoints share a local Term Kind name. A short name is allowed only when
  it has one owner. Qualification requires that owner in `@viewpoints`; it does
  not import a vocabulary. An optional Term Kind prefix in a `term edit` selector checks the Term Declaration's current classification; Knowledge qualification disambiguates Term names.
- After `@viewpoints`, use optional `@description { ... }` and `@scope { ... }`
  blocks in either order, before Term Declarations. Both require nonempty multiline bodies
  indented two spaces and a column-zero closing brace. Description tells readers
  what the Knowledge contains and appears in Knowledge lists. Scope tells writers
  what belongs here, what must be covered and what belongs elsewhere. Read Scope
  before authoring; never use Description as its substitute.
- Local references resolve only inside that Knowledge. Use `_knowledge_id:Term_`
  for cross-Knowledge references and external source comments. Use qualified CLI
  selectors or `--knowledge` whenever an unqualified name is ambiguous.
- A Term Declaration may declare `in group.path` between its Term and `=`. Use dot-separated
  lowercase_snake_case segments for authored organization. Groups contain Term Declarations;
  each Term's single Term Declaration belongs to at most one Group. Group paths do not
  change Term references or identity. Use a complete-Term Declaration `aterm term edit` to change one.
- Declare every non-self Term Declaration reference in its reserved `.relations` section,
  immediately after definition and before other content sections. Write one
  `phrase _Target_` declaration per line; the Source is the containing Term.
  Targets declared by another Term Declaration do not satisfy this Term Declaration.
  Use built-in `is_a` for Generalization, `has_part` for Parthood and
  `has_member` for Membership and `has_state` for a permitted State in a state space
  when supported; ordinary phrases remain valid. `has_state` does not assert the
  current State or infer initial, transition or exactly-one rules.
  Built-in names use exact lowercase spelling; unknown underscore names fail.
  Use neutral `references` for a dependency without a more specific assertion.
  Use `derived_from` from rewritten guidance to its authoritative source. After
  writes, review every reported `derivedImpacts` target; update affected guidance
  or explain why it still applies. Self-derivation and derivation cycles fail checks.
  Self-references otherwise need no declaration. A `†` marks required reading context at
  the occurrence where it is written; do not move a Remarks-only marker into
  a declaration. Old `**Relation**:` headings must be migrated, not retained.
- Use `_Term_.section` to reference an actual section key, and put
  `_Term_.section†` alone on a body line to expand its content in Markdown output
  or a rendered Guide. Section expansion retains the target's Knowledge context;
  missing sections, duplicate Terms and expansion cycles fail checking. The plain
  `_Term_†` still requests whole-Term reading context. `+` is not a syntax alias.
- Discover Skills with `skill list`; `skill toc <Term...>` reads generated entrypoints.
  Use `skill view <Term...>` for actual bodies and `skill remind <Term...>` for recall.
  All selectors are local or qualified Term names. Compose reusable guidance with section daggers
  at its point of application; keep `.relations` focused on the whole-Term
  connection. Include the prerequisites and conditions needed by each selected
  section. Reading expanded instructions does not prescribe execution.
- Use `termDeclarations`, `termDeclarationCount` and `termKind`/`termKinds` in structured data.
  Viewpoint frontmatter uses `termKinds`. GraphQL uses `TermDeclaration` and `TermKind`;
  former Entry/Kind API spellings are removed. Filesystem directory entries are a separate concept.
- Flat `list` commands use aligned tables; `term list --tree` retains the Group tree.
  `viewpoint list` shows names and descriptions; `viewpoint view` prints the original
  Markdown file including frontmatter and its authored ending. `knowledge view`
  separates Scope and Declarations.
- Generated `--output markdown` prints compact Term Declaration and section headings, omits Knowledge
  context and ends with two empty lines. Default text also omits Scope; use
  plain-text `term view --detail` or JSON/YAML to read Scope before implementation.
- Use `term move <selector...> --to <knowledge>` for transfers into an existing Knowledge.
  Preview with `--dry-run`; the complete Term Declaration moves with its Term and references follow the new boundary.
  Destination Term Kinds must be compatible; preserve meaning rather than merge conflicting Terms.
- Use `knowledge rename <old_id> <new_id>` for Knowledge identity changes and preview
  with `--dry-run`. Both rename operations include configured externalSources by
  default; explicit external selection replaces that configuration.
- Find the owning Term Declarations with `term list`, `corpus search` and `graph overview`, then read them
  with `term show` or `term view` before working. Read their Knowledge `@scope` explicitly
  through plain-text `term view --detail` or JSON/YAML output.
- Compare intended behavior with scope and contracts. Missing requirements
  inside scope are specification gaps. Add supported requirements and record
  new decisions as `Chosen:`; do not silently widen scope or turn incidental
  implementation details into requirements.
- Every code update must include an update to the corresponding specification
  in the same task. If the contract already states the intended behavior,
  preserve it and update its remarks with the correction or behavior-preservation
  rationale and verification. Do not invent a behavioral change for a SPEC diff.
- Use `viewpoint create/edit/delete` for whole Viewpoint documents and bindings, and
  `knowledge create/edit/delete` for whole Knowledges. Creation requires an explicit
  Workspace-relative path under a configured source. Use `file read/write` with
  content versions to repair invalid configuration or source; check saved status
  and corpus diagnostics separately before returning to semantic authoring.
- MCP supports standalone `mcp run` over stdio (normal CLI dispatch),
  `mcp run --with-server` (stdio and HTTP share one process), and remote HTTP
  at `/mcp` from `server run`. Hosted mode requires server.port or --port and
  refuses occupied ports; standalone stdio does not own an existing server.
  Its `aterm` tool shares CLI help and
  output and accepts `{cmd, stdin?}` without shell execution. Read canonical Skills
  through `skill_NAME` tools, then follow the entrypoint's batch skill view command
  and use skill remind before applying the selected Skill.
  Explicit `--server URL` selects remote execution; paths belong to the server
  Workspace, and installation/sync/server/MCP lifecycle commands remain local-only.
  Stdio stdout is exclusively MCP protocol; logs belong on stderr. Hosted writes
  publish before completion; standalone writes keep CLI filesystem/debounce behavior.
- Use `aterm term edit` for Term-addressed changes and `aterm term rename` for Terms and
  their references, through the local invocation. Check the corpus before and
  after changes. Knowledge header edits also require a subsequent check.
- Compare code and specification diffs before handing over. Identify changed
  Term Declarations, verification and unresolved gaps. Structural validity does not prove
  semantic coverage. Ask about consequential choices unsupported by evidence.

## Build and verification

Prerequisites: Node.js 24 or later and pnpm 10.26.2, as declared in `package.json`.

```sh
pnpm install        # Install workspace dependencies.
pnpm build          # Compile packages and make the CLI executable.
pnpm check          # Type-check implementation and tests.
pnpm test           # Build, then run the test suite.
pnpm aterm corpus check    # Check the active corpus.
```

Rebuild after TypeScript changes before invoking the local CLI. Neither
`pnpm aterm` nor `aterm-dev` builds automatically. Shipped Knowledges, Skills and
Viewpoints are read from their package files without a TypeScript rebuild.

## Complexity and refactoring

- Aim for Cognitive Complexity <= 15 and Cyclomatic Complexity <= 10 per function.
- Review Cognitive 16-30 and Cyclomatic 11-20 for mixed responsibilities and unnecessary nesting.
- Prioritize functions above Cognitive 30 or Cyclomatic 20 for refactoring, considering their responsibilities and change risk.
- These are review signals, not automatic build failures or proof that a function is well designed. Apply the same criteria throughout the project.
- Run `pnpm complexity` to rank current implementation sources; use `pnpm --silent complexity --json` to retain full measurements.
- Split only when the extracted responsibility has a precise name and clear inputs and outputs. Do not create arbitrary helpers merely to lower a score.
- Preserve observable behavior during structural refactoring, including diagnostic order, source bytes, locking, version checks and failure reporting. Treat behavior changes as explicit decisions.
- Compare the original function and its extracted functions. Report remaining hotspots and verification evidence; a lower coordinator score does not imply less total work or fewer execution paths.
- Explain the resulting flow through its Terms so the user can assess whether the decomposition is sufficient.

## Local CLI and global snapshot

| Invocation          | Executable                                                                          | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm aterm <args>` | This checkout's `packages/cli/dist/entry.js`                                        | Preferred for work in this repository; uses its latest build.           |
| `aterm-dev <args>`  | `~/.local/bin/aterm-dev`, symlinked to this checkout's `packages/cli/dist/entry.js` | Convenient direct invocation of this checkout's latest build.           |
| `aterm <args>`      | `~/.local/bin/aterm`, symlinked to `~/.local/lib/aterm/dist/entry.js`               | Separately installed standalone snapshot; can lag behind this checkout. |

Use the local CLI for development, including reading skills and checking the
corpus. A local build does not refresh the global snapshot. Do not install or
deploy globally as part of routine development unless requested.

When a global update is requested, build and verify locally, deploy into a staging
directory, then make an independent file copy before replacing the installation.
`pnpm deploy --legacy` may hardlink workspace files: do not use that staging tree
directly as the standalone snapshot. Preserve package-relative symlinks, but copy
regular files into new inodes (for example, Python `shutil.copytree` with
`symlinks=True`). Verify that the final tree shares no regular-file inodes with
the workspace and retain the previous installation until smoke checks pass.

The `aterm-dev` link is installed on this machine. To set it up on another
machine, run the following from the desired checkout after building:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/packages/cli/dist/entry.js" "$HOME/.local/bin/aterm-dev"
```

Ensure `~/.local/bin` is on `PATH`. If the name already exists, inspect it before
replacing it. The link stays pinned to that checkout; from a different checkout
use `pnpm aterm` to avoid executing the wrong build.

Executable selection and corpus selection are independent. Both commands use
the normal Home discovery rules from the current directory; `aterm-dev` does
not change the working directory. Run it from the target workspace or pass
`--home /path/to/.aterm` explicitly.

## Project map

- `packages/core`: syntax, configuration, corpus, queries and guarded authoring.
- `packages/cli`: command declarations, invocation and presentation.
- `packages/core/docs/aterm.trm`: shipped language, public behavior, Graph, usage, modeling and naming.
- `packages/core/docs/vending-machine.trm`: shipped worked example.
- `packages/core/docs/skills.trm`: shipped Skill bodies and prerequisite graph.
- This checkout sets `allowDefaultWrites: true` to author packaged resources. Ordinary Homes default to read-only package resources.
- Ship whole Knowledges; their reference closure must not depend on development-only docs.
- `packages/core/viewpoints`: reusable vocabularies. Viewpoint-qualified Term Kind names
  let their original schemas coexist in one Knowledge.
- `docs/aterm-development.trm`: architecture and repository development rules.
- `docs/skill-foundations.trm`: development-only generic Skill theory and quality examples.
- `.aterm/aterm.yaml` selects both shipped and development Knowledge for this checkout.
- `.local/trials`: experiment evidence, coverage audits and worklogs.
- `packages/webapp`: browser reader; `public` assets are copied into core by the build.

## Public repository hygiene

- Keep local evidence, temporary files, review packets and experiments under ignored `.local/`; never publish that directory.
- Generated Agent Skill pointers, runtime caches and machine-specific MCP configuration remain ignored in their required runtime locations.
- Do not commit `.npmrc`, credentials or private infrastructure addresses. npm packages publish to the official registry with public access; authenticate outside the repository.
- The repository and original Aterm code use 0BSD. Third-party dependencies retain their licenses; builds preserve bundled dependency license and notice files.
