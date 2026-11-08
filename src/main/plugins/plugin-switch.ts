import type { Timers } from '../../contracts/ambient';
import type {
  PluginPartsReply,
  PluginPartsRequest,
} from '../../contracts/bridge';
import type { PluginStatus } from '../../contracts/core-state';
import type { Log } from '../../contracts/log';
import type {
  MainStart,
  PluginManifest,
  PluginSwitchService,
} from '../../contracts/plugin';
import type { SlotWriter } from '../../contracts/state';
import { errorText } from '../../shared/error-text';
import type { PluginHost } from '../../shared/plugin-host';
import { neededBy } from '../../shared/plugin-manifests';
import type { AppliedPlugins } from './applied-plugins';

// How often a refused switch-off asks again, until the part lets go or the list changes.
export const PLUGIN_RETRY_MS = 2000;

// Turns plugins on and off while the app runs. `apply` and `restart` run one at a time, each after the one
// before it settles; `mayDisable` runs beside them.
export interface PluginSwitch extends PluginSwitchService {
  // Applies a new disabled list: refuses with the host's `<id>: <reason>` when a part `mayStop` refuses
  // (a config problem, retried every `PLUGIN_RETRY_MS`), else stops page parts then main parts, clears the
  // switched-off owners' slots, starts main parts then page parts, and sets the applied list. Resolves to the
  // refusal or null.
  apply(disabled: readonly string[]): Promise<string | null>;
  // The reason turning `pluginId` off would be refused now, in words Settings shows (neededBy, then mayStop),
  // or null.
  mayDisable(pluginId: string): Promise<string | null>;
  // Stops `pluginId` and its dependents, page parts first, then starts what stopped, main parts first; their
  // slots are kept. Rejects for a plugin that is off or that no manifest has.
  restart(pluginId: string): Promise<void>;
}

export interface PluginSwitchDeps {
  main: Pick<
    PluginHost<MainStart<PluginManifest>>,
    'start' | 'stop' | 'mayStop' | 'started'
  >;
  page(request: PluginPartsRequest): Promise<PluginPartsReply>;
  applied: AppliedPlugins;
  slots: { clearOwner(pluginId: string): void };
  status: SlotWriter<readonly PluginStatus[]>;
  manifests: readonly PluginManifest[];
  // Sets or clears the switch's config problem.
  problem(message: string | null): void;
  // The applied list changed: push the served config to the page and apply main's keys again.
  servedChanged(): void;
  timers: Timers;
  log: Log;
}

const SOURCE = 'plugin-switch';

// The ids of `manifests` that `isIncluded` keeps, in manifests order.
function idsWhere(
  manifests: readonly PluginManifest[],
  isIncluded: (id: string) => boolean,
): string[] {
  return manifests.map((manifest) => manifest.id).filter(isIncluded);
}

// The host's `<id>: <reason>` split at its first `: `.
function splitRefusal(refusal: string): { id: string; reason: string } {
  const at = refusal.indexOf(': ');
  return { id: refusal.slice(0, at), reason: refusal.slice(at + 2) };
}

function reasonOf(reply: PluginPartsReply): string | null {
  return 'reason' in reply ? reply.reason : null;
}

function stoppedOf(reply: PluginPartsReply): readonly string[] {
  return 'stopped' in reply ? reply.stopped : [];
}

