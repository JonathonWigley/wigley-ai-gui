import './split.css';
import type { Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import {
  PANE_RESIZE_COMMANDS,
  type PaneDirection,
  type ResizeTarget,
} from '../../../contracts/panes';
import type { UiState } from '../../../contracts/ui-state';
import { element } from '../dom';
import {
  type AnchorNamer,
  disposeAnchors,
  keyChevron,
  keyEdge,
} from './key-anchors';
import {
  clampSplitWidth,
  nudgedSplitWidth,
  type SplitLimits,
  storedSplitWidth,
} from './split-width';

// How long the handle's resize prompt shows after a keyboard nudge.
const NUDGE_PROMPT_MS = 1000;

const OPPOSITE_SIDES = { left: 'right', right: 'left' } as const;

// A column divider's directions on the row divider's: up toward the start.
const COLUMN_SIDES = { up: 'left', down: 'right' } as const;

// `axis` `row` lays the panes side by side, `column` one above the other;
// `sizedPane` is the pane whose size the divider holds, `start` unless given.
export interface SplitOptions extends SplitLimits {
  uiState: UiState;
  stateKey: string;
  axis?: 'row' | 'column';
  sizedPane?: 'start' | 'end';
  // Places the handle's `⌥⇧H ◂ ▸ ⌥⇧L` prompt (`⌥⇧K ▴ ▾ ⌥⇧J` on a column
  // split); the view's own anchor function.
  anchor: AnchorNamer<never>;
  // Runs the prompt's linger after a nudge.
  timers: Timers;
}

export interface Split extends ResizeTarget {
  element: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
  width(): number;
  // Shows the width stored under `stateKey` now, so a split another split's
  // drag wrote over takes that width; a drag in progress keeps its own.
  reloadWidth(): void;
  setStartHidden(hidden: boolean): void;
  // Hides the end pane and the handle, the start pane taking the whole split.
  setEndHidden(hidden: boolean): void;
  dispose(): void;
}

// `sizedPane` is the pane whose width the divider holds, `start` unless given;
// `min` and `initial` describe it, and `endMin` the least width it leaves the
// other pane. `axis` `column` holds a height along y in place of a width along
// x: every `left` and `width` below reads as top and height, and up and down
// as left and right. `measure` reads the start pane's left edge in client
// pixels and the span both panes share, whichever pane is sized: an `end`
// pane's width runs leftward from the span's right edge, so a nudge left
// widens it. `show` draws a width. The divider owns the drag on `handle`, the
// stored width under `stateKey` and `nudge`; a drag writes
// uiState once at its end, a nudge on each press, each only when the width
// changed. A nudge steps from the drawn width, the stored one clamped to the
// span, so a press at a limit writes nothing and keeps a wider stored width;
// nudge does nothing while a drag is running. `nudge` returns false, moving
// nothing, for the directions off the divider's axis (up and down on a row,
// left and right on a column), and while
// `handle` has no layout box (its split stacked, the pane it sizes hidden or
// lying over, or the window too narrow for it), so the press goes on to the
// next divider; it
// returns true for its axis's directions otherwise, moved or not.
export interface SplitDividerOptions extends SplitLimits {
  uiState: UiState;
  stateKey: string;
  axis?: 'row' | 'column';
  sizedPane?: 'start' | 'end';
  handle: HTMLElement;
  measure(): { left: number; span: number };
  show(width: number): void;
  // Places the handle's `⌥⇧H ◂ ▸ ⌥⇧L` prompt; the view's or shell's own
  // anchor function.
  anchor: AnchorNamer<never>;
  // Runs the prompt's linger after a nudge; the page's Timers seam.
  timers: Timers;
}

export interface SplitDivider extends ResizeTarget {
  width(): number;
  reloadWidth(): void;
  dispose(): void;
}

// One end of a resize prompt: the resize command whose key it shows, and the
// chevron beside that key.
export interface ResizePromptEnd {
  command: CommandId;
  chevron: string;
}

export interface DividerHandleOptions {
  handle: HTMLElement;
  // The resize prompt's two ends: `start`'s key and chevron, then `end`'s
  // chevron and key (`⌥⇧H ◂ ▸ ⌥⇧L`).
  prompt: { start: ResizePromptEnd; end: ResizePromptEnd };
  // Places the prompt's keys; the owner's own anchor function.
  anchor: AnchorNamer<never>;
  // Runs the prompt's linger after a nudge; the page's Timers seam.
  timers: Timers;
  // The pointer's client position along the divider's axis.
  pointerAt(event: PointerEvent): number;
  // The divider's drawn client position along its axis, read at the press.
  dividerAt(): number;
  // A drag began.
  onStart(): void;
  // The pointer moved during the drag, the divider wanted at client
  // position `at`.
  onMove(at: number): void;
  // The drag ended: `byRelease` true for a release, a capture loss or a new
  // press after one went unheard, false for `dispose`.
  onEnd(byRelease: boolean): void;
}

// A divider handle's drag and its resize prompt.
export interface DividerHandle {
  // Whether a drag holds the pointer now.
  isDragging(): boolean;
  // Shows the prompt (`is-nudged`) for a moment, a later nudge restarting it.
  showPromptAfterNudge(): void;
  // Ends a running drag, removes the listeners, clears the linger and
  // disposes the prompt's anchors; leaves `handle` in the document.
  dispose(): void;
}

// The drag core every divider shares, the split's, the shell's bars' and the
// pane tree's: a primary press on `handle` captures the pointer and starts a
// drag (`is-active`) that keeps the pointer's distance from the divider, so
// the divider stays under the same point of the handle. The drag holds until
// that pointer's pointerup or pointercancel reaches the window, which hears it
// even after the handle has left the document, or its capture loss reaches the
// handle. The prompt is drawn in `handle`, shown while hovered, dragged and for
// a moment after a nudge.
export function createDividerHandle(
  options: DividerHandleOptions,
): DividerHandle {
  const { handle } = options;
  const prompt = splitResizePrompt(
    options.anchor,
    options.prompt.start,
    options.prompt.end,
  );
  handle.append(prompt.element);

  let dragPointer: number | null = null;
  // The pointer's distance from the divider at the press.
  let grabOffset = 0;
  let promptTimer: number | null = null;

  const endDragOnRelease = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) {
      endDrag(true);
    }
  };
  const endDrag = (byRelease: boolean) => {
    dragPointer = null;
    window.removeEventListener('pointerup', endDragOnRelease);
    window.removeEventListener('pointercancel', endDragOnRelease);
    handle.classList.remove('is-active');
    options.onEnd(byRelease);
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
    options.onStart();
    grabOffset = options.pointerAt(event) - options.dividerAt();
  };
  const drag = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      options.onMove(options.pointerAt(event) - grabOffset);
    }
  };
  // The browser fires lostpointercapture after pointerup and pointercancel
  // release capture, and on every other loss of it while the handle is in the
  // document.
  const endDragOnCaptureLoss = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) {
      endDrag(true);
    }
  };
  handle.addEventListener('pointerdown', startDrag);
  handle.addEventListener('pointermove', drag);
  handle.addEventListener('lostpointercapture', endDragOnCaptureLoss);

  return {
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
      disposeAnchors(prompt.anchors);
    },
  };
}

