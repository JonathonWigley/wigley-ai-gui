import './pane-tree.css';
import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import {
  type OuterPanes,
  PANE_RESIZE_COMMANDS,
  type PaneDirection,
} from '../../../contracts/panes';
import { element } from '../dom';
import type { AnchorNamer } from '../ui/key-anchors';
import { NUDGE_PROMPT_MS, splitResizePrompt } from '../ui/split';
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
// focus change also calls `focused`; `restore` calls neither.
export interface PaneTreeView {
  element: HTMLElement;
  tree(): PaneTree;
  // The slot of leaf `id`; the same element for as long as the leaf lives.
  // Throws when `id` is not a leaf.
  slot(id: string): HTMLElement;
  // Draws `tree` in place of the current one; slots of leaves it drops leave
  // the document.
  restore(tree: PaneTree): void;
  // Splits the focused pane, the new pane `newId` right of it (`row`) or below
  // it (`column`) and focused. False, with nothing changed, when either half
  // would fall under the least pane size. Throws when `newId` is a leaf.
  split(axis: SplitAxis, newId: string): boolean;
  // Closes pane `id`, its slot leaving the document; false for the last pane.
  close(id: string): boolean;
  // Focuses pane `id`; throws when `id` is not a leaf.
  focus(id: string): void;
  // Swaps the focused pane with the pane toward `direction`; false at the edge.
  swap(direction: PaneDirection): boolean;
  // Focus moves between the panes, and resize moves the focused pane's
  // divider, `owned` for any direction with a split of its axis above it.
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
}

// A split drawn: its box (`first`, handle, `second`), the node it draws now,
// and its handle's drag and prompt. `dispose` ends a drag without reporting it.
interface SplitBox {
  element: HTMLElement;
  handle: HTMLElement;
  axis: SplitAxis;
  split: PaneSplit;
  isDragging(): boolean;
  showPromptAfterNudge(): void;
  dispose(): void;
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
    const prompt =
      axis === 'row'
        ? splitResizePrompt(
            options.anchor,
            { command: PANE_RESIZE_COMMANDS.left, chevron: '◂' },
            { command: PANE_RESIZE_COMMANDS.right, chevron: '▸' },
          )
        : splitResizePrompt(
            options.anchor,
            { command: PANE_RESIZE_COMMANDS.up, chevron: '▴' },
            { command: PANE_RESIZE_COMMANDS.down, chevron: '▾' },
          );
    handle.append(prompt.element);
    const anchors: Disposable[] = prompt.anchors;
    const pointerAt = (event: PointerEvent) =>
      axis === 'row' ? event.clientX : event.clientY;

    // The pointer whose drag the handle holds, as `createSplitDivider` holds
    // it: until its pointerup or pointercancel reaches the window or its
    // capture loss reaches the handle.
    let dragPointer: number | null = null;
    let ratioAtDragStart = split.ratio;
    // The pointer's distance from the divider at the press, kept through the
    // drag so the divider stays under the same point of the handle.
    let grabOffset = 0;
    let promptTimer: number | null = null;

    const endDragOnRelease = (event: PointerEvent) => {
      if (event.pointerId === dragPointer) {
        endDrag(true);
      }
    };
    const endDrag = (reportsChange: boolean) => {
      dragPointer = null;
      window.removeEventListener('pointerup', endDragOnRelease);
      window.removeEventListener('pointercancel', endDragOnRelease);
      handle.classList.remove('is-active');
      if (reportsChange && drawn.split.ratio !== ratioAtDragStart) {
        options.changed(current);
      }
    };
    const isDragging = () =>
      dragPointer !== null && handle.hasPointerCapture(dragPointer);
    const startDrag = (event: PointerEvent) => {
      if (event.button !== 0 || isDragging()) {
        return;
      }
      if (dragPointer !== null) {
        endDrag(true);
      }
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      dragPointer = event.pointerId;
      window.addEventListener('pointerup', endDragOnRelease);
      window.addEventListener('pointercancel', endDragOnRelease);
      handle.classList.add('is-active');
      ratioAtDragStart = drawn.split.ratio;
      const { start, span } = measured(drawn);
      grabOffset = pointerAt(event) - start - drawn.split.ratio * span;
    };
    const drag = (event: PointerEvent) => {
      if (!handle.hasPointerCapture(event.pointerId)) {
        return;
      }
      const { start, span, handle: handleSize } = measured(drawn);
      if (span <= 0) {
        return;
      }
      const ratio = clampedRatio(
        drawn.split,
        (pointerAt(event) - start - grabOffset) / span,
        leastShares(axis, span, handleSize),
      );
      current = withSplitRatio(current, drawn.split, ratio);
      draw();
    };
    const endDragOnCaptureLoss = (event: PointerEvent) => {
      if (event.pointerId === dragPointer) {
        endDrag(true);
      }
    };
    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('pointermove', drag);
    handle.addEventListener('lostpointercapture', endDragOnCaptureLoss);

