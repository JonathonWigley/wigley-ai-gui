import type { MainPart } from '../contracts/plugin';
import { agentLinesMainPart } from './agent-lines/main/start';
import { appUpdateMainPart } from './app-update/main/start';
import { audioPickerMainPart } from './audio-picker/main/start';
import { agentSkillsMainPart } from './agent-skills/main/start';
import { contextSourcesMainPart } from './context-sources/main/start';
import { agentStripMainPart } from './agent-strip/main/start';
import { agentsMainPart } from './agents/main/start';
import { autoCompactMainPart } from './auto-compact/main/start';
import { autoRetroMainPart } from './auto-retro/main/start';
import { backlogMainPart } from './backlog/main/start';
import { chatMainPart } from './chat/main/start';
import { docsMainPart } from './docs/main/start';
import { formsMainPart } from './forms/main/start';
import { galleryMainPart } from './gallery/main/start';
import { keysMainPart } from './keys/main/start';
import { liveViewMainPart } from './live-view/main/start';
import { notesMainPart } from './notes/main/start';
import { practiceMainPart } from './practice/main/start';
import { primerMainPart } from './primer/main/start';
import { schedulingMainPart } from './scheduling/main/start';
import { scopedAgentsMainPart } from './scoped-agents/main/start';
import { sessionLogMainPart } from './session-log/main/start';
import { sessionStashMainPart } from './session-stash/main/start';
import { sessionsMainPart } from './sessions/main/start';
import { settingsMainPart } from './settings/main/start';
import { systemStatsMainPart } from './system-stats/main/start';
import { unityPoolMainPart } from './unity-pool/main/start';
import { usageMainPart } from './usage/main/start';
import { visualMainPart } from './visual/main/start';
import { windowMainPart } from './window/main/start';
import { workflowMainPart } from './workflow/main/start';
import { workflowLargeMainPart } from './workflow-large/main/start';
import { workflowMediumMainPart } from './workflow-medium/main/start';
import { workflowSmallMainPart } from './workflow-small/main/start';
import { workflowSpikeMainPart } from './workflow-spike/main/start';

// Every built-in plugin's main part, in start order where no dependency says
// otherwise.
export const mainParts: readonly MainPart[] = [
  keysMainPart,
  sessionsMainPart,
  formsMainPart,
  primerMainPart,
  audioPickerMainPart,
  chatMainPart,
  autoCompactMainPart,
  // Before session-log, so chat lists Stashed above Recently closed.
  sessionStashMainPart,
  sessionLogMainPart,
  autoRetroMainPart,
  schedulingMainPart,
  agentsMainPart,
  agentLinesMainPart,
  agentStripMainPart,
  agentSkillsMainPart,
  contextSourcesMainPart,
  liveViewMainPart,
  docsMainPart,
  settingsMainPart,
  scopedAgentsMainPart,
  backlogMainPart,
  notesMainPart,
  practiceMainPart,
  usageMainPart,
  workflowMainPart,
  workflowLargeMainPart,
  workflowSpikeMainPart,
  workflowSmallMainPart,
  workflowMediumMainPart,
  unityPoolMainPart,
  systemStatsMainPart,
  visualMainPart,
  galleryMainPart,
  windowMainPart,
  // Last, so its self-test script's title bar button shows in no other script.
  appUpdateMainPart,
];
