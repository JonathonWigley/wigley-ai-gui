import type { Clock } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { RecentFolder } from '../contract';
import { UNRECORDED_HARNESS_ID } from './lookups';

export const RECENT_FOLDERS_FILE = 'recent-folders.json';
export const MAX_RECENT_FOLDERS = 20;

export interface RecentFolders {
  // Newest first; [] when the file is missing, and [] with the error logged
  // when it cannot be read or parsed. An entry written without a harness reads
  // as UNRECORDED_HARNESS_ID's.
  list(): Promise<RecentFolder[]>;
  // Writes run one after another, each reading the file the last one wrote.
  // Rejects, leaving the file as it is, when the file exists but cannot be
  // read or parsed, so a passing failure never wipes the history.
  record(projectDir: string, harness: string, profile: string): Promise<void>;
}

// `folder` first, any earlier entry for the same path as its projectDir
// dropped (the new spelling kept), at most MAX_RECENT_FOLDERS kept.
export function addRecentFolder(
  folders: readonly RecentFolder[],
  folder: RecentFolder,
  paths: Paths,
): RecentFolder[] {
  const others = folders.filter(
    (earlier) => !paths.samePath(earlier.projectDir, folder.projectDir),
  );
  return [folder, ...others].slice(0, MAX_RECENT_FOLDERS);
}

// A recent folder as the file holds it: one written before the harness was
// recorded has none.
type StoredRecentFolder = Omit<RecentFolder, 'harness'> &
  Partial<Pick<RecentFolder, 'harness'>>;

function parseRecentFolders(text: string): RecentFolder[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('not a JSON array');
  }
  return (parsed as StoredRecentFolder[]).map((folder) => ({
    ...folder,
    harness: folder.harness ?? UNRECORDED_HARNESS_ID,
  }));
}

// Chat's recent project folders in `recent-folders.json` in its data folder.
export function createRecentFolders(deps: {
  data: Files;
  clock: Clock;
  paths: Paths;
  log: PluginLog;
}): RecentFolders {
  const { data, clock, paths, log } = deps;
  let lastWrite: Promise<void> = Promise.resolve();

  // [] when the file is missing; throws when it cannot be read or parsed.
  async function readSaved(): Promise<RecentFolder[]> {
    const text = await readIfPresent(data, RECENT_FOLDERS_FILE);
    return text === null ? [] : parseRecentFolders(text);
  }

  async function list(): Promise<RecentFolder[]> {
    try {
      return await readSaved();
    } catch (error) {
      log(`${RECENT_FOLDERS_FILE} unreadable: ${errorText(error)}`);
      return [];
    }
  }

  async function write(
    projectDir: string,
    harness: string,
    profile: string,
  ): Promise<void> {
    const folders = addRecentFolder(
      await readSaved(),
      { projectDir, harness, profile, lastUsed: clock.now() },
      paths,
    );
    await data.write(RECENT_FOLDERS_FILE, JSON.stringify(folders, null, 2));
  }

  return {
    list,
    record(projectDir, harness, profile) {
      const recorded = lastWrite.then(() =>
        write(projectDir, harness, profile),
      );
      lastWrite = recorded.catch(() => undefined);
      return recorded;
    },
  };
}
