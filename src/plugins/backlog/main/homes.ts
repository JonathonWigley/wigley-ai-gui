import type { IndexEntry } from '../../docs/contract';
import type { BacklogHome } from '../contract';

// A home as the index alone gives it: no git state or follow-up items, which
// the main part reads from disk and git.
export type HomeShape = Pick<BacklogHome, 'repo' | 'root'> & {
  followupFiles: { path: string }[];
};

// The `features` source's entries grouped into homes by `root`, sorted by
// repo, then root; each home's follow-up files sorted by path. Any entry of a
// home makes it a home; only its follow-up entries name its files.
export function groupHomes(entries: readonly IndexEntry[]): HomeShape[] {
  const builds = new Map<string, { repo: string; followupPaths: Set<string> }>();
  for (const entry of entries) {
    const { source, repo, root } = entry;
    const isHomeEntry = source === 'features' && repo !== null && root !== null;
    if (!isHomeEntry) {
      continue;
    }
    let build = builds.get(root);
    if (build === undefined) {
      build = { repo, followupPaths: new Set() };
      builds.set(root, build);
    }
    if (entry.kind === 'followup') {
      build.followupPaths.add(entry.path);
    }
  }
  const homes = [...builds].map(
    ([root, { repo, followupPaths }]): HomeShape => ({
      repo,
      root,
      followupFiles: [...followupPaths].toSorted().map((path) => ({ path })),
    }),
  );
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
