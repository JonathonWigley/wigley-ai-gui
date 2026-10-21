// The docs view's pure state rules: the tree's visible rows and selection,
// the load-state chips and context choices, the editor's opening line and
// the fence a non-markdown file renders in.

import type {
  IndexContext,
  IndexDocument,
  IndexHarness,
  LoadState,
  LoadStateRecord,
} from '../contract';
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
