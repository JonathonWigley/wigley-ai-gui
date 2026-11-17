import type { PluginManifest } from '../contracts/plugin';
import { agentLinesManifest } from './agent-lines/manifest';
import { appUpdateManifest } from './app-update/manifest';
import { audioPickerManifest } from './audio-picker/manifest';
import { agentSkillsManifest } from './agent-skills/manifest';
import { contextSourcesManifest } from './context-sources/manifest';
import { agentStripManifest } from './agent-strip/manifest';
import { agentsManifest } from './agents/manifest';
import { autoCompactManifest } from './auto-compact/manifest';
import { autoRetroManifest } from './auto-retro/manifest';
import { backlogManifest } from './backlog/manifest';
import { chatManifest } from './chat/manifest';
import { docsManifest } from './docs/manifest';
import { docsSessionTabManifest } from './docs-session-tab/manifest';
import { formsManifest } from './forms/manifest';
import { galleryManifest } from './gallery/manifest';
import { keysManifest } from './keys/manifest';
import { liveViewManifest } from './live-view/manifest';
import { notesManifest } from './notes/manifest';
import { practiceManifest } from './practice/manifest';
import { primerManifest } from './primer/manifest';
import { schedulingManifest } from './scheduling/manifest';
import { scopedAgentsManifest } from './scoped-agents/manifest';
import { sessionLogManifest } from './session-log/manifest';
import { sessionStashManifest } from './session-stash/manifest';
import { sessionsManifest } from './sessions/manifest';
import { settingsManifest } from './settings/manifest';
import { systemStatsManifest } from './system-stats/manifest';
import { unityPoolManifest } from './unity-pool/manifest';
import { usageManifest } from './usage/manifest';
import { usageTabLineManifest } from './usage-tab-line/manifest';
import { visualManifest } from './visual/manifest';
import { windowManifest } from './window/manifest';
import { workflowManifest } from './workflow/manifest';
import { workflowLargeManifest } from './workflow-large/manifest';
import { workflowMediumManifest } from './workflow-medium/manifest';
import { workflowSmallManifest } from './workflow-small/manifest';
import { workflowSpikeManifest } from './workflow-spike/manifest';

// The digits that pick forms' numbered choices, which the default keymap binds.
export { DIGITS } from './forms/manifest';
export { MAX_CANDIDATES } from './audio-picker/manifest';

// Every built-in plugin's manifest, each keeping its literal id, command ids
// and scopes in its type, which the default keymap is checked against.
export const builtInManifests = [
  sessionsManifest,
  formsManifest,
  primerManifest,
  audioPickerManifest,
  chatManifest,
  autoCompactManifest,
  sessionStashManifest,
  sessionLogManifest,
  autoRetroManifest,
  schedulingManifest,
  agentsManifest,
  agentLinesManifest,
  agentStripManifest,
  agentSkillsManifest,
  contextSourcesManifest,
  liveViewManifest,
  keysManifest,
  docsManifest,
  docsSessionTabManifest,
  galleryManifest,
  settingsManifest,
  scopedAgentsManifest,
  backlogManifest,
  notesManifest,
  practiceManifest,
  usageManifest,
  usageTabLineManifest,
  workflowManifest,
  workflowLargeManifest,
  workflowSpikeManifest,
  workflowSmallManifest,
  workflowMediumManifest,
  unityPoolManifest,
  systemStatsManifest,
  visualManifest,
  windowManifest,
  appUpdateManifest,
] as const;

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, and both processes' plugin hosts
// check each part's `dependsOn` against it, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = builtInManifests;
