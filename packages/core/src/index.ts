export { AtermError } from './error.js';
export type {
  IDiscoveryResult,
  IDiscoveryCandidate,
  IDiscoveryEvidence,
  SearchMode,
} from './query-module/discovery.js';
export type { ISemanticIndexResult } from './retrieval-module/retrieval.js';
export { byText } from './order.js';
export * from './syntax-module/index.js';
export * from './file-module/index.js';
export * from './home-module/index.js';
export * from './corpus-module/index.js';
export * from './query-module/index.js';
export * from './skill-module/index.js';
export * from './authoring-module/index.js';
export { AtermApplication, type AtermResult, type IAtermOpenOptions } from './application.js';
export * from './external-module/index.js';
export * from './server-module/index.js';
export { TextMatching } from './matching.js';
