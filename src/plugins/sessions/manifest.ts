import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';

// Agent sessions: the relay each one connects through, and Sessions mode, its
// sidebar of session rows beside chat panes, each showing one session's tabs.
// Its keys act in every scope; `idle` is the base scope while the focused pane
// shows no tab, `sidebar` while the Sessions list holds the keys (Alt+h past
// the leftmost pane), its cursor walking the session rows and its row keys
// acting on the cursor's row, `picker` is pushed while the list picker asks
// which session a new pane shows, and `rename` while the rename dialog shows.
// `layout` names the layout the side bar, the panes, the tab bars and the
// session popups draw with; `popup-top` places a session popup's top edge down
// its frame's body.
export const sessionsManifest = definePlugin({
  id: 'sessions',
  label: 'Sessions',
  description:
    'Adds Sessions mode, with a sidebar row for each agent session beside its panes and tabs.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {
    showMode: {
      label: 'Sessions mode · toggle the sidebar',
      group: 'sessions',
      runsIn: 'page',
    },
    nextSession: { label: 'next session', group: 'sessions', runsIn: 'page' },
    prevSession: {
      label: 'previous session',
      group: 'sessions',
      runsIn: 'page',
    },
    nextTab: { label: 'next tab', group: 'tabs', runsIn: 'page' },
    prevTab: { label: 'previous tab', group: 'tabs', runsIn: 'page' },
    closeSession: {
      label: 'close the session',
      group: 'sessions',
      runsIn: 'page',
      risky: true,
      targets: true,
    },
    selectRow: {
      label: 'open the session',
      group: 'sessions',
      runsIn: 'page',
      arg: 'string',
    },
    selectTab: {
      label: 'show the tab',
      group: 'sessions',
      runsIn: 'page',
      arg: { sessionId: 'string', tab: 'string' },
    },
    renameSession: {
      label: 'rename the session',
      group: 'sessions',
      runsIn: 'page',
      targets: true,
    },
    togglePopup: {
      label: "hide or show the session's popup",
      group: 'sessions',
      runsIn: 'page',
    },
    favoriteProject: {
      label: 'favorite or unfavorite the project',
      group: 'projects',
      runsIn: 'page',
    },
    favoriteProjectAt: {
      label: 'favorite or unfavorite the named project',
      group: 'projects',
      runsIn: 'page',
      arg: 'string',
    },
    moveProjectUp: {
      label: 'move the project up',
      group: 'projects',
      runsIn: 'page',
    },
    moveProjectDown: {
      label: 'move the project down',
      group: 'projects',
      runsIn: 'page',
    },
    listDown: { label: 'next session row', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous session row', group: 'list', runsIn: 'page' },
    listTop: { label: 'first session row', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last session row', group: 'list', runsIn: 'page' },
    listOpen: {
      label: 'show the session and focus its pane',
      group: 'list',
      runsIn: 'page',
    },
    listShow: {
      label: 'show the session, staying in the list',
      group: 'list',
      runsIn: 'page',
    },
    listBack: {
      label: 'back to the focused pane',
      group: 'list',
      runsIn: 'page',
    },
    listFavorite: {
      label: "favorite or unfavorite the row's project",
      group: 'list',
      runsIn: 'page',
    },
    listMoveUp: {
      label: "move the row's project up",
      group: 'list',
      runsIn: 'page',
    },
    listMoveDown: {
      label: "move the row's project down",
      group: 'list',
      runsIn: 'page',
    },
    listRename: {
      label: "rename the row's session",
      group: 'list',
      runsIn: 'page',
    },
    listClose: {
      label: "close the row's session",
      group: 'list',
      runsIn: 'page',
      risky: true,
    },
    splitDown: {
      label: 'split the pane, new pane below',
      group: 'panes',
      runsIn: 'page',
    },
    splitRight: {
      label: 'split the pane, new pane right',
      group: 'panes',
      runsIn: 'page',
    },
    closePane: {
      label: 'close the pane',
      group: 'panes',
      runsIn: 'page',
      risky: true,
    },
    swapPaneLeft: {
      label: 'swap with the pane on the left',
      group: 'panes',
      runsIn: 'page',
    },
    swapPaneRight: {
      label: 'swap with the pane on the right',
      group: 'panes',
      runsIn: 'page',
    },
    swapPaneUp: {
      label: 'swap with the pane above',
      group: 'panes',
      runsIn: 'page',
    },
    swapPaneDown: {
      label: 'swap with the pane below',
      group: 'panes',
      runsIn: 'page',
    },
    ...LIST_PICKER_COMMANDS,
    renameAccept: { label: 'rename', group: 'rename', runsIn: 'page' },
    renameCancel: { label: 'cancel', group: 'rename', runsIn: 'page' },
    openPreview: {
      label: 'show the layout preview rows',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {
    idle: 'Sessions',
    sidebar: 'In the sessions list',
    picker: 'In the sessions pane picker',
    rename: 'In the rename dialog',
  },
  settings: { layout: 'default', titleMaxLength: 30 },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The sessions layout Sessions mode's side bar, panes, tab bars, session popups and their hidden bar draw in: a folder name in sessions' layouts folder, or default.",
    },
    titleMaxLength: {
      label: 'Title length',
      description:
        'The most characters a session title may hold; longer titles from the agent or the rename dialog are refused, and a first-message title is cut.',
    },
  },
  themeTokens: {
    'popup-top': { kind: 'raw', default: '15%' },
  },
});
