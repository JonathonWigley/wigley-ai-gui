import { type Files, isMissingFile, readIfPresent } from '../contracts/files';
import type { Git } from '../contracts/git';
import type { Paths } from '../contracts/paths';
import { type PlanProgress, readPlanProgress } from './plan-progress';

// One checkout's copy of a plan folder: `planDir` in `checkout`, and the
// newest modified time of its `plan.md` and task documents.
export interface PlanCopy {
  readonly planDir: string;
  readonly checkout: string;
  readonly changedAt: number;
}

export interface PlanCopyDeps {
  readonly git: Pick<Git, 'topLevel' | 'worktrees'>;
  readonly files: Pick<
    Files,
    'read' | 'modified' | 'list' | 'realPath' | 'stat'
  >;
  readonly paths: Paths;
}

// A task document's file name in a plan folder.
const TASK_DOCUMENT = /^\d{2}-.+\.md$/;

interface Anchor {
  // The nearest folder at or above the plan folder that exists.
  readonly folder: string;
  // The plan folder's segments below `folder`.
  readonly rest: readonly string[];
}

// The clone's top folder holding `planDir`, asked of its nearest existing
// folder, so a deleted copy still finds its clone; null in no clone.
export async function repoTop(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<string | null> {
  return deps.git.topLevel((await nearestFolder(planDir, deps)).folder);
}

// The copies of `planDir` that hold a `plan.md`: the same repo-relative folder
// in each checkout of its clone, in `git worktree list` order (the main tree
// first). Outside a clone, or when git cannot list the checkouts, the copy at
// `planDir` alone. Rejects on a files failure other than a missing file.
export async function planCopies(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<PlanCopy[]> {
  const { files, paths } = deps;
  const anchor = await nearestFolder(planDir, deps);
  const top = await deps.git.topLevel(anchor.folder);
  if (top === null) {
    return copyAtPlanDir(planDir, deps);
  }
  const segments = paths.segmentsBelow(
    paths.join(await files.realPath(anchor.folder), ...anchor.rest),
    await files.realPath(top),
  );
  if (segments === null) {
    return copyAtPlanDir(planDir, deps);
  }
  let trees;
  try {
    trees = await deps.git.worktrees(top);
  } catch {
    return copyAtPlanDir(planDir, deps);
  }
  const copies = await Promise.all(
    trees.map((tree) =>
      copyAt(paths.join(tree.path, ...segments), tree.path, deps),
    ),
  );
  return copies.filter((copy) => copy !== null);
}

// The copy with the largest `changedAt`, the earlier one in `planCopies`
// order on a tie; null when there is none.
export async function newestPlanCopy(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<PlanCopy | null> {
  let newest: PlanCopy | null = null;
  for (const copy of await planCopies(planDir, deps)) {
    if (newest === null || copy.changedAt > newest.changedAt) {
      newest = copy;
    }
  }
  return newest;
}

// The copy's progress, its task statuses read from the copy's own task
// documents; null when its `plan.md` is gone.
export async function readPlanCopy(
  copy: PlanCopy,
  deps: PlanCopyDeps,
): Promise<PlanProgress | null> {
  const { files, paths } = deps;
  const planText = await readIfPresent(
    files,
    paths.join(copy.planDir, 'plan.md'),
  );
  if (planText === null) {
    return null;
  }
  const taskTexts = new Map<string, string>();
  for (const task of readPlanProgress(planText, new Map()).tasks) {
    if (task.file === null) {
      continue;
    }
    const text = await readIfPresent(
      files,
      paths.join(copy.planDir, task.file),
    );
    if (text !== null) {
      taskTexts.set(task.file, text);
    }
  }
  return readPlanProgress(planText, taskTexts);
}

// `planDir`'s nearest existing folder, walking up to a root, which is its own
// parent.
async function nearestFolder(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<Anchor> {
  const rest: string[] = [];
  let folder = planDir;
  while (!(await deps.files.stat(folder))?.isFolder) {
    const parent = deps.paths.parent(folder);
    if (parent === folder) {
      break;
    }
    rest.unshift(deps.paths.base(folder));
    folder = parent;
  }
  return { folder, rest };
}

async function copyAtPlanDir(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<PlanCopy[]> {
  const copy = await copyAt(planDir, planDir, deps);
  return copy === null ? [] : [copy];
}

// The copy at `planDir` in `checkout`; null when it holds no `plan.md` file.
async function copyAt(
  planDir: string,
  checkout: string,
  deps: PlanCopyDeps,
): Promise<PlanCopy | null> {
  const plan = await deps.files.stat(deps.paths.join(planDir, 'plan.md'));
  if (plan === null || plan.isFolder) {
    return null;
  }
  const changedAt = await newestChange(planDir, deps);
  return changedAt === null ? null : { planDir, checkout, changedAt };
}

// The largest modified time of `plan.md` and the task documents directly in
// `planDir`, a file deleted since the listing left out; null when `plan.md`
// is gone.
async function newestChange(
  planDir: string,
  deps: PlanCopyDeps,
): Promise<number | null> {
  const { files, paths } = deps;
  const planTime = await modifiedIfPresent(
    paths.join(planDir, 'plan.md'),
    files,
  );
  if (planTime === null) {
    return null;
  }
  const taskDocuments = (await files.list(planDir)).filter(
    (entry) => entry.kind === 'file' && TASK_DOCUMENT.test(entry.path),
  );
  const taskTimes = await Promise.all(
    taskDocuments.map((entry) =>
      modifiedIfPresent(paths.join(planDir, entry.path), files),
    ),
  );
  let newest = planTime;
  for (const time of taskTimes) {
    if (time !== null && time > newest) {
      newest = time;
    }
  }
  return newest;
}

async function modifiedIfPresent(
  path: string,
  files: Pick<Files, 'modified'>,
): Promise<number | null> {
  try {
    return await files.modified(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}
