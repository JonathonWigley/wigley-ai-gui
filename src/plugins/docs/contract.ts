// The docs index document (schema 5), as `docs_index.py` writes it (the
// marketplace's `plugins/wigley/scripts/docs-index/README.md` is its schema),
// and the docs plugin's channel between its main and page parts.

import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';

// The kinds and sources the app knows; an index entry may name others, which
// still load (`isKnownKind`, `isKnownSource`).
export type DocKind =
  | 'instructions'
  | 'reference'
  | 'learning'
  | 'rule'
  | 'skill'
  | 'skill-file'
  | 'subagent'
  | 'command'
  | 'prompt'
  | 'hook'
  | 'plugin'
  | 'annotation'
  | 'feature'
  | 'task'
  | 'plan'
  | 'feature-doc'
  | 'followup';

export type DocSource = 'global' | 'repo' | 'plugin' | 'features';

// `third-party`: a downloaded copy its next update or sync replaces.
export type DocOwner = 'mine' | 'third-party';

export type LoadState =
  | 'launch'
  | 'on-demand'
  | 'listed'
  | 'shadowed'
  | 'not-loaded';

export type IndexHarness = 'claude' | 'codex';

export interface LoadStateRecord {
  state: LoadState;
  reason: string;
}

export interface IndexHeading {
  level: number;
  text: string;
  // 1-based in the file.
  line: number;
}

export interface IndexLink {
  form: 'markdown' | 'section';
  // The source text of the reference, a line break in it reading as `\n`.
  raw: string;
  // The real path of the target file.
  target: string;
  // 1-based in the file.
  line: number;
  // The target heading's line, 1-based in the file; null when the link names a
  // file only.
  targetLine: number | null;
}

export interface IndexEntry {
  // The real path, with `#L<line>` for an item inside a file and
  // `#hook:<event>:<n>` for a hook.
  id: string;
  // A `DocKind`, or a kind the app does not know.
  kind: string;
  // A `DocSource`, or a source the app does not know.
  source: string;
  owner: DocOwner;
  // A string for `repo` and `features` entries.
  repo: string | null;
  // The clone, feature home or plugin install folder; a string for every
  // known source but `global`, and a string or null for a source the app does
  // not know.
  root: string | null;
  // `<plugin>@<marketplace>` for a `plugin` entry, and for a marketplace
  // clone's plugin file in a `repo` entry.
  plugin: string | null;
  path: string;
  // 1-based.
  line: number | null;
  title: string;
  meta: Record<string, unknown>;
  // Each path where the index's walk reached this entry through a link.
  walked: string[];
  headings: IndexHeading[];
  links: IndexLink[];
  // The transcript timestamp (ISO 8601) of the latest load of the entry; null
  // when no transcript read shows one. Machine-wide in the `machine` source,
  // the session's own in a `session:<id>` source.
  lastLoaded: string | null;
}

// One install merged into a marketplace clone's plugin file; `path` is the
// install's copy of the file.
export interface InstalledCopy {
  harness: IndexHarness;
  version: string;
  path: string;
}

export interface IndexContext {
  folder: string;
  sessionId: string | null;
  // `<plugin>@<marketplace>` → the version the session loaded; `{}` outside a
  // session.
  loadedPlugins: Record<string, string>;
  // Entry id → harness → its load state there.
  states: Record<string, Partial<Record<IndexHarness, LoadStateRecord>>>;
}

export interface IndexDocument {
  schemaVersion: 5;
  generatedAt: string;
  entries: IndexEntry[];
  contexts: IndexContext[];
}

// The kinds the user creates by kind.
export type CreateKind =
  | 'instructions'
  | 'rule'
  | 'skill'
  | 'subagent'
  | 'command'
  | 'learning'
  | 'reference'
  | 'feature-doc'
  | 'followup';

// A folder a doc of some kind may be created in.
export interface CreatePlace {
  title: string;
  folder: string;
  source: DocSource;
}

// One entry of a folder's one-level listing.
export interface FolderEntry {
  name: string;
  isFolder: boolean;
}

// What one run of an index source gives the view: the document to show
// (null: none) and a line to show above the tree (null: none).
export interface IndexLoad {
  document: IndexDocument | null;
  message: string | null;
}

