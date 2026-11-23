import type { PagePart } from '../contracts/plugin';
import { agentCommandsPagePart } from './agent-commands/page/start';
import { agentLinesPagePart } from './agent-lines/page/start';
import { appUpdatePagePart } from './app-update/page/start';
import { audioPickerPagePart } from './audio-picker/page/start';
import { agentSkillsPagePart } from './agent-skills/page/start';
import { contextSourcesPagePart } from './context-sources/page/start';
import { liveViewPagePart } from './live-view/page/start';
import { agentStripPagePart } from './agent-strip/page/start';
import { agentsPagePart } from './agents/page/start';
import { autoCompactPagePart } from './auto-compact/page/start';
import { autoRetroPagePart } from './auto-retro/page/start';
import { backlogPagePart } from './backlog/page/start';
import { chatPagePart } from './chat/page/start';
import { chatroomPagePart } from './chatroom/page/start';
import { demoPagePart } from './demo/page/start';
import { docsPagePart } from './docs/page/start';
import { docsSessionTabPagePart } from './docs-session-tab/page/start';
import { formsPagePart } from './forms/page/start';
import { galleryPagePart } from './gallery/page/start';
import { keysPagePart } from './keys/page/start';
import { markdownBlocksPagePart } from './markdown-blocks/page/start';
import { notesPagePart } from './notes/page/start';
import { practicePagePart } from './practice/page/start';
import { primerPagePart } from './primer/page/start';
import { schedulingPagePart } from './scheduling/page/start';
import { scopedAgentsPagePart } from './scoped-agents/page/start';
import { sessionLogPagePart } from './session-log/page/start';
import { sessionStashPagePart } from './session-stash/page/start';
import { sessionsPagePart } from './sessions/page/start';
import { settingsPagePart } from './settings/page/start';
import { systemStatsPagePart } from './system-stats/page/start';
import { unityPoolPagePart } from './unity-pool/page/start';
import { buildsPagePart } from './builds/page/start';
import { usagePagePart } from './usage/page/start';
import { usageTabLinePagePart } from './usage-tab-line/page/start';
import { visualPagePart } from './visual/page/start';
import { workPagePart } from './work/page/start';
import { workBoardPagePart } from './work-board/page/start';
import { workInboxPagePart } from './work-inbox/page/start';
import { workflowPagePart } from './workflow/page/start';
import { workflowLargePagePart } from './workflow-large/page/start';
import { workflowMediumPagePart } from './workflow-medium/page/start';
import { workflowSmallPagePart } from './workflow-small/page/start';
import { workflowSpikePagePart } from './workflow-spike/page/start';

// Every built-in plugin's page part, in start order where no dependency says
// otherwise. `keys` starts first, so its Keys button contributes to the title
// bar's end ahead of every other plugin's; `markdown-blocks` next, so its
// blocks are registered before any markdown owner draws.
export const pageParts: readonly PagePart[] = [
  keysPagePart,
  markdownBlocksPagePart,
  sessionsPagePart,
  sessionStashPagePart,
  sessionLogPagePart,
  chatPagePart,
  formsPagePart,
  primerPagePart,
  audioPickerPagePart,
  agentCommandsPagePart,
  agentsPagePart,
  autoCompactPagePart,
  agentLinesPagePart,
  workflowPagePart,
  workflowLargePagePart,
  workflowSpikePagePart,
  workflowSmallPagePart,
  workflowMediumPagePart,
  unityPoolPagePart,
  buildsPagePart,
  systemStatsPagePart,
  autoRetroPagePart,
  agentStripPagePart,
  agentSkillsPagePart,
  contextSourcesPagePart,
  liveViewPagePart,
  docsPagePart,
  docsSessionTabPagePart,
  galleryPagePart,
  settingsPagePart,
  scopedAgentsPagePart,
  backlogPagePart,
  workPagePart,
  workInboxPagePart,
  workBoardPagePart,
  practicePagePart,
  schedulingPagePart,
  chatroomPagePart,
  notesPagePart,
  usagePagePart,
  usageTabLinePagePart,
  visualPagePart,
  demoPagePart,
  appUpdatePagePart,
];
