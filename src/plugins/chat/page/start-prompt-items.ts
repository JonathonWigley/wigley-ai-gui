import type { ChatProfile, RecentFolder } from '../contract';

export type FolderItem =
  | { kind: 'recent'; folder: RecentFolder; label: string }
  | { kind: 'choose'; label: string };

export const CHOOSE_FOLDER_LABEL = 'Choose folder…';

// `projectDir` with the home folder shown as `~`; a folder outside home is
// unchanged.
export function displayPath(projectDir: string, homeDir: string): string {
  const home = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  if (projectDir === home) {
    return '~';
  }
  if (projectDir.startsWith(`${home}/`)) {
    return `~${projectDir.slice(home.length)}`;
  }
  return projectDir;
}

// The folder step's lines: the recent folders in the order given, then the
// choose-folder line.
export function folderItems(
  recent: readonly RecentFolder[],
  homeDir: string,
): FolderItem[] {
  const recentItems: FolderItem[] = recent.map((folder) => ({
    kind: 'recent',
    folder,
    label: displayPath(folder.projectDir, homeDir),
  }));
  return [...recentItems, { kind: 'choose', label: CHOOSE_FOLDER_LABEL }];
}

// The index in `profiles` to pre-select for `projectDir`; 0 when no recent
// folder names a profile in `profiles`.
export function preselectedProfile(
  profiles: readonly ChatProfile[],
  recent: readonly RecentFolder[],
  projectDir: string,
): number {
  const used = recent.find((folder) => folder.projectDir === projectDir);
  if (used === undefined) {
    return 0;
  }
  const index = profiles.findIndex((profile) => profile.name === used.profile);
  return Math.max(0, index);
}

export function profileLabel(profile: ChatProfile): string {
  return `${profile.name} · ${profile.configDir}`;
}
