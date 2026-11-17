import type { AlertNoun, Alerts } from '../contracts/alerts';
import type { Registrations } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { Files } from '../contracts/files';
import type { MarkdownRenderer } from '../contracts/markdown';
import type { ProcessRunner } from '../contracts/processes';
import type { UserConfig } from '../contracts/user-config';
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
// aborts that run. A detached start passes through untracked, since it is meant
// to outlive the plugin and the app.
export function abortableProcesses(
  processes: ProcessRunner,
  registrations: Registrations,
): ProcessRunner {
  const stopping = new AbortController();
  registrations.track({ dispose: () => stopping.abort() });
  return {
    startDetached: (command, args, options) =>
      processes.startDetached(command, args, options),
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

// One plugin's view of `alerts`: `registrations` disposing it sets to 0, with
// its last noun, each source whose last count from this plugin is not 0, and a
// count set after that is dropped.
export function trackedAlerts(
  alerts: Alerts,
  registrations: Registrations,
): Alerts {
  const lastCounts = new Map<string, { count: number; noun: AlertNoun }>();
  let isDisposed = false;
  registrations.track({
    dispose() {
      isDisposed = true;
      for (const [source, { count, noun }] of lastCounts) {
        if (count !== 0) {
          alerts.setOpenCount(source, 0, noun);
        }
      }
    },
  });
  return {
    setOpenCount(source, count, noun) {
      if (!isDisposed) {
        lastCounts.set(source, { count, noun });
        alerts.setOpenCount(source, count, noun);
      }
    },
  };
}

// One plugin's view of `userConfig`: `registrations` disposing it drops every
// `onChanged` listener the plugin added.
export function trackedUserConfig(
  userConfig: UserConfig,
  registrations: Registrations,
): UserConfig {
  return {
    ...userConfig,
    onChanged: (listener) =>
      registrations.track(userConfig.onChanged(listener)),
  };
}

// The live editors are one store entry, so a destroyed editor's view is not
// held. An editor made after the store's `dispose` is destroyed at once, and an
// editor's `destroy` runs its own once.
export function trackedEditor(
  editor: EditorHost,
  registrations: Registrations,
): EditorHost {
  const live = registrations.track(createRegistrations());
  const recorded = <E extends { destroy(): void }>(created: E): E => {
    const ownDestroy = created.destroy;
    const entry = live.track({ dispose: () => ownDestroy.call(created) });
    created.destroy = () => entry.dispose();
    return created;
  };
  return {
    ...editor,
    create: (...args) => recorded(editor.create(...args)),
    createDocument: (...args) => recorded(editor.createDocument(...args)),
    onPendingKeys: (listener) =>
      registrations.track(editor.onPendingKeys(listener)),
  };
}

// One plugin's view of `markdown`: `registrations` disposing it removes every
// fence the plugin added.
export function trackedMarkdown(
  markdown: MarkdownRenderer,
  registrations: Registrations,
): MarkdownRenderer {
  return {
    ...markdown,
    addFence: (fence) => registrations.track(markdown.addFence(fence)),
  };
}
