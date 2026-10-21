// The docs view's pure state rules: the tree's visible rows and selection,
// the load-state chips and context choices, the editor's opening line, the
// fence a non-markdown file renders in, the changes the view applies before a
// build lists them, and a hook's or plugin's detail fields.

import type {
  DocKind,
  IndexContext,
  IndexDocument,
  IndexEntry,
  IndexHarness,
  LoadState,
  LoadStateRecord,
} from '../contract';
import { baseName, isInside, tildePath } from '../doc-paths';
import { metaString } from '../index-document';
import { skillFolder } from '../kinds';
import type { TreeLeaf, TreeNode } from '../tree';

export interface TreeRow {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
}

export interface TreeState {
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  filter: string;
}

export function rootIds(tree: readonly TreeNode[]): Set<string> {
  return new Set(tree.map((node) => node.id));
}

// Unfiltered, a group's children show while it is expanded. Filtered, only
// leaves whose title or path holds the filter (case-insensitive) show, under
// every group above them, each such group expanded. `pathOf` reads a leaf's
// entry path, for the filter.
export function visibleRows(
  tree: readonly TreeNode[],
  state: TreeState,
  pathOf: (entryId: string) => string,
): TreeRow[] {
  const needle = state.filter.toLowerCase();
  const matches = (node: TreeLeaf) =>
    node.title.toLowerCase().includes(needle) ||
    pathOf(node.entryId).toLowerCase().includes(needle);
  // Recursive: a filtered group's row shows only once its children are known
  // to hold a match.
  const rowsOf = (node: TreeNode, depth: number): TreeRow[] => {
    if (node.type === 'entry') {
      return needle === '' || matches(node)
        ? [{ node, depth, isExpanded: false }]
        : [];
    }
    if (needle === '') {
      const isExpanded = state.expanded.has(node.id);
      const children = isExpanded
        ? node.children.flatMap((child) => rowsOf(child, depth + 1))
        : [];
      return [{ node, depth, isExpanded }, ...children];
    }
    const children = node.children.flatMap((child) => rowsOf(child, depth + 1));
    return children.length === 0
      ? []
      : [{ node, depth, isExpanded: true }, ...children];
  };
  return tree.flatMap((node) => rowsOf(node, 0));
}

// The row id `by` rows from `selectedId` (clamped at both ends); the first
// row's id when `selectedId` is not shown; null when no row shows.
export function stepSelection(
  rows: readonly TreeRow[],
  selectedId: string | null,
  by: 1 | -1,
): string | null {
  if (rows.length === 0) {
    return null;
  }
  const index = rows.findIndex((row) => row.node.id === selectedId);
  if (index === -1) {
    return rows[0].node.id;
  }
  const next = Math.min(Math.max(index + by, 0), rows.length - 1);
  return rows[next].node.id;
}

// The id of the group holding `nodeId`, or null for a root (or an id the
// tree does not hold).
export function parentId(
  tree: readonly TreeNode[],
  nodeId: string,
): string | null {
  const pending: { node: TreeNode; parent: string | null }[] = tree.map(
    (node) => ({ node, parent: null }),
  );
  let item = pending.pop();
  while (item !== undefined) {
    if (item.node.id === nodeId) {
      return item.parent;
    }
    if (item.node.type === 'group') {
      const parent = item.node.id;
      for (const child of item.node.children) {
        pending.push({ node: child, parent });
      }
    }
    item = pending.pop();
  }
  return null;
}

// `state` is what the chip's colour keys on: the load state, `none` for a
// harness with no state, `pending` for an entry changed since the last build.
export interface Chip {
  text: string;
  tooltip: string;
  state: LoadState | 'none' | 'pending';
}

const HARNESS_NAMES: Record<IndexHarness, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

const PENDING_TOOLTIP = 'Changed since the last build';

export function chips(
  context: IndexContext | null,
  entryId: string,
  isPending: boolean,
): { claude: Chip; codex: Chip } {
  const states = context?.states[entryId] ?? {};
  return {
    claude: chip('claude', states.claude, isPending),
    codex: chip('codex', states.codex, isPending),
  };
}

function chip(
  harness: IndexHarness,
  record: LoadStateRecord | undefined,
  isPending: boolean,
): Chip {
  const name = HARNESS_NAMES[harness];
  if (isPending) {
    return {
      text: `${name} pending`,
      tooltip: PENDING_TOOLTIP,
      state: 'pending',
    };
  }
  if (record === undefined) {
    return { text: `${name} —`, tooltip: '', state: 'none' };
  }
  return {
    text: `${name} ${record.state}`,
    tooltip: record.reason,
    state: record.state,
  };
}

// Home folder's context first, then the rest by folder in code-unit order.
export function contextChoices(
  document: IndexDocument,
  homeDir: string,
): IndexContext[] {
  const home = document.contexts.filter(
    (context) => context.folder === homeDir,
  );
  const rest = document.contexts
    .filter((context) => context.folder !== homeDir)
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  return [...home, ...rest];
}

// 1-based source line of the top visible rendered block: the last of
// `blocks` (source line and top offset, in page order) whose top is ≤
// `scrollTop`, plus the frontmatter offset (`bodyStartLine - 1`);
// `bodyStartLine` when none is.
export function topVisibleLine(
  blocks: readonly { line: number; top: number }[],
  scrollTop: number,
  bodyStartLine: number,
): number {
  const above = blocks.filter((block) => block.top <= scrollTop);
  const top = above.at(-1);
  return top === undefined ? bodyStartLine : top.line + bodyStartLine - 1;
}

