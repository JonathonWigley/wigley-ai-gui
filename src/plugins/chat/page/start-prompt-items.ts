import type { Paths } from '../../../contracts/paths';
import type { ChatProfile, RecentFolder } from '../contract';

export type FolderItem =
  | { kind: 'recent'; folder: RecentFolder; label: string }
  | { kind: 'choose'; label: string };

export const CHOOSE_FOLDER_LABEL = 'Choose folder…';

// `projectDir` in the OS's own spelling with the home folder shown as `~`.
export function displayPath(
  projectDir: string,
  homeDir: string,
  paths: Paths,
): string {
  return paths.tilde(projectDir, homeDir);
}

// The folder step's lines: the recent folders in the order given, then the
// choose-folder line.
export function folderItems(
  recent: readonly RecentFolder[],
  homeDir: string,
  paths: Paths,
): FolderItem[] {
  const recentItems: FolderItem[] = recent.map((folder) => ({
    kind: 'recent',
    folder,
    label: displayPath(folder.projectDir, homeDir, paths),
  }));
  return [...recentItems, { kind: 'choose', label: CHOOSE_FOLDER_LABEL }];
}

// The index in `profiles` to pre-select for `projectDir`; 0 when no recent
// folder that is the same path names a profile in `profiles`.
export function preselectedProfile(
  profiles: readonly ChatProfile[],
  recent: readonly RecentFolder[],
  projectDir: string,
  paths: Paths,
): number {
  const used = recent.find((folder) =>
    paths.samePath(folder.projectDir, projectDir),
  );
  if (used === undefined) {
    return 0;
  }
  const index = profiles.findIndex((profile) => profile.name === used.profile);
  return Math.max(0, index);
}

export function profileLabel(profile: ChatProfile): string {
  return `${profile.name} · ${profile.configDir}`;
}
