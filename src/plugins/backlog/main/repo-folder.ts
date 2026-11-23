import type { Paths } from '../../../contracts/paths';
import type { RepoFolderSetting } from '../contract';

// `folder` with `levels` trailing parts taken off.
export function climbFolder(
  paths: Paths,
  folder: string,
  levels: number,
): string {
  let climbed = folder;
  for (let level = 0; level < levels; level += 1) {
    climbed = paths.parent(climbed);
  }
  return climbed;
}

// Whether `folder`'s last parts are `parts`, compared part by part from the
// end.
export function endsWithParts(
  paths: Paths,
  folder: string,
  parts: readonly string[],
): boolean {
  let current = folder;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (paths.base(current) !== parts[index]) {
      return false;
    }
    current = paths.parent(current);
  }
  return true;
}

// The folder of the home's repo: when the home is in a clone and its root
// ends with one of `homeParts` (the in-repo templates' folder parts, the
// first match winning), the folder that many levels above the root; else the
// folder of the first `settings` entry for the repo (its `repo` matched
// exactly), `~` expanded against `homeDir`; null when there is no entry, or
// that entry's folder is empty or not absolute.
export function repoFolderOf(
  home: { repo: string; root: string },
  isInClone: boolean,
  settings: readonly RepoFolderSetting[],
  paths: Paths,
  homeDir: string,
  homeParts: readonly (readonly string[])[],
): string | null {
  const inRepoParts = homeParts.find((parts) =>
    endsWithParts(paths, home.root, parts),
  );
  if (inRepoParts !== undefined && isInClone) {
    return climbFolder(paths, home.root, inRepoParts.length);
  }
  const written = settings.find(
    (setting) => setting.repo === home.repo,
  )?.folder;
  // The settings check types no element of an empty default list.
  const folder =
    typeof written === 'string' ? paths.expandTilde(written, homeDir) : '';
  return paths.isAbsolute(folder) ? paths.normalize(folder) : null;
}
