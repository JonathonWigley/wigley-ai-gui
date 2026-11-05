import { type Files, isMissingFile } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { RecentChange } from '../contract';

export interface RecentChangesDeps {
  git: Pick<Git, 'topLevel' | 'log'>;
  files: Pick<Files, 'realPath'>;
  paths: Paths;
  log: PluginLog;
}

// One clone and the paths to log in it, relative to its root.
interface CloneLog {
  root: string;
  relativePaths: string[];
}

// The newest `limit` commits touching `paths` across the clones holding them,
// newest first, a commit two clones share merged into one row. A path in no
// clone or no longer on disk is left out; any other failure leaves out what it
// reached and logs `recent changes <path or root>: <reason>` under `docs`. It
// never rejects.
export async function readRecentChanges(
  paths: readonly string[],
  limit: number,
  deps: RecentChangesDeps,
): Promise<RecentChange[]> {
  const realPaths = await realPathsOf(paths, deps);
  const roots = await rootsOfFolders(realPaths, deps);
  const cloneLogs = cloneLogsOf(realPaths, roots, deps.paths);
  const changes = await Promise.all(
    cloneLogs.map((cloneLog) => changesInClone(cloneLog, limit, deps)),
  );
  return mergedNewestFirst(changes.flat(), deps.paths).slice(0, limit);
}

// The distinct real paths of `paths`, in order. Git's top folders are real
// paths, so only a real path sits below one.
async function realPathsOf(
  paths: readonly string[],
  deps: RecentChangesDeps,
): Promise<string[]> {
  const resolved = await Promise.all(
    [...new Set(paths)].map((path) => realPathOrNull(path, deps)),
  );
  return [...new Set(resolved.filter((real) => real !== null))];
}

async function realPathOrNull(
  path: string,
  deps: RecentChangesDeps,
): Promise<string | null> {
  try {
    return await deps.files.realPath(path);
  } catch (error) {
    if (!isMissingFile(error)) {
      deps.log(`recent changes ${path}: ${errorText(error)}`);
    }
    return null;
  }
}

// Each real path's folder → the clone root holding it; null when it has none.
async function rootsOfFolders(
  realPaths: readonly string[],
  deps: RecentChangesDeps,
): Promise<Map<string, string | null>> {
  const folders = [
    ...new Set(realPaths.map((real) => deps.paths.parent(real))),
  ];
  const roots = await Promise.all(
    folders.map((folder) => rootOrNull(folder, deps)),
  );
  return new Map(folders.map((folder, index) => [folder, roots[index]]));
}

async function rootOrNull(
  folder: string,
  deps: RecentChangesDeps,
): Promise<string | null> {
  try {
    return await deps.git.topLevel(folder);
  } catch (error) {
    deps.log(`recent changes ${folder}: ${errorText(error)}`);
    return null;
  }
}

// One `CloneLog` per root, in the order each root first appears.
function cloneLogsOf(
  realPaths: readonly string[],
  roots: ReadonlyMap<string, string | null>,
  paths: Paths,
): CloneLog[] {
  const cloneLogs: CloneLog[] = [];
  for (const real of realPaths) {
    const root = roots.get(paths.parent(real)) ?? null;
    const segments = root === null ? null : paths.segmentsBelow(real, root);
    if (root === null || segments === null) {
      continue;
    }
    const relative = segments.join('/');
    const known = cloneLogs.find((cloneLog) =>
      paths.samePath(cloneLog.root, root),
    );
    if (known === undefined) {
      cloneLogs.push({ root, relativePaths: [relative] });
    } else {
      known.relativePaths.push(relative);
    }
  }
  return cloneLogs;
}

// The clone's commits with real paths; [] when its log fails.
async function changesInClone(
  { root, relativePaths }: CloneLog,
  limit: number,
  deps: RecentChangesDeps,
): Promise<RecentChange[]> {
  try {
    const commits = await deps.git.log(root, relativePaths, limit);
    return commits.map((commit) => ({
      ...commit,
      paths: commit.paths.map((relative) => deps.paths.join(root, relative)),
    }));
  } catch (error) {
    deps.log(`recent changes ${root}: ${errorText(error)}`);
    return [];
  }
}

// One row per sha holding every path once. The sort is stable, so equal times
// keep clone and git order; `at` is compared as a time because offsets differ.
function mergedNewestFirst(
  changes: readonly RecentChange[],
  paths: Paths,
): RecentChange[] {
  const rows = new Map<string, RecentChange>();
  for (const change of changes) {
    const row = rows.get(change.sha) ?? { ...change, paths: [] };
    rows.set(change.sha, row);
    for (const path of change.paths) {
      if (!row.paths.some((held) => paths.samePath(held, path))) {
        row.paths.push(path);
      }
    }
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