// The id the docs main part registers the machine index under; Docs mode
// shows it.
export const MACHINE_SOURCE_ID = 'machine';

const SESSION_SOURCE_PREFIX = 'session:';

// The id the docs main part registers a session's index under, by the
// session row's id; the `docs-session-tab` plugin's Docs tab shows it.
export function sessionSourceId(sessionId: string): string {
  return `${SESSION_SOURCE_PREFIX}${sessionId}`;
}

// The session row id `sessionSourceId` built `sourceId` from; null for any
// other source id.
export function sessionIdOfSource(sourceId: string): string | null {
  return sourceId.startsWith(SESSION_SOURCE_PREFIX)
    ? sourceId.slice(SESSION_SOURCE_PREFIX.length)
    : null;
}

// A docs index the page shows a view over, registered by `id` in the docs main
// part. `rebuild`, when present, refreshes the index before reading it.
export interface IndexSource {
  id: string;
  title: string;
  load(): Promise<IndexLoad>;
  rebuild?(): Promise<IndexLoad>;
}

// One source's load or rebuild, with that source's title and whether it has a
// `rebuild`.
export interface SourceRead extends IndexLoad {
  title: string;
  canRebuild: boolean;
}

// The docs main part's exports, each running the same code as the channel
// method of its name, except `addSource`, which has none, `machineIndex` and
// `rebuildMachineIndex`, which run `loadIndex` and `rebuildIndex` on the
// machine source, and `watchDoc`, which takes a callback. `addSource` throws
// on an id already registered; while the source is registered, the entries it
// last loaded allow changes to their docs. None of them emits `indexLoaded`.
// A source and a watch are filed under the dependent, so its stop disposes them,
// and a watch that lands after that stop closes at once.
export interface DocsMainExports {
  addSource(source: IndexSource): Disposable;
  // The machine index source's load, as Docs mode reads it.
  machineIndex(): Promise<SourceRead>;
  // The machine index source's rebuild.
  rebuildMachineIndex(): Promise<SourceRead>;
  readDoc(path: string): Promise<string>;
  // Guarded as the channel's `writeDoc`: the same refusals and changed-on-disk
  // check; `expectedText` null overwrites whatever is on disk.
  writeDoc(
    path: string,
    text: string,
    expectedText: string | null,
  ): Promise<WriteResult>;
  // Guarded as `writeDoc`, with no changed-on-disk check.
  writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>;
  // The channel's `trashDoc`.
  trashDoc(path: string): Promise<TrashResult>;
  // Calls `changed` after the file at `path` changes or is replaced, until
  // `dispose`.
  watchDoc(path: string, changed: () => void): Promise<Disposable>;
}

export const docsMainKey: DependencyKey<DocsMainExports, 'main', 'docs'> = {
  id: 'docs',
  process: 'main',
};

// `indexLoaded`: a `loadIndex` or `rebuildIndex` channel call (the page's
// own reads) finished reading the source `sourceId`.
// `docSaved`: text or bytes written, by the page or an export. A write that
// finds the file changed on disk saved nothing and fires none.
// `docCreated`, `docRenamed`: the page's create or rename landed; `to` is the
// path the doc now has.
// `docTrashed`: a trash moved `trashed`; a partial trash fires for what went, and
// one that moved nothing fires none.
export interface DocsMainEvents extends EventShape {
  indexLoaded: { sourceId: string };
  docSaved: { path: string };
  docCreated: { path: string };
  docTrashed: { path: string; trashed: string[] };
  docRenamed: { from: string; to: string };
}

// `docOpened`: a docs view showed the doc at `path`. A refused or failed open
// fires none, and neither does a close or the open doc moving.
export interface DocsPageEvents extends EventShape {
  docOpened: { path: string };
}

// One docs view `addView` handed out: `element` holds its tree and doc in a
// split. `shown` runs each time the caller shows the element (the view's
// first show reads its index); `hasUnsavedEdits` is the caller's close guard;
// `sourceReplaced` tells the view its source was registered again, rebuilding
// its index once it has shown and doing nothing before; `dispose` takes the
// view out of the docs plugin.
export interface DocsViewHandle extends Disposable {
  element: HTMLElement;
  shown(): void;
  hasUnsavedEdits(): boolean;
  sourceReplaced(): void;
}

