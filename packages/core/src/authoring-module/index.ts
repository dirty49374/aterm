export { TermPatch, type ITermPatch } from './patch.js';
export { RelationFormatter } from './relation-formatter.js';
export {
  AtermEditor,
  type IAtermEditInput,
  type IAtermEditResult,
  type IAtermEditSource,
  type IAtermFormatInput,
  type IAtermRenameInput,
  type IAtermMoveInput,
} from './editor.js';
export { TermDeclarationChanges, type ITermDeclarationDiff } from './changes.js';
export { WorkspaceFiles, type IFileRequest, type IWorkspaceFileResult } from './workspace-files.js';
export {
  SourceAuthoring,
  checkCorpus,
  type ISourceAuthoringRequest,
  type ISourceAuthoringResult,
} from './source-authoring.js';
