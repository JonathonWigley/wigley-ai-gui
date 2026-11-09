import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  CatalogChange,
  CatalogEntry,
  CatalogProblem,
  PluginCatalog,
  PluginSource,
  SourceLoad,
} from '../../contracts/plugin-catalog';
import { errorText } from '../../shared/error-text';
import { dependencyOrder } from '../../shared/plugin-manifests';

const LOG_SOURCE = 'plugin-catalog';

type SourceName = 'built-in' | 'user';

// Each id's last good load from one source, as the catalog shows it.
type Candidates = Map<string, CatalogEntry>;

// A load problem and the source whose load gave it.
interface LoadProblem {
  source: SourceName;
  message: string;
}

// The entries a set of candidates shows, and the held-back problem of each
// id whose candidate waits on a dependency that shows nothing.
interface Shown {
  entries: CatalogEntry[];
  heldBack: Map<string, string>;
}

// The ids the catalog orders: built-ins in the built-in source's order, then
// user-only ids by name.
function orderedIds(builtIns: Candidates, users: Candidates): string[] {
  const userOnly = [...users.keys()]
    .filter((id) => !builtIns.has(id))
    .sort((a, b) => a.localeCompare(b));
  return [...builtIns.keys(), ...userOnly];
}

// The first id `entry` depends on, `main` then `page`, that `shown` lacks.
function missingDependency(
  entry: CatalogEntry,
  shown: ReadonlyMap<string, CatalogEntry>,
): string | undefined {
  const { main, page } = entry.manifest.dependsOn;
  return [...main, ...page].find((dependency) => !shown.has(dependency));
}

// Each id's user candidate, else its built-in; then, until nothing changes, a
// candidate whose dependency shows nothing is held back, a user candidate
// giving way to its id's built-in.
function shownEntries(builtIns: Candidates, users: Candidates): Shown {
  const ids = orderedIds(builtIns, users);
  const shown = new Map<string, CatalogEntry>();
  for (const id of ids) {
    const candidate = users.get(id) ?? builtIns.get(id);
    if (candidate !== undefined) {
      shown.set(id, candidate);
    }
  }
  const heldBack = new Map<string, string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, entry] of shown) {
      const missing = missingDependency(entry, shown);
      if (missing === undefined) {
        continue;
      }
      if (!heldBack.has(id)) {
        heldBack.set(id, `needs plugin "${missing}", which is not loaded`);
      }
      const builtIn = builtIns.get(id);
      if (entry !== builtIn && builtIn !== undefined) {
        shown.set(id, builtIn);
      } else {
        shown.delete(id);
      }
      changed = true;
    }
  }
  const entries = ids.flatMap((id) => {
    const entry = shown.get(id);
    return entry === undefined ? [] : [entry];
  });
  return { entries, heldBack };
}

// Sorts each id by whether `before` and `after` hold it, and whether its
// entry object changed.
function changeBetween(
  before: readonly CatalogEntry[],
  after: readonly CatalogEntry[],
): CatalogChange {
  const beforeById = new Map(before.map((entry) => [entry.manifest.id, entry]));
  const afterIds = new Set(after.map((entry) => entry.manifest.id));
  const added: string[] = [];
  const reloaded: string[] = [];
  for (const entry of after) {
    const old = beforeById.get(entry.manifest.id);
    if (old === undefined) {
      added.push(entry.manifest.id);
    } else if (old !== entry) {
      reloaded.push(entry.manifest.id);
    }
  }
  const removed = before
    .map((entry) => entry.manifest.id)
    .filter((id) => !afterIds.has(id));
  return { added, removed, reloaded };
}

function sameProblems(
  a: readonly CatalogProblem[],
  b: readonly CatalogProblem[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (problem, index) =>
        problem.id === b[index].id && problem.message === b[index].message,
    )
  );
}

