// The docs index document (schema 1), as `docs_index.py` writes it (the
// marketplace's `plugins/wigley/scripts/docs-index/README.md` is its schema),
// and the docs plugin's channel between its main and page parts.

import type { ChannelShape } from '../../contracts/plugin';

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
  kind: DocKind;
  source: DocSource;
  // A string for `repo` and `features` entries.
  repo: string | null;
  // The clone, feature home or plugin install folder; a string for every
  // source but `global`.
  root: string | null;
  // `<plugin>@<marketplace>` for a `plugin` entry.
  plugin: string | null;
  path: string;
  // 1-based.
  line: number | null;
  title: string;
  meta: Record<string, unknown>;
}

export interface IndexContext {
  folder: string;
  sessionId: string | null;
  // Entry id → harness → its load state there.
  states: Record<string, Partial<Record<IndexHarness, LoadStateRecord>>>;
}

export interface IndexDocument {
  schemaVersion: 1;
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

// A session's Docs tab's source, from sessions' `sessionAdded` payload.
export interface SessionSourceSpec {
  hostSessionId: string | null;
  projectDir: string | null;
  harness: IndexHarness | null;
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
    machineIndex(): Promise<IndexLoad>;
    rebuild(): Promise<IndexLoad>;
    sessionIndex(spec: SessionSourceSpec): Promise<IndexLoad>;
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
  messages: { docChanged: DocChange };
}
