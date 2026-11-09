import type { Timers } from '../../contracts/ambient';
import type {
  PluginPartsReply,
  PluginPartsRequest,
} from '../../contracts/bridge';
import type { PluginStatus } from '../../contracts/core-state';
import type { Log } from '../../contracts/log';
import type {
  MainPart,
  MainStart,
  PluginManifest,
  PluginSwitchService,
} from '../../contracts/plugin';
import type {
  CatalogEntry,
  CatalogProblem,
  PluginCatalog,
} from '../../contracts/plugin-catalog';
import type { SlotWriter } from '../../contracts/state';
import { errorText } from '../../shared/error-text';
import { handlerProblems } from '../../shared/plugin-catalog/validate-manifest';
import type { PluginHost } from '../../shared/plugin-host';
import {
  dependencyOrder,
  dependentsOf,
  neededBy,
} from '../../shared/plugin-manifests';
import type { AppliedPlugins } from './applied-plugins';

// How often a refused switch-off asks again, until the part lets go or the
// list changes.
export const PLUGIN_RETRY_MS = 2000;

// Turns plugins on and off while the app runs, and follows the plugin
// catalog: a plugin that arrives starts, one that leaves stops as a switch-off
// does, and one with a new entry reloads, its dependents with it. `apply`,
// `restart` and each catalog change run one at a time, each after the one
// before it settles; `mayDisable` runs beside them. At creation it queues the
// launch start of each held plugin (`heldAtStart`) the user did not switch
// off, one at a time. A start that fails, a reload whose new version the
// config refuses or that fails to start (the last good version then runs in
// its place), and a page part that fails, each show as the plugin's problem
// in `core.plugins` and in the config's plugin problems; a plugin that runs no
// version stays in the applied list until a later entry or its dependency
// starts it.
export interface PluginSwitch extends PluginSwitchService {
  // Applies a new disabled list: refuses with the host's `<id>: <reason>` when
  // a part `mayStop` refuses (a config problem, retried every
  // `PLUGIN_RETRY_MS` with the newest list `apply` was handed). Else, to switch
  // off, it sets the applied list and pushes the served config, stops page
  // parts then main parts, and clears the switched-off owners' slots; to
  // switch on, it starts built-in main parts, sets the applied list and pushes
  // the served config, then starts their page parts, then starts each user
  // plugin one at a time. A main stop that throws still stops every other id.
  // A plugin that runs no version is neither started nor stopped by the list.
  // Resolves to the refusal or null.
  apply(disabled: readonly string[]): Promise<string | null>;
  // The reason turning `pluginId` off would be refused now, in words Settings
  // shows (neededBy, then mayStop), or null.
  mayDisable(pluginId: string): Promise<string | null>;
  // Stops `pluginId` and its dependents, page parts first, then starts what
  // stopped, main parts first; their slots are kept. Their binds leave first:
  // it sets them as the applied paused list and pushes the served config
  // before the page stop, and clears the list and pushes again after the main
  // start, before the page start. When a step throws, it starts again each
  // main part it stopped, one at a time, logging a start that throws, and each
  // page part whose main part runs again or that has no main part, then clears
  // the paused list and pushes when it is still set, then rejects. Rejects
  // for a plugin that is off or that the config does not hold, pushing
  // nothing.
  restart(pluginId: string): Promise<void>;
  // Resolves once the switch's queue holds no work.
  settled(): Promise<void>;
  // Clears the retry timer and stops following the catalog; a later `apply`
  // resolves null, a later `restart` resolves, and queued work does nothing.
  dispose(): void;
}

