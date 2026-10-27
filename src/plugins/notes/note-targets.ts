import type { Paths } from '../../contracts/paths';
import type { NoteHome } from './contract';

// The home a session in `projectDir` notes into: the home whose clone holds
// the folder (the deepest clone wins), else the home whose repo name the
// folder or one of its parents bears (the deepest folder wins); null when
// none matches or `projectDir` is null.
export function defaultTarget(
  homes: readonly NoteHome[],
  projectDir: string | null,
  paths: Paths,
): NoteHome | null {
  if (projectDir === null) {
    return null;
  }
  let inside: { home: NoteHome; folder: string } | null = null;
  for (const home of homes) {
    const folder = home.folder;
    const holdsProject = folder !== null && paths.isInside(projectDir, folder);
    if (
      holdsProject &&
      (inside === null || folder.length > inside.folder.length)
    ) {
      inside = { home, folder };
    }
  }
  if (inside !== null) {
    return inside.home;
  }
  for (let folder = projectDir; ; folder = paths.parent(folder)) {
    const name = paths.base(folder);
    const named = homes.find((home) => home.repo === name);
    if (named !== undefined) {
      return named;
    }
    if (paths.samePath(paths.parent(folder), folder)) {
      return null;
    }
  }
}

// The folder a session launched for `home` starts in: the home's clone, else
// the first of `sessionFolders` that `defaultTarget` maps to `home`; null when
// none does.
export function launchFolder(
  home: NoteHome,
  sessionFolders: readonly string[],
  paths: Paths,
): string | null {
  if (home.folder !== null) {
    return home.folder;
  }
  const found = sessionFolders.find(
    (folder) => defaultTarget([home], folder, paths) === home,
  );
  return found ?? null;
}
