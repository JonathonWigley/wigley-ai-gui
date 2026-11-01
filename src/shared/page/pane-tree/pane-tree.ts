// The pane tree: panes as leaves of nested two-way splits, each split holding
// its first child's share of its span. Pure; leaves are id strings the owner
// gives meaning to. Every function returns a new tree and leaves its input
// unchanged.
import type { PaneDirection } from '../../../contracts/panes';

// `row`: side by side, `first` on the left; `column`: stacked, `first` on top.
export type SplitAxis = 'row' | 'column';

export type PaneNode = { kind: 'leaf'; id: string } | PaneSplit;

// `ratio` is `first`'s share of the split's span, inside (0, 1).
export interface PaneSplit {
  kind: 'split';
  axis: SplitAxis;
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

// `focusedId` is always one of the tree's leaves.
export interface PaneTree {
  root: PaneNode;
  focusedId: string;
}

type Side = 'first' | 'second';

// A split on the way from the root to a leaf, and the side the leaf is in.
interface Step {
  split: PaneSplit;
  side: Side;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const TOLERANCE = 1e-9;

export function singlePane(id: string): PaneTree {
  return { root: { kind: 'leaf', id }, focusedId: id };
}

// Depth first, `first` before `second`.
export function leafIds(tree: PaneTree): string[] {
  return leavesOf(tree.root);
}

// Replaces the focused leaf with an even split of `axis`: the old leaf
// `first`, the new leaf `second` and focused. Throws when `newId` is already a
// leaf.
export function splitFocused(
  tree: PaneTree,
  axis: SplitAxis,
  newId: string,
): PaneTree {
  if (leafIds(tree).includes(newId)) {
    throw new Error(`Pane ${newId} is already in the pane tree`);
  }
  const split: PaneSplit = {
    kind: 'split',
    axis,
    ratio: 0.5,
    first: { kind: 'leaf', id: tree.focusedId },
    second: { kind: 'leaf', id: newId },
  };
  return {
    root: replacedAt(tree.root, stepsTo(tree, tree.focusedId), split),
    focusedId: newId,
  };
}

// Null when `id` is the only leaf. Otherwise the sibling subtree takes the
// parent split's place; a focused `id` hands focus to the sibling subtree's
// last leaf when `id` was `second`, its first leaf when `id` was `first`.
export function closePane(tree: PaneTree, id: string): PaneTree | null {
  const steps = stepsTo(tree, id);
  const parent = steps.at(-1);
  if (parent === undefined) {
    return null;
  }
  const sibling =
    parent.side === 'first' ? parent.split.second : parent.split.first;
  const root = replacedAt(tree.root, steps.slice(0, -1), sibling);
  if (tree.focusedId !== id) {
    return { root, focusedId: tree.focusedId };
  }
  const siblingLeaves = leavesOf(sibling);
  const focusedId =
    parent.side === 'second' ? siblingLeaves.at(-1) : siblingLeaves[0];
  return { root, focusedId: focusedId as string };
}

// The leaf across `id`'s `direction` edge that shares the most of that edge;
// on a tie the topmost for left and right, the leftmost for up and down. Null
// at the tree's edge.
export function paneToward(
  tree: PaneTree,
  id: string,
  direction: PaneDirection,
): string | null {
  const rects = leafRects(tree.root);
  const from = rects.get(id);
  if (from === undefined) {
    throw new Error(`Pane ${id} is not in the pane tree`);
  }
  const isAcross = direction === 'left' || direction === 'right';
  let best: { id: string; overlap: number; start: number } | null = null;
  for (const [candidateId, rect] of rects) {
    if (!touchesEdge(from, rect, direction)) {
      continue;
    }
    const start = isAcross ? rect.top : rect.left;
    const overlap = isAcross
      ? Math.min(from.bottom, rect.bottom) - Math.max(from.top, rect.top)
      : Math.min(from.right, rect.right) - Math.max(from.left, rect.left);
    if (overlap <= TOLERANCE) {
      continue;
    }
    const isLarger = best === null || overlap > best.overlap + TOLERANCE;
    const isEarlierTie =
      best !== null &&
      Math.abs(overlap - best.overlap) <= TOLERANCE &&
      start < best.start;
    if (isLarger || isEarlierTie) {
      best = { id: candidateId, overlap, start };
    }
  }
  return best?.id ?? null;
}

// The tree focused on the pane toward `direction`; null at the tree's edge.
export function focusToward(
  tree: PaneTree,
  direction: PaneDirection,
): PaneTree | null {
  const target = paneToward(tree, tree.focusedId, direction);
  return target === null ? null : { root: tree.root, focusedId: target };
}

// The focused leaf's id and the id of the pane toward `direction` exchanged in
// place, focus staying on the moved id; null at the tree's edge.
export function swapToward(
  tree: PaneTree,
  direction: PaneDirection,
): PaneTree | null {
  const moved = tree.focusedId;
  const target = paneToward(tree, moved, direction);
  if (target === null) {
    return null;
  }
  const swapped = (id: string) =>
    id === moved ? target : id === target ? moved : id;
  return { root: withLeavesRenamed(tree.root, swapped), focusedId: moved };
}

// Moves the focused leaf's nearest divider on `direction`'s axis by `step`
// from its drawn ratio (its ratio held by `least`), left and up shrinking
// `first`, right and down growing it, each side held as `clampedRatio` holds
// it. The divider is the leaf's right or lower one (the
// nearest split of that axis with the leaf in `first`), else its left or upper
// one. `limits` gives the step and least shares for the split it picked, or
// null when that split has no span to move in. `owned` is false, with the tree
// unchanged, when no split above the leaf has that axis or `limits` gave null;
// a press that leaves the drawn ratio where it is returns the same tree, so a
// stored ratio past the limit is kept.
export function nudgeFocused(
  tree: PaneTree,
  direction: PaneDirection,
  limits: (split: PaneSplit) => { step: number; least: LeastShares } | null,
): { tree: PaneTree; owned: boolean } {
  const axis: SplitAxis =
    direction === 'left' || direction === 'right' ? 'row' : 'column';
  const onAxis = stepsTo(tree, tree.focusedId)
    .reverse()
    .filter((step) => step.split.axis === axis);
  const divider =
    onAxis.find((step) => step.side === 'first') ??
    onAxis.find((step) => step.side === 'second');
  if (divider === undefined) {
    return { tree, owned: false };
  }
  const { split } = divider;
  const shares = limits(split);
  if (shares === null) {
    return { tree, owned: false };
  }
  const { step, least } = shares;
  const signedStep = direction === 'left' || direction === 'up' ? -step : step;
  const drawn = clampedRatio(split, split.ratio, least);
  const ratio = clampedRatio(split, drawn + signedStep, least);
  if (ratio === drawn) {
    return { tree, owned: true };
  }
  return { tree: withSplitRatio(tree, split, ratio), owned: true };
}

// A pane's least size and a divider handle's size, each as a share of one
// split's span.
export interface LeastShares {
  pane: number;
  handle: number;
}

// `ratio` held for `split` so that each side keeps the least share of every
// pane it lays out across the split's axis, with the handles between them, at
// most half the span.
export function clampedRatio(
  split: PaneSplit,
  ratio: number,
  least: LeastShares,
): number {
  const first = sideLeastShare(split.first, split.axis, least);
  const second = sideLeastShare(split.second, split.axis, least);
  return Math.min(Math.max(ratio, first), 1 - second);
}

function sideLeastShare(
  side: PaneNode,
  axis: SplitAxis,
  least: LeastShares,
): number {
  const panes = panesAcross(side, axis);
  return Math.min(panes * least.pane + (panes - 1) * least.handle, 0.5);
}

// The most panes `node` lays side by side along `axis`: a split of `axis`
// adds its sides' counts, a split of the other axis takes the larger.
function panesAcross(node: PaneNode, axis: SplitAxis): number {
  if (node.kind === 'leaf') {
    return 1;
  }
  const first = panesAcross(node.first, axis);
  const second = panesAcross(node.second, axis);
  return node.axis === axis ? first + second : Math.max(first, second);
}

// The tree with `split` (found by identity) at `ratio`; the same tree when
// `split` already holds it.
export function withSplitRatio(
  tree: PaneTree,
  split: PaneSplit,
  ratio: number,
): PaneTree {
  if (split.ratio === ratio) {
    return tree;
  }
  const steps = stepsToSplit(tree.root, split);
  return {
    root: replacedAt(tree.root, steps, { ...split, ratio }),
    focusedId: tree.focusedId,
  };
}

// A pane tree read back from storage, or null when `value` is not a
// well-formed one: a ratio outside (0, 1), an empty or repeated leaf id, or a
// `focusedId` that is not a leaf.
export function parsePaneTree(value: unknown): PaneTree | null {
  if (!isRecord(value) || typeof value.focusedId !== 'string') {
    return null;
  }
  const root = parsedNode(value.root);
  if (root === null) {
    return null;
  }
  const ids = leavesOf(root);
  const hasRepeatedId = new Set(ids).size !== ids.length;
  if (hasRepeatedId || !ids.includes(value.focusedId)) {
    return null;
  }
  return { root, focusedId: value.focusedId };
}

function parsedNode(value: unknown): PaneNode | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === 'leaf') {
    const isId = typeof value.id === 'string' && value.id !== '';
    return isId ? { kind: 'leaf', id: value.id as string } : null;
  }
  const isAxis = value.axis === 'row' || value.axis === 'column';
  const isRatio =
    typeof value.ratio === 'number' && value.ratio > 0 && value.ratio < 1;
  if (value.kind !== 'split' || !isAxis || !isRatio) {
    return null;
  }
  const first = parsedNode(value.first);
  const second = parsedNode(value.second);
  if (first === null || second === null) {
    return null;
  }
  return {
    kind: 'split',
    axis: value.axis as SplitAxis,
    ratio: value.ratio as number,
    first,
    second,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function leavesOf(root: PaneNode): string[] {
  const ids: string[] = [];
  const pending: PaneNode[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.kind === 'leaf') {
      ids.push(node.id);
    } else {
      pending.push(node.second, node.first);
    }
  }
  return ids;
}

// The splits from the root down to leaf `id`. Throws when `id` is not a leaf.
function stepsTo(tree: PaneTree, id: string): Step[] {
  const steps = stepsWhere(
    tree.root,
    (node) => node.kind === 'leaf' && node.id === id,
  );
  if (steps === null) {
    throw new Error(`Pane ${id} is not in the pane tree`);
  }
  return steps;
}

function stepsToSplit(root: PaneNode, split: PaneSplit): Step[] {
  const steps = stepsWhere(root, (node) => node === split);
  if (steps === null) {
    throw new Error('The split is not in the pane tree');
  }
  return steps;
}

function stepsWhere(
  root: PaneNode,
  isTarget: (node: PaneNode) => boolean,
): Step[] | null {
  const pending: { node: PaneNode; steps: Step[] }[] = [
    { node: root, steps: [] },
  ];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, steps } = item;
    if (isTarget(node)) {
      return steps;
    }
    if (node.kind === 'split') {
      pending.push(
        { node: node.first, steps: [...steps, { split: node, side: 'first' }] },
        {
          node: node.second,
          steps: [...steps, { split: node, side: 'second' }],
        },
      );
    }
  }
  return null;
}

