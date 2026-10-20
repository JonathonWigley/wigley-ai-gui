import type { Clock } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { RecentFolder } from '../contract';

export const RECENT_FOLDERS_FILE = 'recent-folders.json';
export const MAX_RECENT_FOLDERS = 20;

export interface RecentFolders {
  // Newest first; [] when the file is missing or unreadable.
  list(): Promise<RecentFolder[]>;
  // Writes run one after another, each reading the file the last one wrote.
  record(projectDir: string, profile: string): Promise<void>;
}

// `folder` first, any earlier entry for its projectDir dropped, at most
// MAX_RECENT_FOLDERS kept.
export function addRecentFolder(
  folders: readonly RecentFolder[],
  folder: RecentFolder,
): RecentFolder[] {
  const others = folders.filter(
    (earlier) => earlier.projectDir !== folder.projectDir,
  );
  return [folder, ...others].slice(0, MAX_RECENT_FOLDERS);
}

function parseRecentFolders(text: string): RecentFolder[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('not a JSON array');
  }
  return parsed as RecentFolder[];
}

// Chat's recent project folders in `recent-folders.json` in its data folder.
export function createRecentFolders(deps: {
  data: Files;
  clock: Clock;
  log: Log;
}): RecentFolders {
  const { data, clock, log } = deps;
  let lastWrite: Promise<void> = Promise.resolve();

  async function list(): Promise<RecentFolder[]> {
    let text: string;
    try {
      text = await data.read(RECENT_FOLDERS_FILE);
    } catch {
      return [];
    }
    try {
      return parseRecentFolders(text);
    } catch (error) {
      log('chat', `${RECENT_FOLDERS_FILE} unreadable: ${errorText(error)}`);
      return [];
    }
  }

  async function write(projectDir: string, profile: string): Promise<void> {
    const folders = addRecentFolder(await list(), {
      projectDir,
      profile,
      lastUsed: clock.now(),
    });
    await data.write(RECENT_FOLDERS_FILE, JSON.stringify(folders, null, 2));
  }

  return {
    list,
    record(projectDir, profile) {
      const recorded = lastWrite.then(() => write(projectDir, profile));
      lastWrite = recorded.catch(() => undefined);
      return recorded;
    },
  };
}
