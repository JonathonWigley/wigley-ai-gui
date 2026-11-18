import type { Paths } from '../../../contracts/paths';
import type {
  AgentHarnessInfo,
  HarnessProfile,
} from '../../../contracts/agent';
import type {
  ChatProject,
  RecentFolder,
  ResumeSectionRow,
  ResumeSectionRows,
} from '../contract';
import { sectionRowsOnce, sessionTime, withNote } from './resume-items';

export type FolderItem =
  | { kind: 'section'; section: string; row: ResumeSectionRow; label: string }
  | { kind: 'recent'; folder: RecentFolder; label: string }
  | { kind: 'choose'; label: string };

export type ProjectItem =
  | { kind: 'section'; section: string; row: ResumeSectionRow; label: string }
  | { kind: 'project'; project: ChatProject; label: string }
  | { kind: 'other'; label: string };

// A section row on the folder or project step.
type SectionItem = Extract<FolderItem | ProjectItem, { kind: 'section' }>;

export const CHOOSE_FOLDER_LABEL = 'Choose folder…';
export const FOLDERS_HEADING = 'Folders';
export const PROJECT_STEP_TITLE = 'Project';
export const OTHER_FOLDER_LABEL = 'Other folder…';
export const PROJECTS_HEADING = 'Projects';

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

// Every section's rows once, as the first step's lines.
function sectionItems(
  sections: readonly ResumeSectionRows[],
  paths: Paths,
): SectionItem[] {
  return sectionRowsOnce(sections).map(({ section, row }) => ({
    kind: 'section',
    section,
    row,
    label: `${row.title} · ${folderSectionDetail(row, paths)}`,
  }));
}

// The folder step's lines: the section rows, then the recent folders in the
// order given, then the choose-folder line.
export function folderItems(
  recent: readonly RecentFolder[],
  sections: readonly ResumeSectionRows[],
  homeDir: string,
  paths: Paths,
): FolderItem[] {
  const recentItems: FolderItem[] = recent.map((folder) => ({
    kind: 'recent',
    folder,
    label: displayPath(folder.projectDir, homeDir, paths),
  }));
  return [
    ...sectionItems(sections, paths),
    ...recentItems,
    { kind: 'choose', label: CHOOSE_FOLDER_LABEL },
  ];
}

// `<name> · <folder, ~ for the home folder>` or `<name> · <pool>`.
export function projectLabel(
  project: ChatProject,
  homeDir: string,
  paths: Paths,
): string {
  const where =
    project.kind === 'pool'
      ? project.pool
      : paths.tilde(paths.expandTilde(project.folder, homeDir), homeDir);
  return `${project.name} · ${where}`;
}

// The project step's lines: the section rows, then each project in settings
// order, then the other-folder line.
export function projectItems(
  projects: readonly ChatProject[],
  sections: readonly ResumeSectionRows[],
  homeDir: string,
  paths: Paths,
): ProjectItem[] {
  const projectLines: ProjectItem[] = projects.map((project) => ({
    kind: 'project',
    project,
    label: projectLabel(project, homeDir, paths),
  }));
  return [
    ...sectionItems(sections, paths),
    ...projectLines,
    { kind: 'other', label: OTHER_FOLDER_LABEL },
  ];
}

// The project step's row name: the project's name; the other-folder line's
// label; empty for a section row, which matches only on its label.
export function projectName(item: ProjectItem): string {
  if (item.kind === 'section') {
    return '';
  }
  return item.kind === 'project' ? item.project.name : item.label;
}

// The heading `item` sits under: its section, else `PROJECTS_HEADING`; null
// for every line of a step that shows no section rows.
export function projectSection(
  item: ProjectItem,
  showsSections: boolean,
): string | null {
  if (item.kind === 'section') {
    return item.section;
  }
  return showsSections ? PROJECTS_HEADING : null;
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
  profiles: readonly HarnessProfile[],
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

// The harness a picked recent folder starts on: the harness recorded with it
// while `harnesses` holds it, else `defaultHarness`.
export function recentFolderHarness(
  folder: RecentFolder,
  harnesses: ReadonlyMap<string, AgentHarnessInfo>,
  defaultHarness: string,
): string {
  return harnesses.has(folder.harness) ? folder.harness : defaultHarness;
}

export function profileLabel(profile: HarnessProfile): string {
  return `${profile.name} · ${profile.configDir}`;
}
