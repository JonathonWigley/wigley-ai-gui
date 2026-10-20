import type { PluginManifest } from '../contracts/plugin';
import { chatManifest } from './chat/manifest';
import { formsManifest } from './forms/manifest';
import { keysManifest } from './keys/manifest';
import { sessionsManifest } from './sessions/manifest';

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, and both processes' plugin hosts
// check each part's `dependsOn` against it, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = [
  sessionsManifest,
  formsManifest,
  chatManifest,
  keysManifest,
];
