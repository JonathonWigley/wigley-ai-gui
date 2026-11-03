import type { Alerts } from '../contracts/alerts';
import type { Registrations } from '../contracts/disposable';
import type { Files } from '../contracts/files';
import type { ProcessRunner } from '../contracts/processes';
import { createRegistrations } from './registrations';

// One plugin's view of `files`: `registrations` disposing it disposes the
// plugin's live watches, and a watch made after that is disposed at once. A
// watch's own `dispose` forgets it, so a disposed watch is not held.
export function trackedFiles(
  files: Files,
  registrations: Registrations,
): Files {
  const liveWatches = registrations.track(createRegistrations());
  return {
    ...files,
    watch: (folder, onChange, options) =>
      liveWatches.track(files.watch(folder, onChange, options)),
  };
}

// One plugin's view of `processes`: `registrations` disposing it aborts every
// run still going and every later one, as an abort of the caller's own `signal`
// aborts that run.
export function abortableProcesses(
  processes: ProcessRunner,
  registrations: Registrations,
): ProcessRunner {
  const stopping = new AbortController();
  registrations.track({ dispose: () => stopping.abort() });
  return {
    run: (command, args, options) =>
      processes.run(command, args, {
        ...options,
        signal:
          options?.signal === undefined
            ? stopping.signal
            : AbortSignal.any([options.signal, stopping.signal]),
      }),
  };
}

// One plugin's view of `alerts`: `registrations` disposing it sets to 0 each
// source whose last count from this plugin is not 0, and a count set after that
// is dropped.
export function trackedAlerts(
  alerts: Alerts,
  registrations: Registrations,
): Alerts {
  const lastCounts = new Map<string, number>();
  let isDisposed = false;
  registrations.track({
    dispose() {
      isDisposed = true;
      for (const [source, count] of lastCounts) {
        if (count !== 0) {
          alerts.setOpenCount(source, 0);
        }
      }
    },
  });
  return {
    announce: (title, body, onClick) => alerts.announce(title, body, onClick),
    setOpenCount(source, count) {
      if (!isDisposed) {
        lastCounts.set(source, count);
        alerts.setOpenCount(source, count);
      }
    },
  };
}
