import type { Git } from '../contracts/git';

// Each folder's origin repo name, asked of git once for the app's life: a null
// stays cached, and a rejected lookup leaves the cache, so the next caller asks
// again.
export function createOriginRepoNames(
  git: Pick<Git, 'originRepoName'>,
): (folder: string) => Promise<string | null> {
  const lookups = new Map<string, Promise<string | null>>();
  return (folder) => {
    const cached = lookups.get(folder);
    if (cached !== undefined) {
      return cached;
    }
    const lookup = git.originRepoName(folder);
    lookups.set(folder, lookup);
    lookup.catch(() => lookups.delete(folder));
    return lookup;
  };
}
