import { definePlugin } from '../../shared/define-plugin';

// Live visuals: an agent's ```html code block drawn as a sandboxed frame
// wherever markdown renders. Its page part contributes the `html` fence,
// which draws the "drawing visual…" card while the block is open and the
// visual once it closes, each through the `layout` setting's visual layout.
// Its main part registers that layout contract and hands chat the session
// note that tells agents about visuals.
export const visualManifest = definePlugin({
  id: 'visual',
  dependsOn: ['chat', 'keys'],
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Visual layout',
      description:
        'The layout that draws each visual and its drawing card: a folder in the layouts/visual folder, or default.',
    },
  },
  themeTokens: {},
});
