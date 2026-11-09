import { definePlugin } from '../../shared/define-plugin';

// Live visuals: an agent's ```html code block drawn as a sandboxed frame
// wherever markdown renders. Its page part contributes the `html` fence,
// which draws the "drawing visual…" card while the block is open and the
// visual once it closes, each through the `layout` setting's visual layout,
// and the full-size overlay, which `v` opens on the focused chat entry's
// visuals and each visual's expand control on that visual. A visual takes the
// reading width until its agent marks it wide, or `w` or its widen control
// flips it. Its main part registers that layout contract and hands chat the
// session note that tells agents about visuals.
export const visualManifest = definePlugin({
  id: 'visual',
  label: 'Visuals',
  description:
    'Draws the html code blocks an agent writes as live visuals, with a full-size view.',
  dependsOn: { main: ['chat'], page: ['chat'] },
  reads: { main: [], page: [] },
  commands: {
    openVisuals: {
      label: "open the focused entry's visuals",
      group: 'visual',
      runsIn: 'page',
    },
    toggleWidth: {
      label: "widen or narrow the focused entry's visual",
      group: 'visual',
      runsIn: 'page',
    },
    nextVisual: { label: 'next visual', group: 'visual', runsIn: 'page' },
    prevVisual: { label: 'previous visual', group: 'visual', runsIn: 'page' },
    closeVisual: { label: 'close the visual', group: 'visual', runsIn: 'page' },
    expand: {
      label: 'expand the visual',
      group: 'visual',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: { overlay: 'In the visual overlay' },
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Visual layout',
      description:
        'The layout that draws each visual, its drawing card and the full-size overlay: a folder in the layouts/visual folder, or default.',
    },
  },
  themeTokens: {},
});
