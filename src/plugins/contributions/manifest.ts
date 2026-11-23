import { definePlugin } from '../../shared/define-plugin';

// The contributions registry: reads the `auri.json` at the root of the app's
// own agent plugin and of every plugin a registered profile installs, and
// offers each section to the feature that registered a reader for its key. A
// main part serves the strategies; the page part adds one Settings control
// kind per feature and the workflow list's kind. It owns no command, layout or
// setting.
export const contributionsManifest = definePlugin({
  id: 'contributions',
  label: 'Contributions',
  description:
    "Reads each agent plugin's auri.json and offers its strategies to the app's features.",
  demoSkip:
    'It has no screen of its own; each feature it feeds shows its strategies.',
  dependsOn: { main: [], page: ['settings'] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
