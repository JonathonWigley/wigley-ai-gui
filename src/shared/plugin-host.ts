import type { Disposable, Registrations } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type { PluginManifest, ProcessName } from '../contracts/plugin';
import { errorText } from './error-text';
import { disabledDependencyProblem } from './plugin-manifests';
import { createRegistrations } from './registrations';

// What the host hands each part's start: `dependency` returns the provider's view for this part
// (`exports(registrations)`, called once per consumer and kept), `registrations` is this part's store.
export interface PartContext {
  dependency(pluginId: string): unknown;
  registrations: Registrations;
}

export interface PluginHost<Started> {
  readonly started: ReadonlyMap<string, Started>;
  // Stops the started dependents of `pluginId` in this process, in reverse start order, then awaits the part's
  // `dispose`, then disposes its registrations, then forgets it. Does nothing for a part not started. Every step
  // runs even when one throws; the returned promise rejects with the first error.
  stop(pluginId: string): Promise<void>;
  // Stops every started part in reverse start order, with the same error rule.
  stopAll(): Promise<void>;
}

type Provider = { exports?(consumer: Registrations): unknown };

// What the host keeps for a started part besides what its start returned.
interface PartRecord {
  manifest: PluginManifest;
  registrations: Registrations & Disposable;
  // The view of each dependency this part has asked for, by provider id.
  views: Map<string, unknown>;
}

function requireUniqueIds(manifests: readonly PluginManifest[]) {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Two plugins have the id "${manifest.id}"`);
    }
    seen.add(manifest.id);
  }
}

function requireDependenciesListed(
  manifests: readonly PluginManifest[],
  process: ProcessName,
  known: readonly PluginManifest[],
) {
  const ids = new Set(known.map((manifest) => manifest.id));
  for (const manifest of manifests) {
    const missing = manifest.dependsOn[process].filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Plugin "${manifest.id}" depends on plugins not in the list: ${missing.join(', ')}`,
      );
    }
  }
}

// `dependency` for a part: its view of a plugin its manifest lists in
// `dependsOn[process]`, which started before it, made on the first ask and kept
// in `views`; undefined for one with no part here or no `exports`.
function dependencyFor(
  { manifest, registrations, views }: PartRecord,
  process: ProcessName,
  started: ReadonlyMap<string, Provider>,
): (pluginId: string) => unknown {
  return (pluginId) => {
    if (!manifest.dependsOn[process].includes(pluginId)) {
      throw new Error(
        `Plugin "${manifest.id}" asked for plugin "${pluginId}", which its manifest does not list in dependsOn.${process}`,
      );
    }
    if (!views.has(pluginId)) {
      views.set(pluginId, started.get(pluginId)?.exports?.(registrations));
    }
    return views.get(pluginId);
  };
}

// The pending part to start next: the first in `pending` once none of its
// dependencies is pending, else the first such part down the chain of each
// one's first pending dependency in list order. Throws on a chain that comes
// back to a part it passed, naming the parts of that cycle.
function nextToStart<Part extends { manifest: PluginManifest }>(
  pending: readonly Part[],
  process: ProcessName,
): Part {
  const firstPendingDependency = (part: Part) =>
    pending.find((each) =>
      part.manifest.dependsOn[process].includes(each.manifest.id),
    );
  const chain = [pending[0]];
  let dependency = firstPendingDependency(chain[0]);
  while (dependency !== undefined) {
    if (chain.includes(dependency)) {
      const cycle = chain.slice(chain.indexOf(dependency));
      const ids = cycle.map((part) => part.manifest.id).join(', ');
      throw new Error(`Plugins depend on each other in a cycle: ${ids}`);
    }
    chain.push(dependency);
    dependency = firstPendingDependency(dependency);
  }
  return chain[chain.length - 1];
}

// Runs `start`; when it throws, disposes the part's registrations and rethrows
// the start's error. A throw from that dispose is logged, so it cannot hide the
// start's.
function startWithCleanup<Started>(
  start: () => Started,
  { manifest, registrations }: PartRecord,
  log: Log | undefined,
): Started {
  try {
    return start();
  } catch (error) {
    try {
      registrations.dispose();
    } catch (disposeError) {
      log?.(
        'plugin-host',
        `disposing "${manifest.id}" after its failed start failed: ${errorText(disposeError)}`,
      );
    }
    throw error;
  }
}

