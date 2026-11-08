// The docs view's pure state rules: the tree's visible rows and selection,
// what each tree key does on a row, the load-state chips and context
// choices, the editor's opening line, the fence a non-markdown file renders
// in, the changes the view applies before a build lists them, which docs may
// be renamed or trashed, the texts the view shows (the tree's line, with the
// command its hint anchors, among them), a hook's or plugin's detail fields,
// the read-only reasons, the plugin-source status texts and the tree's
// rollups.

import type { Disposable } from '../../../contracts/disposable';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PaneDirection } from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import { matchesSubstring } from '../../../shared/matches-substring';
import { codeUnitOrder } from '../code-unit-order';
import {
  type CloneStatus,
  type DocKind,
  type FileStatus,
  type IndexContext,
  type IndexDocument,
  type IndexEntry,
  type IndexHarness,
  type IndexHeading,
  type LoadState,
  type LoadStateRecord,
  type PluginStatusRead,
  UNSAVED_TEXT,
} from '../contract';
import {
  INDEX_HARNESSES,
  installedCopies,
  metaString,
} from '../index-document';
import { skillFolder } from '../kinds';
import type { docsManifest } from '../manifest';
import {
  MINE_ROOT_ID,
  STARRED_ROOT_ID,
  THIRD_PARTY_ROOT_ID,
  type TreeGroup,
  type TreeHeadingMatch,
  type TreeLeaf,
  type TreeNode,
} from '../tree';

// Names `element` as the anchor of a docs command's hint in a docs scope, as
// `api.keys.anchor` does, until the Disposable's `dispose`.
export type DocsAnchor = (
  element: HTMLElement,
  command: keyof typeof docsManifest.commands,
  options: {
    scope: keyof typeof docsManifest.scopes;
    label?: boolean | string;
  },
) => Disposable;

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

// The groups the first tree shows expanded: every root but Third-party
// (Starred and Mine among them), and each group child of Mine.
export function defaultExpandedIds(tree: readonly TreeNode[]): Set<string> {
  const expanded = new Set<string>();
  for (const root of tree) {
    if (root.id === THIRD_PARTY_ROOT_ID) {
      continue;
    }
    expanded.add(root.id);
    if (root.id === MINE_ROOT_ID && root.type === 'group') {
      for (const child of root.children) {
        if (child.type === 'group') {
          expanded.add(child.id);
        }
      }
    }
  }
  return expanded;
}

// `expanded` plus the Starred root when `next` shows it and a `previous` with
// rows did not, so a Starred group that first shows in a later tree starts
// expanded, and one back after an empty tree keeps its state; else `expanded`
// unchanged.
export function expandNewStarred(
  previous: readonly TreeNode[],
  next: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): ReadonlySet<string> {
  const hasStarred = (tree: readonly TreeNode[]) =>
    tree.some((root) => root.id === STARRED_ROOT_ID);
  const isStarredNew =
    previous.length > 0 && hasStarred(next) && !hasStarred(previous);
  return isStarredNew ? new Set([...expanded, STARRED_ROOT_ID]) : expanded;
}

// The id of every group in `tree`, at any depth.
export function groupIds(tree: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const pending = [...tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'group') {
      ids.add(node.id);
      pending.push(...node.children);
    }
  }
  return ids;
}

// `expanded` plus each group of `next` not in `seen`, the ids every earlier tree
// held, so a collapsed group stays collapsed, through a tree that dropped it too,
// and a new one starts expanded.
export function expandNewGroups(
  seen: ReadonlySet<string>,
  next: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): Set<string> {
  const result = new Set(expanded);
  for (const id of groupIds(next)) {
    if (!seen.has(id)) {
      result.add(id);
    }
  }
  return result;
}

