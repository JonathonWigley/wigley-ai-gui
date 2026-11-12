import type { Paths } from '../../../contracts/paths';
import type { RepoFolderSetting } from '../contract';

// The folder of the home's repo: the folder above `docs/features` when the
// home is a `docs/features` folder in a clone; else the folder of the first
// `settings` entry for the repo (its `repo` matched exactly), `~` expanded
// against `homeDir`; null when there is no entry, or that entry's folder is
// empty or not absolute.
export function repoFolderOf(
  home: { repo: string; root: string },
  isInClone: boolean,
  settings: readonly RepoFolderSetting[],
  paths: Paths,
  homeDir: string,
): string | null {
  const docsFolder = paths.parent(home.root);
  const isFeaturesShape =
    paths.base(home.root) === 'features' && paths.base(docsFolder) === 'docs';
  if (isFeaturesShape && isInClone) {
    return paths.parent(docsFolder);
  }
  const written = settings.find(
    (setting) => setting.repo === home.repo,
  )?.folder;
  // The settings check types no element of an empty default list.
  const folder =
    typeof written === 'string' ? paths.expandTilde(written, homeDir) : '';
  return paths.isAbsolute(folder) ? paths.normalize(folder) : null;
}
