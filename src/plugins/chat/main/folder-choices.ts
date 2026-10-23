import type { AgentHarness, ProjectFolder } from '../../../contracts/agent';
import type { Files, FileStat } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { ChatProfile, RecentFolder } from '../contract';
import { MAX_RECENT_FOLDERS, type RecentFolders } from './recent-folders';

export const MAX_FOLDER_CHOICES = MAX_RECENT_FOLDERS * 2;

// A harness's project folder under the profile it was listed for.
export interface ListedProject {
  profile: string;
  folder: ProjectFolder;
}

// One entry per folder (`paths.samePath`), the one with the greatest
// `lastUsed` kept with its spelling and profile; a project's `modified` is its
// `lastUsed`. Newest first, every folder kept: `list` caps its folders at
// MAX_FOLDER_CHOICES after leaving folders out.
export function mergeFolderChoices(
  recent: readonly RecentFolder[],
  projects: readonly ListedProject[],
  paths: Paths,
): RecentFolder[] {
  const uses: RecentFolder[] = [
    ...recent,
    ...projects.map(({ profile, folder }) => ({
      projectDir: folder.projectDir,
      profile,
      lastUsed: folder.modified,
    })),
  ];
  uses.sort((a, b) => b.lastUsed - a.lastUsed);
  const kept: RecentFolder[] = [];
  for (const use of uses) {
    const isNewFolder = !kept.some((earlier) =>
      paths.samePath(earlier.projectDir, use.projectDir),
    );
    if (isNewFolder) {
      kept.push(use);
    }
  }
  return kept;
}

export interface FolderChoices {
  // The start prompt's folders: chat's recent folders merged with every
  // profile's harness project folders, leaving out each folder inside one of
  // the OS's temp folders, each that is no longer a folder, and each it cannot
  // check (logged); the newest MAX_FOLDER_CHOICES of the rest. A profile whose
  // listing rejects is logged and lists none; rejects when chat's harness is
  // missing.
  list(): Promise<RecentFolder[]>;
}

// `harness` is looked up on every call and throws when chat's harness is
// missing.
export function createFolderChoices(deps: {
  recent: RecentFolders;
  harness(): AgentHarness;
  profiles(): readonly ChatProfile[];
  files: Pick<Files, 'stat'>;
  paths: Paths;
  tempFolders: readonly string[];
  log: Log;
}): FolderChoices {
  const { files, paths, tempFolders, log } = deps;

  async function profileProjects(
    harness: AgentHarness,
    profile: ChatProfile,
  ): Promise<ListedProject[]> {
    try {
      const folders = await harness.listProjects(profile.configDir);
      return folders.map((folder) => ({ profile: profile.name, folder }));
    } catch (error) {
      log(
        'chat',
        `project folders of ${profile.name} not listed: ${errorText(error)}`,
      );
      return [];
    }
  }

  async function everyProfileProjects(): Promise<ListedProject[]> {
    const harness = deps.harness();
    const listings = await Promise.all(
      deps.profiles().map((profile) => profileProjects(harness, profile)),
    );
    return listings.flat();
  }

  async function statFolder(folder: RecentFolder): Promise<FileStat | null> {
    try {
      return await files.stat(folder.projectDir);
    } catch (error) {
      log(
        'chat',
        `folder ${folder.projectDir} not checked: ${errorText(error)}`,
      );
      return null;
    }
  }

  const isInTempFolder = (folder: RecentFolder) =>
    tempFolders.some((temp) => paths.isInside(folder.projectDir, temp));

  return {
    async list() {
      const [recent, projects] = await Promise.all([
        deps.recent.list(),
        everyProfileProjects(),
      ]);
      const merged = mergeFolderChoices(recent, projects, paths).filter(
        (folder) => !isInTempFolder(folder),
      );
      const stats = await Promise.all(merged.map(statFolder));
      return merged
        .filter((_, index) => stats[index]?.isFolder === true)
        .slice(0, MAX_FOLDER_CHOICES);
    },
  };
}