// `pluginId` and every started part that depends on it in `process`, directly
// or through another dependent, in reverse start order; empty for a part not
// started. A part starts after its dependencies, so one pass over `records` in
// start order finds every dependent.
function stopOrder(
  pluginId: string,
  process: ProcessName,
  records: ReadonlyMap<string, PartRecord>,
): string[] {
  if (!records.has(pluginId)) {
    return [];
  }
  const stopping = new Set([pluginId]);
  for (const [id, { manifest }] of records) {
    if (manifest.dependsOn[process].some((each) => stopping.has(each))) {
      stopping.add(id);
    }
  }
  return [...stopping].reverse();
}

// Awaits the part's `dispose`, disposes its registrations, then forgets the
// part and its views. A step's throw goes in `errors`, and the next step runs.
async function stopPart<Started extends { dispose?(): void | Promise<void> }>(
  pluginId: string,
  started: Map<string, Started>,
  records: Map<string, PartRecord>,
  errors: unknown[],
) {
  try {
    await started.get(pluginId)?.dispose?.();
  } catch (error) {
    errors.push(error);
  }
  try {
    records.get(pluginId)?.registrations.dispose();
  } catch (error) {
    errors.push(error);
  }
  records.get(pluginId)?.views.clear();
  records.delete(pluginId);
  started.delete(pluginId);
}

function throwFirst(errors: readonly unknown[]) {
  if (errors.length > 0) {
    throw errors[0];
  }
}

// Starts every part whose id `disabled` does not name, in list order, each
// part's dependencies in this process started just before it when the list
// holds them later, so a part listed earlier than another starts before it
// unless it depends on it in this process; hands each part its own store of
// registrations and its own view of each of its dependencies in this process.
// Plugins that add parts to one surface (chat's composer parts) add them in
// this order. `known` is every plugin's manifest, those with no part in this
// process included; a dependency in `known` with no part here, such as a
// page-only plugin in main, starts nowhere in this process. `log` is the core
// log, through which `stopAll` logs `stopping <id>` before each part, so a hang
// names the plugin. Returns the host, whose `started` holds what each start
// returned, by plugin id, in start order, until the part stops. Throws on a
// duplicate id, a dependency in this process not in `known`, a kept part
// depending on a disabled plugin, or a dependency cycle in this process. A
// `start` that throws has its registrations disposed and its error rethrown;
// no host is returned, so the parts started before it stay started.
export function startPlugins<
  Part extends { manifest: PluginManifest },
  Started extends {
    exports?(consumer: Registrations): unknown;
    dispose?(): void | Promise<void>;
  },
>(
  parts: readonly Part[],
  process: ProcessName,
  start: (part: Part, context: PartContext) => Started,
  known: readonly PluginManifest[] = parts.map((part) => part.manifest),
  disabled: readonly string[] = [],
  log?: Log,
): PluginHost<Started> {
  const kept = parts.filter((part) => !disabled.includes(part.manifest.id));
  const manifests = kept.map((part) => part.manifest);
  requireUniqueIds(manifests);
  requireDependenciesListed(manifests, process, known);
  const problem = disabledDependencyProblem(disabled, manifests);
  if (problem !== null) {
    throw new Error(problem);
  }
  const started = new Map<string, Started>();
  const records = new Map<string, PartRecord>();
  let pending = [...kept];
  while (pending.length > 0) {
    const ready = nextToStart(pending, process);
    const record: PartRecord = {
      manifest: ready.manifest,
      registrations: createRegistrations(),
      views: new Map(),
    };
    const context: PartContext = {
      dependency: dependencyFor(record, process, started),
      registrations: record.registrations,
    };
    started.set(
      ready.manifest.id,
      startWithCleanup(() => start(ready, context), record, log),
    );
    records.set(ready.manifest.id, record);
    pending = pending.filter((part) => part !== ready);
  }
  return {
    started,
    async stop(pluginId) {
      const errors: unknown[] = [];
      for (const id of stopOrder(pluginId, process, records)) {
        await stopPart(id, started, records, errors);
      }
      throwFirst(errors);
    },
    async stopAll() {
      const errors: unknown[] = [];
      for (const id of [...started.keys()].reverse()) {
        log?.('plugin-host', `stopping ${id}`);
        await stopPart(id, started, records, errors);
      }
      throwFirst(errors);
    },
  };
}
