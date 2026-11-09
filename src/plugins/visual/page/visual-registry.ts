import type { Disposable } from '../../../contracts/disposable';

// Every closed visual's source by its `div.visual-host`. `add` holds `host`
// until its Disposable's `dispose`; `hostsIn` lists the held hosts under
// `root`, and `sourcesIn` their sources, in document order.
export interface VisualRegistry {
  add(host: HTMLElement, source: string): Disposable;
  hostsIn(root: HTMLElement): HTMLElement[];
  sourcesIn(root: HTMLElement): string[];
}

export function createVisualRegistry(): VisualRegistry {
  const sources = new Map<HTMLElement, string>();
  const hostsIn = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('.visual-host')].filter((host) =>
      sources.has(host),
    );
  return {
    add(host, source) {
      sources.set(host, source);
      return { dispose: () => sources.delete(host) };
    },
    hostsIn,
    sourcesIn(root) {
      return hostsIn(root).flatMap((host) => {
        const source = sources.get(host);
        return source === undefined ? [] : [source];
      });
    },
  };
}
