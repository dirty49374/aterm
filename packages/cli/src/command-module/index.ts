import { ViewpointCreateCommand } from './viewpoint-create-command.js';
import { ViewpointEditCommand } from './viewpoint-edit-command.js';
import { ViewpointDeleteCommand } from './viewpoint-delete-command.js';
import { KnowledgeCreateCommand } from './knowledge-create-command.js';
import { KnowledgeEditCommand } from './knowledge-edit-command.js';
import { KnowledgeDeleteCommand } from './knowledge-delete-command.js';
import { FileListCommand } from './file-list-command.js';
import { FileReadCommand } from './file-read-command.js';
import { FileWriteCommand } from './file-write-command.js';
import { FileDeleteCommand } from './file-delete-command.js';
import { SkillListCommand } from './skill-list-command.js';
import { SkillTocCommand } from './skill-toc-command.js';
import { SkillViewCommand } from './skill-view-command.js';
import { SkillRemindCommand } from './skill-remind-command.js';
import { UISessionListCommand } from './ui-session-list-command.js';
import { DiscoverCommand } from './discover-command.js';
import { IndexBuildCommand } from './index-build-command.js';
import { IndexStatusCommand } from './index-status-command.js';
import { UISessionViewCommand } from './ui-session-view-command.js';
import { UICommandViewCommand } from './ui-command-view-command.js';
import { UIOpenCommand } from './ui-open-command.js';
import { UINoteSendCommand } from './ui-note-send-command.js';
import { UIExploreSetCommand } from './ui-explore-set-command.js';
import { UIExploreAddCommand } from './ui-explore-add-command.js';
import { UIExploreRemoveCommand } from './ui-explore-remove-command.js';
import { UIExploreClearCommand } from './ui-explore-clear-command.js';
import { SkillUninstallCommand } from './skill-uninstall-command.js';
import { SkillUpdateCommand } from './skill-update-command.js';
import { SkillInstallCommand } from './skill-install-command.js';
import { KnowledgeViewCommand } from './knowledge-view-command.js';
import { KnowledgeListCommand } from './knowledge-list-command.js';
import { ViewpointListCommand } from './viewpoint-list-command.js';
import { RenameKnowledgeCommand } from './rename-knowledge-command.js';
import { ServerCommand } from './server-command.js';
import { MCPCommand } from './mcp-command.js';
import type { ICommandConstructor } from '../contracts.js';
import { ListCommand } from './list-command.js';
import { SearchCommand } from './search-command.js';
import { ShowCommand } from './show-command.js';
import { ViewCommand } from './view-command.js';
import { OverviewCommand } from './overview-command.js';
import { ConnectCommand } from './connect-command.js';
import { PathCommand } from './path-command.js';
import { GrepCommand } from './grep-command.js';
import { RelationsCommand } from './relations-command.js';
import { CheckCommand } from './check-command.js';
import { ChangesCommand } from './changes-command.js';
import { EditCommand } from './edit-command.js';
import { RenameCommand } from './rename-command.js';
import { MoveCommand } from './move-command.js';
import { FormatCommand } from './format-command.js';
import { ViewpointCommand } from './viewpoint-command.js';
import { InitCommand } from './init-command.js';
import { QueryCommand } from './query-command.js';
import { JqCommand } from './jq-command.js';

/** Registration supplies help order; each declaration owns its complete command path. */
export const commands: readonly ICommandConstructor[] = [
  ViewpointCreateCommand,
  ViewpointEditCommand,
  ViewpointDeleteCommand,
  KnowledgeCreateCommand,
  KnowledgeEditCommand,
  KnowledgeDeleteCommand,
  FileListCommand,
  FileReadCommand,
  FileWriteCommand,
  FileDeleteCommand,

  ListCommand,
  SkillListCommand,
  SkillTocCommand,
  SkillViewCommand,
  SkillRemindCommand,

  SearchCommand,
  QueryCommand,
  JqCommand,
  DiscoverCommand,
  IndexBuildCommand,
  IndexStatusCommand,
  ShowCommand,
  ViewCommand,
  OverviewCommand,
  ConnectCommand,
  PathCommand,
  GrepCommand,
  RelationsCommand,
  CheckCommand,
  ChangesCommand,
  EditCommand,
  RenameCommand,
  MoveCommand,
  KnowledgeListCommand,
  KnowledgeViewCommand,
  RenameKnowledgeCommand,
  FormatCommand,
  ViewpointListCommand,
  ViewpointCommand,
  SkillInstallCommand,
  SkillUpdateCommand,
  SkillUninstallCommand,
  InitCommand,
  ServerCommand,
  MCPCommand,
  UISessionListCommand,
  UISessionViewCommand,
  UICommandViewCommand,
  UIOpenCommand,
  UINoteSendCommand,
  UIExploreSetCommand,
  UIExploreAddCommand,
  UIExploreRemoveCommand,
  UIExploreClearCommand,
];
export { SearchOptions } from './search-options.js';
