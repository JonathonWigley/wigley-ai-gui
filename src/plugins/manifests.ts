import type { PluginManifest } from '../contracts/plugin';
import { backlogManifest } from './backlog/manifest';
import { chatManifest } from './chat/manifest';
import { docsManifest } from './docs/manifest';
import { formsManifest } from './forms/manifest';
import { galleryManifest } from './gallery/manifest';
import { keysManifest } from './keys/manifest';
import { primerManifest } from './primer/manifest';
import { sessionsManifest } from './sessions/manifest';
import { settingsManifest } from './settings/manifest';

// The digits that pick forms' numbered choices, which the default keymap binds.
export { DIGITS } from './forms/manifest';

// Every built-in plugin's manifest, each keeping its literal id, command ids
// and scopes in its type, which the default keymap is checked against.
export const builtInManifests = [
  sessionsManifest,
  formsManifest,
  primerManifest,
  chatManifest,
  keysManifest,
  docsManifest,
  galleryManifest,
  settingsManifest,
  backlogManifest,
] as const;

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, and both processes' plugin hosts
// check each part's `dependsOn` against it, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = builtInManifests;
