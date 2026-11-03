import './pane-tree.css';
import type { Timers } from '../../../contracts/ambient';
import {
  type OuterPanes,
  PANE_RESIZE_COMMANDS,
  type PaneDirection,
} from '../../../contracts/panes';
import { element, moveConnected } from '../dom';
import type { AnchorNamer } from '../ui/key-anchors';
import { createDividerHandle, type DividerHandle } from '../ui/split';
import {
  clampedRatio,
  closePane,
  focusToward,
  type LeastShares,
  leafIds,
  nudgeFocused,
  type PaneNode,
  type PaneSplit,
  type PaneTree,
  type SplitAxis,
  singlePane,
  splitFocused,
  swapToward,
  withSplitRatio,
} from './pane-tree';

// The least width of a pane beside another, in pixels.
const LEAST_PANE_WIDTH = 280;
// The least height of a pane above or below another, in pixels.
const LEAST_PANE_HEIGHT = 160;
// How far one resize press moves a divider, in pixels.
const NUDGE_STEP = 24;

// The pane tree drawn: one slot element per leaf, which its owner fills, in
// nested split boxes with a drag handle between each split's two sides.
// `split`, `close`, `focus`, `swap`, a handle's drag and the outer panes'
// focus and resize each call `changed` once when they change the tree, and a
// focus change also calls `focused`; `restore` calls neither. Each split is
// drawn at its ratio clamped to the least pane sizes in the tree's box, drawn
// again as the box resizes, while the tree keeps the ratio it was given.
export interface PaneTreeView {
  element: HTMLElement;
  tree(): PaneTree;
  // The slot of leaf `id`; the same element for as long as the leaf lives.
  // Throws when `id` is not a leaf.
  slot(id: string): HTMLElement;
  // Draws `tree` in place of the current one; slots of leaves it drops leave
  // the document, after `leaving`.
  restore(tree: PaneTree): void;
  // Splits the focused pane, the new pane `newId` right of it (`row`) or below
  // it (`column`) and focused. False, with nothing changed, when either half
  // would fall under the least pane size. Throws when `newId` is a leaf.
  split(axis: SplitAxis, newId: string): boolean;
  // Closes pane `id`, its slot leaving the document after `leaving`; false for
  // the last pane.
  close(id: string): boolean;
  // Focuses pane `id`; throws when `id` is not a leaf.
  focus(id: string): void;
  // Swaps the focused pane with the pane toward `direction`; false at the edge.
  swap(direction: PaneDirection): boolean;
  // Focus moves between the panes, and resize moves the focused pane's
  // divider, `owned` for any direction with a split of its axis above it
  // whose box has a span.
  outer: OuterPanes;
  dispose(): void;
}

export interface PaneTreeViewOptions {
  initialId: string;
  // Places each handle's resize prompt; the owner's own anchor function.
  anchor: AnchorNamer<never>;
  // Runs a prompt's linger after a nudge.
  timers: Timers;
  changed(tree: PaneTree): void;
  focused(id: string): void;
  // Runs with the ids of the leaves a close or `restore` drops while their
  // slots are still in the document, before they leave it.
  leaving(ids: readonly string[]): void;
}

// A split drawn: its box (`first`, handle, `second`), the node it draws now,
// the ratio it draws that node at, and its handle's drag and prompt, whose
// `dispose` ends a drag without reporting it.
interface SplitBox {
  element: HTMLElement;
  handle: HTMLElement;
  axis: SplitAxis;
  split: PaneSplit;
  drawnRatio: number;
  divider: DividerHandle;
}

// One draw's record: the keys of the split boxes it drew, and how many
// children each element it filled keeps once every node is placed.
interface DrawPass {
  used: Set<string>;
  childCounts: Map<HTMLElement, number>;
}

// A box's size in pixels.
interface Size {
  width: number;
  height: number;
}

