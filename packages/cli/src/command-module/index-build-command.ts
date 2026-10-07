import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class IndexBuildCommand implements ICommandDefinition {
  readonly name = 'corpus index build';
  readonly options = [] as const;
  readonly help = {
    summary: 'Prepare the embedded Model and current corpus Embeddings',
    behavior:
      'Runs locally. Downloads missing pinned Model files and caches only missing source inputs under the selected Home. Corpus text never leaves the process. Existing compatible vectors are reused; failed batches retain completed records. Knowledges are unchanged.',
    example: 'aterm corpus index build',
  };
  readonly action = 'query' as const;
  async prepare(): Promise<AtermQuery> {
    return { operation: 'index-build' };
  }
}