// The plugins the app runs, merged from the built-in and user sources: a user
// plugin replaces the built-in of its id, a failed load keeps the last good
// entry, and a plugin whose dependency is not loaded is held back. Each load a
// source's watch sends after start reaches every `onChanged` listener.
export async function startPluginCatalog(deps: {
  builtIn: PluginSource;
  user: PluginSource;
  log: Log;
}): Promise<PluginCatalog & Disposable> {
  const { builtIn, user, log } = deps;
  const builtIns: Candidates = new Map();
  const users: Candidates = new Map();
  const loadProblems = new Map<string, LoadProblem>();
  // Each id's shown problem, in the order each was first recorded.
  const problemsById = new Map<string, string>();
  let shown: CatalogEntry[] = [];
  const listeners = new Set<(change: CatalogChange) => void>();

  const candidatesOf = (source: SourceName): Candidates =>
    source === 'built-in' ? builtIns : users;

  // Built-in candidates are all in place before the first user load, so a
  // user candidate's origin stays true.
  const entryOf = (
    source: SourceName,
    entry: Omit<CatalogEntry, 'origin'>,
  ): CatalogEntry => {
    if (source === 'built-in') {
      return { ...entry, origin: 'built-in' };
    }
    const replaces = builtIns.has(entry.manifest.id);
    return { ...entry, origin: replaces ? 'replaces-built-in' : 'user' };
  };

  // The thrown text when the candidates with `candidate` swapped in would
  // depend on each other in a cycle; null when they would not.
  const cycleProblem = (
    source: SourceName,
    candidate: CatalogEntry,
  ): string | null => {
    const swapped = new Map(candidatesOf(source)).set(
      candidate.manifest.id,
      candidate,
    );
    const wouldBe = shownEntries(
      source === 'built-in' ? swapped : builtIns,
      source === 'user' ? swapped : users,
    );
    try {
      dependencyOrder(wouldBe.entries.map((entry) => entry.manifest));
      return null;
    } catch (error) {
      return errorText(error);
    }
  };

  const apply = (source: SourceName, load: SourceLoad) => {
    switch (load.kind) {
      case 'loaded': {
        const candidate = entryOf(source, load.entry);
        const id = candidate.manifest.id;
        const problem = cycleProblem(source, candidate);
        if (problem !== null) {
          loadProblems.set(id, { source, message: problem });
          return;
        }
        candidatesOf(source).set(id, candidate);
        loadProblems.delete(id);
        return;
      }
      case 'failed':
        loadProblems.set(load.id, { source, message: load.message });
        return;
      case 'gone':
        candidatesOf(source).delete(load.id);
        loadProblems.delete(load.id);
        return;
    }
  };

  // Computes the shown entries and problems again; a problem that cleared
  // leaves its place, and one that comes back is recorded at the end.
  const recompute = () => {
    const next = shownEntries(builtIns, users);
    shown = next.entries;
    const messageOf = (id: string) =>
      loadProblems.get(id)?.message ?? next.heldBack.get(id);
    for (const id of problemsById.keys()) {
      if (messageOf(id) === undefined) {
        problemsById.delete(id);
      }
    }
    for (const id of new Set([
      ...loadProblems.keys(),
      ...next.heldBack.keys(),
    ])) {
      problemsById.set(id, messageOf(id) as string);
    }
  };

  const problems = (): CatalogProblem[] =>
    [...problemsById].map(([id, message]) => ({ id, message }));

  const announce = (change: CatalogChange) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error) {
        log(LOG_SOURCE, `change listener failed: ${errorText(error)}`);
      }
    }
  };

  const applyWatched = (source: SourceName, load: SourceLoad) => {
    const entriesBefore = shown;
    const problemsBefore = problems();
    apply(source, load);
    recompute();
    const change = changeBetween(entriesBefore, shown);
    const entriesChanged =
      change.added.length + change.removed.length + change.reloaded.length > 0;
    if (entriesChanged || !sameProblems(problemsBefore, problems())) {
      announce(change);
    }
  };

  for (const load of await builtIn.loadAll()) {
    apply('built-in', load);
  }
  for (const load of await user.loadAll()) {
    apply('user', load);
  }
  recompute();

  const builtInWatch = builtIn.watch((load) => applyWatched('built-in', load));
  const userWatch = user.watch((load) => applyWatched('user', load));

  const entry = (id: string) =>
    shown.find((shownEntry) => shownEntry.manifest.id === id);

  return {
    entries: () => shown,
    manifests: () => shown.map((shownEntry) => shownEntry.manifest),
    problems,
    entry,
    onChanged: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    reload: async (id) => {
      const hasUserLoad =
        users.has(id) || loadProblems.get(id)?.source === 'user';
      if (hasUserLoad) {
        applyWatched('user', await user.reload(id));
        return;
      }
      if (builtIns.has(id)) {
        throw new Error(
          `Plugin "${id}" is built in; it reloads only with a rebuild`,
        );
      }
      throw new Error(`No plugin "${id}"`);
    },
    dispose: () => {
      builtInWatch.dispose();
      userWatch.dispose();
    },
  };
}
