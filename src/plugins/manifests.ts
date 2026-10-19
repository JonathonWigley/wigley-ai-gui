import type { PluginManifest } from '../contracts/plugin';
import { formsManifest } from './forms/manifest';

// Every built-in plugin's manifest: main builds the served keymap, command
// labels and plugin settings from this list, so a plugin's main and page parts
// each need their manifest here.
export const manifests: readonly PluginManifest[] = [formsManifest];