    const drawn: SplitBox = {
      element: box,
      handle,
      axis,
      split,
      isDragging,
      showPromptAfterNudge() {
        handle.classList.add('is-nudged');
        if (promptTimer !== null) {
          options.timers.clear(promptTimer);
        }
        promptTimer = options.timers.set(() => {
          promptTimer = null;
          handle.classList.remove('is-nudged');
        }, NUDGE_PROMPT_MS);
      },
      dispose() {
        if (dragPointer !== null) {
          endDrag(false);
        }
        handle.removeEventListener('pointerdown', startDrag);
        handle.removeEventListener('pointermove', drag);
        handle.removeEventListener('lostpointercapture', endDragOnCaptureLoss);
        if (promptTimer !== null) {
          options.timers.clear(promptTimer);
          promptTimer = null;
        }
        for (const anchor of anchors) {
          anchor.dispose();
        }
      },
    };
    return drawn;
  };

  // `node`'s element, growing by `grow` (its parent split's share for it, ''
  // for the root), its split boxes kept under `path` (`0` for `first`, `1`
  // for `second` at each level) and recorded in `used`.
  const drawnNode = (
    node: PaneNode,
    grow: string,
    path: string,
    used: Set<string>,
  ): HTMLElement => {
    if (node.kind === 'leaf') {
      const slot = slotFor(node.id);
      slot.style.flexGrow = grow;
      return slot;
    }
    const key = `${path}:${node.axis}`;
    used.add(key);
    let box = boxes.get(key);
    if (box === undefined) {
      box = createBox(node.axis, node);
      boxes.set(key, box);
    }
    box.split = node;
    box.element.style.flexGrow = grow;
    placeChildren(box.element, [
      drawnNode(node.first, String(node.ratio), `${path}0`, used),
      box.handle,
      drawnNode(node.second, String(1 - node.ratio), `${path}1`, used),
    ]);
    return box.element;
  };

  // Draws `current`. An element focused in the tree is focused again when
  // the draw moved it and it stayed in the document.
  const draw = () => {
    const active = document.activeElement;
    const focusedInTree =
      active instanceof HTMLElement && root.contains(active) ? active : null;
    const used = new Set<string>();
    placeChildren(root, [drawnNode(current.root, '', '', used)]);
    if (
      focusedInTree?.isConnected === true &&
      document.activeElement !== focusedInTree
    ) {
      focusedInTree.focus({ preventScroll: true });
    }
    for (const [key, box] of boxes) {
      if (!used.has(key)) {
        box.element.remove();
        box.dispose();
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
    for (const [id, slot] of slots) {
      if (!ids.has(id)) {
        slot.remove();
        slots.delete(id);
      }
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
      if (span <= 0 || box.isDragging()) {
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
    nudged?.showPromptAfterNudge();
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
      for (const box of boxes.values()) {
        box.dispose();
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

// A divider handle's size, the `space-1` theme token's pixels as `root`
// computes it; 0 for a length in any other unit.
function handleSize(root: HTMLElement): number {
  const token = getComputedStyle(root).getPropertyValue('--wg-space-1').trim();
  return /^\d+(\.\d+)?px$/.test(token) ? parseFloat(token) : 0;
}

// Makes `wanted` the children of `parent` in order, moving only the elements
// not already in their place.
function placeChildren(parent: HTMLElement, wanted: HTMLElement[]): void {
  wanted.forEach((child, index) => {
    const present = parent.children[index] ?? null;
    if (present !== child) {
      parent.insertBefore(child, present);
    }
  });
  while (parent.children.length > wanted.length) {
    parent.lastElementChild?.remove();
  }
}
