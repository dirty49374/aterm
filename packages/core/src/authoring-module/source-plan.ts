import type { IAtermConfig } from '../home-module/index.js';
import type { DerivationIndex } from '../query-module/derivation.js';

export interface ISourceAuthoringRequest {
  readonly operation:
    | 'knowledge-create'
    | 'knowledge-edit'
    | 'knowledge-delete'
    | 'viewpoint-create'
    | 'viewpoint-edit'
    | 'viewpoint-delete';
  readonly name: string;
  readonly path?: string;
  readonly text?: string;
  readonly ifMatch?: string;
  readonly dryRun?: boolean;
}
export interface IPlannedSourceFile {
  path: string;
  before?: string;
  after?: string;
  version?: string;
}
export interface ISourceAuthoringResult {
  readonly operation: ISourceAuthoringRequest['operation'];
  readonly name: string;
  readonly dryRun: boolean;
  readonly saved: boolean;
  readonly files: readonly IPlannedSourceFile[];
  readonly derivedImpacts: ReturnType<DerivationIndex['impacts']>;
}

/** Candidate configuration and source overrides; paths are absolute until result presentation. */
export interface ISourcePlan {
  readonly config: IAtermConfig;
  readonly target: string;
  readonly files: readonly IPlannedSourceFile[];
  readonly overrides: ReadonlyMap<string, string | null>;
}
