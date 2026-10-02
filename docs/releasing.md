# Releasing Aterm

Publish `@agent-workshop/aterm-core` and `@agent-workshop/aterm` to `https://registry.npmjs.org` with public
access. Their versions and the private root Workspace version must agree. The
initial public repository starts from the current 0.0.13 snapshot; it does not
reuse the previous repository's commit history.

1. Confirm npm ownership of the `@agent-workshop` scope and authenticate using your user
   configuration or trusted CI publishing. Do not add a repository `.npmrc`.
2. Check whether the intended version already exists on the public registry.
3. Build, test and inspect the exact packages before publishing.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm aterm corpus check
pnpm release:pack
```

Inspect `dist/agent-workshop-aterm-core-VERSION.tgz` and `dist/agent-workshop-aterm-VERSION.tgz`. Verify the
CLI's dependency is the exact Core version, runtime/browser assets are present,
licenses and notices are included, and local configuration/evidence is absent.
Install the tarballs together into a clean directory and test the installed CLI.

```sh
npm publish ./dist/agent-workshop-aterm-core-VERSION.tgz --access public --registry https://registry.npmjs.org
npm publish ./dist/agent-workshop-aterm-VERSION.tgz --access public --registry https://registry.npmjs.org
```

Publish Core first. `pnpm pack` resolves workspace dependencies; do not publish
the raw workspace manifest with `npm publish` from the CLI directory. A successful
build or GitHub push does not publish npm packages. Verify the installed version,
fresh Home, corpus check, Skill reading and native dependencies after publication.

Changing the public repository or npm target does not update running deployments.
Build and verify a new container separately, preserve persistent data and deploy
its immutable digest. See [container instructions](../deploy/container/README.md).

## Licenses

Aterm's original code and documentation use 0BSD. Dependency licenses do not
change. The browser build collects license and notice files for its actual
transitive esbuild inputs and copied ELK package; missing license files fail the
build. Review generated `webapp/licenses/packages.json` and
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) when dependencies change.

A dependency inventory can be inspected with `pnpm licenses list --json`.
This includes build-only packages; it is not an inventory of a specific tarball
or container. Re-audit native libraries and source availability when building a
standalone image or changing how dependencies are linked/distributed.

## Local material

Keep trials, review packets, release logs, screenshots, experimental models and
private configuration under `.local/`. It is ignored as a whole. Generated
runtime state and Agent Skill installations stay in their required locations but
are also ignored. Neither local evidence nor the old repository's private
history belongs in public commits or package tarballs.