export interface PluginSwitchDeps {
  main: Pick<
    PluginHost<MainStart<PluginManifest>, MainPart>,
    'start' | 'stop' | 'mayStop' | 'started' | 'add' | 'remove'
  >;
  page(request: PluginPartsRequest): Promise<PluginPartsReply>;
  applied: AppliedPlugins;
  slots: { clearOwner(pluginId: string): void };
  status: SlotWriter<readonly PluginStatus[]>;
  catalog: Pick<PluginCatalog, 'entries' | 'problems' | 'onChanged'>;
  // The config store's side of the plugins: `plugins()` is the entries it
  // admitted, read after each `setPlugins` resolves.
  config: {
    plugins(): readonly CatalogEntry[];
    setPlugins(entries: readonly CatalogEntry[]): Promise<void>;
    pluginProblems(): readonly CatalogProblem[];
    setPluginProblems(problems: readonly CatalogProblem[]): void;
  };
  // The `plugins.disabled` the config holds now.
  configDisabled(): readonly string[];
  // Sets or clears the switch's config problem.
  problem(message: string | null): void;
  // The applied or paused list changed: push the served config to the page
  // and apply main's keys again.
  servedChanged(): void;
  timers: Timers;
  log: Log;
}

const SOURCE = 'plugin-switch';
const NEEDS_PLUGIN = 'Needs plugin';

function idOf(entry: CatalogEntry): string {
  return entry.manifest.id;
}

// The ids in either of the manifest's `dependsOn` lists: its `main` list, then
// its `page` list.
function dependenciesOf(manifest: PluginManifest): string[] {
  return [...manifest.dependsOn.main, ...manifest.dependsOn.page];
}

// The ids of `manifests` that `isIncluded` keeps, in manifests order.
function idsWhere(
  manifests: readonly PluginManifest[],
  isIncluded: (id: string) => boolean,
): string[] {
  return manifests.map((manifest) => manifest.id).filter(isIncluded);
}

