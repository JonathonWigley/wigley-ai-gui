import type { Git } from '../../../contracts/git';

// Each folder's origin repo name, asked of git once for the app's life: a null
// stays cached, and a rejected lookup leaves the cache, so the next caller asks
// again.
export function createProjectNames(
  git: Pick<Git, 'originRepoName'>,
): (projectDir: string) => Promise<string | null> {
  const lookups = new Map<string, Promise<string | null>>();
  return (projectDir) => {
    const cached = lookups.get(projectDir);
    if (cached !== undefined) {
      return cached;
    }
    const lookup = git.originRepoName(projectDir);
    lookups.set(projectDir, lookup);
    lookup.catch(() => lookups.delete(projectDir));
    return lookup;
  };
}
