import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The complete public built-in Viewpoint inventory. */
export const installedViewpoints = ['specification', 'generic', 'domain', 'skill'] as const;
export const viewpointSource = fileURLToPath(new URL('../../viewpoints/', import.meta.url));

export const guideSource = fileURLToPath(new URL('../../docs/', import.meta.url));

/** Package resource identity follows its path, never the name of its config binding. */
export function isDefaultResource(path: string): boolean {
  return [guideSource, viewpointSource].some((root) => {
    const child = relative(root, path);
    return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
  });
}
