// The docs view's pure state rules: the tree's visible rows and selection,
// what each tree key does on a row, the load-state chips and context
// choices, the editor's opening line, the fence a non-markdown file renders
// in, the changes the view applies before a build lists them, which docs may
// be renamed or trashed, the texts the view shows with their keys (the tree's
// line among them), and a hook's or plugin's detail fields.

import type { Paths } from '../../../contracts/paths';
import type {
  DocKind,
  IndexContext,
  IndexDocument,
  IndexEntry,
  IndexHarness,
  LoadState,
  LoadStateRecord,
} from '../contract';
import { metaString } from '../index-document';
import { skillFolder } from '../kinds';
import type { docsManifest } from '../manifest';
import type { TreeLeaf, TreeNode } from '../tree';

// The page keys bound now to a docs command in a docs scope, as the user
// reads them; null when none is.
export type DocsKeysFor = (
  command: keyof typeof docsManifest.commands,
  scope: keyof typeof docsManifest.scopes,
) => string | null;

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

// The first or last row's id; null when no row shows.
export function edgeSelection(
  rows: readonly TreeRow[],
  edge: 'first' | 'last',
): string | null {
  const row = edge === 'first' ? rows[0] : rows[rows.length - 1];
  return row?.node.id ?? null;
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

// The tree keys that act on the selected row: `l`, `h` and Enter.
export type TreeRowKey = 'open' | 'close' | 'toggle';

export type TreeRowAction =
  | { type: 'openLeaf'; focusDoc: boolean }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'select'; id: string }
  | { type: 'none' };

// What `key` does on `row`, one of the visible `rows`. A leaf opens on open
// or toggle, and toggle focuses the doc it opens. Open expands a collapsed
// group and steps into an expanded one's first shown child, the row after it.
// Close collapses an expanded group, else selects the row's parent. Toggle
// expands a collapsed group and collapses an expanded one. A filter shows
// every group expanded, so it collapses none: there toggle steps in as open
// does.
export function treeRowAction(
  tree: readonly TreeNode[],
  rows: readonly TreeRow[],
  row: TreeRow,
  filter: string,
  key: TreeRowKey,
): TreeRowAction {
  const { node } = row;
  const isCollapsible =
    node.type === 'group' && row.isExpanded && filter === '';
  if (key === 'close') {
    if (isCollapsible) {
      return { type: 'collapse' };
    }
    const parent = parentId(tree, node.id);
    return parent === null ? { type: 'none' } : { type: 'select', id: parent };
  }
  if (node.type === 'entry') {
    return { type: 'openLeaf', focusDoc: key === 'toggle' };
  }
  if (!row.isExpanded) {
    return { type: 'expand' };
  }
  if (key === 'toggle' && isCollapsible) {
    return { type: 'collapse' };
  }
  const next = rows[rows.findIndex((each) => each.node.id === node.id) + 1];
  const isShownChild = next !== undefined && next.depth > row.depth;
  return isShownChild ? { type: 'select', id: next.node.id } : { type: 'none' };
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
  paths: Paths,
): IndexContext[] {
  const isHome = (context: IndexContext) =>
    paths.samePath(context.folder, homeDir);
  const home = document.contexts.filter(isHome);
  const rest = document.contexts
    .filter((context) => !isHome(context))
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
// folder names the folder; a trash names every path that moved (a link's
// target and the link) and the path as asked once all moved.
export type DocChangeRecord =
  | { type: 'created'; entry: IndexEntry }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'trashed'; paths: readonly string[] };

// The document with the change applied, before any build sees it. A rename
// moves every entry at or inside `from`, its id and its states with it, and a
// title that was the old base name becomes the new one; a trash drops every
// entry at or inside any of its paths.
export function applyChange(
  document: IndexDocument,
  change: DocChangeRecord,
  paths: Paths,
): IndexDocument {
  switch (change.type) {
    case 'created': {
      const kept = document.entries.filter(
        (entry) => entry.id !== change.entry.id,
      );
      return { ...document, entries: [...kept, change.entry] };
    }
    case 'renamed':
      return renamedDocument(document, change.from, change.to, paths);
    case 'trashed':
      return {
        ...document,
        entries: document.entries.filter(
          (entry) =>
            !change.paths.some((path) => paths.isInside(entry.path, path)),
        ),
      };
  }
}

