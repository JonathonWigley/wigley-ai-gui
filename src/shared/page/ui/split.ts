import './split.css';
import type { UiState } from '../../../contracts/ui-state';
import { element } from '../dom';
import {
  clampSplitWidth,
  type SplitLimits,
  storedSplitWidth,
} from './split-width';

export interface SplitOptions extends SplitLimits {
  uiState: UiState;
  stateKey: string;
  // The end pane's least width in CSS pixels, 0 when absent: the start pane
  // gives up its width down to `min` first, and below `min` plus this the
  // panes stack.
  endMin?: number;
}

export interface Split {
  element: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
  width(): number;
  // Shows the width stored under `stateKey` now, so a split another split's
  // drag wrote over takes that width; a drag in progress keeps its own.
  reloadWidth(): void;
  setStartHidden(hidden: boolean): void;
}

// Two panes side by side with a drag handle between them, stacked
// (`is-stacked`) while the split is narrower than `min` plus `endMin`. The
// start pane's width opens from `uiState` under `stateKey` and is written back
// once per drag, when the drag changed it; `reloadWidth` reads it again.
export function createSplit(options: SplitOptions): Split {
  if (options.min > options.max) {
    throw new Error(
      `Split ${options.stateKey}: min ${options.min} is above max ${options.max}`,
    );
  }
  const root = element('div', 'ui-split');
  const start = element('div', 'ui-split-start');
  const handle = element('div', 'ui-split-handle');
  const end = element('div', 'ui-split-end');
  root.append(start, handle, end);
  const endMin = options.endMin ?? 0;
  if (endMin > 0) {
    root.style.setProperty('--ui-split-end-min', `${endMin}px`);
    new ResizeObserver(([observed]) => {
      const isNarrow = observed.contentRect.width < options.min + endMin;
      root.classList.toggle('is-stacked', isNarrow);
    }).observe(root);
  }

  let width = storedSplitWidth(options.uiState, options.stateKey, options);
  let widthAtDragStart = width;
  const showWidth = (next: number) => {
    width = next;
    root.style.setProperty('--ui-split-start', String(width));
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

  handle.addEventListener('pointerdown', (event) => {
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
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }
    const left = root.getBoundingClientRect().left;
    showWidth(clampSplitWidth(event.clientX - left, options));
  });
  // The browser fires lostpointercapture after pointerup and pointercancel
  // release capture, and on every other loss of it while the handle is in the
  // document.
  handle.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === dragPointer) {
      endDrag();
    }
  });

  return {
    element: root,
    start,
    end,
    width: () => width,
    reloadWidth() {
      if (!isDragging()) {
        showWidth(storedSplitWidth(options.uiState, options.stateKey, options));
      }
    },
    setStartHidden(hidden) {
      root.classList.toggle('is-start-hidden', hidden);
    },
  };
}
