import type { AppBuild, AppInstance } from '../contracts/app-instance';

// A packaged app is the stable one; any other start is the dev app.
export function appInstanceOf(isPackaged: boolean): AppInstance {
  if (isPackaged) {
    return { id: 'wigley-ai-gui', displayName: 'Auri', isDev: false };
  }
  return { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true };
}

// The build from the baked commit and the clone folder; null when the build
// baked no commit (the dev app), the clone folder is missing, or the run is
// not live, so a self-test or drive run of a packaged app never fetches the
// user's clone.
export function appBuildOf(
  commit: string,
  cloneDir: string | null,
  isLive: boolean,
): AppBuild | null {
  return commit === '' || cloneDir === null || !isLive
    ? null
    : { commit, cloneDir };
}
