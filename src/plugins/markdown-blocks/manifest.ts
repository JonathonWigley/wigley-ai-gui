import { definePlugin } from '../../shared/define-plugin';

// The `:::changes`, `:::tree` and `:::details` markdown blocks: a page-only
// plugin that adds them to the markdown service, so every markdown owner draws
// them. Forms and chat depend on it, which keeps it on while either runs. It
// owns no layout and no setting.
export const markdownBlocksManifest = definePlugin({
  id: 'markdown-blocks',
  label: 'Markdown blocks',
  description:
    'Draws the :::changes, :::tree and :::details blocks agents write in markdown.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