// The text a fenced block needs to show `text` whole: backticks one longer
// than its longest run, at least three.
export function codeFence(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = Math.max(0, ...runs.map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

// A change main made to the docs on disk. A rename or trash of a skill
// folder names the folder.
export type DocChangeRecord =
  | { type: 'created'; entry: IndexEntry }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'trashed'; path: string };

// The document with the change applied, before any build sees it. A rename
// moves every entry at or inside `from`, its id and its states with it, and a
// title that was the old base name becomes the new one; a trash drops every
// entry at or inside the path.
export function applyChange(
  document: IndexDocument,
  change: DocChangeRecord,
): IndexDocument {
  switch (change.type) {
    case 'created': {
      const kept = document.entries.filter(
        (entry) => entry.id !== change.entry.id,
      );
      return { ...document, entries: [...kept, change.entry] };
    }
    case 'renamed':
      return renamedDocument(document, change.from, change.to);
    case 'trashed':
      return {
        ...document,
        entries: document.entries.filter(
          (entry) => !isInside(entry.path, change.path),
        ),
      };
  }
}

function renamedDocument(
  document: IndexDocument,
  from: string,
  to: string,
): IndexDocument {
  const movedIds = new Map<string, string>();
  const oldName = baseName(from);
  const entries = document.entries.map((entry) => {
    if (!isInside(entry.path, from)) {
      return entry;
    }
    const id = entry.id.startsWith(from)
      ? to + entry.id.slice(from.length)
      : entry.id;
    movedIds.set(entry.id, id);
    return {
      ...entry,
      id,
      path: to + entry.path.slice(from.length),
      title: entry.title === oldName ? baseName(to) : entry.title,
    };
  });
  const contexts = document.contexts.map((context) => ({
    ...context,
    states: Object.fromEntries(
      Object.entries(context.states).map(([id, states]) => [
        movedIds.get(id) ?? id,
        states,
      ]),
    ),
  }));
  return { ...document, entries, contexts };
}

const INSTRUCTION_NAMES = new Set([
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
]);

// The entry a new file gets until a build lists it: owned by the deepest
// non-plugin root holding it (else global), its kind `kind` or, when null,
// guessed from the path.
export function provisionalEntry(
  path: string,
  kind: DocKind | null,
  entries: readonly IndexEntry[],
): IndexEntry {
  const owner = owningEntry(path, entries);
  const skill = skillFolder(path);
  return {
    id: path,
    kind: kind ?? guessedKind(path, skill, owner),
    source: owner?.source ?? 'global',
    repo: owner?.repo ?? null,
    root: owner?.root ?? null,
    plugin: null,
    path,
    line: null,
    title: skill === null ? baseName(path) : baseName(skill),
    meta: {},
  };
}

function owningEntry(
  path: string,
  entries: readonly IndexEntry[],
): IndexEntry | null {
  let owner: IndexEntry | null = null;
  let ownerRoot = '';
  for (const entry of entries) {
    const { root } = entry;
    const holdsPath =
      root !== null && entry.source !== 'plugin' && isInside(path, root);
    if (holdsPath && root.length > ownerRoot.length) {
      owner = entry;
      ownerRoot = root;
    }
  }
  return owner;
}

function guessedKind(
  path: string,
  skill: string | null,
  owner: IndexEntry | null,
): DocKind {
  if (skill !== null) {
    return 'skill';
  }
  if (path.includes('/rules/')) {
    return 'rule';
  }
  if (path.includes('/agents/')) {
    return 'subagent';
  }
  if (path.includes('/commands/')) {
    return 'command';
  }
  if (INSTRUCTION_NAMES.has(baseName(path))) {
    return 'instructions';
  }
  return owner?.source === 'features' ? 'feature-doc' : 'reference';
}

// The pending paths still waiting once a source run that started at change
// `settledSeq` lands: those changed after it.
export function settlePending(
  pending: ReadonlyMap<string, number>,
  settledSeq: number,
): Map<string, number> {
  return new Map([...pending].filter(([, seq]) => seq > settledSeq));
}

const NO_VALUE = '—';

// The field table a hook or plugin entry shows in place of a body; [] for
// any other kind.
export function detailFields(
  entry: IndexEntry,
  homeDir: string,
): [string, string][] {
  if (entry.kind === 'hook') {
    return [
      ['Event', metaString(entry, 'event') ?? NO_VALUE],
      ['Matcher', metaString(entry, 'matcher') ?? NO_VALUE],
      ['Command', metaString(entry, 'command') ?? NO_VALUE],
    ];
  }
  if (entry.kind !== 'plugin') {
    return [];
  }
  const harness = metaString(entry, 'harness');
  const enabled = entry.meta.enabled;
  return [
    [
      'Harness',
      harness === 'claude' || harness === 'codex'
        ? HARNESS_NAMES[harness]
        : NO_VALUE,
    ],
    ['Version', metaString(entry, 'version') ?? NO_VALUE],
    [
      'Enabled',
      typeof enabled === 'boolean' ? (enabled ? 'yes' : 'no') : NO_VALUE,
    ],
    ['Installs', installsText(entry.meta.installs, homeDir)],
  ];
}

function installsText(installs: unknown, homeDir: string): string {
  if (!Array.isArray(installs) || installs.length === 0) {
    return NO_VALUE;
  }
  return installs
    .map((install: { scope?: unknown; projectPath?: unknown }) => {
      const scope = String(install.scope);
      return typeof install.projectPath === 'string'
        ? `${scope} · ${tildePath(install.projectPath, homeDir)}`
        : scope;
    })
    .join(', ');
}
