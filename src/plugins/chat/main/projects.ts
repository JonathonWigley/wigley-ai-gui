// The pure project rules: the `projects` setting's checks, which project a
// folder belongs to, a pool project's branch order, and the pool provider
// registry.
import type { Disposable } from '../../../contracts/disposable';
import type { Paths } from '../../../contracts/paths';
import type { ChatProject, PoolProvider, ProjectSetting } from '../contract';

type ProjectFields = Record<string, unknown>;

// Each element of `raw` checked in order, the kept ones returned in settings
// order. `raw` may hold any JSON whatever its type says, since the settings
// check types no element of an empty default list. A key holding null counts
// as absent. An element failing a check is left out and logs one line naming
// its index, its name and its fault. A name is taken only by a kept entry.
// `folder` is kept as written, a `~` unexpanded; no profile or path is checked
// against anything outside the element.
export function readProjects(
  raw: readonly ProjectSetting[],
  log: (line: string) => void,
): ChatProject[] {
  const kept: ChatProject[] = [];
  raw.forEach((element: unknown, index) => {
    const read = readProject(element, kept);
    if (typeof read === 'string') {
      log(`projects[${index}] ${entryName(element)} skipped: ${read}`);
      return;
    }
    kept.push(read);
  });
  return kept;
}

// The first project in `projects` order that covers `folder`, else null. A
// folder project covers its tilde-expanded folder and below; a pool project
// covers each clone `poolFolders` gives, as given, and below.
export function projectOf(
  folder: string,
  projects: readonly ChatProject[],
  poolFolders: (pool: string) => readonly string[],
  homeDir: string,
  paths: Pick<Paths, 'isInside' | 'expandTilde'>,
): ChatProject | null {
  const covering = projects.find((project) =>
    project.kind === 'folder'
      ? paths.isInside(folder, paths.expandTilde(project.folder, homeDir))
      : poolFolders(project.pool).some((clone) =>
          paths.isInside(folder, clone),
        ),
  );
  return covering ?? null;
}

// A pool project's Branch list: `pinned` in its order, then each name of
// `origin` not pinned, in origin order; each name once, compared with ===. A
// pinned name origin lacks is still listed.
export function branchChoices(
  pinned: readonly string[],
  origin: readonly string[],
): string[] {
  return [...new Set([...pinned, ...origin])];
}

export interface PoolProviders {
  // Each call is its own registration; its handle removes only it, and a
  // second `dispose` does nothing.
  add(provider: PoolProvider): Disposable;
  // The newest provider still registered; null with none.
  current(): PoolProvider | null;
}

export function createPoolProviders(): PoolProviders {
  // One object per `add` call, in registration order.
  const registrations = new Set<{ provider: PoolProvider }>();
  return {
    add(provider) {
      const registration = { provider };
      registrations.add(registration);
      return {
        dispose() {
          registrations.delete(registration);
        },
      };
    },
    current() {
      return [...registrations].at(-1)?.provider ?? null;
    },
  };
}

// The element as a project, or the fault that skips it.
function readProject(
  element: unknown,
  kept: readonly ChatProject[],
): ChatProject | string {
  if (!isPlainObject(element)) {
    return 'not an object';
  }
  const name = present(element, 'name');
  if (typeof name !== 'string' || name === '') {
    return 'name must be a non-empty string';
  }
  const folder = present(element, 'folder');
  const pool = present(element, 'pool');
  if (folder === undefined && pool === undefined) {
    return 'needs a folder or a pool';
  }
  if (folder !== undefined && pool !== undefined) {
    return 'has both a folder and a pool';
  }
  if (folder !== undefined && (typeof folder !== 'string' || folder === '')) {
    return 'folder must be a non-empty string';
  }
  if (pool !== undefined && (typeof pool !== 'string' || pool === '')) {
    return 'pool must be a non-empty string';
  }
  const profile = present(element, 'profile');
  if (profile !== undefined && typeof profile !== 'string') {
    return 'profile must be a string';
  }
  const pinnedBranches = present(element, 'pinnedBranches');
  if (pinnedBranches !== undefined && folder !== undefined) {
    return 'pinnedBranches belongs to a pool project';
  }
  if (pinnedBranches !== undefined && !isNameList(pinnedBranches)) {
    return 'pinnedBranches must be a list of branch names';
  }
  if (kept.some((project) => project.name === name)) {
    return 'the name an earlier project took';
  }
  if (typeof folder === 'string') {
    return { kind: 'folder', name, folder, profile: profile ?? null };
  }
  return {
    kind: 'pool',
    name,
    pool: pool as string,
    profile: profile ?? null,
    pinnedBranches: pinnedBranches ?? [],
  };
}

function isNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((branch) => typeof branch === 'string')
  );
}

function isPlainObject(value: unknown): value is ProjectFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The key's value, undefined when absent or JSON null.
function present(fields: ProjectFields, key: string): unknown {
  return fields[key] ?? undefined;
}

function entryName(element: unknown): string {
  const name = isPlainObject(element) ? element['name'] : undefined;
  return typeof name === 'string' ? JSON.stringify(name) : 'unnamed';
}
