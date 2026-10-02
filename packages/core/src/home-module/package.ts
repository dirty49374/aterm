import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AtermConfigReader, type IAtermConfig } from './config.js';
import { AtermViewpointReader } from './viewpoint.js';
import type { IAtermHome } from './home.js';
import { installedViewpoints, viewpointSource, guideSource } from './defaults.js';
export { guideSource } from './defaults.js';

/** Whole shipped Knowledges are resolved in the package's own vocabulary. */

export async function shippedConfig(): Promise<IAtermConfig> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const home: IAtermHome = {
    home: join(root, 'docs'),
    workspace: root,
    configPath: join(root, 'docs', 'aterm.yaml'),
    origin: 'option',
  };
  const reader = new AtermViewpointReader();
  const loaded = new Map(
    await Promise.all(
      installedViewpoints.map(
        async (name) =>
          [name, await reader.read(name, home.home, join(viewpointSource, `${name}.md`))] as const,
      ),
    ),
  );
  return new AtermConfigReader().parse(
    home,
    'sources: [docs]\nuseDefaultKnowledge: false\n',
    loaded,
  );
}