// The ids of `order` that `ids` holds, in `order`'s order.
function inOrder(order: readonly string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return order.filter((id) => wanted.has(id));
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

// A page `start` reply's problems; a reply with none counts as none.
function startProblemsOf(reply: PluginPartsReply): readonly CatalogProblem[] {
  return 'problems' in reply ? reply.problems : [];
}

// Every entry whose origin is not `built-in`, and every entry that depends
// (`dependsOn.main` or `.page`, transitively) on one, in entry order: the
// plugins main holds in the applied list at launch, for the switch to start
// one at a time.
export function heldAtStart(entries: readonly CatalogEntry[]): string[] {
  const held = new Set(
    entries.filter((entry) => entry.origin !== 'built-in').map(idOf),
  );
  let isGrowing = true;
  while (isGrowing) {
    isGrowing = false;
    for (const entry of entries) {
      const dependsOnHeld = dependenciesOf(entry.manifest).some((id) =>
        held.has(id),
      );
      if (dependsOnHeld && !held.has(idOf(entry))) {
        held.add(idOf(entry));
        isGrowing = true;
      }
    }
  }
  return entries.map(idOf).filter((id) => held.has(id));
}

export function createPluginSwitch(deps: PluginSwitchDeps): PluginSwitch {
  const { main, applied, catalog, config } = deps;
  const admittedEntry = (id: string) =>
    config.plugins().find((entry) => idOf(entry) === id);
  const isAdmitted = (id: string) => admittedEntry(id) !== undefined;
  const admittedManifests = () =>
    config.plugins().map((entry) => entry.manifest);
  const startOrder = () =>
    dependencyOrder(admittedManifests()).map((manifest) => manifest.id);
  const label = (id: string) => admittedEntry(id)?.manifest.label ?? id;
  const isRunningAtCreation = (entry: CatalogEntry) =>
    (main.started.has(idOf(entry)) || entry.main === null) &&
    !applied.disabled().includes(idOf(entry));

  // The catalog entry the switch last acted on, by id: the baseline of each
  // catalog job.
  const handled = new Map(
    config.plugins().map((entry) => [idOf(entry), entry]),
  );
  // Ids kept in the applied list that the user did not switch off.
  const withheld = new Set(
    applied.disabled().filter((id) => !deps.configDisabled().includes(id)),
  );
  const startProblems = new Map<string, string>();
  // The entry whose code last started cleanly, by id.
  const lastGood = new Map(
    config
      .plugins()
      .filter(isRunningAtCreation)
      .map((entry) => [idOf(entry), entry]),
  );
  // The last good entry that runs in place of the catalog's entry after a
  // failed reload, by id.
  const inPlace = new Map<string, CatalogEntry>();
  let lastRefusal: string | null = null;
  // The newest list `apply` was handed, which a retry applies when it runs;
  // null before the first `apply` and after `dispose`.
  let pending: readonly string[] | null = null;
  let retryHandle: number | null = null;
  let isDisposed = false;
  let tail: Promise<unknown> = Promise.resolve();

  const inQueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };

  const logFailure = (error: unknown) =>
    deps.log(SOURCE, `failed: ${errorText(error)}`);

  const problemOf = (id: string) =>
    startProblems.get(id) ??
    catalog.problems().find((problem) => problem.id === id)?.message ??
    config.pluginProblems().find((problem) => problem.id === id)?.message ??
    null;

  const writeStatus = () => {
    const disabled = applied.disabled();
    const manifests = admittedManifests();
    const entries = catalog.entries();
    const entryRows = entries.map((entry): PluginStatus => {
      const id = idOf(entry);
      const admitted = admittedEntry(id);
      const shown = admitted ?? entry;
      return {
        id,
        label: shown.manifest.label,
        description: shown.manifest.description,
        on: admitted !== undefined && !disabled.includes(id),
        neededBy: neededBy(id, disabled, manifests),
        origin: shown.origin,
        problem: problemOf(id),
      };
    });
    const failedIds = [
      ...new Set(catalog.problems().map((problem) => problem.id)),
    ].filter((id) => !entries.some((entry) => idOf(entry) === id));
    const failedRows = failedIds.map((id): PluginStatus => ({
      id,
      label: id,
      description: '',
      on: false,
      neededBy: [],
      origin: 'user',
      problem: problemOf(id),
    }));
    deps.status.set([...entryRows, ...failedRows]);
  };

  // Writes the status rows and hands the config the start problems, then the
  // catalog's.
  const publish = () => {
    writeStatus();
    config.setPluginProblems([
      ...[...startProblems].map(([id, message]) => ({ id, message })),
      ...catalog.problems(),
    ]);
  };

  const addToApplied = (ids: readonly string[]) => {
    const current = applied.disabled();
    const missing = ids.filter((id) => !current.includes(id));
    if (missing.length > 0) {
      applied.set([...current, ...missing]);
    }
  };

  const dropFromApplied = (ids: readonly string[]) => {
    const current = applied.disabled();
    if (ids.some((id) => current.includes(id))) {
      applied.set(current.filter((id) => !ids.includes(id)));
    }
  };

  // `list` plus each withheld id it does not name.
  const withWithheld = (list: readonly string[]) => [
    ...list,
    ...[...withheld].filter((id) => !list.includes(id)),
  ];

  // The catalog's entries, each `inPlace` entry in place of its id's.
  const setPlugins = () =>
    config.setPlugins(
      catalog.entries().map((entry) => inPlace.get(idOf(entry)) ?? entry),
    );

  const pageStart = async (ids: readonly string[]) => {
    const reply = await deps.page({ kind: 'start', ids });
    for (const { id, message } of startProblemsOf(reply)) {
      startProblems.set(id, message);
    }
  };

  const removeMain = async (id: string): Promise<string[]> => {
    try {
      return await main.remove(id);
    } catch (error) {
      logFailure(error);
      return [];
    }
  };

  // A dependency counts as started when it is admitted, not in the applied
  // list, and its main part runs or it has none.
  const countsAsStarted = (id: string) => {
    const entry = admittedEntry(id);
    return (
      entry !== undefined &&
      !applied.disabled().includes(id) &&
      (main.started.has(id) || entry.main === null)
    );
  };

  const missingDependency = (manifest: PluginManifest) =>
    dependenciesOf(manifest).find((id) => !countsAsStarted(id));

  const withhold = (id: string, message: string): false => {
    startProblems.set(id, message);
    withheld.add(id);
    addToApplied([id]);
    return false;
  };

  const withholdForDependency = (id: string, dependency: string) =>
    withhold(id, `${NEEDS_PLUGIN} "${dependency}", which did not start`);

  // Starts `entry`'s main part, when it has one, and checks a user part's
  // handlers against its manifest, stopping a part whose handlers differ.
  // Resolves to the problem, or null.
  const startMain = async (entry: CatalogEntry): Promise<string | null> => {
    if (entry.main === null) {
      return null;
    }
    const id = idOf(entry);
    try {
      main.start([id]);
    } catch (error) {
      return `Did not start: ${errorText(error)}`;
    }
    const started = main.started.get(id);
    if (entry.origin === 'built-in' || started === undefined) {
      return null;
    }
    const differences = handlerProblems(
      entry.manifest,
      'main',
      started.commands,
    );
    if (differences.length === 0) {
      return null;
    }
    try {
      await main.stop(id);
    } catch (error) {
      logFailure(error);
    }
    return `Commands and handlers differ: ${differences.join(', ')}`;
  };

  // Starts one admitted id when its dependencies count as started, recording
  // the problem and withholding it when it does not start. Resolves to
  // whether it runs.
  const guardedStart = async (
    id: string,
    { pageStart: isPageStarting }: { pageStart: boolean },
  ): Promise<boolean> => {
    const entry = admittedEntry(id);
    if (entry === undefined) {
      throw new Error(`No plugin "${id}"`);
    }
    const dependency = missingDependency(entry.manifest);
    if (dependency !== undefined) {
      return withholdForDependency(id, dependency);
    }
    const problem = await startMain(entry);
    if (problem !== null) {
      return withhold(id, problem);
    }
    lastGood.set(id, entry);
    if (!inPlace.has(id)) {
      startProblems.delete(id);
    }
    if (withheld.has(id)) {
      withheld.delete(id);
      dropFromApplied([id]);
      deps.servedChanged();
    }
    if (isPageStarting) {
      await pageStart([id]);
    }
    deps.log(SOURCE, `on ${id}`);
    return true;
  };

  // Starts each withheld id whose start problem is a missing dependency that
  // now counts as started, in start order.
  const retryWithheldDependents = async () => {
    for (const id of startOrder()) {
      const isWaitingOnDependency =
        withheld.has(id) &&
        (startProblems.get(id)?.startsWith(NEEDS_PLUGIN) ?? false);
      const entry = admittedEntry(id);
      const isReady =
        isWaitingOnDependency &&
        entry !== undefined &&
        !deps.configDisabled().includes(id) &&
        missingDependency(entry.manifest) === undefined;
      if (!isReady) {
        continue;
      }
      await guardedStart(id, { pageStart: true });
      if (isDisposed) {
        return;
      }
    }
  };

  const forget = (id: string) => {
    withheld.delete(id);
    startProblems.delete(id);
    lastGood.delete(id);
    inPlace.delete(id);
    handled.delete(id);
  };

  // Stops `ids` as a switch-off does, their slots included, and withholds
  // each main dependent the stop took down. Resolves to false when the
  // switch was disposed on the way.
  const stopAsRemoved = async (ids: readonly string[]): Promise<boolean> => {
    addToApplied(ids);
    deps.servedChanged();
    for (const id of ids) {
      await deps.page({ kind: 'remove', id });
      if (isDisposed) {
        return false;
      }
    }
    const mainStopped: string[] = [];
    for (const id of ids) {
      mainStopped.push(...(await removeMain(id)));
    }
    for (const id of ids) {
      deps.slots.clearOwner(id);
    }
    for (const id of mainStopped.filter((each) => !ids.includes(each))) {
      const entry = admittedEntry(id);
      const dependency =
        entry === undefined ? undefined : missingDependency(entry.manifest);
      if (dependency !== undefined) {
        withholdForDependency(id, dependency);
      }
    }
    return true;
  };

  const removePlugins = async (ids: readonly string[]) => {
    if (!(await stopAsRemoved(ids))) {
      return;
    }
    await setPlugins();
    if (isDisposed) {
      return;
    }
    dropFromApplied(ids);
    for (const id of ids) {
      forget(id);
      deps.log(SOURCE, `removed ${id}`);
    }
  };

  const addPlugins = async (entries: readonly CatalogEntry[]) => {
    const ids = entries.map(idOf);
    for (const entry of entries) {
      withheld.add(idOf(entry));
      handled.set(idOf(entry), entry);
    }
    addToApplied(ids);
    await setPlugins();
    if (isDisposed) {
      return;
    }
    // A refused id has no admitted entry, so start order leaves it out and it
    // stays withheld.
    for (const id of inOrder(startOrder(), ids)) {
      const entry = admittedEntry(id);
      if (entry === undefined || entry !== handled.get(id)) {
        continue;
      }
      if (entry.main !== null) {
        main.add(entry.main);
      }
      if (deps.configDisabled().includes(id)) {
        withheld.delete(id);
      } else {
        await guardedStart(id, { pageStart: true });
        if (isDisposed) {
          return;
        }
      }
      deps.log(SOURCE, `added ${id}`);
    }
  };

  const unpause = () => {
    applied.setPaused([]);
    deps.servedChanged();
  };

  const configProblemOf = (id: string) =>
    config.pluginProblems().find((problem) => problem.id === id)?.message ??
    'the config did not admit it';

  // Records a page `reload` reply's problem as the start problem of `id`.
  const recordReloadProblem = (id: string, reply: PluginPartsReply) => {
    if ('problem' in reply && reply.problem !== null) {
      startProblems.set(id, reply.problem);
    }
  };

  // Reload step 1: an id that runs no version swaps its main and page parts,
  // and a withheld one starts on the new entry.
  const reloadStopped = async (
    id: string,
    next: CatalogEntry,
    isOff: boolean,
  ) => {
    await setPlugins();
    if (isDisposed || admittedEntry(id) !== next) {
      return;
    }
    await removeMain(id);
    if (next.main !== null) {
      main.add(next.main);
    }
    // The page holds the old page part until a reload swaps it, and a later
    // start would start that part.
    const reply = await deps.page({ kind: 'reload', id });
    if (isDisposed) {
      return;
    }
    if (!isOff && withheld.has(id)) {
      await guardedStart(id, { pageStart: true });
      if (isDisposed) {
        return;
      }
    }
    recordReloadProblem(id, reply);
    deps.log(SOURCE, `reloaded ${id}`);
  };

  // Guarded starts, without page starts, of each of `ids` that `isDue`
  // keeps, in start order. Resolves to whether `id` runs after them.
  const startEach = async (
    id: string,
    ids: ReadonlySet<string>,
    isDue: (each: string) => boolean,
  ): Promise<boolean> => {
    let isRunning = false;
    for (const each of inOrder(startOrder(), ids)) {
      if (!isDue(each)) {
        continue;
      }
      const runs = await guardedStart(each, { pageStart: false });
      if (each === id) {
        isRunning = runs;
      }
      if (isDisposed) {
        return isRunning;
      }
    }
    return isRunning;
  };

  // Reload step 7: the new entry of `id` did not start, so its last good
  // entry runs in its place when there is one and it starts.
  const restoreLastGood = async (
    id: string,
    next: CatalogEntry,
    stopped: ReadonlySet<string>,
  ) => {
    const good = lastGood.get(id);
    const first = startProblems.get(id) ?? '';
    if (good === undefined || good === next) {
      deps.log(SOURCE, `reload of ${id} failed: ${first}`);
      return;
    }
    inPlace.set(id, good);
    await removeMain(id);
    if (good.main !== null) {
      main.add(good.main);
    }
    await setPlugins();
    if (isDisposed) {
      return;
    }
    let second: string | null;
    if (admittedEntry(id) === good) {
      const runs = await startEach(
        id,
        stopped,
        (each) => each === id || !main.started.has(each),
      );
      second = runs ? null : (startProblems.get(id) ?? '');
    } else {
      second = configProblemOf(id);
    }
    startProblems.set(id, first);
    if (second === null) {
      deps.log(
        SOURCE,
        `reload of ${id} failed: ${first}; the last good version runs`,
      );
      return;
    }
    inPlace.delete(id);
    deps.log(
      SOURCE,
      `reload of ${id} failed: ${first}; the last good version failed too: ${second}`,
    );
  };

  // Reload steps 2 to 10: an id that runs swaps its part with its binds and
  // its dependents' paused.
  const reloadRunning = async (id: string, next: CatalogEntry) => {
    applied.setPaused([
      id,
      ...dependentsOf(id, applied.disabled(), admittedManifests()),
    ]);
    deps.servedChanged();
    try {
      await setPlugins();
      if (isDisposed) {
        return;
      }
      const stored = admittedEntry(id);
      if (stored !== next) {
        unpause();
        const problem = configProblemOf(id);
        if (stored === undefined) {
          withheld.add(id);
          await stopAsRemoved([id]);
          deps.log(SOURCE, `reload of ${id} failed: ${problem}`);
          return;
        }
        deps.log(
          SOURCE,
          `reload of ${id} failed: ${problem}; the last good version runs`,
        );
        return;
      }
      const pageStopped = stoppedOf(
        await deps.page({ kind: 'stop', ids: [id] }),
      );
      if (isDisposed) {
        return;
      }
      const stopped = new Set([...(await removeMain(id)), id]);
      if (next.main !== null) {
        main.add(next.main);
      }
      const nextRuns = await startEach(id, stopped, () => true);
      if (isDisposed) {
        return;
      }
      if (!nextRuns) {
        await restoreLastGood(id, next, stopped);
        if (isDisposed) {
          return;
        }
      }
      unpause();
      if (nextRuns) {
        const reply = await deps.page({ kind: 'reload', id });
        if (isDisposed) {
          return;
        }
        recordReloadProblem(id, reply);
      }
      const pageStarts = pageStopped.filter((each) => !withheld.has(each));
      if (pageStarts.length > 0) {
        await pageStart(pageStarts);
        if (isDisposed) {
          return;
        }
      }
      if (nextRuns) {
        deps.log(SOURCE, `reloaded ${id}`);
      }
    } finally {
      if (applied.paused().length > 0) {
        unpause();
      }
    }
  };

  const reloadPlugin = async (id: string, next: CatalogEntry) => {
    handled.set(id, next);
    inPlace.delete(id);
    const isOff = deps.configDisabled().includes(id);
    if (isOff || withheld.has(id)) {
      await reloadStopped(id, next, isOff);
      return;
    }
    await reloadRunning(id, next);
  };

  // Acts on what changed in the catalog since the entries in `handled`:
  // removed ids first, then reloaded ones, then added ones, then the
  // withheld dependents whose dependencies now run.
  const runCatalogJob = async () => {
    const entries = catalog.entries();
    const byId = new Map(entries.map((entry) => [idOf(entry), entry]));
    const handledOrder = dependencyOrder(
      [...handled.values()].map((entry) => entry.manifest),
    ).map((manifest) => manifest.id);
    const removed = handledOrder.filter((id) => !byId.has(id)).reverse();
    const reloadedEntries = entries.filter((entry) => {
      const before = handled.get(idOf(entry));
      return before !== undefined && before !== entry;
    });
    const added = entries.filter((entry) => !handled.has(idOf(entry)));
    if (removed.length > 0) {
      await removePlugins(removed);
    }
    const order = startOrder();
    const startIndex = (entry: CatalogEntry) => {
      const index = order.indexOf(idOf(entry));
      return index === -1 ? order.length : index;
    };
    const reloaded = [...reloadedEntries].sort(
      (a, b) => startIndex(a) - startIndex(b),
    );
    for (const next of reloaded) {
      if (isDisposed) {
        return;
      }
      await reloadPlugin(idOf(next), next);
    }
    if (isDisposed) {
      return;
    }
    if (added.length > 0) {
      await addPlugins(added);
    }
    if (isDisposed) {
      return;
    }
    await retryWithheldDependents();
  };

  const queueCatalogJob = (work: () => Promise<void>) =>
    inQueue(async () => {
      if (isDisposed) {
        return;
      }
      await work();
      if (!isDisposed) {
        publish();
      }
    }).catch(logFailure);

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

  // Steps 3 and 4: the binds leave while the handlers exist, then page parts
  // stop before main parts.
  const switchOff = async (off: readonly string[]) => {
    applied.set([...applied.disabled(), ...off]);
    deps.servedChanged();
    await deps.page({ kind: 'stop', ids: off });
    const errors: unknown[] = [];
    for (const id of off) {
      try {
        await main.stop(id);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const id of off.filter((each) => !main.started.has(each))) {
      deps.slots.clearOwner(id);
    }
    if (errors.length > 0) {
      for (const error of errors.slice(1)) {
        logFailure(error);
      }
      throw errors[0];
    }
    for (const id of off) {
      deps.log(SOURCE, `off ${id}`);
    }
  };

  // Step 5: built-in main parts start before the binds join, and their page
  // parts after both; each user plugin then starts guarded, one at a time.
  const switchOn = async (on: readonly string[], next: readonly string[]) => {
    const builtIns = on.filter(
      (id) => admittedEntry(id)?.origin === 'built-in',
    );
    const others = on.filter((id) => !builtIns.includes(id));
    for (const id of others) {
      withheld.add(id);
    }
    if (builtIns.length > 0) {
      try {
        main.start(builtIns);
      } catch (error) {
        for (const id of others) {
          withheld.delete(id);
        }
        await stopStarted(builtIns);
        throw error;
      }
    }
    applied.set(withWithheld(next));
    deps.servedChanged();
    if (builtIns.length > 0) {
      await pageStart(builtIns);
    }
    for (const id of builtIns) {
      deps.log(SOURCE, `on ${id}`);
    }
    for (const id of inOrder(startOrder(), others)) {
      await guardedStart(id, { pageStart: true });
    }
  };

  // Stops each of `ids` that main has started, last first; a stop that throws
  // is logged.
  const stopStarted = async (ids: readonly string[]) => {
    for (const id of [...ids].reverse()) {
      if (!main.started.has(id)) {
        continue;
      }
      try {
        await main.stop(id);
      } catch (error) {
        logFailure(error);
      }
    }
  };

  const applyNow = async (
    disabled: readonly string[],
  ): Promise<string | null> => {
    const next = disabled.filter(isAdmitted);
    for (const id of next) {
      withheld.delete(id);
    }
    const current = applied.disabled();
    const manifests = admittedManifests();
    const off = idsWhere(
      manifests,
      (id) => next.includes(id) && !current.includes(id),
    );
    const on = idsWhere(
      manifests,
      (id) => current.includes(id) && !next.includes(id) && !withheld.has(id),
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
      publish();
    }
    deps.problem(null);
    lastRefusal = null;
    return null;
  };

  const clearRetry = () => {
    if (retryHandle !== null) {
      deps.timers.clear(retryHandle);
      retryHandle = null;
    }
  };

  // Queues an apply of the list `listOf` gives when the queued work runs.
  const applyQueued = (listOf: () => readonly string[] | null) =>
    inQueue(async () => {
      const disabled = listOf();
      if (isDisposed || disabled === null) {
        return null;
      }
      const refusal = await applyNow(disabled);
      if (refusal === null) {
        clearRetry();
        return null;
      }
      if (!isDisposed) {
        retryHandle ??= deps.timers.set(retry, PLUGIN_RETRY_MS);
      }
      return refusal;
    });

  const retry = () => {
    retryHandle = null;
    applyQueued(() => pending).catch(logFailure);
  };

  const apply = (disabled: readonly string[]) => {
    if (isDisposed) {
      return Promise.resolve(null);
    }
    pending = disabled;
    return applyQueued(() => disabled);
  };

  // Starts each of `mainIds` that main no longer runs, one at a time in
  // dependency order, then the page parts of `pageIds` whose plugin has no
  // main part in `mainIds` or whose main part runs again; the page skips
  // those started. A start that throws is logged.
  const startWhatStopped = async (
    mainIds: readonly string[],
    pageIds: readonly string[],
  ) => {
    for (const id of startOrder()) {
      if (!mainIds.includes(id) || main.started.has(id)) {
        continue;
      }
      try {
        main.start([id]);
      } catch (error) {
        logFailure(error);
      }
    }
    const pageStarts = pageIds.filter(
      (id) => !mainIds.includes(id) || main.started.has(id),
    );
    if (pageStarts.length === 0) {
      return;
    }
    try {
      await pageStart(pageStarts);
    } catch (error) {
      logFailure(error);
    }
  };

  // The launch job: each held id the user did not switch off (the withheld
  // ones) starts guarded, in start order, then one catalog job catches a
  // change made before now.
  const startHeld = async () => {
    const held = heldAtStart(config.plugins()).filter((id) => withheld.has(id));
    for (const id of inOrder(startOrder(), held)) {
      await guardedStart(id, { pageStart: true });
      if (isDisposed) {
        return;
      }
    }
    await runCatalogJob();
  };

  writeStatus();
  queueCatalogJob(startHeld);
  const catalogChanges = catalog.onChanged(() => {
    if (!isDisposed) {
      queueCatalogJob(runCatalogJob);
    }
  });
  return {
    apply,
    async mayDisable(pluginId) {
      const disabled = applied.disabled();
      if (disabled.includes(pluginId)) {
        return null;
      }
      const needers = neededBy(pluginId, disabled, admittedManifests());
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
        if (isDisposed) {
          return;
        }
        if (!isAdmitted(pluginId)) {
          throw new Error(`No plugin "${pluginId}"`);
        }
        if (applied.disabled().includes(pluginId)) {
          throw new Error(`Plugin "${pluginId}" is off`);
        }
        const manifests = admittedManifests();
        const mainBefore = idsWhere(manifests, (id) => main.started.has(id));
        let pageStopped: readonly string[] = [];
        let isDone = false;
        // The binds leave while the handlers exist, and main's come back once
        // its handlers exist again; the page start brings the page's back.
        applied.setPaused([
          pluginId,
          ...dependentsOf(pluginId, applied.disabled(), manifests),
        ]);
        deps.servedChanged();
        try {
          pageStopped = stoppedOf(
            await deps.page({ kind: 'stop', ids: [pluginId] }),
          );
          const mainStopped = await main.stop(pluginId);
          main.start(mainStopped);
          unpause();
          await pageStart(pageStopped);
          isDone = true;
          deps.log(SOURCE, `restarted ${pluginId}`);
        } finally {
          if (!isDone) {
            await startWhatStopped(mainBefore, pageStopped);
            if (applied.paused().length > 0) {
              unpause();
            }
          }
          publish();
        }
      }),
    async settled() {
      let seen: Promise<unknown>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
    dispose() {
      isDisposed = true;
      pending = null;
      clearRetry();
      catalogChanges.dispose();
    },
  };
}
