# Releasing Aterm

Publish `@garage49/aterm-core` and `@garage49/aterm` to `https://registry.npmjs.org` with public
access. Their versions and the private root Workspace version must agree. The
initial public repository starts from the current 0.0.13 snapshot; it does not
reuse the previous repository's commit history.

1. Confirm npm ownership of the `@garage49` scope and configure trusted CI publishing
   or the shared workflow's initial-publish credential. Do not add a repository `.npmrc`.
2. Check whether the intended version already exists on the public registry.
3. Build, test and inspect the exact packages before publishing.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm aterm corpus check
pnpm release:pack
```

Inspect `dist/garage49-aterm-core-VERSION.tgz` and `dist/garage49-aterm-VERSION.tgz`. Verify the
CLI's dependency is the exact Core version, runtime/browser assets are present,
licenses and notices are included, and local configuration/evidence is absent.
Install the tarballs together into a clean directory and test the installed CLI.

Release through `.github/workflows/build.yml`, which calls the
[shared Node workflow](https://github.com/garage49/.github/blob/main/.github/workflows/node-build.yml).
Only a `vX.Y.Z` tag on a commit in `main` publishes a release; root, Core and CLI
versions must all match the tag. Before 1.0, a breaking change increments MINOR.
Public pull requests run on hosted runners and publish nothing. Main builds
produce snapshot artifacts and, when enabled, snapshot images; they do not publish
npm releases. The shared version action computes snapshot versions from Git history.

The workflow builds and packs once, installs those exact tarballs in the container,
runs the image smoke, and pushes the image before publishing npm packages. A failed
smoke stops publication. Core publishes first; the workflow waits until that version
is fetchable before publishing CLI. `pnpm pack` resolves workspace dependencies;
do not publish a raw workspace manifest. Release assets include both tarballs,
individual SHA-256 files and `SHA256SUMS`.

Verify the installed version, fresh Home, corpus check, Skill reading and native
dependencies after publication. Image publication does not authorize production
replacement. Back up and validate the persistent Workspace with the candidate, then
deploy its immutable digest. See [container instructions](../deploy/container/README.md).

## Migration to 0.1.0

The npm scope changes from `@agent-workshop` to `@garage49`; the executable remains
`aterm`. After the new packages are published and verified, migrate the global CLI:

```sh
npm uninstall -g @agent-workshop/aterm
npm install -g @garage49/aterm@0.1.0
aterm --version
```

Core consumers must change their dependency and imports to `@garage49/aterm-core`.
Do not keep both global CLI packages installed: both provide the `aterm` executable.
Only deprecate the previous package names after both replacements are live and
smoke-tested. Existing Knowledge, Skill identities and protocol 24 are unchanged;
running deployments stay on their previous digest until explicitly upgraded.

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
