import { GlobPattern } from './pattern.js';
import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import type { AtermQuestion } from '../syntax-module/index.js';

/** One kind as a Viewpoint reading reports it: its sections, and what it asks of a Term. */
export interface IViewpointTermKindView {
  readonly name: string;
  readonly description: string;
  readonly sections: readonly {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly questions?: readonly AtermQuestion[];
    readonly example?: string;
  }[];
}

export interface IViewpointView {
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly termKinds: readonly IViewpointTermKindView[];
  readonly guidance?: string;
  readonly source?: string;
}

export interface IViewpointResult {
  readonly viewpoints: readonly IViewpointView[];
  /** Whether the request named Viewpoints; an unselected reading is a listing. */
  readonly selected: boolean;
}

export interface IViewpointRequest {
  readonly caseSensitive?: boolean;
  readonly viewpoints?: readonly string[];
  readonly guidance?: boolean;
  /** Selected readings include the original file; composition can omit it. */
  readonly source?: boolean;
}

/**
 * Reads the bound Viewpoints of one configuration. It answers from the configuration alone
 * and never scans a source, because a vocabulary is settled before any Knowledge is read.
 */
export class ViewpointReading {
  validate(
    names: readonly string[],
    selected: readonly string[] = [],
    caseSensitive = false,
  ): void {
    const patterns = selected.map((name) => new GlobPattern(name, caseSensitive));
    const unknown = patterns.filter(
      (pattern) => !pattern.isGlob && !names.some((name) => pattern.matches(name)),
    );
    if (unknown.length)
      throw new AtermError(
        'viewpoint.unknown',
        `Unknown Viewpoint ${unknown.map((pattern) => pattern.text).join(', ')}; available: ` +
          names.join(', ') +
          '.',
      );
  }

  read(config: IAtermConfig, request: IViewpointRequest = {}): IViewpointResult {
    this.validate(
      config.viewpoints.map((viewpoint) => viewpoint.name),
      request.viewpoints,
      request.caseSensitive,
    );
    const patterns = (request.viewpoints ?? []).map(
      (name) => new GlobPattern(name, request.caseSensitive ?? false),
    );
    const viewpoints = config.viewpoints.filter(
      (viewpoint) =>
        !patterns.length || patterns.some((pattern) => pattern.matches(viewpoint.name)),
    );
    return {
      selected: patterns.length > 0,
      viewpoints: viewpoints.map((viewpoint) => ({
        name: viewpoint.name,
        path: viewpoint.path,
        description: viewpoint.description,
        termKinds: viewpoint.termKinds.map((termKind) => ({
          name: termKind.name,
          description: termKind.description,
          sections: termKind.schema.sections.map((section) => ({
            name: section.name,
            type: section.type,
            ...(section.description === undefined ? {} : { description: section.description }),
            ...(section.questions?.length ? { questions: section.questions } : {}),
            ...(section.example === undefined ? {} : { example: section.example }),
          })),
        })),
        ...(request.guidance ? { guidance: viewpoint.body } : {}),
        ...(request.source !== false && patterns.length ? { source: viewpoint.source } : {}),
      })),
    };
  }
}
