import type { PagePart } from '../contracts/plugin';
import { agentsPagePart } from './agents/page/start';
import { backlogPagePart } from './backlog/page/start';
import { chatPagePart } from './chat/page/start';
import { docsPagePart } from './docs/page/start';
import { formsPagePart } from './forms/page/start';
import { galleryPagePart } from './gallery/page/start';
import { keysPagePart } from './keys/page/start';
import { notesPagePart } from './notes/page/start';
import { primerPagePart } from './primer/page/start';
import { sessionsPagePart } from './sessions/page/start';
import { settingsPagePart } from './settings/page/start';
import { usagePagePart } from './usage/page/start';
import { visualPagePart } from './visual/page/start';
import { workflowPagePart } from './workflow/page/start';

// Every built-in plugin's page part, in start order where no dependency says
// otherwise.
export const pageParts: readonly PagePart[] = [
  sessionsPagePart,
  formsPagePart,
  primerPagePart,
  keysPagePart,
  chatPagePart,
  agentsPagePart,
  workflowPagePart,
  docsPagePart,
  galleryPagePart,
  settingsPagePart,
  backlogPagePart,
  notesPagePart,
  usagePagePart,
  visualPagePart,
];
