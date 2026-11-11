import type { Git } from '../../../contracts/git';

// The fixture build's commit, and origin's `main` one commit past it.
export const FIXTURE_INSTALLED_COMMIT =
  '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const FIXTURE_ORIGIN_COMMIT = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// A clone whose fetch succeeds, whose `origin/main` is `FIXTURE_ORIGIN_COMMIT`,
// and whose installed commit is its ancestor, for the self-test and a drive
// run, where no app is installed and no clone is fetched.
export function fixtureGit(): Pick<
  Git,
  'fetch' | 'resolveCommit' | 'isAncestor'
> {
  return {
    fetch: async () => false,
    resolveCommit: async (_root, ref) =>
      ref === 'origin/main' ? FIXTURE_ORIGIN_COMMIT : null,
    isAncestor: async (_root, ancestor, descendant) =>
      ancestor === FIXTURE_INSTALLED_COMMIT &&
      descendant === FIXTURE_ORIGIN_COMMIT,
  };
}
