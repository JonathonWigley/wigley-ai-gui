import type {
  ChatEntry,
  PastSession,
  ProjectFolder,
  UsageAgentEvent,
} from '../../contracts/agent';
import type { Files } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../../shared/error-text';
import {
  EMPTY_SESSION_USAGE,
  usageEvent,
  withSavedReplies,
} from './session-usage';
import {
  endsInsideLine,
  mainReplies,
  readTranscriptHead,
  SESSION_ID,
  sessionTitle,
  TRANSCRIPT_HEAD_BYTES,
  TRANSCRIPT_HEAD_MAX_BYTES,
  type TranscriptHead,
  transcriptEntries,
} from './transcripts';

export interface PastSessionsDeps {
  files: Files;
  paths: Paths;
  log: Log;
}

const TRANSCRIPT_EXTENSION = '.jsonl';
// How many transcripts, or project folders, a listing reads at once, so a
// large folder cannot exhaust the process's file handles.
export const TRANSCRIPT_READ_BATCH = 16;

// The sessions in `projectsFolder` whose transcript opens in `projectDir`, as
// `paths.samePath` compares them, newest first, then by session id, read
// `TRANSCRIPT_READ_BATCH` at a time. A transcript that cannot be read is left
// out and logged; a missing folder lists none.
export async function listPastSessions(
  deps: PastSessionsDeps,
  projectsFolder: string,
  projectDir: string,
): Promise<PastSession[]> {
  const listed = await deps.files.list(projectsFolder);
  const sessionIds = listed
    .filter((entry) => entry.kind === 'file')
    .map((entry) => transcriptSessionId(entry.path))
    .filter((id): id is string => id !== null);
  const found = await inBatches(sessionIds, (id) =>
    pastSession(deps, projectsFolder, projectDir, id),
  );
  return found
    .filter((session): session is PastSession => session !== null)
    .sort(
      (a, b) =>
        b.modified - a.modified || compareText(a.sessionId, b.sessionId),
    );
}

// Every project folder in `projectsRoot` (`<config>/projects`) named by the
// `cwd` at the start of its newest transcript, with that transcript's modified
// time, newest first, then by folder; read `TRANSCRIPT_READ_BATCH` folders at
// a time. A folder with no readable transcript or no `cwd` is left out and
// logged; a missing `projectsRoot` lists none.
export async function listProjectFolders(
  deps: PastSessionsDeps,
  projectsRoot: string,
): Promise<ProjectFolder[]> {
  const listed = await deps.files.list(projectsRoot);
  const folders = listed
    .filter((entry) => entry.kind === 'folder')
    .map((entry) => deps.paths.join(projectsRoot, entry.path));
  const found = await inBatches(folders, (folder) =>
    projectFolder(deps, folder),
  );
  return found
    .filter((project): project is ProjectFolder => project !== null)
    .sort(
      (a, b) =>
        b.modified - a.modified || compareText(a.projectDir, b.projectDir),
    );
}

// The saved session's chat entries. Rejects before any read for an id that is
// not a session id, since the id becomes part of a path.
export async function readHistory(
  files: Files,
  paths: Paths,
  projectsFolder: string,
  sessionId: string,
): Promise<ChatEntry[]> {
  return transcriptEntries(
    await readTranscript(files, paths, projectsFolder, sessionId),
  );
}

// The main agent's `usage` event as the saved session's main replies left it,
// at the last one's time; null when it has none. Rejects before any read for
// an id that is not a session id, as `readHistory` does.
export async function readLastUsage(
  files: Files,
  paths: Paths,
  projectsFolder: string,
  sessionId: string,
): Promise<UsageAgentEvent | null> {
  const replies = mainReplies(
    await readTranscript(files, paths, projectsFolder, sessionId),
  );
  if (replies.length === 0) {
    return null;
  }
  return usageEvent(
    withSavedReplies(EMPTY_SESSION_USAGE, replies),
    replies[replies.length - 1].at,
  );
}

// The saved session's transcript text. Rejects before any read for an id that
// is not a session id, since the id becomes part of a path.
export async function readTranscript(
  files: Files,
  paths: Paths,
  projectsFolder: string,
  sessionId: string,
): Promise<string> {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(`not a Claude session id: ${sessionId}`);
  }
  return files.read(transcriptPath(paths, projectsFolder, sessionId));
}

// The session id a `<id>.jsonl` file name carries, or null for any other file.
function transcriptSessionId(fileName: string): string | null {
  if (!fileName.endsWith(TRANSCRIPT_EXTENSION)) {
    return null;
  }
  const id = fileName.slice(0, -TRANSCRIPT_EXTENSION.length);
  return SESSION_ID.test(id) ? id : null;
}

function transcriptPath(
  paths: Paths,
  projectsFolder: string,
  sessionId: string,
): string {
  return paths.join(projectsFolder, `${sessionId}${TRANSCRIPT_EXTENSION}`);
}