// The pane tree's view. Split boxes are kept by their place in the tree and
// their axis, and slots by leaf id, so a draw moves only the elements whose
// place changed. A press on a slot focuses its pane.
export function createPaneTreeView(options: PaneTreeViewOptions): PaneTreeView {
  const root = element('div', 'pane-tree');
  const slots = new Map<string, HTMLElement>();
  const boxes = new Map<string, SplitBox>();
  let current = singlePane(options.initialId);

  const slotFor = (id: string) => {
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = element('div', 'pane-tree-slot');
      slots.set(id, slot);
    }
    return slot;
  };

  // The split's start edge, the span its two sides share, and its handle's
  // size, along its axis.
  const measured = (box: SplitBox) => {
    const rect = box.element.getBoundingClientRect();
    const handleRect = box.handle.getBoundingClientRect();
    return box.axis === 'row'
      ? {
          start: rect.left,
          span: rect.width - handleRect.width,
          handle: handleRect.width,
        }
      : {
          start: rect.top,
          span: rect.height - handleRect.height,
          handle: handleRect.height,
        };
  };

  const createBox = (axis: SplitAxis, split: PaneSplit): SplitBox => {
    const box = element('div', `pane-tree-split is-${axis}`);
    const handle = element('div', 'ui-split-handle pane-tree-handle');
    let ratioAtDragStart = split.ratio;
    const divider = createDividerHandle({
      handle,
      prompt:
        axis === 'row'
          ? {
              start: { command: PANE_RESIZE_COMMANDS.left, chevron: '◂' },
              end: { command: PANE_RESIZE_COMMANDS.right, chevron: '▸' },
            }
          : {
              start: { command: PANE_RESIZE_COMMANDS.up, chevron: '▴' },
              end: { command: PANE_RESIZE_COMMANDS.down, chevron: '▾' },
            },
      anchor: options.anchor,
      timers: options.timers,
      pointerAt: (event) => (axis === 'row' ? event.clientX : event.clientY),
      dividerAt() {
        const { start, span } = measured(drawn);
        return start + drawn.drawnRatio * span;
      },
      onStart() {
        ratioAtDragStart = drawn.split.ratio;
      },
      onMove(at) {
        const { start, span, handle: handleSize } = measured(drawn);
        if (span <= 0) {
          return;
        }
        const ratio = clampedRatio(
          drawn.split,
          (at - start) / span,
          leastShares(axis, span, handleSize),
        );
        current = withSplitRatio(current, drawn.split, ratio);
        draw();
      },
      onEnd(byRelease) {
        if (byRelease && drawn.split.ratio !== ratioAtDragStart) {
          options.changed(current);
        }
      },
    });

    const drawn: SplitBox = {
      element: box,
      handle,
      axis,
      split,
      drawnRatio: split.ratio,
      divider,
    };
    return drawn;
  };

  // Places `node`'s element at `index` in `parent`, then its sides in it, so
  // a split's box is in the document before the slots move into it. The
  // element is `size` in pixels with handles `handle` pixels across and
  // grows by `grow` (its parent split's drawn share for it, '' for the root);
  // its split boxes are kept under `path` (`0` for `first`, `1` for `second`
  // at each level) and recorded in `pass`. Each split draws its ratio clamped
  // so each side keeps its least in `size`, the tree's ratio left as it is.
  const placeNode = (
    node: PaneNode,
    size: Size,
    handle: number,
    grow: string,
    path: string,
    parent: HTMLElement,
    index: number,
    pass: DrawPass,
  ): void => {
    if (node.kind === 'leaf') {
      const slot = slotFor(node.id);
      slot.style.flexGrow = grow;
      placeChild(parent, slot, index);
      return;
    }
    const key = `${path}:${node.axis}`;
    pass.used.add(key);
    let box = boxes.get(key);
    if (box === undefined) {
      box = createBox(node.axis, node);
      boxes.set(key, box);
    }
    box.split = node;
    box.drawnRatio = ratioDrawnIn(node, size, handle);
    box.element.style.flexGrow = grow;
    placeChild(parent, box.element, index);
    pass.childCounts.set(box.element, 3);
    const [firstSize, secondSize] = sideSizes(
      node.axis,
      size,
      box.drawnRatio,
      handle,
    );
    placeNode(
      node.first,
      firstSize,
      handle,
      String(box.drawnRatio),
      `${path}0`,
      box.element,
      0,
      pass,
    );
    placeChild(box.element, box.handle, 1);
    placeNode(
      node.second,
      secondSize,
      handle,
      String(1 - box.drawnRatio),
      `${path}1`,
      box.element,
      2,
      pass,
    );
  };

  // Draws `current` in the tree's box as it is now. An element focused in the
  // tree is focused again when the draw moved it and it stayed in the
  // document.
  const draw = () => {
    const active = document.activeElement;
    const focusedInTree =
      active instanceof HTMLElement && root.contains(active) ? active : null;
    const pass: DrawPass = {
      used: new Set(),
      childCounts: new Map([[root, 1]]),
    };
    const { width, height } = root.getBoundingClientRect();
    // A box with no size, the tree hidden, draws the stored ratios.
    const handle = width > 0 || height > 0 ? handleSize(root) : 0;
    placeNode(current.root, { width, height }, handle, '', '', root, 0, pass);
    for (const [parent, count] of pass.childCounts) {
      dropChildrenPast(parent, count);
    }
    if (
      focusedInTree?.isConnected === true &&
      document.activeElement !== focusedInTree
    ) {
      focusedInTree.focus({ preventScroll: true });
    }
    for (const [key, box] of boxes) {
      if (!pass.used.has(key)) {
        box.element.remove();
        box.divider.dispose();
        boxes.delete(key);
      }
    }
    const ids = leafIds(current);
    for (const [id, slot] of slots) {
      slot.classList.toggle(
        'is-focused',
        ids.length > 1 && id === current.focusedId,
      );
    }
  };

  const dropSlotsMissingFrom = (tree: PaneTree) => {
    const ids = new Set(leafIds(tree));
    const dropped = [...slots].filter(([id]) => !ids.has(id));
    if (dropped.length === 0) {
      return;
    }
    options.leaving(dropped.map(([id]) => id));
    for (const [id, slot] of dropped) {
      slot.remove();
      slots.delete(id);
    }
  };

  const commit = (next: PaneTree) => {
    const focusMoved = next.focusedId !== current.focusedId;
    current = next;
    draw();
    options.changed(current);
    if (focusMoved) {
      options.focused(current.focusedId);
    }
  };

  const focusOnPress = (event: PointerEvent) => {
    for (const [id, slot] of slots) {
      if (slot.contains(event.target as Node)) {
        focus(id);
        return;
      }
    }
  };
  root.addEventListener('pointerdown', focusOnPress, true);
  // A resize of the tree's box draws every split's ratio clamped again.
  const observer = new ResizeObserver(() => draw());
  observer.observe(root);

  const focus = (id: string) => {
    if (!leafIds(current).includes(id)) {
      throw new Error(`Pane ${id} is not in the pane tree`);
    }
    if (id !== current.focusedId) {
      commit({ root: current.root, focusedId: id });
    }
  };

  const nudge = (direction: PaneDirection) => {
    let nudged = null as SplitBox | null;
    const result = nudgeFocused(current, direction, (split) => {
      const box = [...boxes.values()].find((held) => held.split === split);
      if (box === undefined) {
        throw new Error('The nudged split has no box drawn');
      }
      const { span, handle } = measured(box);
      if (span <= 0) {
        return null;
      }
      if (box.divider.isDragging()) {
        return { step: 0, least: { pane: 0, handle: 0 } };
      }
      nudged = box;
      return {
        step: NUDGE_STEP / span,
        least: leastShares(box.axis, span, handle),
      };
    });
    if (result.tree !== current) {
      commit(result.tree);
    }
    nudged?.divider.showPromptAfterNudge();
    return result.owned;
  };

  draw();

  return {
    element: root,
    tree: () => current,
    slot(id) {
      if (!leafIds(current).includes(id)) {
        throw new Error(`Pane ${id} is not in the pane tree`);
      }
      return slotFor(id);
    },
    restore(tree) {
      current = tree;
      dropSlotsMissingFrom(tree);
      draw();
    },
    split(axis, newId) {
      const next = splitFocused(current, axis, newId);
      const rect = slotFor(current.focusedId).getBoundingClientRect();
      const size = axis === 'row' ? rect.width : rect.height;
      if ((size - handleSize(root)) / 2 < leastSize(axis)) {
        return false;
      }
      commit(next);
      return true;
    },
    close(id) {
      const next = closePane(current, id);
      if (next === null) {
        return false;
      }
      dropSlotsMissingFrom(next);
      commit(next);
      return true;
    },
    focus,
    swap(direction) {
      const next = swapToward(current, direction);
      if (next === null) {
        return false;
      }
      commit(next);
      return true;
    },
    outer: {
      focus: {
        move(direction) {
          const next = focusToward(current, direction);
          if (next === null) {
            return false;
          }
          commit(next);
          return true;
        },
      },
      resize: { nudge },
    },
    dispose() {
      root.removeEventListener('pointerdown', focusOnPress, true);
      observer.disconnect();
      for (const box of boxes.values()) {
        box.divider.dispose();
      }
      boxes.clear();
    },
  };
}

