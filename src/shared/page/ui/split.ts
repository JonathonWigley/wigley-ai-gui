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
}

export interface Split {
  element: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
  width(): number;
  setStartHidden(hidden: boolean): void;
}

// Two panes side by side with a drag handle between them. The start pane's
// width opens from `uiState` under `stateKey` and is written back once per
// drag, when the drag changed it.
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

  let width = storedSplitWidth(options.uiState, options.stateKey, options);
  let widthAtDragStart = width;
  const showWidth = (next: number) => {
    width = next;
    root.style.setProperty('--ui-split-start', String(width));
  };
  showWidth(width);

  // The pointer whose drag the handle holds, kept until its capture loss
  // reaches the handle; a handle moved out of the document mid-drag gets no
  // lostpointercapture, so the drag stays set with its capture gone.
  let dragPointer: number | null = null;
  const endDrag = () => {
    dragPointer = null;
    handle.classList.remove('is-active');
    if (width !== widthAtDragStart) {
      options.uiState.set(options.stateKey, width);
    }
  };

  handle.addEventListener('pointerdown', (event) => {
    const dragInProgress =
      dragPointer !== null && handle.hasPointerCapture(dragPointer);
    if (event.button !== 0 || dragInProgress) {
      return;
    }
    if (dragPointer !== null) {
      endDrag();
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    dragPointer = event.pointerId;
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
    setStartHidden(hidden) {
      root.classList.toggle('is-start-hidden', hidden);
    },
  };
}
