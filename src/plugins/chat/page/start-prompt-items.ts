import type { Paths } from '../../../contracts/paths';
import type {
  ChatProfile,
  RecentFolder,
  ResumeSectionRow,
  ResumeSectionRows,
} from '../contract';
import { sectionRowsOnce, sessionTime, withNote } from './resume-items';

export type FolderItem =
  | { kind: 'section'; section: string; row: ResumeSectionRow; label: string }
  | { kind: 'recent'; folder: RecentFolder; label: string }
  | { kind: 'choose'; label: string };

export const CHOOSE_FOLDER_LABEL = 'Choose folder…';
export const FOLDERS_HEADING = 'Folders';

// `projectDir` in the OS's own spelling with the home folder shown as `~`.
export function displayPath(
  projectDir: string,
  homeDir: string,
  paths: Paths,
): string {
  return paths.tilde(projectDir, homeDir);
}

// A folder step section row's line after its title, its note first.
export function folderSectionDetail(
  row: ResumeSectionRow,
  paths: Paths,
): string {
  return withNote(
    row,
    `${paths.base(row.projectDir)} · ${row.profile} · ${sessionTime(row.at)}`,
  );
}

// The folder step's lines: the section rows, then the recent folders in the
// order given, then the choose-folder line.
export function folderItems(
  recent: readonly RecentFolder[],
  sections: readonly ResumeSectionRows[],
  homeDir: string,
  paths: Paths,
): FolderItem[] {
  const sectionItems: FolderItem[] = sectionRowsOnce(sections).map(
    ({ section, row }) => ({
      kind: 'section',
      section,
      row,
      label: `${row.title} · ${folderSectionDetail(row, paths)}`,
    }),
  );
  const recentItems: FolderItem[] = recent.map((folder) => ({
    kind: 'recent',
    folder,
    label: displayPath(folder.projectDir, homeDir, paths),
  }));
  return [
    ...sectionItems,
    ...recentItems,
    { kind: 'choose', label: CHOOSE_FOLDER_LABEL },
  ];
}

// The folder step's row name: a recent folder's own name; the choose-folder
// line's label; empty for a section row, which matches only on its label.
export function folderName(item: FolderItem, paths: Paths): string {
  if (item.kind === 'section') {
    return '';
  }
  return item.kind === 'recent'
    ? paths.base(item.folder.projectDir)
    : item.label;
}

// The heading `item` sits under: its section, else `FOLDERS_HEADING`; null for
// every line of a step that shows no section rows.
export function folderSection(
  item: FolderItem,
  showsSections: boolean,
): string | null {
  if (item.kind === 'section') {
    return item.section;
  }
  return showsSections ? FOLDERS_HEADING : null;
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
