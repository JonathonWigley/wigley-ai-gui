import { definePlugin } from '../../shared/define-plugin';

// Browses and edits every agent doc on the machine through the docs index:
// Docs mode over the machine's index and a Docs tab in each session over that
// session's. `scriptPath` names the `docs_index.py` to run; empty, the script
// is found through the wigley plugin's install in each Claude config folder.
export const docsManifest = definePlugin({
  id: 'docs',
  dependsOn: ['sessions', 'keys'],
  commands: {
    showMode: {
      label: 'docs (again: toggle the tree)',
      group: 'modes',
      runsIn: 'page',
    },
    treeDown: { label: 'next row', group: 'tree', runsIn: 'page' },
    treeUp: { label: 'previous row', group: 'tree', runsIn: 'page' },
    treeTop: { label: 'first row', group: 'tree', runsIn: 'page' },
    treeBottom: { label: 'last row', group: 'tree', runsIn: 'page' },
    treeOpen: { label: 'open or expand', group: 'tree', runsIn: 'page' },
    treeClose: {
      label: 'collapse or go to the parent',
      group: 'tree',
      runsIn: 'page',
    },
    filter: { label: 'filter by title or path', group: 'tree', runsIn: 'page' },
    rescan: { label: 'rescan the docs', group: 'tree', runsIn: 'page' },
    pickContext: {
      label: 'pick the load-state folder',
      group: 'tree',
      runsIn: 'page',
    },
    focusDoc: { label: 'focus the doc', group: 'focus', runsIn: 'page' },
    focusTree: { label: 'focus the tree', group: 'focus', runsIn: 'page' },
    scrollDown: { label: 'scroll down', group: 'doc', runsIn: 'page' },
    scrollUp: { label: 'scroll up', group: 'doc', runsIn: 'page' },
    edit: { label: 'edit the doc', group: 'doc', runsIn: 'page' },
    conflictReload: {
      label: 'reload from disk',
      group: 'conflict',
      runsIn: 'page',
    },
    conflictOverwrite: {
      label: 'overwrite the disk',
      group: 'conflict',
      runsIn: 'page',
    },
    conflictCancel: {
      label: 'keep editing',
      group: 'conflict',
      runsIn: 'page',
    },
    pickerDown: { label: 'next choice', group: 'picker', runsIn: 'page' },
    pickerUp: { label: 'previous choice', group: 'picker', runsIn: 'page' },
    pickerChoose: { label: 'choose', group: 'picker', runsIn: 'page' },
    pickerCancel: { label: 'cancel', group: 'picker', runsIn: 'page' },
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
    trash: { label: 'move to the Trash', group: 'change', runsIn: 'page' },
    confirmYes: {
      label: 'yes, move it to the Trash',
      group: 'confirm',
      runsIn: 'page',
    },
    confirmNo: { label: 'keep it', group: 'confirm', runsIn: 'page' },
  },
  scopes: {
    tree: 'In the docs tree',
    doc: 'In a doc',
    conflict: 'In the changed-on-disk prompt',
    picker: 'In a docs list',
    box: 'In a docs text box',
    confirm: 'In the Trash confirmation',
  },
  settings: { scriptPath: '' },
  themeTokens: {},
});