// The toast a docs view, or a caller's close guard over one, shows when
// unsaved edits refuse a change.
export const UNSAVED_TEXT = 'Unsaved changes — :w to save, :q! to discard';

// The docs page part's exports. `addView` builds a docs view over the index
// source registered as `sourceId`, its keys active while `isVisible`, filed
// under the dependent, so its stop disposes the view.
// `openDoc` shows Docs mode and opens `path` there at the 1-based `line`. When
// the machine index's first read does not list `path` and a rebuild is coming
// or running, it waits for that one rebuild; it toasts when the index still
// does not list `path`. A waiting request is dropped when a newer `openDoc` is
// asked meanwhile.
export interface DocsPageExports {
  addView(sourceId: string, options: { isVisible(): boolean }): DocsViewHandle;
  openDoc(path: string, line?: number): void;
}

// Opens the section whose heading carries `anchor`, in the docs view `viewId`,
// as a section's `edit` control does.
export const docsEditSectionAtCommand: CommandKey<
  { viewId: string; anchor: string },
  'docs.editSectionAt'
> = { id: 'docs.editSectionAt' };

// A click in the docs view `viewId`, each acting in that view.
export const docsOpenNodeCommand: CommandKey<
  { viewId: string; nodeId: string },
  'docs.openNode'
> = { id: 'docs.openNode' };

// A rendered link's `href` and its text.
export type DocsLinkClick = { viewId: string; href: string; title: string };

export const docsFollowLinkCommand: CommandKey<
  DocsLinkClick,
  'docs.followLink'
> = { id: 'docs.followLink' };

// A place in a doc a section link or an On this page or Linked from row names:
// `path` at the 1-based `line`, 0 for its top.
export type DocsDocAtClick = { viewId: string; path: string; line: number };

export const docsOpenDocAtCommand: CommandKey<
  DocsDocAtClick,
  'docs.openDocAt'
> = { id: 'docs.openDocAt' };

// A Recent changes page's click: the doc at `path`, read again when shown.
export const docsOpenRecentPageCommand: CommandKey<
  { viewId: string; path: string },
  'docs.openRecentPage'
> = { id: 'docs.openRecentPage' };

export const docsSwitchTreeViewCommand: CommandKey<
  { viewId: string },
  'docs.switchTreeView'
> = { id: 'docs.switchTreeView' };

export const docsOpenListRowCommand: CommandKey<
  { viewId: string; entryId: string },
  'docs.openListRow'
> = { id: 'docs.openListRow' };

export const docsCreateMainCommand: CommandKey<
  { viewId: string },
  'docs.createMain'
> = { id: 'docs.createMain' };

// A Trash button's click: the prompt of the docs view `viewId` takes `answer`,
// `yes` or `no`.
export const docsAnswerConfirmCommand: CommandKey<
  { viewId: string; answer: string },
  'docs.answerConfirm'
> = { id: 'docs.answerConfirm' };

export const docsPageKey: DependencyKey<DocsPageExports, 'page', 'docs'> = {
  id: 'docs',
  process: 'page',
};

export type WriteResult =
  | { type: 'written' }
  | { type: 'changedOnDisk'; diskText: string };

export type CreateRequest =
  | { type: 'kind'; kind: CreateKind; place: CreatePlace; name: string }
  | { type: 'path'; path: string };

export interface CreatedDoc {
  path: string;
  // 1-based: where the editor opens on the new file.
  line: number;
}

// What `trashDoc` moved to the Trash: every path that went, and the path as
// asked once all went. `error` is a later move's failure after the first
// went; null when all went.
export interface TrashResult {
  trashed: string[];
  error: string | null;
}

// One file's git statuses: changed from HEAD, HEAD ahead of its upstream, and
// each harness whose installed copy differs from the upstream's file.
export interface FileStatus {
  uncommitted: boolean;
  unpushed: boolean;
  notInstalled: IndexHarness[];
}

// One marketplace clone's statuses. `files` is keyed by entry id and holds
// only entries with a status set; `fetchedAt` is the clone's last fetch (ISO),
// null when never fetched.
export interface CloneStatus {
  root: string;
  fetchedAt: string | null;
  fetchFailed: boolean;
  files: Record<string, FileStatus>;
}

