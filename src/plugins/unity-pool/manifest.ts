import { definePlugin } from '../../shared/define-plugin';

// The unity-pool view: which pool clone each session holds or waits for, as a badge on its sidebar row, and every
// clone of the shown session's pool in a right-bar panel with Hold, Release and Open buttons, read from unity-pool's
// state files and changed only through its CLI. The panel is a right-bar stop: while it holds the keys, `j`/`k`/`gg`/
// `G` walk a cursor over its session holders and Enter shows the cursor's session. Its click commands each name what
// they act on, so none has a key: Hold, Release and Open a clone, and a holder's label selecting that session's row. It
// names `sessions` for the rows it badges and the sessions it matches, and `chat` for the pool provider it registers
// and its self-test's launch.
export const unityPoolManifest = definePlugin({
  id: 'unity-pool',
  label: 'Unity pool',
  description:
    'Shows which Unity pool clone each session holds, with Hold, Release and Open buttons.',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    cursorDown: { label: 'next session', group: 'panel', runsIn: 'page' },
    cursorUp: { label: 'previous session', group: 'panel', runsIn: 'page' },
    cursorTop: { label: 'first session', group: 'panel', runsIn: 'page' },
    cursorBottom: { label: 'last session', group: 'panel', runsIn: 'page' },
    showHolder: { label: 'show the session', group: 'panel', runsIn: 'page' },
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
    open: {
      label: 'open the clone in Unity',
      group: 'pool',
      runsIn: 'page',
      arg: { pool: 'string', clone: 'number' },
      risky: true,
    },
    selectHolder: {
      label: "show the holder's session",
      group: 'pool',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: { panel: 'In the Unity pool panel' },
  settings: { scriptPath: '', layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    scriptPath: {
      label: 'unity-pool command',
      description:
        "The unity-pool script the panel's Hold, Release and Open buttons run with the core programs.python Python; ~ is the home folder. Empty, the buttons run nothing and say no script is set.",
    },
    layout: {
      label: 'Layout',
      description:
        "The unity-pool layout the row badge and the right-bar panel draw in: a folder name in unity-pool's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