// Null for a transcript that cannot be read or opens in another folder.
async function pastSession(
  deps: PastSessionsDeps,
  projectsFolder: string,
  projectDir: string,
  sessionId: string,
): Promise<PastSession | null> {
  const transcript = transcriptPath(deps.paths, projectsFolder, sessionId);
  let head: TranscriptHead;
  let modified: number;
  try {
    [head, modified] = await Promise.all([
      readHead(deps, transcript, hasFolderAndUserLine),
      deps.files.modified(transcript),
    ]);
  } catch (error) {
    deps.log(
      'claude',
      `transcript ${transcript} unreadable: ${errorText(error)}`,
    );
    return null;
  }
  const { cwd, firstMessage } = head;
  if (cwd === null || !deps.paths.samePath(cwd, projectDir)) {
    return null;
  }
  return { sessionId, title: sessionTitle(firstMessage), modified };
}

// Whether `head` holds the folder and a whole `user` line. A typed first
// message implies one; a transcript whose user lines are all tool results or
// commands stops here too, with no title.
function hasFolderAndUserLine(head: TranscriptHead): boolean {
  return head.cwd !== null && head.sawUserLine;
}

// Null, logged, for a folder that cannot be listed, or whose newest
// transcript cannot be read or names no folder.
async function projectFolder(
  deps: PastSessionsDeps,
  folder: string,
): Promise<ProjectFolder | null> {
  let newest: { path: string; modified: number } | null;
  try {
    newest = await newestTranscript(deps, folder);
  } catch (error) {
    deps.log(
      'claude',
      `project folder ${folder} unreadable: ${errorText(error)}`,
    );
    return null;
  }
  if (newest === null) {
    deps.log('claude', `project folder ${folder} has no readable transcript`);
    return null;
  }
  let head: TranscriptHead;
  try {
    head = await readHead(deps, newest.path, (read) => read.cwd !== null);
  } catch (error) {
    deps.log(
      'claude',
      `transcript ${newest.path} unreadable: ${errorText(error)}`,
    );
    return null;
  }
  const { cwd } = head;
  if (cwd === null) {
    deps.log('claude', `transcript ${newest.path} names no folder`);
    return null;
  }
  return { projectDir: cwd, modified: newest.modified };
}

// The head of the transcript at `path`: its first `TRANSCRIPT_HEAD_BYTES`,
// read again at twice the length while the read ends inside a line and lacks
// what `hasEnough` asks for, up to `TRANSCRIPT_HEAD_MAX_BYTES`, or until a
// longer read returns no more (the whole file). A head that cap still cuts
// short is logged.
async function readHead(
  deps: PastSessionsDeps,
  path: string,
  hasEnough: (head: TranscriptHead) => boolean,
): Promise<TranscriptHead> {
  let maxBytes = TRANSCRIPT_HEAD_BYTES;
  let text = await deps.files.readStart(path, maxBytes);
  let head = readTranscriptHead(text);
  while (!hasEnough(head) && endsInsideLine(text)) {
    if (maxBytes === TRANSCRIPT_HEAD_MAX_BYTES) {
      deps.log(
        'claude',
        `transcript ${path} cut at ${TRANSCRIPT_HEAD_MAX_BYTES} bytes`,
      );
      break;
    }
    maxBytes = Math.min(maxBytes * 2, TRANSCRIPT_HEAD_MAX_BYTES);
    const longer = await deps.files.readStart(path, maxBytes);
    // An unchanged read is the whole file, ending in a line that does not parse.
    const isWholeFile = longer.length === text.length;
    text = longer;
    head = readTranscriptHead(text);
    if (isWholeFile) {
      break;
    }
  }
  return head;
}

// The most recently changed `<session id>.jsonl` in `folder`; a transcript
// whose time cannot be read is skipped and logged.
async function newestTranscript(
  deps: PastSessionsDeps,
  folder: string,
): Promise<{ path: string; modified: number } | null> {
  const listed = await deps.files.list(folder);
  const transcripts = listed
    .filter((entry) => entry.kind === 'file')
    .filter((entry) => transcriptSessionId(entry.path) !== null)
    .map((entry) => deps.paths.join(folder, entry.path));
  const times = await inBatches(transcripts, async (path) => {
    try {
      return { path, modified: await deps.files.modified(path) };
    } catch (error) {
      deps.log('claude', `transcript ${path} unreadable: ${errorText(error)}`);
      return null;
    }
  });
  let newest: { path: string; modified: number } | null = null;
  for (const time of times) {
    const isNewest =
      time !== null && (newest === null || time.modified > newest.modified);
    if (isNewest) {
      newest = time;
    }
  }
  return newest;
}

// `read` over every item, `TRANSCRIPT_READ_BATCH` at a time, so a large
// folder cannot exhaust the process's file handles; results in item order.
async function inBatches<Item, Result>(
  items: readonly Item[],
  read: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += TRANSCRIPT_READ_BATCH) {
    const batch = items.slice(start, start + TRANSCRIPT_READ_BATCH);
    results.push(...(await Promise.all(batch.map(read))));
  }
  return results;
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
