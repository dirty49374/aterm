import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AtermError } from '../error.js';
import { CONFIG_FILE, HOME_DIRECTORY } from './home.js';
import { installedViewpoints, viewpointSource } from './defaults.js';
export { installedViewpoints, viewpointSource } from './defaults.js';

export interface IAtermInitialization {
  readonly home: string;
  readonly configPath: string;
  readonly viewpoints: readonly string[];
  readonly sources: readonly string[];
}

export const VIEWPOINT_DIRECTORY = 'viewpoints';

export const defaultConfigText = `# Aterm home configuration. Relative paths resolve against the parent directory of ${HOME_DIRECTORY}/.
# Include the shipped Aterm Knowledges in corpus queries; Skills remain available when false.
useDefaultKnowledge: true
# Packaged Knowledge and Viewpoints are read-only unless explicitly enabled.
allowDefaultWrites: false
# Select built-in vocabularies without copying their files; [] selects none.
useViewpoints: [specification, generic, domain, skill]
server:
  # Use 0.0.0.0 to allow connections from other machines.
  host: 127.0.0.1
  port: 43127
  debounceMs: 200
  watchExternal: true
# External text is searched with or without a server.
# externalSources:
#   app: "src/**/*.{ts,tsx}"
# Generate Skill documents in .aterm/skills, then install to this project's Agents.
# Omit skills to manage local documents only. These commands run only on skill lifecycle actions.
skills:
  sync: |
    if [[ -n "$ATERM_REMOVED_SKILL_NAMES" ]]; then
      npx --yes --package skills --call 'skills remove --skill $ATERM_REMOVED_SKILL_NAMES --yes'
    fi
    if [[ -n "$ATERM_SKILL_NAMES" ]]; then
      npx --yes --package skills --call 'skills add "$ATERM_SKILLS_DIR" --skill $ATERM_SKILL_NAMES --agent claude-code codex --yes'
    fi
  uninstall: |
    if [[ -n "$ATERM_REMOVED_SKILL_NAMES" ]]; then
      npx --yes --package skills --call 'skills remove --skill $ATERM_REMOVED_SKILL_NAMES --yes'
    fi
sources:
  - docs
# Every Knowledge starts with a unique Knowledge ID, then names its Viewpoints:
#   @knowledge example
#   @viewpoints specification
#   @description {
#     What readers will find in this Knowledge.
#   }
#   @scope {
#     What authors must cover and where the boundary lies.
#   }
# Bind additional or customized vocabularies with Home-relative paths.
# viewpoints:
#   project: ./viewpoints/project.md
`;

/** Creates one Aterm home: configuration referencing package Viewpoints and an empty `docs` source. */
export class AtermInitialization {
  async create(directory: string): Promise<IAtermInitialization> {
    const root = resolve(directory);
    const home = join(root, HOME_DIRECTORY);
    const configPath = join(home, CONFIG_FILE);
    const viewpoints = join(home, VIEWPOINT_DIRECTORY);
    await mkdir(viewpoints, { recursive: true });
    try {
      await writeFile(configPath, defaultConfigText, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new AtermError('config.exists', `Already initialized: ${configPath}`);
      throw error;
    }
    const sources = [join(root, 'docs')];
    for (const source of sources) await mkdir(source, { recursive: true });
    return {
      home,
      configPath,
      viewpoints: installedViewpoints.map((name) => join(viewpointSource, `${name}.md`)),
      sources,
    };
  }
}
