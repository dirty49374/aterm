# Complexity report

From the repository root:

```sh
pnpm complexity                    # Top 30 per metric
pnpm complexity --top 10
pnpm --silent complexity --json > .local/complexity.json
pnpm test:complexity
```

The report uses the actual ESLint `complexity` rule (classic variant) and
SonarJS `cognitive-complexity` rule. It does not implement its own scoring formula.
High scores are review signals, not build failures. Parse/read failures or
unexpected diagnostics exit nonzero, without emitting a partial report.

Project review criteria (also in AGENTS.md):

| Metric | Target | Review | Prioritize refactoring |
| --- | ---: | ---: | ---: |
| Cognitive | <= 15 | 16-30 | > 30 |
| Cyclomatic | <= 10 | 11-20 | > 20 |

Use clear responsibility boundaries, not arbitrary extractions to meet a number.
Compare extracted functions as well as their coordinator, and preserve behavior
unless a separate behavior change is explicitly chosen.

- Cyclomatic Complexity counts independent execution paths. All explicit
  functions and implicit class field initializers/static blocks appear, including score 1.
- Cognitive Complexity weights control flow and nesting. Only functions with
  positive scores appear. The subject is the source line at SonarJS's reported
  function token; callbacks remain identifiable by file, line and column.
- The metrics use different scales and units; do not sum them or compare their
  row counts. Inspect the code before deciding whether extraction would improve it.
- Text shows two independently ranked lists. `--top` limits each to N rows.
- JSON retains all measured rows and the exact file inventory. It is suitable for
  later comparison, but this command has no automatic baseline gate.

Coverage: `packages/*/src`, `packages/webapp/public`, and `tooling` JavaScript,
TypeScript and JSX sources. Tests, declarations, node_modules, dist and packaged
browser copies are excluded. Inline ESLint directives cannot suppress measurement.
These fixture tests also participate in the root `pnpm test` suite.

This private package isolates the parser's supported TypeScript 6 runtime from
Aterm's TypeScript 7 compiler. Pinned versions and the shared pnpm lockfile make
measurements reproducible. No analyzer is a runtime dependency of shipped packages.

Official metric definitions:
- https://eslint.org/docs/latest/rules/complexity
- https://sonarsource.github.io/rspec/#/rspec/S3776/javascript
