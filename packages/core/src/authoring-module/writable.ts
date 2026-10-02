import { isDefaultResource } from '../home-module/defaults.js';
import { AtermError } from '../error.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';

/** Packaged Knowledge is protected unless the Home explicitly enables default writes. */
export function assertWritableTrmFile(trmFile: ITrmFile | undefined): void {
  if (trmFile?.readOnly)
    throw new AtermError(
      'aterm.read-only',
      `Packaged Knowledge ${trmFile.parsed?.knowledge ?? trmFile.path} is read-only: ${trmFile.absolutePath}. Set allowDefaultWrites: true to permit changes.`,
    );
}

export function assertDefaultWritable(path: string, allowDefaultWrites: boolean): void {
  if (isDefaultResource(path) && !allowDefaultWrites)
    throw new AtermError(
      'aterm.read-only',
      `Packaged resource is read-only: ${path}. Set allowDefaultWrites: true to permit changes.`,
    );
}
