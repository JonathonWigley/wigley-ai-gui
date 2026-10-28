import './split.css';
import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import {
  PANE_RESIZE_COMMANDS,
  type ResizeDirection,
  type ResizeTarget,
} from '../../../contracts/panes';
import type { UiState } from '../../../contracts/ui-state';
import { element } from '../dom';
import { type AnchorNamer, keyChevron, keyEdge } from './key-anchors';
import {
  clampSplitWidth,
  nudgedSplitWidth,
  type SplitLimits,
  storedSplitWidth,
} from './split-width';

// How long the handle's resize prompt shows after a keyboard nudge.
const NUDGE_PROMPT_MS = 1000;

export interface SplitOptions extends SplitLimits {
  uiState: UiState;
  stateKey: string;
  // Places the handle's `⌥⇧H ◂ ▸ ⌥⇧L` prompt; the view's own anchor function.
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
  dispose(): void;
}

// `measure` reads the start pane's left edge in client pixels and the span
// both panes share; `show` draws a width. The divider owns the drag on
// `handle`, the stored width under `stateKey` and `nudge`; a drag writes
// uiState once at its end, a nudge on each press, each only when the width
// changed; nudge does nothing while `handle` has no layout box.
export interface SplitDividerOptions extends SplitLimits {
  uiState: UiState;
  stateKey: string;
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

// The divider core every split and the side bar share: the drag on `handle`,
// the width it opens at from `uiState`, the keyboard nudge, and the resize
// prompt drawn centred on `handle`, shown while hovered, dragged
// (`is-active`) and for a moment after a nudge (`is-nudged`). `dispose` leaves
// `handle` in the document; its owner removes it.
export function createSplitDivider(options: SplitDividerOptions): SplitDivider {
  const { handle } = options;
  const leftAnchor = element('span');
  const rightAnchor = element('span');
  handle.append(
    keyEdge('ui-split-prompt', [
      leftAnchor,
      keyChevron('◂'),
      keyChevron('▸'),
      rightAnchor,
    ]),
  );
  const anchors: Disposable[] = [
    options.anchor(leftAnchor, PANE_RESIZE_COMMANDS.left),
    options.anchor(rightAnchor, PANE_RESIZE_COMMANDS.right),
  ];

  let width = storedSplitWidth(options.uiState, options.stateKey, options);
  let widthAtDragStart = width;
  let isDisposed = false;
  let promptTimer: number | null = null;
  const showWidth = (next: number) => {
    width = next;
    options.show(width);
  };
  showWidth(width);

  // The pointer whose drag the handle holds, until that pointer's pointerup or
  // pointercancel reaches the window or its capture loss reaches the handle;
  // the window hears the release even after the handle has left the document.
  let dragPointer: number | null = null;
  const endDragOnRelease = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) {
      endDrag();
    }
  };
  const endDrag = () => {
    dragPointer = null;
    window.removeEventListener('pointerup', endDragOnRelease);
    window.removeEventListener('pointercancel', endDragOnRelease);
    handle.classList.remove('is-active');
    if (width !== widthAtDragStart) {
      options.uiState.set(options.stateKey, width);
    }
  };

  const isDragging = () =>
    dragPointer !== null && handle.hasPointerCapture(dragPointer);

  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0 || isDragging()) {
      return;
    }
    if (dragPointer !== null) {
      endDrag();
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    dragPointer = event.pointerId;
    window.addEventListener('pointerup', endDragOnRelease);
    window.addEventListener('pointercancel', endDragOnRelease);
    handle.classList.add('is-active');
    widthAtDragStart = width;
  };
  const drag = (event: PointerEvent) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }
    const { left, span } = options.measure();
    showWidth(clampSplitWidth(event.clientX - left, options, span));
  };
  // The browser fires lostpointercapture after pointerup and pointercancel
  // release capture, and on every other loss of it while the handle is in the
  // document.
  const endDragOnCaptureLoss = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) {
      endDrag();
    }
  };
  handle.addEventListener('pointerdown', startDrag);
  handle.addEventListener('pointermove', drag);
  handle.addEventListener('lostpointercapture', endDragOnCaptureLoss);

  const showPromptAfterNudge = () => {
    handle.classList.add('is-nudged');
    if (promptTimer !== null) {
      options.timers.clear(promptTimer);
    }
    promptTimer = options.timers.set(() => {
      promptTimer = null;
      handle.classList.remove('is-nudged');
    }, NUDGE_PROMPT_MS);
  };

  return {
    width: () => width,
    reloadWidth() {
      if (!isDragging()) {
        showWidth(storedSplitWidth(options.uiState, options.stateKey, options));
      }
    },
    nudge(direction: ResizeDirection) {
      const hasLayoutBox = handle.getClientRects().length > 0;
      if (isDisposed || !hasLayoutBox) {
        return;
      }
      const { span } = options.measure();
      const next = nudgedSplitWidth(width, direction, options, span);
      if (next !== width) {
        showWidth(next);
        options.uiState.set(options.stateKey, width);
      }
      showPromptAfterNudge();
    },
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      if (dragPointer !== null) {
        endDrag();
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
}

// Two panes side by side with a drag handle between them, stacked
// (`is-stacked`) while the split is narrower than `min` plus `endMin`. The
// start pane's width opens from `uiState` under `stateKey` and is written back
// at the end of a drag and on each nudge, when either changed it;
// `reloadWidth` reads it again. Its owner calls `dispose` when it drops the
// split.
export function createSplit(options: SplitOptions): Split {
  const root = element('div', 'ui-split');
  const start = element('div', 'ui-split-start');
  const handle = element('div', 'ui-split-handle');
  const end = element('div', 'ui-split-end');
  root.append(start, handle, end);
  root.style.setProperty('--ui-split-end-min', `${options.endMin}px`);
  const observer = new ResizeObserver(([observed]) => {
    const isNarrow = observed.contentRect.width < options.min + options.endMin;
    root.classList.toggle('is-stacked', isNarrow);
  });
  observer.observe(root);

  const divider = createSplitDivider({
    ...options,
    handle,
    measure() {
      const rootRect = root.getBoundingClientRect();
      return {
        left: rootRect.left,
        span: rootRect.width - handle.getBoundingClientRect().width,
      };
    },
    show(width) {
      root.style.setProperty('--ui-split-start', String(width));
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
    dispose() {
      observer.disconnect();
      divider.dispose();
    },
  };
}
