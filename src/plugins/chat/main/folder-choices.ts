import type {
  AgentHarness,
  HarnessProfile,
  ProjectFolder,
} from '../../../contracts/agent';
import type { Files, FileStat } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { RecentFolder } from '../contract';
import type { ChatHarnesses } from './lookups';
import { MAX_RECENT_FOLDERS, type RecentFolders } from './recent-folders';

export const MAX_FOLDER_CHOICES = MAX_RECENT_FOLDERS * 2;

// A harness's project folder under the profile it was listed for, with that
// harness's id.
export interface ListedProject {
  harness: string;
  profile: string;
  folder: ProjectFolder;
}

// One entry per folder (`paths.samePath`), the one with the greatest
// `lastUsed` kept with its spelling, harness and profile; a project's `modified` is its
// `lastUsed`. Newest first, every folder kept: `list` caps its folders at
// MAX_FOLDER_CHOICES after leaving folders out.
export function mergeFolderChoices(
  recent: readonly RecentFolder[],
  projects: readonly ListedProject[],
  paths: Paths,
): RecentFolder[] {
  const uses: RecentFolder[] = [
    ...recent,
    ...projects.map(({ harness, profile, folder }) => ({
      projectDir: folder.projectDir,
      harness,
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
  // The start prompt's folders: chat's recent folders merged with the project
  // folders of every profile each registered listed harness publishes, leaving out
  // each folder inside one of the OS's temp folders, each that is no longer a
  // folder, and each it cannot check (logged); the newest MAX_FOLDER_CHOICES of
  // the rest. A profile whose listing rejects is logged and lists none.
  list(): Promise<RecentFolder[]>;
}

// The registered harnesses are read on every call.
export function createFolderChoices(deps: {
  recent: RecentFolders;
  harnesses: Pick<ChatHarnesses, 'list' | 'profilesOf'>;
  files: Pick<Files, 'stat'>;
  paths: Paths;
  tempFolders: readonly string[];
  log: PluginLog;
}): FolderChoices {
  const { files, paths, tempFolders, log } = deps;

  async function profileProjects(
    harness: AgentHarness,
    profile: HarnessProfile,
  ): Promise<ListedProject[]> {
    try {
      const folders = await harness.listProjects(profile.configDir);
      return folders.map((folder) => ({
        harness: harness.id,
        profile: profile.name,
        folder,
      }));
    } catch (error) {
      log(`project folders of ${profile.name} not listed: ${errorText(error)}`);
      return [];
    }
  }

  async function everyProfileProjects(): Promise<ListedProject[]> {
    const listings = await Promise.all(
      deps.harnesses
        .list()
        .filter((harness) => harness.info().unlisted !== true)
        .flatMap((harness) =>
          deps.harnesses
            .profilesOf(harness.id)
            .map((profile) => profileProjects(harness, profile)),
        ),
    );
    return listings.flat();
  }

  async function statFolder(folder: RecentFolder): Promise<FileStat | null> {
    try {
      return await files.stat(folder.projectDir);
    } catch (error) {
      log(`folder ${folder.projectDir} not checked: ${errorText(error)}`);
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
