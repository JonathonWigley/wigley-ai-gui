import path from 'node:path';
import type { ChatEntry, PastSession } from '../../contracts/agent';
import type { Files } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import { errorText } from '../../shared/error-text';
import {
  readTranscriptHead,
  SESSION_ID,
  sessionTitle,
  TRANSCRIPT_HEAD_BYTES,
  transcriptEntries,
} from './transcripts';

export interface PastSessionsDeps {
  files: Files;
  log: Log;
}

const TRANSCRIPT_EXTENSION = '.jsonl';

// The sessions in `projectsFolder` whose transcript opens in `projectDir`,
// newest first, then by session id. A transcript that cannot be read is left
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
  const found = await Promise.all(
    sessionIds.map((id) => pastSession(deps, projectsFolder, projectDir, id)),
  );
  return found
    .filter((session): session is PastSession => session !== null)
    .sort(
      (a, b) =>
        b.modified - a.modified || compareText(a.sessionId, b.sessionId),
    );
}

// The saved session's chat entries. Rejects before any read for an id that is
// not a session id, since the id becomes part of a path.
export async function readHistory(
  files: Files,
  projectsFolder: string,
  sessionId: string,
): Promise<ChatEntry[]> {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(`not a Claude session id: ${sessionId}`);
  }
  return transcriptEntries(
    await files.read(transcriptPath(projectsFolder, sessionId)),
  );
}

// The session id a `<id>.jsonl` file name carries, or null for any other file.
function transcriptSessionId(fileName: string): string | null {
  if (!fileName.endsWith(TRANSCRIPT_EXTENSION)) {
    return null;
  }
  const id = fileName.slice(0, -TRANSCRIPT_EXTENSION.length);
  return SESSION_ID.test(id) ? id : null;
}

function transcriptPath(projectsFolder: string, sessionId: string): string {
  return path.join(projectsFolder, `${sessionId}${TRANSCRIPT_EXTENSION}`);
}

// Null for a transcript that cannot be read or opens in another folder.
async function pastSession(
  deps: PastSessionsDeps,
  projectsFolder: string,
  projectDir: string,
  sessionId: string,
): Promise<PastSession | null> {
  const transcript = transcriptPath(projectsFolder, sessionId);
  let head: string;
  let modified: number;
  try {
    [head, modified] = await Promise.all([
      deps.files.readStart(transcript, TRANSCRIPT_HEAD_BYTES),
      deps.files.modified(transcript),
    ]);
  } catch (error) {
    deps.log(
      'claude',
      `transcript ${transcript} unreadable: ${errorText(error)}`,
    );
    return null;
  }
  const { cwd, firstMessage } = readTranscriptHead(head);
  if (cwd !== projectDir) {
    return null;
  }
  return { sessionId, title: sessionTitle(firstMessage), modified };
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
