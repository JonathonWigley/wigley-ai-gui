import type { Paths } from '../../../contracts/paths';
import type { IndexEntry } from '../../docs/contract';
import type { BacklogHome, BacklogPlan, BacklogTask } from '../contract';

export type PlanShape = Omit<BacklogPlan, 'title' | 'target' | 'written'>;

// A home as the index alone gives it: no git state, follow-up items or plan
// header fields, which the main part reads from disk and git.
export type HomeShape = Omit<
  BacklogHome,
  | 'isCreateTarget'
  | 'gitRoot'
  | 'uncommitted'
  | 'repoFolder'
  | 'followupFiles'
  | 'plans'
> & { followupFiles: { path: string }[]; plans: PlanShape[] };

interface HomeBuild {
  shape: HomeShape;
  followupPaths: Set<string>;
  tasks: IndexEntry[];
}

function metaString(entry: IndexEntry, key: string): string | null {
  const value = entry.meta[key];
  return typeof value === 'string' ? value : null;
}

function metaNumber(entry: IndexEntry, key: string): number {
  const value = entry.meta[key];
  return typeof value === 'number' ? value : 0;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

function homeBuild(
  builds: Map<string, HomeBuild>,
  repo: string,
  root: string,
): HomeBuild {
  let build = builds.get(root);
  if (build === undefined) {
    build = {
      shape: { repo, root, followupFiles: [], plans: [], features: [] },
      followupPaths: new Set(),
      tasks: [],
    };
    builds.set(root, build);
  }
  return build;
}

function addEntry(build: HomeBuild, entry: IndexEntry): void {
  const { shape } = build;
  if (entry.kind === 'followup') {
    build.followupPaths.add(entry.path);
  } else if (entry.kind === 'plan') {
    shape.plans.push({
      path: entry.path,
      copyPath: entry.path,
      feature: metaString(entry, 'feature') ?? '',
      checked: metaNumber(entry, 'checked'),
      total: metaNumber(entry, 'total'),
      tasks: [],
    });
  } else if (entry.kind === 'feature') {
    shape.features.push({
      path: entry.path,
      slug: metaString(entry, 'slug') ?? '',
      checked: metaNumber(entry, 'checked'),
      total: metaNumber(entry, 'total'),
      tasks: [],
    });
  } else if (entry.kind === 'task') {
    build.tasks.push(entry);
  }
}

// A task belongs to the plan (`meta.plan` set) or feature (`meta.plan` null)
// whose file shares its folder; a task with neither is dropped.
function attachTasks(build: HomeBuild, paths: Paths): void {
  for (const entry of build.tasks.toSorted(byPath)) {
    const folder = paths.parent(entry.path);
    const owners: { path: string; tasks: BacklogTask[] }[] =
      metaString(entry, 'plan') !== null
        ? build.shape.plans
        : build.shape.features;
    const owner = owners.find((candidate) =>
      paths.samePath(paths.parent(candidate.path), folder),
    );
    owner?.tasks.push({
      path: entry.path,
      copyPath: entry.path,
      title: entry.title,
      status: metaString(entry, 'status'),
    });
  }
}

// The `features` source's entries grouped into homes by `root`, sorted by
// repo, then root; each home's files sorted by path.
export function groupHomes(
  entries: readonly IndexEntry[],
  paths: Paths,
): HomeShape[] {
  const builds = new Map<string, HomeBuild>();
  for (const entry of entries) {
    const { source, repo, root } = entry;
    const isHomeEntry = source === 'features' && repo !== null && root !== null;
    if (isHomeEntry) {
      addEntry(homeBuild(builds, repo, root), entry);
    }
  }
  const homes: HomeShape[] = [];
  for (const build of builds.values()) {
    attachTasks(build, paths);
    const { shape } = build;
    shape.followupFiles = [...build.followupPaths]
      .toSorted()
      .map((path) => ({ path }));
    shape.plans.sort(byPath);
    shape.features.sort(byPath);
    homes.push(shape);
  }
  return homes.sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.root.localeCompare(b.root),
  );
}

// Marks one create target per repo: by `root` order, the first home in git,
// else the first home. The homes keep their order.
export function markCreateTargets<
  H extends { repo: string; root: string; gitRoot: string | null },
>(homes: H[]): (H & { isCreateTarget: boolean })[] {
  const targets = new Map<string, H>();
  for (const home of homes.toSorted((a, b) => a.root.localeCompare(b.root))) {
    const current = targets.get(home.repo);
    const replacesCurrent =
      current === undefined ||
      (current.gitRoot === null && home.gitRoot !== null);
    if (replacesCurrent) {
      targets.set(home.repo, home);
    }
  }
  return homes.map((home) => ({
    ...home,
    isCreateTarget: targets.get(home.repo) === home,
  }));
}