// Unfiltered, a group's children show while it is expanded; a filter of only
// spaces is none. Filtered, only leaves whose title the filter fuzzily matches,
// whose path holds the trimmed filter, ignoring case, or with a matching
// section heading show, in the tree's order, under every group above them, each
// such group expanded: a fuzzy match over a full path or a doc's many headings
// matches almost any query. Each matching heading is a row after its leaf, one
// level deeper, and among a group's children a leaf that matches only by a
// heading comes last. A wiki link or label shows only unfiltered. `pathOf` and
// `headingsOf` read a leaf's entry, for the filter.
export function visibleRows(
  tree: readonly TreeNode[],
  state: TreeState,
  pathOf: (entryId: string) => string,
  headingsOf: (entryId: string) => readonly IndexHeading[],
  matcher: FuzzyMatcher,
): TreeRow[] {
  const { filter } = state;
  const matchesByName = (node: TreeLeaf) =>
    matcher.matches(filter, node.title) ||
    matchesSubstring(filter, pathOf(node.entryId));
  const shownRows = (nodes: readonly TreeNode[], depth: number): TreeRow[] =>
    nodes.flatMap((node) => {
      const isExpanded = node.type === 'group' && state.expanded.has(node.id);
      const children =
        node.type === 'group' && isExpanded
          ? shownRows(node.children, depth + 1)
          : [];
      return [{ node, depth, isExpanded }, ...children];
    });
  // Recursive: a filtered group's row shows only once its children are known
  // to hold a match.
  const matchedRows = (
    nodes: readonly TreeNode[],
    depth: number,
  ): TreeRow[] => {
    const rows: TreeRow[] = [];
    const headingOnlyRows: TreeRow[] = [];
    for (const node of nodes) {
      if (node.type === 'group') {
        const children = matchedRows(node.children, depth + 1);
        if (children.length > 0) {
          rows.push({ node, depth, isExpanded: true }, ...children);
        }
      } else if (node.type === 'entry') {
        const headings = headingMatches(
          node,
          headingsOf(node.entryId),
          filter,
        ).map((match) => ({
          node: match,
          depth: depth + 1,
          isExpanded: false,
        }));
        const isNamed = matchesByName(node);
        if (isNamed || headings.length > 0) {
          (isNamed ? rows : headingOnlyRows).push(
            { node, depth, isExpanded: false },
            ...headings,
          );
        }
      }
    }
    return [...rows, ...headingOnlyRows];
  };
  return filter.trim() === '' ? shownRows(tree, 0) : matchedRows(tree, 0);
}

// The leaf's headings holding the trimmed filter, ignoring case, in file order,
// less those that only repeat the leaf's title.
function headingMatches(
  leaf: TreeLeaf,
  headings: readonly IndexHeading[],
  filter: string,
): TreeHeadingMatch[] {
  const leafTitle = foldedTitle(leaf.title);
  return headings
    .filter(
      (heading) =>
        matchesSubstring(filter, heading.text) &&
        foldedTitle(heading.text) !== leafTitle,
    )
    .map((heading) => ({
      type: 'headingMatch',
      id: `${leaf.id}/heading:${heading.line}`,
      title: heading.text,
      entryId: leaf.entryId,
      line: heading.line,
      docTitle: leaf.title,
      leafId: leaf.id,
    }));
}

// A doc's title holds its raw `# ` line and a heading has the markers removed;
// lower-cased and with the markers removed, the two compare equal.
function foldedTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/\s*#+\s*$/, '');
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
  | { type: 'openWikiLink'; focusDoc: boolean }
  | { type: 'openHeading'; focusDoc: boolean }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'select'; id: string }
  | { type: 'none' };

