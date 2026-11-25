import type { AgentHarnessRegistry } from '../contracts/agent';
import type { AlertNoun, Alerts } from '../contracts/alerts';
import type { Registrations } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { Files } from '../contracts/files';
import type { MarkdownRenderer } from '../contracts/markdown';
import type {
  ProcessRunner,
  SpawnedProcess,
  SpawnOptions,
} from '../contracts/processes';
import type { TerminalEmulator } from '../contracts/terminal-emulator';
import type { UserConfig } from '../contracts/user-config';
import { callEach } from './call-each';
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
// to outlive the plugin and the app. `spawn` is the tracked path: disposing
// kills every live spawned program with `SIGKILL`, and a later spawn starts
// nothing and hears `closed` with `Stopped <command>` on a microtask.
// `resolveProgram` forwards unchanged.
export function abortableProcesses(
  processes: ProcessRunner,
  registrations: Registrations,
): ProcessRunner {
  const stopping = new AbortController();
  const liveSpawns = new Set<SpawnedProcess>();
  registrations.track({
    dispose: () => {
      stopping.abort();
      const spawns = [...liveSpawns];
      liveSpawns.clear();
      callEach(spawns, (spawned) => spawned.kill('SIGKILL'));
    },
  });
  const spawnTracked = (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): SpawnedProcess => {
    if (stopping.signal.aborted) {
      queueMicrotask(() =>
        options.events.closed({
          code: null,
          signal: null,
          startError: { message: `Stopped ${command}`, notFound: false },
        }),
      );
      return { write() {}, endInput() {}, kill() {} };
    }
    // `closed` may come inside the spawn call, before `spawned` is set.
    let spawned: SpawnedProcess | null = null;
    let hasClosed = false;
    spawned = processes.spawn(command, args, {
      ...options,
      events: {
        stdout: (chunk) => options.events.stdout(chunk),
        stderr: (chunk) => options.events.stderr(chunk),
        closed: (exit) => {
          hasClosed = true;
          if (spawned !== null) {
            liveSpawns.delete(spawned);
          }
          options.events.closed(exit);
        },
      },
    });
    if (!hasClosed) {
      liveSpawns.add(spawned);
    }
    return spawned;
  };
  return {
    startDetached: (command, args, options) =>
      processes.startDetached(command, args, options),
    spawn: spawnTracked,
    resolveProgram: (name) => processes.resolveProgram(name),
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

// One plugin's view of `agentHarnesses`: `registrations` disposing it disposes
// every harness registration the plugin made, so a stopped harness plugin's
// adapter leaves the registry.
export function trackedAgentHarnesses(
  registry: AgentHarnessRegistry,
  registrations: Registrations,
): AgentHarnessRegistry {
  return {
    register: (harness) => registrations.track(registry.register(harness)),
    list: () => registry.list(),
    get: (id) => registry.get(id),
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
// editor's `destroy` runs its own once. A plugin's ex commands are removed when
// it stops.
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
    defineEx: (name, prefix, handler) =>
      registrations.track(editor.defineEx(name, prefix, handler)),
  };
}

// The live screens are one store entry, so a disposed screen is not held. A
// screen made after the store's `dispose` is disposed at once, and a screen's
// `dispose` runs its own once.
export function trackedTerminals(
  terminals: TerminalEmulator,
  registrations: Registrations,
): TerminalEmulator {
  const live = registrations.track(createRegistrations());
  return {
    create: (options) => {
      const screen = terminals.create(options);
      const ownDispose = screen.dispose;
      const entry = live.track({ dispose: () => ownDispose.call(screen) });
      screen.dispose = () => entry.dispose();
      return screen;
    },
  };
}

// One plugin's view of `markdown`: `registrations` disposing it removes every
// fence and block the plugin added.
export function trackedMarkdown(
  markdown: MarkdownRenderer,
  registrations: Registrations,
): MarkdownRenderer {
  return {
    ...markdown,
    addFence: (fence) => registrations.track(markdown.addFence(fence)),
    addBlock: (block) => registrations.track(markdown.addBlock(block)),
  };
}
