import { describe, expect, it } from 'vitest';
import type { Files } from '../../contracts/files';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import {
  listPastSessions,
  readHistory,
  TRANSCRIPT_READ_BATCH,
} from './past-sessions';

const FOLDER = '/config/projects/-w-app';
const OLD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEW_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER_ID = 'aaaaaaaa-0000-4000-8000-000000000003';

function transcript(cwd: string, firstMessage: string): string {
  return [
    { type: 'mode', mode: 'auto' },
    {
      type: 'user',
      uuid: 'u1',
      cwd,
      sessionId: 's',
      message: { role: 'user', content: firstMessage },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n');
}

// Memory files holding three transcripts (two in `/w/app`, one in
// `/w/other`), a text file and a subagent transcript, written at times the
// test sets.
async function savedSessions() {
  let now = 1000;
  const files = createMemoryFiles({ now: () => now });
  await files.write(`${FOLDER}/${OLD_ID}.jsonl`, transcript('/w/app', 'old'));
  now = 2000;
  await files.write(`${FOLDER}/${NEW_ID}.jsonl`, transcript('/w/app', 'new'));
  await files.write(
    `${FOLDER}/${OTHER_ID}.jsonl`,
    transcript('/w/other', 'elsewhere'),
  );
  await files.write(`${FOLDER}/notes.txt`, 'notes');
  await files.write(
    `${FOLDER}/${OLD_ID}/subagents/agent-x.jsonl`,
    transcript('/w/app', 'subagent'),
  );
  return files;
}

function recordingLog() {
  const logged: [string, string][] = [];
  return {
    logged,
    log: (source: string, message: string) => logged.push([source, message]),
  };
}

describe('listPastSessions', () => {
  it('listPastSessions_NewestFirstForTheFolderOnly', async () => {
    const files = await savedSessions();
    const { log } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(sessions).toEqual([
      { sessionId: NEW_ID, title: 'new', modified: 2000 },
      { sessionId: OLD_ID, title: 'old', modified: 1000 },
    ]);
  });

  it('listPastSessions_MissingFolder_Empty', async () => {
    const { log } = recordingLog();

    const sessions = await listPastSessions(
      { files: createMemoryFiles(), paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(sessions).toEqual([]);
  });

  it('listPastSessions_UnreadableTranscript_LeftOutAndLogged', async () => {
    const stored = await savedSessions();
    const broken = `${FOLDER}/${OLD_ID}.jsonl`;
    const files: Files = {
      ...stored,
      readStart: (path, maxBytes) =>
        path === broken
          ? Promise.reject(new Error('boom'))
          : stored.readStart(path, maxBytes),
    };
    const { log, logged } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(sessions).toEqual([
      { sessionId: NEW_ID, title: 'new', modified: 2000 },
    ]);
    expect(logged).toContainEqual([
      'claude',
      `transcript ${broken} unreadable: boom`,
    ]);
  });

  it('listPastSessions_ManyTranscripts_ReadsInBoundedBatches', async () => {
    const stored = createMemoryFiles();
    const count = TRANSCRIPT_READ_BATCH * 2 + 1;
    const ids = Array.from(
      { length: count },
      (_, index) =>
        `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    for (const id of ids) {
      await stored.write(`${FOLDER}/${id}.jsonl`, transcript('/w/app', id));
    }
    let open = 0;
    let mostOpen = 0;
    const files: Files = {
      ...stored,
      readStart: async (path, maxBytes) => {
        open += 1;
        mostOpen = Math.max(mostOpen, open);
        await Promise.resolve();
        const head = await stored.readStart(path, maxBytes);
        open -= 1;
        return head;
      },
    };
    const { log } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(mostOpen).toBe(TRANSCRIPT_READ_BATCH);
    expect(sessions.map((session) => session.sessionId)).toEqual(ids);
  });

  it('listPastSessions_WindowsCwdCaseDiffers_Listed', async () => {
    const folder = 'C:\\Users\\jo\\.claude\\projects\\C---root-dev-app';
    const transcriptPath = `${folder}\\${OLD_ID}.jsonl`;
    const stored = createMemoryFiles();
    // The in-memory files refuse Windows paths, so this stub answers only the
    // exact paths the listing joins.
    const files: Files = {
      ...stored,
      list: (path) =>
        Promise.resolve(
          path === folder ? [{ path: `${OLD_ID}.jsonl`, kind: 'file' }] : [],
        ),
      readStart: (path) =>
        path === transcriptPath
          ? Promise.resolve(transcript('c:\\_root\\dev\\app', 'hello'))
          : Promise.reject(new Error(`missing ${path}`)),
      modified: (path) =>
        path === transcriptPath
          ? Promise.resolve(1000)
          : Promise.reject(new Error(`missing ${path}`)),
    };
    const { log } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: windowsPaths, log },
      folder,
      'C:\\_root\\dev\\app',
    );

    expect(sessions).toEqual([
      { sessionId: OLD_ID, title: 'hello', modified: 1000 },
    ]);
  });
});

describe('readHistory', () => {
  it('readHistory_BadId_RejectsBeforeReading', async () => {
    const stored = createMemoryFiles();
    const readPaths: string[] = [];
    const files: Files = {
      ...stored,
      read: (path) => {
        readPaths.push(path);
        return stored.read(path);
      },
    };

    await expect(
      readHistory(files, posixPaths, FOLDER, '../x'),
    ).rejects.toThrow('not a Claude session id: ../x');
    expect(readPaths).toEqual([]);
  });

  it('readHistory_Missing_RejectsNamingThePath', async () => {
    await expect(
      readHistory(createMemoryFiles(), posixPaths, FOLDER, OLD_ID),
    ).rejects.toThrow(`${FOLDER}/${OLD_ID}.jsonl`);
  });
});
