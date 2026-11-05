import type { PluginManifest } from '../contracts/plugin';
import { agentLinesManifest } from './agent-lines/manifest';
import { agentSkillsManifest } from './agent-skills/manifest';
import { agentStripManifest } from './agent-strip/manifest';
import { agentsManifest } from './agents/manifest';
import { autoCompactManifest } from './auto-compact/manifest';
import { backlogManifest } from './backlog/manifest';
import { chatManifest } from './chat/manifest';
import { docsManifest } from './docs/manifest';
import { formsManifest } from './forms/manifest';
import { galleryManifest } from './gallery/manifest';
import { keysManifest } from './keys/manifest';
import { notesManifest } from './notes/manifest';
import { primerManifest } from './primer/manifest';
import { sessionLogManifest } from './session-log/manifest';
import { sessionsManifest } from './sessions/manifest';
import { settingsManifest } from './settings/manifest';
import { unityPoolManifest } from './unity-pool/manifest';
import { usageManifest } from './usage/manifest';
import { usageTabLineManifest } from './usage-tab-line/manifest';
import { visualManifest } from './visual/manifest';
import { windowManifest } from './window/manifest';
import { workflowManifest } from './workflow/manifest';
import { workflowHeavyManifest } from './workflow-heavy/manifest';
import { workflowLightManifest } from './workflow-light/manifest';
import { workflowMediumManifest } from './workflow-medium/manifest';

// The digits that pick forms' numbered choices, which the default keymap binds.
export { DIGITS } from './forms/manifest';

// Every built-in plugin's manifest, each keeping its literal id, command ids
// and scopes in its type, which the default keymap is checked against.
export const builtInManifests = [
  sessionsManifest,
  formsManifest,
  primerManifest,
  chatManifest,
  autoCompactManifest,
  sessionLogManifest,
  agentsManifest,
  agentLinesManifest,
  agentStripManifest,
  agentSkillsManifest,
  keysManifest,
  docsManifest,
  galleryManifest,
  settingsManifest,
  backlogManifest,
  notesManifest,
  usageManifest,
  usageTabLineManifest,
  workflowManifest,
  workflowHeavyManifest,
  workflowLightManifest,
  workflowMediumManifest,
  unityPoolManifest,
  visualManifest,
  windowManifest,
] as const;

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, and both processes' plugin hosts
// check each part's `dependsOn` against it, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = builtInManifests;
