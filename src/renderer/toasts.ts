import type { Timers } from '../contracts/ambient';
import type { ToastTone } from '../contracts/plugin';
import { errorText } from '../shared/error-text';
import { openFloatingPanel } from '../shared/page/ui/floating-panel';
import type { ToastInput } from './shell/layouts/layout';
import './toasts.css';

const TOAST_MS = 4000;

// Draws one toast into `parent` and returns its root and the dispose of what
// it drew.
export type DrawToast = (
  parent: HTMLElement,
  input: ToastInput,
) => { element: HTMLElement; dispose(): void };

// Short floating notes, newest last. `drawToast` draws each toast's look; the
// core marks its root with `data-tone` and `role="status"`, fades it in, and
// after `TOAST_MS` disposes the draw and removes the root. A draw that throws
// is logged and shows no toast.
export function createToasts(
  layer: HTMLElement,
  timers: Timers,
  drawToast: DrawToast,
  log: (message: string) => void,
): { show(text: string, tone: ToastTone): void } {
  return {
    show(text, tone) {
      let drawn: ReturnType<DrawToast>;
      try {
        drawn = drawToast(layer, { text, tone });
      } catch (error) {
        log(`toast "${text}" failed to draw: ${errorText(error)}`);
        return;
      }
      const root = drawn.element;
      root.dataset.tone = tone;
      root.setAttribute('role', 'status');
      root.hidden = true;
      openFloatingPanel(root);
      timers.set(() => {
        try {
          drawn.dispose();
        } finally {
          root.remove();
        }
      }, TOAST_MS);
    },
  };
}
