import type { MainPart } from '../contracts/plugin';
import { agentLinesMainPart } from './agent-lines/main/start';
import { agentSkillsMainPart } from './agent-skills/main/start';
import { agentStripMainPart } from './agent-strip/main/start';
import { agentsMainPart } from './agents/main/start';
import { autoCompactMainPart } from './auto-compact/main/start';
import { backlogMainPart } from './backlog/main/start';
import { chatMainPart } from './chat/main/start';
import { docsMainPart } from './docs/main/start';
import { formsMainPart } from './forms/main/start';
import { galleryMainPart } from './gallery/main/start';
import { keysMainPart } from './keys/main/start';
import { notesMainPart } from './notes/main/start';
import { primerMainPart } from './primer/main/start';
import { sessionsMainPart } from './sessions/main/start';
import { settingsMainPart } from './settings/main/start';
import { unityPoolMainPart } from './unity-pool/main/start';
import { usageMainPart } from './usage/main/start';
import { visualMainPart } from './visual/main/start';
import { workflowMainPart } from './workflow/main/start';

// Every built-in plugin's main part, in start order where no dependency says
// otherwise.
export const mainParts: readonly MainPart[] = [
  sessionsMainPart,
  formsMainPart,
  primerMainPart,
  chatMainPart,
  autoCompactMainPart,
  agentsMainPart,
  agentLinesMainPart,
  agentStripMainPart,
  agentSkillsMainPart,
  docsMainPart,
  settingsMainPart,
  backlogMainPart,
  notesMainPart,
  usageMainPart,
  workflowMainPart,
  unityPoolMainPart,
  visualMainPart,
  keysMainPart,
  galleryMainPart,
];
