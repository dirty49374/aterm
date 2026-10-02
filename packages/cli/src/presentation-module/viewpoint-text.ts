import { AtermError, type IViewpointResult } from '@agent-workshop/aterm-core';
import { ListTable } from './list-table.js';
import { alignedTable } from './table.js';

/** A selected Viewpoint is its original Markdown file, including frontmatter and EOF. */
export class ViewpointText {
  render(result: IViewpointResult): string {
    if (!result.selected) return alignedTable(ListTable.viewpoints(result)) + '\n';
    if (!result.viewpoints.length) return 'No viewpoints.\n';
    return result.viewpoints
      .map((viewpoint) => {
        if (viewpoint.source === undefined)
          throw new AtermError(
            'viewpoint.source',
            `Viewpoint ${viewpoint.name} has no source in this result.`,
          );
        return viewpoint.source;
      })
      .join('');
  }
}
