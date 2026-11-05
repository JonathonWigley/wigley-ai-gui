import type { FileWatch } from '../../../contracts/files';
import type { DocChange } from '../contract';

export interface ViewWatches {
  // Closes the watch id's watch, then watches `path` unless it is null; a later
  // call for the id wins over one still starting.
  watch(viewId: string, path: string | null): Promise<void>;
  // Closes every watch, and each one still starting once it starts.
  closeAll(): void;
}

// One watched file per watch id (a view's id, or `<viewId>:main`), each change
// sent as that id's `DocChange`.
export function createViewWatches(
  watchFile: (path: string, changed: () => void) => Promise<FileWatch>,
  send: (change: DocChange) => void,
): ViewWatches {
  const watches = new Map<string, FileWatch>();
  const latestRequest = new Map<string, number>();
  let requestCount = 0;

  const stop = (viewId: string) => {
    watches.get(viewId)?.dispose();
    watches.delete(viewId);
  };

  return {
    async watch(viewId, path) {
      const request = ++requestCount;
      latestRequest.set(viewId, request);
      stop(viewId);
      if (path === null) {
        return;
      }
      const watch = await watchFile(path, () => send({ viewId, path }));
      if (latestRequest.get(viewId) !== request) {
        watch.dispose();
        return;
      }
      watches.set(viewId, watch);
    },
    closeAll() {
      latestRequest.clear();
      for (const watch of watches.values()) {
        watch.dispose();
      }
      watches.clear();
    },
  };
}
