import type { AppUpdateStatus } from '../contract';

// The length of the commit an `available` status names.
const SHORT_SHA_LENGTH = 7;

// Whether origin's `main` (`origin`, null when the clone has none) holds an
// update for the app built from `installed`: only when it is another commit
// and `installed` is its ancestor, so a build from a newer local commit shows
// none. `isInstalledAncestor` is false when not asked, as for an equal commit.
export function updateStatusOf(
  installed: string,
  origin: string | null,
  isInstalledAncestor: boolean,
): AppUpdateStatus {
  const isNewer =
    origin !== null && origin !== installed && isInstalledAncestor;
  return isNewer
    ? { kind: 'available', sha: origin.slice(0, SHORT_SHA_LENGTH) }
    : { kind: 'none' };
}
