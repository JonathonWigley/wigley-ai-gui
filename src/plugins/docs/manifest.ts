import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';

// Browses and edits every agent doc on the machine through the docs index:
// Docs mode over the machine's index, and an index source per session that
// an `addView` caller shows (the `docs-session-tab` plugin). `scriptPath`
// names the `docs_index.py` to run; empty, the script is found through the
// wigley plugin's install in each Claude config folder. The page reads the
// session rows so a session source's place leaves with its row.
// `recentChangesLimit` caps the commits the Main page's Recent changes lists.
export const docsManifest = definePlugin({
  id: 'docs',
  label: 'Docs',
  description:
    'Adds Docs mode, to browse and edit every agent doc on the machine.',
  dependsOn: { main: ['sessions'], page: [] },
  reads: { main: [], page: ['sessions'] },
  commands: {
    showMode: {
      label: 'docs (again: toggle the tree)',
      group: 'modes',
      runsIn: 'page',
    },
    toggleTree: {
      label: 'hide or show the docs tree',
      group: 'view',
      runsIn: 'page',
    },
    treeDown: { label: 'next row', group: 'tree', runsIn: 'page' },
    treeUp: { label: 'previous row', group: 'tree', runsIn: 'page' },
    treeTop: { label: 'first row', group: 'tree', runsIn: 'page' },
    treeBottom: { label: 'last row', group: 'tree', runsIn: 'page' },
    treeOpen: {
      label: 'open, expand or step in',
      group: 'tree',
      runsIn: 'page',
    },
    treeToggle: {
      label: 'open and focus, expand or collapse',
      group: 'tree',
      runsIn: 'page',
    },
    treeClose: {
      label: 'collapse or go to the parent',
      group: 'tree',
      runsIn: 'page',
    },
    filter: {
      label: 'filter by title, path or heading',
      group: 'tree',
      runsIn: 'page',
    },
    rescan: { label: 'rescan the docs', group: 'tree', runsIn: 'page' },
    pickContext: {
      label: 'pick the load-state folder',
      group: 'tree',
      runsIn: 'page',
    },
    toggleStar: {
      label: 'star or unstar the doc',
      group: 'tree',
      runsIn: 'page',
    },
    toggleWikiView: {
      label: 'switch the sidebar between the wiki and All pages',
      group: 'view',
      runsIn: 'page',
    },
    // The commands below with a `viewId` are the clicks of one docs view: a
    // click acts in the view that drew what it clicked, the active one or not.
    switchTreeView: {
      label: 'switch this tree between the wiki and All pages',
      group: 'view',
      runsIn: 'page',
      arg: { viewId: 'string' },
    },
    openNode: {
      label: 'open this row',
      group: 'tree',
      runsIn: 'page',
      arg: { viewId: 'string', nodeId: 'string' },
    },
    followLink: {
      label: 'follow this link',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string', href: 'string', title: 'string' },
    },
    // `line` is 1-based, 0 for the doc's top.
    openDocAt: {
      label: 'go to this place',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string', path: 'string', line: 'number' },
    },
    openRecentPage: {
      label: 'open this recent page',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string', path: 'string' },
    },
    openListRow: {
      label: 'open this list row',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string', entryId: 'string' },
    },
    createMain: {
      label: 'create the Main page',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string' },
    },
    backToTree: { label: 'back to the tree', group: 'focus', runsIn: 'page' },
    scrollDown: { label: 'scroll down', group: 'doc', runsIn: 'page' },
    scrollUp: { label: 'scroll up', group: 'doc', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'doc', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'doc', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'doc',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'doc',
      runsIn: 'page',
    },
    scrollTop: { label: 'scroll to the top', group: 'doc', runsIn: 'page' },
    scrollEnd: { label: 'scroll to the end', group: 'doc', runsIn: 'page' },
    edit: { label: 'edit the doc', group: 'doc', runsIn: 'page' },
    editSection: { label: 'edit this section', group: 'doc', runsIn: 'page' },
    editSectionAt: {
      label: 'edit the section under its heading',
      group: 'doc',
      runsIn: 'page',
      arg: { viewId: 'string', anchor: 'string' },
    },
    prevSection: { label: 'previous section', group: 'doc', runsIn: 'page' },
    nextSection: { label: 'next section', group: 'doc', runsIn: 'page' },
    historyBack: { label: 'go back', group: 'doc', runsIn: 'page' },
    historyForward: { label: 'go forward', group: 'doc', runsIn: 'page' },
    openMain: { label: 'open the Main page', group: 'doc', runsIn: 'page' },
    listOpen: { label: 'open the row', group: 'doc', runsIn: 'page' },
    quitEditor: { label: 'close the editor', group: 'doc', runsIn: 'page' },
    conflictReload: {
      label: 'reload from disk',
      group: 'conflict',
      runsIn: 'page',
      risky: true,
    },
    conflictOverwrite: {
      label: 'overwrite the disk',
      group: 'conflict',
      runsIn: 'page',
      risky: true,
    },
    conflictCancel: {
      label: 'keep editing',
      group: 'conflict',
      runsIn: 'page',
    },
    ...LIST_PICKER_COMMANDS,
    boxComplete: { label: 'complete the path', group: 'box', runsIn: 'page' },
    boxAccept: { label: 'accept', group: 'box', runsIn: 'page' },
    boxCancel: { label: 'cancel', group: 'box', runsIn: 'page' },
    createByKind: { label: 'new doc by kind', group: 'change', runsIn: 'page' },
    createByPath: {
      label: 'new file by path',
      group: 'change',
      runsIn: 'page',
    },
    rename: { label: 'rename or move', group: 'change', runsIn: 'page' },
    trash: {
      label: 'move to the Trash',
      group: 'change',
      runsIn: 'page',
      risky: true,
    },
    confirmYes: {
      label: 'yes, move it to the Trash',
      group: 'confirm',
      runsIn: 'page',
      risky: true,
    },
    confirmNo: { label: 'keep it', group: 'confirm', runsIn: 'page' },
    asideDown: { label: 'next row', group: 'aside', runsIn: 'page' },
    asideUp: { label: 'previous row', group: 'aside', runsIn: 'page' },
    asideTop: { label: 'first row', group: 'aside', runsIn: 'page' },
    asideBottom: { label: 'last row', group: 'aside', runsIn: 'page' },
    asideOpen: {
      label: 'jump to the section or open the linking doc',
      group: 'aside',
      runsIn: 'page',
    },
    backToDoc: { label: 'back to the doc', group: 'focus', runsIn: 'page' },
    // A Trash button's click: the prompt of the view that drew it takes
    // `answer`, `yes` or `no`; the keys answer the active view's.
    answerConfirm: {
      label: 'answer this Trash prompt',
      group: 'confirm',
      runsIn: 'page',
      arg: { viewId: 'string', answer: 'string' },
      risky: true,
    },
  },
  scopes: {
    tree: 'In the docs tree',
    doc: 'In a doc',
    conflict: 'In the changed-on-disk prompt',
    picker: 'In a docs list',
    box: 'In a docs text box',
    confirm: 'In the Trash confirmation',
    aside: "In the doc's right column",
  },
  settings: { scriptPath: '', layout: 'default', recentChangesLimit: 10 },
  settingInfo: {
    scriptPath: {
      label: 'Docs index script',
      description:
        "The path to `docs_index.py`; empty finds the installed wigley plugin's copy. `~` is the home folder.",
    },
    layout: {
      label: 'Docs layout',
      description:
        'The layout the docs views draw with, a folder in ~/.config/wigley-ai-gui/layouts/docs/; default when unset.',
    },
    recentChangesLimit: {
      label: 'Recent changes',
      description: "How many commits the Main page's Recent changes lists.",
    },
  },
  themeTokens: {
    'aside-width': { kind: 'length', default: '240px' },
  },
});