function leastSize(axis: SplitAxis): number {
  return axis === 'row' ? LEAST_PANE_WIDTH : LEAST_PANE_HEIGHT;
}

// The least pane size and a handle of `handle` pixels as shares of a split's
// `span`.
function leastShares(
  axis: SplitAxis,
  span: number,
  handle: number,
): LeastShares {
  return { pane: leastSize(axis) / span, handle: handle / span };
}

// The ratio `split` is drawn at in a box of `size`: its own ratio, clamped so
// each side keeps the least size of each pane across it while the span has
// room; its own ratio in a box with no span.
function ratioDrawnIn(split: PaneSplit, size: Size, handle: number): number {
  const span = (split.axis === 'row' ? size.width : size.height) - handle;
  if (span <= 0) {
    return split.ratio;
  }
  return clampedRatio(
    split,
    split.ratio,
    leastShares(split.axis, span, handle),
  );
}

// The sizes of a split's two sides in a box of `size`, `first` taking
// `ratio` of the span beside a handle of `handle` pixels.
function sideSizes(
  axis: SplitAxis,
  size: Size,
  ratio: number,
  handle: number,
): [Size, Size] {
  if (axis === 'row') {
    const span = Math.max(size.width - handle, 0);
    return [
      { width: span * ratio, height: size.height },
      { width: span * (1 - ratio), height: size.height },
    ];
  }
  const span = Math.max(size.height - handle, 0);
  return [
    { width: size.width, height: span * ratio },
    { width: size.width, height: span * (1 - ratio) },
  ];
}

// A divider handle's size, the `space-1` theme token's pixels as `root`
// computes it; 0 for a length in any other unit.
function handleSize(root: HTMLElement): number {
  const token = getComputedStyle(root).getPropertyValue('--wg-space-1').trim();
  return /^\d+(\.\d+)?px$/.test(token) ? parseFloat(token) : 0;
}

// Makes `child` the child at `index` of `parent`, whose children before it are
// already placed, moving it only when it is not there.
function placeChild(parent: HTMLElement, child: HTMLElement, index: number) {
  const present = parent.children[index] ?? null;
  if (present !== child) {
    moveConnected(parent, child, present);
  }
}

// Removes the children of `parent` past its first `count`.
function dropChildrenPast(parent: HTMLElement, count: number): void {
  while (parent.children.length > count) {
    parent.lastElementChild?.remove();
  }
}
