import { definePlugin } from '../../shared/define-plugin';

// Browses and edits every agent doc on the machine through the docs index.
// `scriptPath` names the `docs_index.py` to run; empty, the script is found
// through the wigley plugin's install in each Claude config folder.
export const docsManifest = definePlugin({
  id: 'docs',
  dependsOn: [],
  commands: {},
  scopes: {},
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: { scriptPath: '' },
});
