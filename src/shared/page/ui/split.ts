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

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
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
  const endDrag = (event: PointerEvent) => {
    if (!handle.classList.contains('is-active')) {
      return;
    }
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('is-active');
    if (width !== widthAtDragStart) {
      options.uiState.set(options.stateKey, width);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

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
