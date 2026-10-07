# Aterm server image

This image installs the exact `@garage49/aterm-core` and `@garage49/aterm` tarballs
produced by the build. It does not compile source or fetch those packages from the
registry. Release and snapshot images use the same path; third-party dependencies
come from npm. Use only `deploy/container` as the build context.

```sh
pnpm release:pack
mkdir -p deploy/container/npm
# Keep npm/ limited to the two tarballs for this version.
cp dist/garage49-aterm-core-0.1.0.tgz dist/garage49-aterm-0.1.0.tgz deploy/container/npm/
docker build --platform linux/amd64 \
  --build-arg VERSION=0.1.0 \
  -t aterm:0.1.0 deploy/container
node deploy/container/smoke.mjs aterm:0.1.0
```

The shared workflow populates ignored `deploy/container/npm/` and supplies `VERSION`.
The build refuses an absent version or a CLI version that differs from the label.
The smoke script requires Node 24+, npm and Docker; it installs the same tarballs
into a disposable test runtime and does not require checkout dependencies or a
local build. The Node base is digest-pinned; third-party npm and Debian dependencies
are resolved at build time. Record the resulting image digest.

Tag the tested image for your registry and push it only after checking deployment
automation. A new version tag can trigger rollout even when `latest` is unchanged.
Deploy an immutable digest and retain a pullable previous image for rollback.
Registry retention must preserve every deployed and rollback digest.

## Run

```sh
docker volume create aterm-data
docker run --rm --name aterm --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev \
  --mount type=volume,src=aterm-data,dst=/data \
  -p 127.0.0.1:43127:43127 aterm:0.1.0
```

The image runs Linux amd64 / Node 24 as UID/GID 1000. Tini forwards signals to a
single foreground server bound to `0.0.0.0:43127`. The default Home is
`/data/.aterm`; the Workspace and all persistent source/configuration live under
`/data`. The browser is `/`, GraphQL is `/graphql`, and MCP is `/mcp`.
WebSocket forwarding is needed for `/api/ui/events`.

First boot initializes an absent Home, enables packaged Knowledge and the four
packaged Viewpoints, and removes client-side Agent installation hooks. Existing
configuration, local Viewpoints and corpus files are never replaced by bootstrap.
Built-in resources are loaded from the installed package.

`ATERM_PUBLIC_ORIGIN=https://aterm.example` sets `server.publicOrigin` only when
initializing a Home. To change an existing origin, edit its persistent YAML and
restart. Explicit CLI host/port flags override YAML. An explicit port also keeps
the repair endpoint available when configuration is invalid.

## Persistence and Kubernetes

- Mount the entire Workspace, not only `.aterm`. Keep it writable by UID 1000.
- Use one replica and the `Recreate` strategy; in-memory snapshots and authoring
  locks are not distributed coordination.
- Keep the root filesystem read-only, drop capabilities, disable privilege
  escalation and service-account token mounting, and provide writable `/tmp`.
- For NFS-backed data, mount local-backed storage separately at
  `/data/.aterm/cache/semantic`. SQLite WAL must not reside on NFS.
- Prepare the nested mount's parent directories before startup. A same-UID init
  container can create `/data/.aterm/cache/semantic` with only `/data` mounted.
- A temporary semantic cache needs rebuilding after pod replacement. Normal
  startup and lexical queries do not download an embedding model.

Native filesystem watching may not observe edits made by another NFS client.
Hosted MCP writes explicitly refresh the snapshot before completion. Verify
external-write visibility on the actual storage class.

Git comparison creates private temporary control metadata under `/tmp`, with up
to 128 MiB allowed per comparison. It uses isolated configuration and disables
execution-capable filters, hooks, fsmonitor and external diff. All authoring
commands refuse `.git` metadata writes. These are defenses, not a sandbox for
untrusted Workspace writers or arbitrarily configured source paths.

## Backup and upgrade

Before changing a live mount, quiesce writes, back up the complete Workspace,
verify a full restore into an isolated location, and validate that restored copy
with the candidate image. Preserve authored business data, custom Viewpoints and
Skills. Retain the previous image digest and backup until live checks pass.

0.1.0 changes npm package scope to `@garage49` and installs packed build artifacts
in the image. It retains protocol 24 and the same persistent data format. The
localhost listener also uses the address families available to HTTP clients so
automatic discovery reaches it on systems with IPv6 only on loopback.

0.0.14 fixes remote CLI commands waiting for unused stdin. Upgrade CLI clients to
receive this fix; server-only upgrades cannot fix an older client.

0.0.14 uses protocol 24 and needs no data migration from 0.0.12. It includes the
GraphQL workspace, reviewed contextual Naming and repeated Term-based Retell
Skills, and behavior-preserving refactors. Reload clients after upgrading.

Older installations may require migration. The current schema uses `termKinds`,
`termDeclarations`, one declaration per Term, `useDefaultKnowledge` and
`useViewpoints`. The unified `skill` commands replace legacy Workflow/Newskill
commands. Validate migrations on the restored copy; never silently overwrite
custom source files with packaged defaults.

## Exposure and health

MCP callers are trusted writers: semantic authoring and raw Workspace file
operations are available. There is no per-user ACL or read-only MCP boundary.
Use an authenticating TLS proxy for external access; do not publish an unauthenticated
backend. `server.controlToken` protects the separate UI-control API, not MCP.

The proxy must preserve an accepted Host and Origin. For a public browser,
configure `server.publicOrigin` to the exact public origin. An MCP-only proxy may
omit Origin and use the backend Host. Untrusted forwarded headers do not grant
access. Keep host paths, cluster credentials and unrelated secrets out of the mount.

`GET /api/health` returns transport status and JSON including `protocol`, `home`,
`revision` and `ready`. HTTP 200 with `ready: false` can mean invalid configuration
or a refresh error; keep the repair endpoint available rather than restarting it
or removing the only service endpoint. Check corpus diagnostics separately.

Begin capacity testing with CPU request 250m, memory request 512Mi, limits 2 CPU /
2Gi and a 5–10 GiB Workspace. These are estimates; measure with the actual corpus
and semantic indexing. Preserve third-party notices and source availability when
distributing images; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
