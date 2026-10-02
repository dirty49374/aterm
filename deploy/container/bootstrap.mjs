import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AtermApplication, AtermInitialization } from '@agent-workshop/aterm-core';
import { parseDocument } from 'yaml';

const workspace = '/data';
const home = join(workspace, '.aterm');
const configPath = join(home, 'aterm.yaml');

// Even an invalid existing Home belongs to its operator. The repair endpoint
// must be able to start without this bootstrap rewriting or parsing that Home.
try {
  await lstat(configPath);
  process.exit(0);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// A nested cache mount can pre-create .aterm. Publish the configuration last,
// after preparing empty project directories. Built-in Viewpoints stay in the package;
// existing unbound local files remain untouched.
const staging = await mkdtemp(join(workspace, '.aterm-init-'));
try {
  const initialized = await new AtermInitialization().create(staging);
  const config = parseDocument(await readFile(initialized.configPath, 'utf8'));
  config.setIn(['server', 'host'], '0.0.0.0');
  config.setIn(['server', 'port'], 43127);
  if (process.env.ATERM_PUBLIC_ORIGIN) {
    config.setIn(['server', 'publicOrigin'], process.env.ATERM_PUBLIC_ORIGIN);
  }
  // Agent installation belongs on an Agent's machine, not on this server.
  config.delete('skills');
  await writeFile(initialized.configPath, config.toString());
  await AtermApplication.open({ home: initialized.home });
  const viewpoints = join(home, 'viewpoints');
  await mkdir(viewpoints, { recursive: true });
  await mkdir(join(workspace, 'docs'), { recursive: true });
  await rename(initialized.configPath, configPath);
  console.error(`Initialized Aterm Home at ${home}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