// `root` with the node `steps` lead to replaced by `node`, every split on the
// way copied.
function replacedAt(root: PaneNode, steps: Step[], node: PaneNode): PaneNode {
  let replaced = node;
  for (let index = steps.length - 1; index >= 0; index--) {
    const { split, side } = steps[index];
    replaced = { ...split, [side]: replaced };
  }
  return replaced;
}

function withLeavesRenamed(
  node: PaneNode,
  rename: (id: string) => string,
): PaneNode {
  if (node.kind === 'leaf') {
    return { kind: 'leaf', id: rename(node.id) };
  }
  return {
    ...node,
    first: withLeavesRenamed(node.first, rename),
    second: withLeavesRenamed(node.second, rename),
  };
}

// Each leaf's rect in the unit square, from the splits' ratios.
function leafRects(root: PaneNode): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const pending: { node: PaneNode; rect: Rect }[] = [
    { node: root, rect: { left: 0, top: 0, right: 1, bottom: 1 } },
  ];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, rect } = item;
    if (node.kind === 'leaf') {
      rects.set(node.id, rect);
      continue;
    }
    if (node.axis === 'row') {
      const edge = rect.left + (rect.right - rect.left) * node.ratio;
      pending.push(
        { node: node.first, rect: { ...rect, right: edge } },
        { node: node.second, rect: { ...rect, left: edge } },
      );
    } else {
      const edge = rect.top + (rect.bottom - rect.top) * node.ratio;
      pending.push(
        { node: node.first, rect: { ...rect, bottom: edge } },
        { node: node.second, rect: { ...rect, top: edge } },
      );
    }
  }
  return rects;
}

// Whether `rect`'s edge facing `from` lies on `from`'s `direction` edge.
function touchesEdge(
  from: Rect,
  rect: Rect,
  direction: PaneDirection,
): boolean {
  const gap = {
    left: from.left - rect.right,
    right: rect.left - from.right,
    up: from.top - rect.bottom,
    down: rect.top - from.bottom,
  }[direction];
  return Math.abs(gap) <= TOLERANCE;
}