// A divider handle's resize prompt, `span.ui-split-prompt`: `start`'s key and
// chevron, then `end`'s chevron and key.
function splitResizePrompt(
  anchor: AnchorNamer<never>,
  start: ResizePromptEnd,
  end: ResizePromptEnd,
): { element: HTMLElement; anchors: Disposable[] } {
  const startAnchor = element('span');
  const endAnchor = element('span');
  const prompt = keyEdge('ui-split-prompt', [
    startAnchor,
    keyChevron(start.chevron),
    keyChevron(end.chevron),
    endAnchor,
  ]);
  return {
    element: prompt,
    anchors: [
      anchor(startAnchor, start.command),
      anchor(endAnchor, end.command),
    ],
  };
}

// The divider core every split and the shell's bars share: the width it opens
// at from `uiState`, the drag on `handle` through `createDividerHandle`, and
// the keyboard nudge. `dispose` leaves `handle` in the document; its owner
// removes it.
export function createSplitDivider(options: SplitDividerOptions): SplitDivider {
  const sizesEnd = options.sizedPane === 'end';
  const isColumn = options.axis === 'column';
  // The divider's client position for the sized pane drawn `drawn` wide, and
  // back: an end pane is measured from the span's right edge.
  const dividerAtWidth = (drawn: number, left: number, span: number) =>
    sizesEnd ? left + span - drawn : left + drawn;
  const widthAtDivider = (at: number, left: number, span: number) =>
    sizesEnd ? left + span - at : at - left;
  let width = storedSplitWidth(options.uiState, options.stateKey, options);
  let widthAtDragStart = width;
  let isDisposed = false;
  const showWidth = (next: number) => {
    width = next;
    options.show(width);
  };
  showWidth(width);

  const handle = createDividerHandle({
    handle: options.handle,
    prompt: isColumn
      ? {
          start: { command: PANE_RESIZE_COMMANDS.up, chevron: '▴' },
          end: { command: PANE_RESIZE_COMMANDS.down, chevron: '▾' },
        }
      : {
          start: { command: PANE_RESIZE_COMMANDS.left, chevron: '◂' },
          end: { command: PANE_RESIZE_COMMANDS.right, chevron: '▸' },
        },
    anchor: options.anchor,
    timers: options.timers,
    pointerAt: (event) => (isColumn ? event.clientY : event.clientX),
    dividerAt() {
      const { left, span } = options.measure();
      return dividerAtWidth(clampSplitWidth(width, options, span), left, span);
    },
    onStart() {
      widthAtDragStart = width;
    },
    onMove(at) {
      const { left, span } = options.measure();
      showWidth(clampSplitWidth(widthAtDivider(at, left, span), options, span));
    },
    onEnd() {
      if (width !== widthAtDragStart) {
        options.uiState.set(options.stateKey, width);
      }
    },
  });

  return {
    width: () => width,
    reloadWidth() {
      if (!handle.isDragging()) {
        showWidth(storedSplitWidth(options.uiState, options.stateKey, options));
      }
    },
    nudge(direction: PaneDirection) {
      const hasLayoutBox = options.handle.getClientRects().length > 0;
      const side = sideOnAxis(direction, isColumn);
      if (side === null || !hasLayoutBox) {
        return false;
      }
      if (isDisposed || handle.isDragging()) {
        return true;
      }
      const { span } = options.measure();
      const drawn = clampSplitWidth(width, options, span);
      const widthDirection = sizesEnd ? OPPOSITE_SIDES[side] : side;
      const next = nudgedSplitWidth(drawn, widthDirection, options, span);
      if (next !== drawn) {
        showWidth(next);
        options.uiState.set(options.stateKey, next);
      }
      handle.showPromptAfterNudge();
      return true;
    },
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      handle.dispose();
    },
  };
}

