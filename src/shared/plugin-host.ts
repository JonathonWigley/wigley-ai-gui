import type { Disposable, Registrations } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type {
  PartStop,
  PluginManifest,
  ProcessName,
} from '../contracts/plugin';
import { errorText } from './error-text';
import { disabledDependencyProblem } from './plugin-manifests';
import { createRegistrations } from './registrations';

// What the host hands each part's start: `dependency` returns the provider's
// view for this part (`exports(registrations)`, called once per consumer and
// kept), `registrations` is this part's store.
export interface PartContext {
  dependency(pluginId: string): unknown;
  registrations: Registrations;
}

// A host holds every part it was handed or `add`ed and not `remove`d, the
// disabled ones included, so a later `start` can bring any of them up.
// "Start order" below is the order of `started`: a part started again goes to
// its end. A dependency is known when `startPlugins`' `known` holds its
// manifest or the host holds its part, both read at each check.
export interface PluginHost<Started, Part = unknown> {
  // What each start returned, by plugin id, in start order, until the part
  // stops.
  readonly started: ReadonlyMap<string, Started>;
  // Calls `ready()` on every started part, in start order. The composition
  // root calls it once, after the start. A `ready` that throws is logged as
  // `ready of <id> failed: <error>` and the next part's `ready` still runs; it
  // does not throw.
  ready(): void;
  // Starts each held part that `pluginIds` names and that is not started, in
  // dependency order, then calls `ready()` on each one it started. The order
  // is held list order (`parts`, then each `add` at the end), each part's
  // dependencies first, never an earlier start order. An id with no part held
  // in this process is ignored, a started id (one whose stop is in flight
  // included) is skipped and not checked, and a known dependency with no part
  // here is allowed.
  // Throws, starting nothing, when a part it would start depends on a plugin
  // that is not known: `Plugin "<id>" depends on plugins not in the list:
  // <ids>`; or on a part that is not started, or whose stop is in flight, and
  // is not named: `Plugin "<id>" depends on plugin "<dependency>", which is
  // not started`, for the first such pair in that order. A start that throws has its registrations
  // disposed; the parts this call started before it stay started and get
  // their `ready`, the parts after it are not started, and the start's error
  // is rethrown. A `ready` that throws is logged, as `ready()` logs it, and not
  // rethrown. Once `stopAll` began, it throws `Plugin host is stopping` and
  // starts nothing.
  start(pluginIds: readonly string[]): void;
  // Starts each held part that `pluginIds` names and that is not started, one
  // at a time in `start`'s order, each as `start([id])` would, so each part's
  // `ready` runs before its dependents start: a part whose start or check
  // throws, a dependent of a part that threw included, does not keep the next
  // from starting. Returns each throw with the id of the part that threw, in
  // that order. Throws `Plugin host is stopping`, starting nothing, once
  // `stopAll` began.
  startEach(pluginIds: readonly string[]): { id: string; error: unknown }[];
  // Whether the host holds a part of `pluginId`, started or not.
  holds(pluginId: string): boolean;
  // Stops the started dependents of `pluginId` in this process, newest first,
  // then the part, and resolves to the ids it stopped, in that stop order.
  // Logs `stopping <id>` before each part. Each stop awaits the part's
  // `dispose`, handed `stop` (`end` when left out), then disposes its
  // registrations, then forgets it. Resolves to
  // `[]` for a part not started. Every step runs even when one throws; the
  // returned promise then rejects with the first error and without the ids, so
  // a caller reads `started` for what is left. A part already stopping is not
  // stopped twice: this call waits on the stop in flight and shares its
  // errors, so a part's own `dispose` must not call it on that part.
  stop(pluginId: string, stop?: PartStop): Promise<string[]>;
  // Holds `part`, at the end of the held list, starting nothing and calling no
  // `ready`; the caller calls `start([id])`. Throws, changing nothing: once
  // `stopAll` began, `Plugin host is stopping`; on an id the host holds,
  // `Two plugins have the id "<id>"`; on a dependency in this process that is
  // not known, `Plugin "<id>" depends on plugins not in the list: <ids>`; on a
  // dependency cycle in this process over every held part and `part`,
  // disabled ones included, `Plugins depend on each other in a cycle: <ids>`.
  add(part: Part): void;
  // stop(pluginId, stop), then forgets the part, also when the stop rejects;
  // its dependents stay held, stopped. Resolves to the ids it stopped, or
  // rejects with the stop's first error. Resolves to `[]` for an id the host
  // does not hold. Runs after `stopAll` began, as `stop` does.
  remove(pluginId: string, stop?: PartStop): Promise<string[]>;
  // stop(pluginId, 'restart'), then start(the ids it stopped), resolving to the
  // ids in stop order. Each part gets new registrations and new views, so a
  // dependent's `dependency` gives the new provider's exports; slots are
  // untouched. When the stop rejects, it rejects with that error and starts
  // nothing. When a start throws, it rejects with that error, as `start` leaves
  // it: the parts started before it run and got their `ready`, the rest stay
  // stopped.
  restart(pluginId: string): Promise<string[]>;
  // The first reason a started part in `pluginIds` gives through `mayStop`, as
  // `"<id>: <reason>"`, or null. The parts are asked in start order; a part
  // with no `mayStop`, or a named id not started, gives no reason. A `mayStop`
  // that throws reaches the caller, and the parts after it are not asked.
  mayStop(pluginIds: readonly string[]): string | null;
  // The ids whose stop is in flight now, in the order their stops began.
  stopping(): readonly string[];
  // Stops every started part in reverse start order, as an `end`, logging
  // `stopping <id>` before each, with the same error and overlap rules as
  // `stop`. From its first call on, `start` throws.
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

// Awaits the part's `dispose`, handed `stop`, disposes its registrations, then
// forgets the part and its views. Returns each step's throw; a throw does not
// stop the next step.
async function runStopSteps<
  Started extends { dispose?(stop: PartStop): void | Promise<void> },
>(
  pluginId: string,
  stop: PartStop,
  started: Map<string, Started>,
  records: Map<string, PartRecord>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  try {
    await started.get(pluginId)?.dispose?.(stop);
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
  return errors;
}

// The one stop of `pluginId`, resolving to its steps' throws: a part already
// stopping answers with the stop in `inFlight`, so its `dispose` runs once,
// handed the first stop's `stop`.
function stopPart<
  Started extends { dispose?(stop: PartStop): void | Promise<void> },
>(
  pluginId: string,
  stop: PartStop,
  started: Map<string, Started>,
  records: Map<string, PartRecord>,
  inFlight: Map<string, Promise<unknown[]>>,
): Promise<unknown[]> {
  const running = inFlight.get(pluginId);
  if (running !== undefined) {
    return running;
  }
  const stopping = runStopSteps(pluginId, stop, started, records).finally(() =>
    inFlight.delete(pluginId),
  );
  inFlight.set(pluginId, stopping);
  return stopping;
}

function throwFirst(errors: readonly unknown[]) {
  if (errors.length > 0) {
    throw errors[0];
  }
}

// Starts each of `candidates` through `start` in dependency order
// (`nextToStart`), each with a new record, and adds it to `started`, `records`
// and `startedNow` as it comes up, so after a start that throws `startedNow`
// holds the ones started before it.
function startInOrder<
  Part extends { manifest: PluginManifest },
  Started extends Provider,
>(
  candidates: readonly Part[],
  process: ProcessName,
  start: (part: Part, context: PartContext) => Started,
  started: Map<string, Started>,
  records: Map<string, PartRecord>,
  log: Log | undefined,
  startedNow: string[] = [],
) {
  let pending = [...candidates];
  while (pending.length > 0) {
    const next = nextToStart(pending, process);
    const record: PartRecord = {
      manifest: next.manifest,
      registrations: createRegistrations(),
      views: new Map(),
    };
    const context: PartContext = {
      dependency: dependencyFor(record, process, started),
      registrations: record.registrations,
    };
    started.set(
      next.manifest.id,
      startWithCleanup(() => start(next, context), record, log),
    );
    records.set(next.manifest.id, record);
    startedNow.push(next.manifest.id);
    pending = pending.filter((part) => part !== next);
  }
}

// Throws on the first candidate, in `candidates` order, with a dependency in
// `process` that has a part in `partIds` but is not a candidate and is not
// started or is stopping: a stop in flight ends without stopping a dependent
// started after it began.
function requireDependenciesStarting(
  candidates: readonly { manifest: PluginManifest }[],
  process: ProcessName,
  partIds: ReadonlySet<string>,
  started: ReadonlyMap<string, unknown>,
  inFlight: ReadonlyMap<string, unknown>,
) {
  const candidateIds = new Set(candidates.map((part) => part.manifest.id));
  const isRunning = (id: string) => started.has(id) && !inFlight.has(id);
  for (const { manifest } of candidates) {
    const missing = manifest.dependsOn[process].find(
      (id) => partIds.has(id) && !isRunning(id) && !candidateIds.has(id),
    );
    if (missing !== undefined) {
      throw new Error(
        `Plugin "${manifest.id}" depends on plugin "${missing}", which is not started`,
      );
    }
  }
}

// Calls `ready` on each of `pluginIds` in order; a throw is logged and the
// next part's `ready` still runs.
function readyEach(
  pluginIds: readonly string[],
  started: ReadonlyMap<string, { ready?(): void }>,
  log: Log | undefined,
) {
  for (const id of pluginIds) {
    try {
      started.get(id)?.ready?.();
    } catch (error) {
      log?.('plugin-host', `ready of ${id} failed: ${errorText(error)}`);
    }
  }
}

// The manifests of `parts`.
function manifestsOf(parts: readonly { manifest: PluginManifest }[]) {
  return parts.map((part) => part.manifest);
}

// Throws when `parts` hold a dependency cycle in `process`, starting nothing:
// takes `nextToStart` out of a copy until it is empty.
function requireNoCycle(
  parts: readonly { manifest: PluginManifest }[],
  process: ProcessName,
) {
  let pending = [...parts];
  while (pending.length > 0) {
    const next = nextToStart(pending, process);
    pending = pending.filter((part) => part !== next);
  }
}

// Starts every part whose id `disabled` does not name, in list order, each
// part's dependencies in this process started just before it when the list
// holds them later, so a part listed earlier than another starts before it
// unless it depends on it in this process; hands each part its own store of
// registrations and its own view of each of its dependencies in this process.
// Plugins that add parts to one surface (chat's composer parts) add them in
// this order. The host holds every part, the disabled ones included, so its
// `start` can bring one up later, and its held list grows by `add` and shrinks
// by `remove`; it calls no `ready` here, and the caller calls `host.ready()`
// once. `known` is every plugin's manifest, those with no part in this process
// included, as an array or a function the host calls at each check; left out,
// it is the manifests of the parts the host holds at that check. A dependency
// in `known` with no part here, such as a page-only plugin in main, starts
// nowhere in this process. `disabled` is read only here. `log`
// takes the host's own lines: `stop` and `stopAll` log `stopping <id>` before
// each part, so a hang names the plugin, a failed `ready` logs `ready of <id>
// failed: <error>`, and a failed start logs a failed cleanup; the caller picks
// who reads them. Returns the host, whose `started` holds what each start
// returned, by plugin id, in start order, until the part stops. Throws on a
// duplicate id or a dependency in this process not in `known` (read once
// here), each checked over every part, disabled ones included; on a kept part depending on a
// disabled plugin; or on a dependency cycle in this process. A `start` that
// throws has its registrations disposed and its error rethrown; no host is
// returned, so the parts started before it stay started.
export function startPlugins<
  Part extends { manifest: PluginManifest },
  Started extends {
    exports?(consumer: Registrations): unknown;
    dispose?(stop: PartStop): void | Promise<void>;
    ready?(): void;
    mayStop?(): string | null;
  },
>(
  parts: readonly Part[],
  process: ProcessName,
  start: (part: Part, context: PartContext) => Started,
  known?: readonly PluginManifest[] | (() => readonly PluginManifest[]),
  disabled: readonly string[] = [],
  log?: Log,
): PluginHost<Started, Part> {
  const held = [...parts];
  const knownNow = () => {
    if (known === undefined) {
      return manifestsOf(held);
    }
    return typeof known === 'function' ? known() : known;
  };
  // What `add` and `start` check a dependency against.
  const knownOrHeld = () => [...knownNow(), ...manifestsOf(held)];
  const manifests = manifestsOf(parts);
  requireUniqueIds(manifests);
  requireDependenciesListed(manifests, process, knownNow());
  const kept = parts.filter((part) => !disabled.includes(part.manifest.id));
  const problem = disabledDependencyProblem(
    disabled,
    kept.map((part) => part.manifest),
  );
  if (problem !== null) {
    throw new Error(problem);
  }
  const started = new Map<string, Started>();
  const records = new Map<string, PartRecord>();
  const inFlight = new Map<string, Promise<unknown[]>>();
  let stopAllBegan = false;
  startInOrder(kept, process, start, started, records, log);

  function startNamed(pluginIds: readonly string[]) {
    if (stopAllBegan) {
      throw new Error('Plugin host is stopping');
    }
    const candidates = held.filter(
      (part) =>
        pluginIds.includes(part.manifest.id) && !started.has(part.manifest.id),
    );
    requireDependenciesListed(manifestsOf(candidates), process, knownOrHeld());
    requireDependenciesStarting(
      candidates,
      process,
      new Set(held.map((part) => part.manifest.id)),
      started,
      inFlight,
    );
    const startedNow: string[] = [];
    try {
      startInOrder(
        candidates,
        process,
        start,
        started,
        records,
        log,
        startedNow,
      );
    } finally {
      // A start that threw leaves the parts before it started, so they get
      // their `ready` too.
      readyEach(startedNow, started, log);
    }
  }

  function startEach(pluginIds: readonly string[]) {
    if (stopAllBegan) {
      throw new Error('Plugin host is stopping');
    }
    let pending = held.filter(
      (part) =>
        pluginIds.includes(part.manifest.id) && !started.has(part.manifest.id),
    );
    const failures: { id: string; error: unknown }[] = [];
    while (pending.length > 0) {
      const next = nextToStart(pending, process);
      pending = pending.filter((part) => part !== next);
      try {
        startNamed([next.manifest.id]);
      } catch (error) {
        failures.push({ id: next.manifest.id, error });
      }
    }
    return failures;
  }

  async function stop(pluginId: string, kind: PartStop = 'end') {
    const ids = stopOrder(pluginId, process, records);
    const errors: unknown[] = [];
    for (const id of ids) {
      log?.('plugin-host', `stopping ${id}`);
      errors.push(...(await stopPart(id, kind, started, records, inFlight)));
    }
    throwFirst(errors);
    return ids;
  }

  return {
    started,
    ready() {
      readyEach([...started.keys()], started, log);
    },
    start: startNamed,
    startEach,
    holds: (pluginId) => held.some((part) => part.manifest.id === pluginId),
    stop,
    add(part) {
      if (stopAllBegan) {
        throw new Error('Plugin host is stopping');
      }
      requireUniqueIds([...manifestsOf(held), part.manifest]);
      requireDependenciesListed([part.manifest], process, knownOrHeld());
      requireNoCycle([...held, part], process);
      held.push(part);
    },
    async remove(pluginId, kind) {
      const part = held.find((each) => each.manifest.id === pluginId);
      if (part === undefined) {
        return [];
      }
      try {
        return await stop(pluginId, kind);
      } finally {
        held.splice(held.indexOf(part), 1);
      }
    },
    async restart(pluginId) {
      const ids = await stop(pluginId, 'restart');
      startNamed(ids);
      return ids;
    },
    mayStop(pluginIds) {
      for (const [id, part] of started) {
        const reason = pluginIds.includes(id)
          ? (part.mayStop?.() ?? null)
          : null;
        if (reason !== null) {
          return `${id}: ${reason}`;
        }
      }
      return null;
    },
    stopping() {
      return [...inFlight.keys()];
    },
    async stopAll() {
      stopAllBegan = true;
      const errors: unknown[] = [];
      for (const id of [...started.keys()].reverse()) {
        log?.('plugin-host', `stopping ${id}`);
        errors.push(...(await stopPart(id, 'end', started, records, inFlight)));
      }
      throwFirst(errors);
    },
  };
}
