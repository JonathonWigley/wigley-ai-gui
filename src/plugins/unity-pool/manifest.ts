import { definePlugin } from '../../shared/define-plugin';

// The unity-pool view: which pool clone each session holds or waits for, as a badge on its sidebar row, and every
// clone of the shown session's pool in a right-bar panel with Hold and Release buttons, read from unity-pool's state
// files and changed only through its CLI. It names `sessions` for the rows it badges and the sessions it matches,
// `keys` for its layout's anchors, and `chat` for its self-test's launch.
export const unityPoolManifest = definePlugin({
  id: 'unity-pool',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions', 'keys'] },
  commands: {},
  scopes: {},
  settings: { scriptPath: '~/.local/bin/unity-pool', layout: 'default' },
  settingInfo: {
    scriptPath: {
      label: 'unity-pool command',
      description:
        "The unity-pool script the panel's Hold and Release buttons run with python3. ~ is the home folder.",
    },
    layout: {
      label: 'Layout',
      description:
        "The unity-pool layout the row badge and the right-bar panel draw in: a folder name in unity-pool's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