// What `key` does on `row`, one of the visible `rows`. A leaf, a wiki link and
// a heading row open on open or toggle, and toggle focuses the doc; a label
// does nothing. Open expands a collapsed group and steps into an expanded one's
// first shown child, the row after it. Close collapses an expanded group,
// selects a heading row's leaf, else selects the row's parent. Toggle expands a
// collapsed group and collapses an expanded one. A filter shows every group
// expanded, so it collapses none: there toggle steps in as open does.
export function treeRowAction(
  tree: readonly TreeNode[],
  rows: readonly TreeRow[],
  row: TreeRow,
  filter: string,
  key: TreeRowKey,
): TreeRowAction {
  const { node } = row;
  const isCollapsible =
    node.type === 'group' && row.isExpanded && filter.trim() === '';
  if (key === 'close') {
    if (isCollapsible) {
      return { type: 'collapse' };
    }
    if (node.type === 'headingMatch') {
      return { type: 'select', id: node.leafId };
    }
    const parent = parentId(tree, node.id);
    return parent === null ? { type: 'none' } : { type: 'select', id: parent };
  }
  if (node.type === 'entry') {
    return { type: 'openLeaf', focusDoc: key === 'toggle' };
  }
  if (node.type === 'wikiLink') {
    return { type: 'openWikiLink', focusDoc: key === 'toggle' };
  }
  if (node.type === 'headingMatch') {
    return { type: 'openHeading', focusDoc: key === 'toggle' };
  }
  if (node.type === 'wikiLabel') {
    return { type: 'none' };
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
    .sort((a, b) => codeUnitOrder(a.folder, b.folder));
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
    // An id is its entry's path, with a suffix for an item inside the file.
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

// The id an entry at or inside `from` gets when `from` moves to `to`. Null
// when the move does not reach it.
export function movedEntryId(
  entryId: string,
  from: string,
  to: string,
  paths: Paths,
): string | null {
  const { path, suffix } = splitEntryId(entryId);
  const below = paths.segmentsBelow(path, from);
  return below === null ? null : paths.join(to, ...below) + suffix;
}

// True when the entry with this id is `path` or lies inside it.
export function isEntryIdInside(
  entryId: string,
  path: string,
  paths: Paths,
): boolean {
  return paths.isInside(splitEntryId(entryId).path, path);
}

// An entry id's item suffix, at the end of the id: `#L<line>` for an item
// inside a file, `#hook:<event>:<n>` for a hook.
const ENTRY_ID_SUFFIX = /#(?:L\d+|hook:[^#:]+:\d+)$/;

// An entry id split into the entry's path and its item suffix (empty for a
// whole file); a `#` the path itself holds stays in the path.
function splitEntryId(entryId: string): { path: string; suffix: string } {
  const suffix = ENTRY_ID_SUFFIX.exec(entryId)?.[0] ?? '';
  return {
    path: entryId.slice(0, entryId.length - suffix.length),
    suffix,
  };
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

export { UNSAVED_TEXT };

// Why a doc opens read-only: a third-party download (`plugin` null for a
// synced skill), or an installed copy of the user's plugin with no file in
// the clone.
export type ReadOnlyReason =
  | { type: 'downloaded'; plugin: string | null }
  | { type: 'installed'; plugin: string };

export function readOnlyReason(entry: IndexEntry): ReadOnlyReason | null {
  if (entry.owner === 'third-party') {
    return { type: 'downloaded', plugin: entry.plugin };
  }
  if (entry.source === 'plugin') {
    return { type: 'installed', plugin: entry.plugin ?? entry.title };
  }
  return null;
}

// The read-only line, shown under the header and toasted on `i`, `r` and `d`.
export function readOnlyText(reason: ReadOnlyReason): string {
  if (reason.type === 'installed') {
    return `Installed copy — ${reason.plugin}. Edits are lost on its next update.`;
  }
  const from = reason.plugin ?? 'synced skill';
  return `Downloaded copy — ${from}. Edits are lost on its next update.`;
}

// Why a selected tree node may not be renamed or moved to the Trash.
export interface ChangeRefusal {
  text: string;
  tone: 'info' | 'error';
}

// The selected doc when it may be renamed or trashed, else why not; null when
// nothing is selected or its entry is gone. Refused: any row but a leaf
// (`groupText`), an item inside a file (a line, a hook or a plugin), a read-only
// doc, and a doc whose file, or skill folder, holds a file in `unsavedPaths`.
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
  if (node.type !== 'entry') {
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
  const reason = readOnlyReason(entry);
  if (reason !== null) {
    return { refusal: { text: readOnlyText(reason), tone: 'info' } };
  }
  const changed = skillFolder(entry.path, paths) ?? entry.path;
  if (unsavedPaths.some((path) => paths.isInside(path, changed))) {
    return { refusal: { text: UNSAVED_TEXT, tone: 'error' } };
  }
  return { entry };
}

// The Trash question over what `trashTargets` named: one path by its base
// name, else the first target and its links by their paths, since they often
// share a name.
export function trashQuestion(
  targets: readonly string[],
  homeDir: string,
  paths: Paths,
): string {
  const [target, ...links] = targets;
  const linkNames = links.map((link) => paths.tilde(link, homeDir)).join(', ');
  const names =
    links.length === 0
      ? paths.base(target)
      : `${paths.tilde(target, homeDir)} and its ${links.length === 1 ? 'link' : 'links'} ${linkNames}`;
  return `Move ${names} to the Trash?`;
}

// The toast when no place holds a kind.
export function noPlaceText(kindTitle: string): string {
  return `No place holds a ${kindTitle} yet; create a file by path`;
}

// A line the tree pane shows: in place of its rows (`empty`) or above them;
// `hint` is the tree command whose keys the line anchors, then its words.
export interface TreeLine {
  placement: 'empty' | 'above';
  text: string;
  hint: { command: 'filter' | 'rescan'; words: string } | null;
}

export interface TreeLineState {
  hasTree: boolean;
  isIndexEmpty: boolean;
  filter: string;
  rowCount: number;
  isFilterOpen: boolean;
  isWikiView: boolean;
}

// The line the tree pane shows for its state; null for none.
export function treeLine(state: TreeLineState): TreeLine | null {
  if (!state.hasTree) {
    return null;
  }
  const isFiltered = state.filter.trim() !== '';
  if (isFiltered && state.rowCount === 0) {
    return {
      placement: 'empty',
      text: `No docs match "${state.filter}"`,
      hint: { command: 'filter', words: 'to change it' },
    };
  }
  if (state.isIndexEmpty) {
    return {
      placement: 'empty',
      text: state.isWikiView ? 'No pages in Main.md' : 'No docs in this index',
      hint: { command: 'rescan', words: 'to rescan' },
    };
  }
  if (isFiltered && !state.isFilterOpen) {
    return {
      placement: 'above',
      text: `Filtered: ${state.filter}`,
      hint: { command: 'filter', words: 'to change it' },
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

// The entry a new file gets until a build lists it: `mine`, sourced from the
// deepest `repo` or `features` root holding it (else global), carrying the
// plugin key of the deepest clone plugin folder holding it, its kind `kind`
// or, when null, guessed from the path; never loaded.
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
    owner: 'mine',
    repo: owner?.repo ?? null,
    root: owner?.root ?? null,
    plugin: holdingPluginKey(path, entries, paths),
    path,
    line: null,
    title: skill === null ? paths.base(path) : paths.base(skill),
    meta: {},
    walked: [],
    headings: [],
    links: [],
    lastLoaded: null,
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

// The key of the deepest plugin folder holding `path`: the common folder of
// one clone's `repo` entries carrying that key. Null when none holds it.
function holdingPluginKey(
  path: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): string | null {
  const byClonePlugin = new Map<string, { plugin: string; paths: string[] }>();
  for (const entry of entries) {
    if (entry.source !== 'repo' || entry.plugin === null) {
      continue;
    }
    const clonePlugin = `${entry.root ?? ''}|${entry.plugin}`;
    const known = byClonePlugin.get(clonePlugin);
    if (known === undefined) {
      byClonePlugin.set(clonePlugin, {
        plugin: entry.plugin,
        paths: [entry.path],
      });
    } else {
      known.paths.push(entry.path);
    }
  }
  let key: string | null = null;
  let keyFolder = '';
  for (const { plugin, paths: entryPaths } of byClonePlugin.values()) {
    const folder = paths.commonFolder(entryPaths);
    const holdsPath = folder !== null && paths.isInside(path, folder);
    if (holdsPath && folder.length > keyFolder.length) {
      key = plugin;
      keyFolder = folder;
    }
  }
  return key;
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

// Every clone's file statuses, by entry id.
export function fileStatuses(
  read: PluginStatusRead | null,
): Map<string, FileStatus> {
  const merged = new Map<string, FileStatus>();
  for (const clone of read?.clones ?? []) {
    for (const [entryId, status] of Object.entries(clone.files)) {
      merged.set(entryId, status);
    }
  }
  return merged;
}

// The status chips' texts for `entry`, in their fixed order.
export function statusTexts(
  entry: IndexEntry,
  status: FileStatus | undefined,
  loadedPlugins: Readonly<Record<string, string>>,
): string[] {
  const texts: string[] = [];
  if (status?.uncommitted === true) {
    texts.push('Uncommitted');
  }
  if (status?.unpushed === true) {
    texts.push('Unpushed');
  }
  for (const harness of INDEX_HARNESSES) {
    if (status?.notInstalled.includes(harness) === true) {
      texts.push(`Not installed · ${HARNESS_NAMES[harness]}`);
    }
  }
  if (isSessionStale(entry, loadedPlugins)) {
    texts.push('Session stale');
  }
  return texts;
}

// The session loaded a version of the entry's plugin other than its Claude
// copy's.
function isSessionStale(
  entry: IndexEntry,
  loadedPlugins: Readonly<Record<string, string>>,
): boolean {
  const { plugin } = entry;
  if (plugin === null || !Object.hasOwn(loadedPlugins, plugin)) {
    return false;
  }
  const claudeCopy = installedCopies(entry)?.find(
    (copy) => copy.harness === 'claude',
  );
  return (
    claudeCopy !== undefined && claudeCopy.version !== loadedPlugins[plugin]
  );
}

// How many of a group's leaves have each status.
export interface StatusCounts {
  uncommitted: number;
  unpushed: number;
  notInstalled: Record<IndexHarness, number>;
}

// `<n> uncommitted · <n> unpushed · <n> not installed for <harness>`, each
// part only when its count is above 0; null when every count is 0.
export function rollupText(counts: StatusCounts): string | null {
  const parts: [number, string][] = [
    [counts.uncommitted, 'uncommitted'],
    [counts.unpushed, 'unpushed'],
    ...INDEX_HARNESSES.map((harness): [number, string] => [
      counts.notInstalled[harness],
      `not installed for ${HARNESS_NAMES[harness]}`,
    ]),
  ];
  const shown = parts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${count} ${what}`);
  return shown.length === 0 ? null : shown.join(' · ');
}

// The clone's origin line when its last fetch failed; null otherwise.
export function fetchText(
  clone: CloneStatus,
  formatTime: (iso: string) => string,
): string | null {
  if (!clone.fetchFailed) {
    return null;
  }
  return clone.fetchedAt === null
    ? 'origin never fetched'
    : `origin as of ${formatTime(clone.fetchedAt)}`;
}

// A tree row's status: a leaf's mark, its status texts joined; a plugin,
// repo or clone group's detail, its leaves' rollup then its clone's origin
// line; a heading row's detail, its doc's title.
export interface TreeRowStatus {
  mark: string | null;
  detail: string | null;
}

export function treeRowStatus(
  node: TreeNode,
  textsOf: (entryId: string) => string[],
  files: ReadonlyMap<string, FileStatus>,
  clones: readonly CloneStatus[],
  formatTime: (iso: string) => string,
  paths: Paths,
): TreeRowStatus {
  if (node.type === 'entry') {
    const texts = textsOf(node.entryId);
    const mark = texts.length === 0 ? null : texts.join(' · ');
    return { mark, detail: null };
  }
  if (node.type === 'headingMatch') {
    return { mark: null, detail: node.docTitle };
  }
  if (node.type !== 'group') {
    return { mark: null, detail: null };
  }
  const { role } = node;
  if (role.type === 'other') {
    return { mark: null, detail: null };
  }
  const cloneRoot = role.type === 'plugin' ? null : role.clone;
  const clone =
    cloneRoot === null
      ? undefined
      : clones.find((each) => paths.samePath(each.root, cloneRoot));
  const parts = [
    rollupText(statusCounts(node, files)),
    clone === undefined ? null : fetchText(clone, formatTime),
  ].filter((part) => part !== null);
  return { mark: null, detail: parts.length === 0 ? null : parts.join(' · ') };
}

// The counts over the group's descendant leaves.
function statusCounts(
  group: TreeGroup,
  files: ReadonlyMap<string, FileStatus>,
): StatusCounts {
  const counts: StatusCounts = {
    uncommitted: 0,
    unpushed: 0,
    notInstalled: { claude: 0, codex: 0 },
  };
  const pending: TreeNode[] = [...group.children];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'group') {
      pending.push(...node.children);
      continue;
    }
    if (node.type !== 'entry') {
      continue;
    }
    const status = files.get(node.entryId);
    if (status === undefined) {
      continue;
    }
    counts.uncommitted += status.uncommitted ? 1 : 0;
    counts.unpushed += status.unpushed ? 1 : 0;
    for (const harness of status.notInstalled) {
      counts.notInstalled[harness] += 1;
    }
  }
  return counts;
}

export type DocsPaneScope = 'tree' | 'doc';

// The pane a focus move `direction` from `focused` lands on: `right` from the
// tree to the doc, `left` from the doc to the tree while `isTreeShown`; null
// for every other move, which leaves focus where it is.
export function paneFocusedBy(
  focused: DocsPaneScope,
  direction: PaneDirection,
  isTreeShown: boolean,
): DocsPaneScope | null {
  if (focused === 'tree' && direction === 'right') {
    return 'doc';
  }
  if (focused === 'doc' && direction === 'left' && isTreeShown) {
    return 'tree';
  }
  return null;
}
