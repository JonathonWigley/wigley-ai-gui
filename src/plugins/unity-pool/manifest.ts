import { definePlugin } from '../../shared/define-plugin';

// The unity-pool view: which pool clone each session holds or waits for, as a badge on its sidebar row, and every
// clone of the shown session's pool in a right-bar panel with Hold and Release buttons, read from unity-pool's state
// files and changed only through its CLI. Its commands are the panel's clicks, each naming what it acts on, so none
// has a key: Hold and Release a clone, and a holder's label selecting that session's row. It names `sessions` for the rows it badges and the sessions it matches, and
// `chat` for its self-test's launch.
export const unityPoolManifest = definePlugin({
  id: 'unity-pool',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    hold: {
      label: 'hold the clone',
      group: 'pool',
      runsIn: 'page',
      arg: { pool: 'string', clone: 'number' },
    },
    release: {
      label: 'release the clone',
      group: 'pool',
      runsIn: 'page',
      arg: { pool: 'string', clone: 'number' },
    },
    selectHolder: {
      label: "show the holder's session",
      group: 'pool',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {},
  settings: { scriptPath: '', pythonCommand: 'python3', layout: 'default' },
  settingInfo: {
    scriptPath: {
      label: 'unity-pool command',
      description:
        "The unity-pool script the panel's Hold and Release buttons run with the Python command. ~ is the home folder. Empty, it is ~/.local/bin/unity-pool, and on Windows ~/wigley-agents/tools/unity-pool/unity-pool, since a Windows install writes launchers, not a symlink Python can run.",
    },
    pythonCommand: {
      label: 'Python command',
      description:
        'The Python the unity-pool script runs with: python3, or py or python on a Windows install with no python3.',
    },
    layout: {
      label: 'Layout',
      description:
        "The unity-pool layout the row badge and the right-bar panel draw in: a folder name in unity-pool's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
