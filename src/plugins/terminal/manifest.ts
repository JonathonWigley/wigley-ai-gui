import { definePlugin } from '../../shared/define-plugin';

// A shell for each session, run in the session host so it survives an app
// restart. Its main part starts each session's shell on first use, keeps its
// output and the `terminal.output` slot, adopts the host's shells at start,
// kills a shell when its row closes, and runs `terminal.type`, the agent's
// hand-off of a command line; it hands chat the session note that tells
// agents about it. Its page part draws each session's terminal in sessions'
// drawer, its header through the `layout` setting's terminal layout.
export const terminalManifest = definePlugin({
  id: 'terminal',
  label: 'Terminal',
  description:
    "A shell for each session, in a drawer under the session's tabs.",
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    type: {
      label: "type a command line into the calling session's terminal",
      group: 'terminal',
      runsIn: 'main',
      arg: 'string',
    },
    toggle: {
      label: "open or close the session's terminal",
      group: 'terminal',
      runsIn: 'page',
    },
    back: {
      label: 'leave the terminal for the session',
      group: 'terminal',
      runsIn: 'page',
    },
    restart: {
      label: "start a new shell in the session's exited terminal",
      group: 'terminal',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: { terminal: 'Terminal' },
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The terminal layout the drawer's header draws in: a folder name in terminal's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
