import type { Disposable } from '../../contracts/disposable';

// Hears `window`'s `pagehide`, which fires as a reload or close tears the page down.
export function onPageHide(listener: () => void): Disposable {
  window.addEventListener('pagehide', listener);
  return {
    dispose() {
      window.removeEventListener('pagehide', listener);
    },
  };
}
