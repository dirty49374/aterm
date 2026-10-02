import type { ITextFile } from '../file-module/index.js';
import type { IParsedFile } from '../syntax-module/index.js';

/** One message about a scanned file or source directory, with its physical location. */
export interface IAtermDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** _aterm_development:TRM_File_Snapshot_: one source snapshot, retained even when parsing fails. */
export interface ITrmFile extends ITextFile {
  /** Packaged .trm files require an explicit allowDefaultWrites opt-in for authoring. */
  readonly readOnly?: boolean;
  /** The Viewpoint names the file's `@viewpoints` line declares; absent when it has none. */
  readonly viewpoints?: readonly string[];
  readonly parsed?: IParsedFile;
}
