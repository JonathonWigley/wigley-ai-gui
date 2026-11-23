import type { MainPart, PluginManifest } from '../contracts/plugin';
import { agentCommandsManifest } from './agent-commands/manifest';
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
import { chatroomManifest } from './chatroom/manifest';
import { claudeCodeManifest } from './claude-code/manifest';
import { demoManifest } from './demo/manifest';
import { docsManifest } from './docs/manifest';
import { docsSessionTabManifest } from './docs-session-tab/manifest';
import { formsManifest } from './forms/manifest';
import { galleryManifest } from './gallery/manifest';
import { keysManifest } from './keys/manifest';
import { liveViewManifest } from './live-view/manifest';
import { markdownBlocksManifest } from './markdown-blocks/manifest';
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
import { buildsManifest } from './builds/manifest';
import { buildsTeamcityManifest } from './builds-teamcity/manifest';
import { buildsLocalManifest } from './builds-local/manifest';
import { usageManifest } from './usage/manifest';
import { usageTabLineManifest } from './usage-tab-line/manifest';
import { visualManifest } from './visual/manifest';
import { windowManifest } from './window/manifest';
import { workManifest } from './work/manifest';
import { workBoardManifest } from './work-board/manifest';
import { workInboxManifest } from './work-inbox/manifest';
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
  claudeCodeManifest,
  formsManifest,
  agentCommandsManifest,
  primerManifest,
  audioPickerManifest,
  chatManifest,
  autoCompactManifest,
  sessionStashManifest,
  sessionLogManifest,
  autoRetroManifest,
  agentsManifest,
  agentLinesManifest,
  agentStripManifest,
  agentSkillsManifest,
  contextSourcesManifest,
  liveViewManifest,
  chatroomManifest,
  keysManifest,
  docsManifest,
  docsSessionTabManifest,
  galleryManifest,
  settingsManifest,
  scopedAgentsManifest,
  backlogManifest,
  workManifest,
  workInboxManifest,
  workBoardManifest,
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
  buildsManifest,
  buildsTeamcityManifest,
  buildsLocalManifest,
  systemStatsManifest,
  visualManifest,
  markdownBlocksManifest,
  // After every plugin that calls chat's `addInstructions`, so at quit it stops
  // first and never re-prepares its runs without their text.
  schedulingManifest,
  windowManifest,
  demoManifest,
  appUpdateManifest,
] as const;

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, and both processes' plugin hosts
// check each part's `dependsOn` against it, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = builtInManifests;

// The built-in plugins that run a real agent harness, which a run on the fake
// harness leaves out.
export const realHarnessPluginIds: readonly string[] = [claudeCodeManifest.id];

// `manifests` and `mainParts` without the plugins in `realHarnessPluginIds`
// when `isFake`, each in its input order; both unchanged otherwise.
export function withoutRealHarnessPlugins(
  manifests: readonly PluginManifest[],
  mainParts: readonly MainPart[],
  isFake: boolean,
): { manifests: readonly PluginManifest[]; mainParts: readonly MainPart[] } {
  if (!isFake) {
    return { manifests, mainParts };
  }
  const isKept = (manifest: PluginManifest) =>
    !realHarnessPluginIds.includes(manifest.id);
  return {
    manifests: manifests.filter(isKept),
    mainParts: mainParts.filter((part) => isKept(part.manifest)),
  };
}
