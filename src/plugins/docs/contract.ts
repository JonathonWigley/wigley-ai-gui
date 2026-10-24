// The docs index document (schema 2), as `docs_index.py` writes it (the
// marketplace's `plugins/wigley/scripts/docs-index/README.md` is its schema),
// and the docs plugin's channel between its main and page parts.

import type { Disposable } from '../../contracts/disposable';
import type { ChannelShape } from '../../contracts/plugin';

// The kinds and sources the app knows; an index entry may name others, which
// still load (`isKnownKind`, `isKnownSource`).
export type DocKind =
  | 'instructions'
  | 'reference'
  | 'learning'
  | 'rule'
  | 'skill'
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

export interface IndexEntry {
  // The real path, with `#L<line>` for an item inside a file and
  // `#hook:<event>:<n>` for a hook.
  id: string;
  // A `DocKind`, or a kind the app does not know.
  kind: string;
  // A `DocSource`, or a source the app does not know.
  source: string;
  // A string for `repo` and `features` entries.
  repo: string | null;
  // The clone, feature home or plugin install folder; a string for every
  // known source but `global`, and a string or null for a source the app does
  // not know.
  root: string | null;
  // `<plugin>@<marketplace>` for a `plugin` entry.
  plugin: string | null;
  path: string;
  // 1-based.
  line: number | null;
  title: string;
  meta: Record<string, unknown>;
  // Each path where the index's walk reached this entry through a link.
  walked: string[];
}

export interface IndexContext {
  folder: string;
  sessionId: string | null;
  // Entry id → harness → its load state there.
  states: Record<string, Partial<Record<IndexHarness, LoadStateRecord>>>;
}

export interface IndexDocument {
  schemaVersion: 2;
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

// The id the docs main part registers a session's index under, by the
// session row's id; that session's Docs tab shows it.
export function sessionSourceId(sessionId: string): string {
  return `session:${sessionId}`;
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

// The docs main part's exports. `addSource` throws on an id already
// registered; while the source is registered, the entries it last loaded
// allow changes to their docs.
export interface DocsMainExports {
  addSource(source: IndexSource): Disposable;
}

// One docs view `addView` handed out: `element` holds its tree and doc in a
// split. `shown` runs each time the caller shows the element (the view's
// first show reads its index); `hasUnsavedEdits` is the caller's close guard;
// `dispose` takes the view out of the docs plugin.
export interface DocsViewHandle {
  element: HTMLElement;
  shown(): void;
  hasUnsavedEdits(): boolean;
  dispose(): void;
}

// The docs page part's exports. `addView` builds a docs view over the index
// source registered as `sourceId`, its keys active while `isVisible`.
// `openDoc` shows Docs mode and opens `path` there at the 1-based `line`. When
// the machine index's first read does not list `path` and a rebuild is coming
// or running, it waits for that one rebuild; it toasts when the index still
// does not list `path`.
export interface DocsPageExports {
  addView(sourceId: string, options: { isVisible(): boolean }): DocsViewHandle;
  openDoc(path: string, line?: number): void;
}

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

export interface DocChange {
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
    // `expectedText` null overwrites whatever is on disk.
    writeDoc(
      path: string,
      text: string,
      expectedText: string | null,
    ): Promise<WriteResult>;
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
    // One watched file per view; `path` null stops that view's watch.
    watchDoc(viewId: string, path: string | null): Promise<void>;
    unwatchAll(): Promise<void>;
    openExternal(url: string): Promise<void>;
    // The config file that lists plugin `key` (`<plugin>@<marketplace>`) and
    // the 1-based line holding it; null when none lists it.
    pluginConfigFile(
      key: string,
      harness: IndexHarness,
    ): Promise<{ path: string; line: number } | null>;
  };
  messages: {
    docChanged: DocChange;
    // Asks the page to run its `openDoc` export; `line` is 1-based.
    openDoc: { path: string; line: number | null };
  };
}
