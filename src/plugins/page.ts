import type { PagePart } from '../contracts/plugin';
import { agentLinesPagePart } from './agent-lines/page/start';
import { agentSkillsPagePart } from './agent-skills/page/start';
import { contextSourcesPagePart } from './context-sources/page/start';
import { agentStripPagePart } from './agent-strip/page/start';
import { agentsPagePart } from './agents/page/start';
import { autoRetroPagePart } from './auto-retro/page/start';
import { backlogPagePart } from './backlog/page/start';
import { chatPagePart } from './chat/page/start';
import { docsPagePart } from './docs/page/start';
import { docsSessionTabPagePart } from './docs-session-tab/page/start';
import { formsPagePart } from './forms/page/start';
import { galleryPagePart } from './gallery/page/start';
import { keysPagePart } from './keys/page/start';
import { notesPagePart } from './notes/page/start';
import { primerPagePart } from './primer/page/start';
import { sessionStashPagePart } from './session-stash/page/start';
import { sessionsPagePart } from './sessions/page/start';
import { settingsPagePart } from './settings/page/start';
import { unityPoolPagePart } from './unity-pool/page/start';
import { usagePagePart } from './usage/page/start';
import { usageTabLinePagePart } from './usage-tab-line/page/start';
import { visualPagePart } from './visual/page/start';
import { workflowPagePart } from './workflow/page/start';
import { workflowLargePagePart } from './workflow-large/page/start';
import { workflowSmallPagePart } from './workflow-small/page/start';
import { workflowMediumPagePart } from './workflow-medium/page/start';

// Every built-in plugin's page part, in start order where no dependency says
// otherwise. `keys` starts first, so its Keys button contributes to the title
// bar's end ahead of every other plugin's.
export const pageParts: readonly PagePart[] = [
  keysPagePart,
  sessionsPagePart,
  sessionStashPagePart,
  chatPagePart,
  formsPagePart,
  primerPagePart,
  agentsPagePart,
  agentLinesPagePart,
  workflowPagePart,
  workflowLargePagePart,
  workflowSmallPagePart,
  workflowMediumPagePart,
  unityPoolPagePart,
  autoRetroPagePart,
  agentStripPagePart,
  agentSkillsPagePart,
  contextSourcesPagePart,
  docsPagePart,
  docsSessionTabPagePart,
  galleryPagePart,
  settingsPagePart,
  backlogPagePart,
  notesPagePart,
  usagePagePart,
  usageTabLinePagePart,
  visualPagePart,
];