export interface PluginStatusRead {
  clones: CloneStatus[];
}

// One commit touching docs `recentChanges` was asked about. `at` is the
// committer date in ISO 8601 with its offset; `paths` are real paths.
export interface RecentChange {
  sha: string;
  subject: string;
  at: string;
  paths: string[];
}

export interface DocChange {
  // The watch id `watchDoc` was given: a view's id, or `<viewId>:main`.
  viewId: string;
  path: string;
}

// Every method rejects with main's own error text when its handler throws.
export interface DocsChannel extends ChannelShape {
  invoke: {
    // Each rejects `No docs index source <sourceId>` for an id not registered.
    loadIndex(sourceId: string): Promise<SourceRead>;
    // Runs the source's `rebuild`, or its `load` when it has none.
    rebuildIndex(sourceId: string): Promise<SourceRead>;
    readDoc(path: string): Promise<string>;
    // `readDoc`, null when nothing is at `path`; any other failure rejects.
    readDocIfPresent(path: string): Promise<string | null>;
    // The wiki's `Main.md` with every link resolved, whether or not it exists.
    wikiMainPath(): Promise<string>;
    // `expectedText` null overwrites whatever is on disk.
    writeDoc(
      path: string,
      text: string,
      expectedText: string | null,
    ): Promise<WriteResult>;
    // Guarded as `writeDoc`, with no changed-on-disk check; makes the folders
    // `path` needs.
    writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>;
    createDoc(request: CreateRequest): Promise<CreatedDoc>;
    // The path the doc now has.
    renameDoc(from: string, to: string): Promise<string>;
    // What `trashDoc(path)` would move to the Trash, in order: the real file
    // or folder (a skill's whole folder for its `SKILL.md`; a chain of links'
    // final target, a link in between staying), then the path itself, its
    // folder resolved, when that is a link.
    trashTargets(path: string): Promise<string[]>;
    // Moves `trashTargets(path)` in order. Rejects when nothing moved;
    // otherwise names what moved, the path as asked among them once all went
    // (it can differ from those through a linked folder), and the failure
    // that stopped the rest.
    trashDoc(path: string): Promise<TrashResult>;
    listFolder(folder: string): Promise<FolderEntry[]>;
    // One watched file per watch id; `path` null stops that watch.
    watchDoc(viewId: string, path: string | null): Promise<void>;
    unwatchAll(): Promise<void>;
    // The config file that lists plugin `key` (`<plugin>@<marketplace>`) and
    // the 1-based line holding it; null when none lists it.
    pluginConfigFile(
      key: string,
      harness: IndexHarness,
    ): Promise<{ path: string; line: number } | null>;
    // The git statuses of the marketplace clones among the source's entries;
    // `fetch` runs a capped `git fetch` in each clone first. Rejects
    // `No docs index source <sourceId>` for an id not registered.
    pluginStatus(sourceId: string, fetch: boolean): Promise<PluginStatusRead>;
    // At most `recentChangesLimit` commits touching `paths`, real or linked,
    // newest first; what git cannot read is left out. Never rejects.
    recentChanges(paths: string[]): Promise<RecentChange[]>;
  };
  messages: {
    docChanged: DocChange;
    // Asks the page to run its `openDoc` export; `line` is 1-based.
    openDoc: { path: string; line: number | null };
  };
}

// An open editor's unsaved edits: the whole file's text as the editor holds it,
// and `baseText`, the file's text the edits were made over.
export interface DocsEdits {
  path: string;
  text: string;
  baseText: string;
}

// Where the user was in one docs view, so a page reload puts them back: the
// open doc, the tree's expanded group ids, selected row and filter, and the
// open editor's unsaved edits, null with none.
export interface DocsPlace {
  openPath: string | null;
  expanded: string[];
  selectedId: string | null;
  filter: string;
  edits: DocsEdits | null;
}

// Each docs view's place, by the source id the view shows: `MACHINE_SOURCE_ID`
// for Docs mode's, `sessionSourceId(sessionId)` for the `docs-session-tab`
// plugin's Docs tab in that session.
export const docsPlaceSlot: KeyedSlotKey<DocsPlace, 'page', 'docs'> = {
  id: 'docs.place',
  process: 'page',
  kind: 'keyed',
};
