import type { Disposable } from '../../../contracts/disposable';

// Every closed visual's source by its `div.visual-host`. `add` holds `host`
// until its Disposable's `dispose`; `sourcesIn` lists the sources of the held
// hosts under `root`, in document order.
export interface VisualRegistry {
  add(host: HTMLElement, source: string): Disposable;
  sourcesIn(root: HTMLElement): string[];
}

export function createVisualRegistry(): VisualRegistry {
  const sources = new Map<HTMLElement, string>();
  return {
    add(host, source) {
      sources.set(host, source);
      return { dispose: () => sources.delete(host) };
    },
    sourcesIn(root) {
      return [...root.querySelectorAll<HTMLElement>('.visual-host')].flatMap(
        (host) => {
          const source = sources.get(host);
          return source === undefined ? [] : [source];
        },
      );
    },
  };
}
