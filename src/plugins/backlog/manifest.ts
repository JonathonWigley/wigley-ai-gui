import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';
import { strategyControlKind } from '../contributions/contract';
import type { RepoFolderSetting } from './contract';

// Backlog mode: one table of every repo's follow-ups, each one's staleness,
// and the chunks of them started as sessions; every follow-up edit goes
// through the Backlog assistant. `tags` is read for notes; `layout` names the
// layout Backlog draws with. `launchBrief` is what a chunk's session reads
// first; `repoFolders` gives the folder of each repo whose features home lies
// outside it; `strategy` names the backlog strategy whose homes, follow-up
// file and assistant text Backlog uses, `''` picking the only one installed. `selectRow` and `selectChunk` are the clicks on a table row and
// a chunk card, each naming its row or chunk, so neither has a key. The page
// runs sessions' `selectRow` by key to open a started chunk's session.
export const backlogManifest = definePlugin({
  id: 'backlog',
  label: 'Backlog',
  description:
    "Adds Backlog mode: every repo's follow-ups in one table, their staleness, and chunks started as sessions.",
  dependsOn: {
    main: ['docs', 'chat', 'sessions', 'scoped-agents', 'contributions'],
    page: ['docs', 'scoped-agents'],
  },
  reads: { main: [], page: ['sessions'] },
  commands: {
    showMode: { label: 'backlog', group: 'modes', runsIn: 'page' },
    listDown: { label: 'next row', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous row', group: 'list', runsIn: 'page' },
    listTop: { label: 'first row', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last row', group: 'list', runsIn: 'page' },
    activate: {
      label: "open the row's session, or the review",
      group: 'list',
      runsIn: 'page',
    },
    filter: {
      label: 'filter by title, one line or tag',
      group: 'list',
      runsIn: 'page',
    },
    rescan: { label: 'rescan the backlog', group: 'list', runsIn: 'page' },
    mark: { label: 'mark or unmark the row', group: 'chunks', runsIn: 'page' },
    addToChunk: {
      label: "add to the strip's chunk, or a new one",
      group: 'chunks',
      runsIn: 'page',
    },
    removeFromChunk: {
      label: 'take out of its chunk',
      group: 'chunks',
      runsIn: 'page',
    },
    renameChunk: { label: 'rename the chunk', group: 'chunks', runsIn: 'page' },
    startChunk: { label: 'start the chunk', group: 'chunks', runsIn: 'page' },
    startAllChunks: {
      label: 'start every shown unstarted chunk with titles',
      group: 'chunks',
      runsIn: 'page',
    },
    toggleHeadless: {
      label: "turn the chunk's headless on or off",
      group: 'chunks',
      runsIn: 'page',
    },
    sweep: {
      label: 'send the staleness sweep to the assistant',
      group: 'chunks',
      runsIn: 'page',
    },
    toggleDone: {
      label: 'show or hide done follow-ups',
      group: 'view',
      runsIn: 'page',
    },
    toggleAgentReadyOnly: {
      label: 'show only agent-ready follow-ups',
      group: 'view',
      runsIn: 'page',
    },
    toggleAssistant: {
      label: 'show or hide the assistant',
      group: 'view',
      runsIn: 'page',
    },
    pickRepo: { label: 'pick a repo', group: 'view', runsIn: 'page' },
    toggleChunkedHidden: {
      label: 'hide or show chunked rows',
      group: 'view',
      runsIn: 'page',
    },
    toggleStaleFirst: {
      label: 'sort stale first',
      group: 'view',
      runsIn: 'page',
    },
    openInDocs: { label: 'open in Docs mode', group: 'view', runsIn: 'page' },
    toggleCommits: {
      label: 'show or hide the commits since written',
      group: 'review',
      runsIn: 'page',
    },
    lineDown: { label: 'scroll a line down', group: 'review', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'review', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'review',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'review',
      runsIn: 'page',
    },
    scrollTop: { label: 'scroll to the top', group: 'review', runsIn: 'page' },
    scrollEnd: { label: 'scroll to the end', group: 'review', runsIn: 'page' },
    stripLeft: { label: 'previous chunk', group: 'strip', runsIn: 'page' },
    stripRight: { label: 'next chunk', group: 'strip', runsIn: 'page' },
    ...LIST_PICKER_COMMANDS,
    boxAccept: { label: 'accept', group: 'box', runsIn: 'page' },
    boxCancel: { label: 'cancel', group: 'box', runsIn: 'page' },
    selectRow: {
      label: 'select this row',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    selectChunk: {
      label: 'select this chunk',
      group: 'strip',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {
    table: 'In the backlog table',
    review: 'In the backlog review pane',
    strip: 'In the backlog chunk strip',
    box: 'In a backlog box',
    picker: 'In a backlog list picker',
  },
  settings: {
    tags: ['agent-ready', 'needs a feature plan'],
    layout: 'default',
    launchBrief:
      'Work these follow-ups in this session. First check each one against the code as it is now: remove an item whose work has landed, and rewrite an item the code has moved past. Then work the rest under your workflow, and report what you did with each item.',
    repoFolders: [] as RepoFolderSetting[],
    strategy: '',
  },
  settingControls: {
    layout: 'layout',
    strategy: strategyControlKind('backlog'),
  },
  settingInfo: {
    strategy: {
      label: 'Backlog plugin',
      description:
        'The plugin whose follow-up homes Backlog lists. Automatic picks the only one installed.',
    },
    tags: {
      label: 'Tags',
      description: 'The tags the notes popup offers a follow-up.',
    },
    layout: {
      label: 'Layout',
      description:
        "The Backlog layout: a folder name in backlog's layouts folder, or default.",
    },
    launchBrief: {
      label: 'Launch brief',
      description:
        "The text a chunk's session reads first, before the chunk's follow-ups.",
    },
    repoFolders: {
      label: 'Repo folders',
      description:
        'The folder each repo whose features home is outside the repo starts sessions in and resolves paths against: a list of { "repo", "folder" }.',
    },
  },
  themeTokens: {},
});
