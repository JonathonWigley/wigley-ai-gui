import type { Timers } from '../contracts/ambient';
import type { ToastTone } from '../contracts/plugin';
import { element } from '../shared/page/dom';
import {
  floatingPanel,
  openFloatingPanel,
} from '../shared/page/ui/floating-panel';
import { type DotStatus, statusDot } from '../shared/page/ui/status-dot';
import './toasts.css';

const TOAST_MS = 4000;

// The status dot leading each tone's toast; an info note carries none.
const TOAST_DOTS: Record<ToastTone, DotStatus | null> = {
  success: 'success',
  info: null,
  error: 'error',
};

// Short floating notes that fade in and remove themselves, newest last.
export function createToasts(
  layer: HTMLElement,
  timers: Timers,
): { show(text: string, tone: ToastTone): void } {
  return {
    show(text, tone) {
      const toast = floatingPanel();
      toast.classList.add('toast');
      toast.dataset.tone = tone;
      toast.setAttribute('role', 'status');
      const dot = TOAST_DOTS[tone];
      if (dot !== null) {
        toast.append(statusDot(dot));
      }
      toast.append(element('span', 'toast-text', text));
      toast.hidden = true;
      layer.append(toast);
      openFloatingPanel(toast);
      timers.set(() => toast.remove(), TOAST_MS);
    },
  };
}