export function createPluginSwitch(deps: PluginSwitchDeps): PluginSwitch {
  const { main, applied, manifests } = deps;
  const known = new Set(manifests.map((manifest) => manifest.id));
  const label = (id: string) =>
    manifests.find((manifest) => manifest.id === id)?.label ?? id;
  let lastRefusal: string | null = null;
  // The refused list a retry applies; null when no retry waits.
  let pending: readonly string[] | null = null;
  let retryHandle: number | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const inQueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };

  const writeStatus = () => {
    const disabled = applied.disabled();
    deps.status.set(
      manifests.map((manifest) => ({
        id: manifest.id,
        label: manifest.label,
        description: manifest.description,
        on: !disabled.includes(manifest.id),
        neededBy: neededBy(manifest.id, disabled, manifests),
      })),
    );
  };

  const mayStop = async (ids: readonly string[]) =>
    main.mayStop(ids) ?? reasonOf(await deps.page({ kind: 'mayStop', ids }));

  const refuse = (refusal: string) => {
    const { id, reason } = splitRefusal(refusal);
    deps.problem(
      `"plugins.disabled" names "${id}", which cannot stop now: ${reason}`,
    );
    if (refusal !== lastRefusal) {
      deps.log(SOURCE, `refused ${id}: ${reason}`);
    }
    lastRefusal = refusal;
  };

  // Steps 3 and 4: the binds leave while the handlers exist, then page parts stop before main parts.
  const switchOff = async (off: readonly string[]) => {
    applied.set([...applied.disabled(), ...off]);
    deps.servedChanged();
    await deps.page({ kind: 'stop', ids: off });
    try {
      for (const id of off) {
        await main.stop(id);
      }
    } catch (error) {
      for (const id of off.filter((each) => !main.started.has(each))) {
        deps.slots.clearOwner(id);
      }
      throw error;
    }
    for (const id of off) {
      deps.slots.clearOwner(id);
    }
    for (const id of off) {
      deps.log(SOURCE, `off ${id}`);
    }
  };

  // Step 5: main parts start before the binds join, and the page parts after both.
  const switchOn = async (on: readonly string[], next: readonly string[]) => {
    try {
      main.start(on);
    } catch (error) {
      await stopStarted(on);
      throw error;
    }
    applied.set(next);
    deps.servedChanged();
    await deps.page({ kind: 'start', ids: on });
    for (const id of on) {
      deps.log(SOURCE, `on ${id}`);
    }
  };

  // Stops each of `ids` that main has started, last first; a stop that throws is logged.
  const stopStarted = async (ids: readonly string[]) => {
    for (const id of [...ids].reverse()) {
      if (!main.started.has(id)) {
        continue;
      }
      try {
        await main.stop(id);
      } catch (error) {
        deps.log(SOURCE, `failed: ${errorText(error)}`);
      }
    }
  };

  const applyNow = async (
    disabled: readonly string[],
  ): Promise<string | null> => {
    const next = disabled.filter((id) => known.has(id));
    const current = applied.disabled();
    const off = idsWhere(
      manifests,
      (id) => next.includes(id) && !current.includes(id),
    );
    const on = idsWhere(
      manifests,
      (id) => current.includes(id) && !next.includes(id),
    );
    if (off.length === 0 && on.length === 0) {
      deps.problem(null);
      lastRefusal = null;
      return null;
    }
    try {
      if (off.length > 0) {
        const refusal = await mayStop(off);
        if (refusal !== null) {
          refuse(refusal);
          return refusal;
        }
        await switchOff(off);
      }
      if (on.length > 0) {
        await switchOn(on, next);
      }
    } finally {
      writeStatus();
    }
    deps.problem(null);
    lastRefusal = null;
    return null;
  };

  const retry = () => {
    retryHandle = null;
    if (pending !== null) {
      apply(pending).catch((error: unknown) =>
        deps.log(SOURCE, `failed: ${errorText(error)}`),
      );
    }
  };

  const apply = (disabled: readonly string[]) => {
    if (pending !== null) {
      pending = disabled;
    }
    return inQueue(async () => {
      const refusal = await applyNow(disabled);
      if (refusal === null) {
        pending = null;
        if (retryHandle !== null) {
          deps.timers.clear(retryHandle);
          retryHandle = null;
        }
        return null;
      }
      pending = disabled;
      retryHandle ??= deps.timers.set(retry, PLUGIN_RETRY_MS);
      return refusal;
    });
  };

  writeStatus();
  return {
    apply,
    async mayDisable(pluginId) {
      const disabled = applied.disabled();
      if (disabled.includes(pluginId)) {
        return null;
      }
      const needers = neededBy(pluginId, disabled, manifests);
      if (needers.length > 0) {
        return `${label(pluginId)} is needed by ${needers.map(label).join(', ')}`;
      }
      const refusal = await mayStop([pluginId]);
      if (refusal === null) {
        return null;
      }
      const { id, reason } = splitRefusal(refusal);
      return `${label(id)} cannot switch off now: ${reason}`;
    },
    restart: (pluginId) =>
      inQueue(async () => {
        if (!known.has(pluginId)) {
          throw new Error(`No plugin "${pluginId}"`);
        }
        if (applied.disabled().includes(pluginId)) {
          throw new Error(`Plugin "${pluginId}" is off`);
        }
        try {
          const pageStopped = stoppedOf(
            await deps.page({ kind: 'stop', ids: [pluginId] }),
          );
          const mainStopped = await main.stop(pluginId);
          main.start(mainStopped);
          await deps.page({ kind: 'start', ids: pageStopped });
          deps.log(SOURCE, `restarted ${pluginId}`);
        } finally {
          writeStatus();
        }
      }),
  };
}
