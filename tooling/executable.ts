import { chmod } from 'node:fs/promises';
// The generated CLI is invoked directly by local npm installs.
await chmod('packages/cli/dist/entry.js', 0o755);