function renamedDocument(
  document: IndexDocument,
  from: string,
  to: string,
  paths: Paths,
): IndexDocument {
  const movedIds = new Map<string, string>();
  const oldName = paths.base(from);
  const entries = document.entries.map((entry) => {
    const below = paths.segmentsBelow(entry.path, from);
    if (below === null) {
      return entry;
    }
    const path = paths.join(to, ...below);
    // An id is its entry's path, with `#…` for an item inside the file.
    const id = entry.id.startsWith(entry.path)
      ? path + entry.id.slice(entry.path.length)
      : entry.id;
    movedIds.set(entry.id, id);
    return {
      ...entry,
      id,
      path,
      title: entry.title === oldName ? paths.base(to) : entry.title,
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

// The change applied again over a source run's document, which may already
// reflect it when the run scanned after the change's write: a created entry
// whose id the run lists keeps the run's entry, and a rename whose `to` the
// run lists is skipped, so a file made at `from` since stays there; a trash
// drops its paths' entries again, any the run still lists among them.
export function reapplyChange(
  document: IndexDocument,
  change: DocChangeRecord,
  paths: Paths,
): IndexDocument {
  const isReflected =
    (change.type === 'created' &&
      document.entries.some((entry) => entry.id === change.entry.id)) ||
    (change.type === 'renamed' &&
      document.entries.some((entry) => paths.isInside(entry.path, change.to)));
  return isReflected ? document : applyChange(document, change, paths);
}

// The paths a change made or moved, read from the document it produced
// (`next`, null when no document shows yet): a created doc's own path even
// then, a rename's only once a document lists what moved.
export function changedPaths(
  change: DocChangeRecord,
  next: IndexDocument | null,
  paths: Paths,
): string[] {
  switch (change.type) {
    case 'created':
      return [change.entry.path];
    case 'renamed':
      return (next?.entries ?? [])
        .filter((entry) => paths.isInside(entry.path, change.to))
        .map((entry) => entry.path);
    case 'trashed':
      return [];
  }
}

// The record of renaming the doc at `path` to the file `renamed`: a skill's
// rename moves its folder, so it names the folder before and after.
export function renameRecord(
  path: string,
  renamed: string,
  paths: Paths,
): Extract<DocChangeRecord, { type: 'renamed' }> {
  const skill = skillFolder(path, paths);
  return skill === null
    ? { type: 'renamed', from: path, to: renamed }
    : { type: 'renamed', from: skill, to: paths.parent(renamed) };
}

export const UNSAVED_TEXT = 'Unsaved changes — :w to save, :q! to discard';

// The plugin cache line, shown under the header and toasted on `i`.
export function readOnlyText(plugin: string): string {
  return `Plugin cache — ${plugin}. Edit the source repo's copy.`;
}

// Why a selected tree node may not be renamed or moved to the Trash.
export interface ChangeRefusal {
  text: string;
  tone: 'info' | 'error';
}

// The selected doc when it may be renamed or trashed, else why not; null when
// nothing is selected or its entry is gone. Refused: a group (`groupText`),
// an item inside a file (a line, a hook or a plugin), a plugin cache doc, and
// a doc whose file, or skill folder, holds a file in `unsavedPaths`.
export function changeableEntry(
  node: TreeNode | null,
  entryOf: (entryId: string) => IndexEntry | undefined,
  groupText: string,
  unsavedPaths: readonly string[],
  paths: Paths,
): { entry: IndexEntry } | { refusal: ChangeRefusal } | null {
  if (node === null) {
    return null;
  }
  if (node.type === 'group') {
    return { refusal: { text: groupText, tone: 'info' } };
  }
  const entry = entryOf(node.entryId);
  if (entry === undefined) {
    return null;
  }
  const isItemInFile =
    entry.line !== null || entry.kind === 'hook' || entry.kind === 'plugin';
  if (isItemInFile) {
    const text = `${entry.title} is an item inside ${paths.base(entry.path)}; it cannot be renamed or moved to the Trash alone`;
    return { refusal: { text, tone: 'info' } };
  }
  if (entry.source === 'plugin') {
    const text = readOnlyText(entry.plugin ?? entry.title);
    return { refusal: { text, tone: 'info' } };
  }
  const changed = skillFolder(entry.path, paths) ?? entry.path;
  if (unsavedPaths.some((path) => paths.isInside(path, changed))) {
    return { refusal: { text: UNSAVED_TEXT, tone: 'error' } };
  }
  return { entry };
}

// `<keys> <what>` for each bound key, joined by `separator`; an unbound key
// (null) drops out.
function keyHints(
  hints: readonly [string | null, string][],
  separator: string,
): string {
  return hints
    .filter((hint): hint is [string, string] => hint[0] !== null)
    .map(([keys, what]) => (what === '' ? keys : `${keys} ${what}`))
    .join(separator);
}

// The changed-on-disk prompt, each answer with its keys.
export function conflictText(keys: {
  reload: string | null;
  overwrite: string | null;
  cancel: string | null;
}): string {
  const hints = keyHints(
    [
      [keys.reload, 'reload'],
      [keys.overwrite, 'overwrite'],
      [keys.cancel, 'cancel'],
    ],
    ', ',
  );
  return hints === ''
    ? 'File changed on disk'
    : `File changed on disk — ${hints}`;
}

// The Trash question over what `trashTargets` named, its yes and no keys
// after it: one path by its base name, else the first target and its links
// by their paths, since they often share a name.
export function trashQuestion(
  targets: readonly string[],
  homeDir: string,
  keys: { yes: string | null; no: string | null },
  paths: Paths,
): string {
  const hints = keyHints(
    [
      [keys.yes, ''],
      [keys.no, ''],
    ],
    '/',
  );
  const [target, ...links] = targets;
  const linkNames = links.map((link) => paths.tilde(link, homeDir)).join(', ');
  const names =
    links.length === 0
      ? paths.base(target)
      : `${paths.tilde(target, homeDir)} and its ${links.length === 1 ? 'link' : 'links'} ${linkNames}`;
  const question = `Move ${names} to the Trash?`;
  return hints === '' ? question : `${question} ${hints}`;
}

// The toast when no place holds a kind, pointing at create by path's keys.
export function noPlaceText(
  kindTitle: string,
  createByPathKeys: string | null,
): string {
  const text = `No place holds a ${kindTitle} yet`;
  return createByPathKeys === null
    ? text
    : `${text} — ${createByPathKeys} creates a file by path`;
}

// One piece of a key hint: keys drawn as a Kbd, or words between them.
export type TreeLineHintPart = { keys: string } | { words: string };

// A line the tree pane shows: in place of its rows (`empty`) or above them.
export interface TreeLine {
  placement: 'empty' | 'above';
  text: string;
  hint: readonly TreeLineHintPart[];
}

export interface TreeLineState {
  hasTree: boolean;
  isIndexEmpty: boolean;
  filter: string;
  rowCount: number;
  isFilterOpen: boolean;
}

export interface TreeLineKeys {
  filter: string | null;
  clear: string | null;
  rescan: string | null;
}

// The line the tree pane shows for its state, with its keys; null for none.
export function treeLine(
  state: TreeLineState,
  keys: TreeLineKeys,
): TreeLine | null {
  if (!state.hasTree) {
    return null;
  }
  if (state.isIndexEmpty) {
    return {
      placement: 'empty',
      text: 'No docs in this index',
      hint:
        keys.rescan === null
          ? []
          : [{ keys: keys.rescan }, { words: 'to rescan' }],
    };
  }
  const isFiltered = state.filter !== '';
  if (isFiltered && state.rowCount === 0) {
    const { filter, clear } = keys;
    return {
      placement: 'empty',
      text: `No docs match "${state.filter}"`,
      hint:
        filter === null || clear === null
          ? []
          : [
              { keys: filter },
              { words: 'then' },
              { keys: clear },
              { words: 'to clear it' },
            ],
    };
  }
  if (isFiltered && !state.isFilterOpen) {
    return {
      placement: 'above',
      text: `Filtered: ${state.filter}`,
      hint:
        keys.filter === null
          ? []
          : [{ keys: keys.filter }, { words: 'to change it' }],
    };
  }
  return null;
}

const INSTRUCTION_NAMES = new Set([
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
]);

// The entry a new file gets until a build lists it: owned by the deepest
// `repo` or `features` root holding it (else global), its kind `kind` or,
// when null, guessed from the path.
export function provisionalEntry(
  path: string,
  kind: DocKind | null,
  entries: readonly IndexEntry[],
  paths: Paths,
): IndexEntry {
  const owner = owningEntry(path, entries, paths);
  const skill = skillFolder(path, paths);
  return {
    id: path,
    kind: kind ?? guessedKind(path, skill, owner, paths),
    source: owner?.source ?? 'global',
    repo: owner?.repo ?? null,
    root: owner?.root ?? null,
    plugin: null,
    path,
    line: null,
    title: skill === null ? paths.base(path) : paths.base(skill),
    meta: {},
    walked: [],
  };
}

function owningEntry(
  path: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): IndexEntry | null {
  let owner: IndexEntry | null = null;
  let ownerRoot = '';
  for (const entry of entries) {
    const { root } = entry;
    const ownsFolder = entry.source === 'repo' || entry.source === 'features';
    const holdsPath = root !== null && ownsFolder && paths.isInside(path, root);
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
  paths: Paths,
): DocKind {
  if (skill !== null) {
    return 'skill';
  }
  const folders = folderNames(path, paths);
  const inFolder = (name: string): boolean =>
    folders.some((folder) => paths.samePath(folder, name));
  if (inFolder('rules')) {
    return 'rule';
  }
  if (inFolder('agents')) {
    return 'subagent';
  }
  if (inFolder('commands')) {
    return 'command';
  }
  if (INSTRUCTION_NAMES.has(paths.base(path))) {
    return 'instructions';
  }
  return owner?.source === 'features' ? 'feature-doc' : 'reference';
}

// The name of each folder holding `path`, nearest first.
function folderNames(path: string, paths: Paths): string[] {
  const names: string[] = [];
  let folder = paths.parent(path);
  while (paths.base(folder) !== '') {
    names.push(paths.base(folder));
    folder = paths.parent(folder);
  }
  return names;
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
  paths: Paths,
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
    ['Installs', installsText(entry.meta.installs, homeDir, paths)],
  ];
}

function installsText(
  installs: unknown,
  homeDir: string,
  paths: Paths,
): string {
  if (!Array.isArray(installs) || installs.length === 0) {
    return NO_VALUE;
  }
  return installs
    .map((install: { scope?: unknown; projectPath?: unknown }) => {
      const scope = String(install.scope);
      return typeof install.projectPath === 'string'
        ? `${scope} · ${paths.tilde(install.projectPath, homeDir)}`
        : scope;
    })
    .join(', ');
}
