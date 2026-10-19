import type { Timers } from '../contracts/ambient';
import type { ToastTone } from '../contracts/plugin';

const TOAST_MS = 4000;

// Short notes that remove themselves, newest last.
export function createToasts(
  layer: HTMLElement,
  timers: Timers,
): { show(text: string, tone: ToastTone): void } {
  return {
    show(text, tone) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.dataset.tone = tone;
      toast.setAttribute('role', 'status');
      toast.textContent = text;
      layer.append(toast);
      timers.set(() => toast.remove(), TOAST_MS);
    },
  };
}