// Two panes with a drag handle between them: side by side, stacked
// (`is-stacked`) while the split is narrower than `min` plus `endMin`, or with
// `axis` `column` (`is-column`) one above the other, never stacked. The sized
// pane's width, or a column's height, opens from `uiState` under `stateKey`
// and is written back at the end of a drag and on each nudge, when either
// changed it; a nudge steps from the drawn width and is ignored mid-drag.
// `reloadWidth` reads it again. With `sizedPane` `end` the root carries
// `is-end-sized` and the end pane holds the size. Its owner calls `dispose`
// when it drops the split.
export function createSplit(options: SplitOptions): Split {
  const isColumn = options.axis === 'column';
  const sizesEnd = options.sizedPane === 'end';
  const root = element('div', 'ui-split');
  root.classList.toggle('is-column', isColumn);
  root.classList.toggle('is-end-sized', sizesEnd);
  const start = element('div', 'ui-split-start');
  const handle = element('div', 'ui-split-handle');
  const end = element('div', 'ui-split-end');
  root.append(start, handle, end);
  root.style.setProperty('--ui-split-end-min', `${options.endMin}px`);
  const observer = new ResizeObserver(([observed]) => {
    const isNarrow = observed.contentRect.width < options.min + options.endMin;
    root.classList.toggle('is-stacked', !isColumn && isNarrow);
  });
  observer.observe(root);

  const divider = createSplitDivider({
    ...options,
    handle,
    measure() {
      const rootRect = root.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      return isColumn
        ? { left: rootRect.top, span: rootRect.height - handleRect.height }
        : { left: rootRect.left, span: rootRect.width - handleRect.width };
    },
    show(width) {
      root.style.setProperty(
        sizesEnd ? '--ui-split-end' : '--ui-split-start',
        String(width),
      );
    },
  });

  return {
    element: root,
    start,
    end,
    width: () => divider.width(),
    reloadWidth: () => divider.reloadWidth(),
    nudge: (direction) => divider.nudge(direction),
    setStartHidden(hidden) {
      root.classList.toggle('is-start-hidden', hidden);
    },
    setEndHidden(hidden) {
      root.classList.toggle('is-end-hidden', hidden);
    },
    dispose() {
      observer.disconnect();
      divider.dispose();
    },
  };
}

// `direction` as the row divider's side it moves toward, or null off the
// divider's axis.
function sideOnAxis(
  direction: PaneDirection,
  isColumn: boolean,
): 'left' | 'right' | null {
  if (isColumn) {
    return direction === 'up' || direction === 'down'
      ? COLUMN_SIDES[direction]
      : null;
  }
  return direction === 'left' || direction === 'right' ? direction : null;
}
