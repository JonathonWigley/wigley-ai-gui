// The docs index document (schema 1), as `docs_index.py` writes it; the
// marketplace's `plugins/wigley/scripts/docs-index/README.md` is its schema.

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
