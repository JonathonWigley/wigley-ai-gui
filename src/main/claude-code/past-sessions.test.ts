import { describe, expect, it } from 'vitest';
import type { Files } from '../../contracts/files';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import {
  listPastSessions,
  listProjectFolders,
  readHistory,
  TRANSCRIPT_READ_BATCH,
} from './past-sessions';
import {
  TRANSCRIPT_HEAD_BYTES,
  TRANSCRIPT_HEAD_MAX_BYTES,
} from './transcripts';

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

// A transcript whose first user line, the only one carrying `cwd`, holds an
// image of `imageBytes` base64 characters ahead of its `firstMessage` text.
function imageFirstTranscript(
  cwd: string,
  firstMessage: string,
  imageBytes: number,
): string {
  return [
    { type: 'mode', mode: 'auto' },
    {
      type: 'user',
      uuid: 'u1',
      cwd,
      message: {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'A'.repeat(imageBytes),
            },
          },
          { type: 'text', text: firstMessage },
        ],
      },
    },
    { type: 'assistant', uuid: 'a1', message: { content: [] } },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n');
}

// Files whose `readStart` of `path` answers a first line that never ends,
// however many bytes are asked for, and records each `maxBytes` asked.
function endlessLineFiles(path: string) {
  const asked: number[] = [];
  const files: Files = {
    ...createMemoryFiles(),
    list: async () => [],
    modified: async () => 1000,
    readStart: async (read, maxBytes) => {
      if (read !== path) {
        throw new Error(`missing ${read}`);
      }
      asked.push(maxBytes);
      const opening = '{"type":"user","cwd":"/w/app","message":{"content":"';
      return opening + 'x'.repeat(maxBytes - opening.length);
    },
  };
  return { files, asked };
}

// `stored` with every `readStart` recording the `maxBytes` it asked for.
function recordingReads(stored: Files) {
  const asked: number[] = [];
  const files: Files = {
    ...stored,
    readStart: (path, maxBytes) => {
      asked.push(maxBytes);
      return stored.readStart(path, maxBytes);
    },
  };
  return { files, asked };
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

function totalBytes(asked: number[]): number {
  return asked.reduce((sum, maxBytes) => sum + maxBytes, 0);
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
    expect(logged).toContainEqual(['claude', expect.stringContaining(broken)]);
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

  it('listPastSessions_FirstLinePastHead_TitledFromTheWholeLine', async () => {
    const files = createMemoryFiles();
    await files.write(
      `${FOLDER}/${OLD_ID}.jsonl`,
      imageFirstTranscript('/w/app', 'see image', TRANSCRIPT_HEAD_BYTES * 5),
    );
    const { log } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(sessions).toEqual([
      { sessionId: OLD_ID, title: 'see image', modified: 0 },
    ]);
  });

  it('listPastSessions_FirstLinePastCap_LeftOutAndLogged', async () => {
    const path = `${FOLDER}/${OLD_ID}.jsonl`;
    const { files, asked } = endlessLineFiles(path);
    files.list = async () => [{ path: `${OLD_ID}.jsonl`, kind: 'file' }];
    const { log, logged } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(sessions).toEqual([]);
    expect(asked.at(-1)).toBe(TRANSCRIPT_HEAD_MAX_BYTES);
    expect(logged).toContainEqual(['claude', expect.stringContaining(path)]);
  });

  it('listPastSessions_ShortFileEndsInsideLine_StopsAtTheFileEnd', async () => {
    const stored = createMemoryFiles();
    await stored.write(
      `${FOLDER}/${OLD_ID}.jsonl`,
      [
        JSON.stringify({ type: 'system', cwd: '/w/app' }),
        '{"type":"user","cwd":"/w/app","message":{"content":"never ends',
      ].join('\n'),
    );
    const { files, asked } = recordingReads(stored);
    const { log, logged } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    // Reading on to the cap would ask for at least the cap's bytes.
    expect(totalBytes(asked)).toBeLessThan(TRANSCRIPT_HEAD_MAX_BYTES);
    expect(logged).toEqual([]);
    expect(sessions).toEqual([
      { sessionId: OLD_ID, title: expect.any(String), modified: 0 },
    ]);
  });

  it('listPastSessions_UntypedUserLineThenCutLine_DoesNotReadTheWholeFile', async () => {
    const stored = createMemoryFiles();
    const text = [
      {
        type: 'user',
        uuid: 'u1',
        cwd: '/w/app',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: { content: 'x'.repeat(TRANSCRIPT_HEAD_BYTES * 3) },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n');
    await stored.write(`${FOLDER}/${OLD_ID}.jsonl`, text);
    const { files, asked } = recordingReads(stored);
    const { log, logged } = recordingLog();

    const sessions = await listPastSessions(
      { files, paths: posixPaths, log },
      FOLDER,
      '/w/app',
    );

    expect(totalBytes(asked)).toBeLessThan(text.length);
    expect(logged).toEqual([]);
    expect(sessions).toEqual([
      { sessionId: OLD_ID, title: expect.any(String), modified: 0 },
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
    ).rejects.toThrow('../x');
    expect(readPaths).toEqual([]);
  });

  it('readHistory_Missing_RejectsNamingThePath', async () => {
    await expect(
      readHistory(createMemoryFiles(), posixPaths, FOLDER, OLD_ID),
    ).rejects.toThrow(`${FOLDER}/${OLD_ID}.jsonl`);
  });
});

describe('listProjectFolders', () => {
  it('listProjects_NewestTranscriptCwd_PerFolder', async () => {
    let now = 1000;
    const files = createMemoryFiles({ now: () => now });
    await files.write(
      `/config/projects/-w-app/${OLD_ID}.jsonl`,
      transcript('/w/app-before-move', 'old'),
    );
    now = 3000;
    await files.write(
      `/config/projects/-w-app/${NEW_ID}.jsonl`,
      transcript('/w/app', 'new'),
    );
    now = 2000;
    await files.write(
      `/config/projects/-w-other/${OTHER_ID}.jsonl`,
      transcript('/w/other', 'elsewhere'),
    );
    now = 4000;
    await files.write('/config/projects/-w-empty/notes.txt', 'notes');
    const { log, logged } = recordingLog();

    const projects = await listProjectFolders(
      { files, paths: posixPaths, log },
      '/config/projects',
    );

    expect(projects).toEqual([
      { projectDir: '/w/app', modified: 3000 },
      { projectDir: '/w/other', modified: 2000 },
    ]);
    expect(logged).toContainEqual([
      'claude',
      expect.stringContaining('/config/projects/-w-empty'),
    ]);
  });

  it('listProjects_UnlistableFolder_LeftOutAndLogged', async () => {
    const stored = createMemoryFiles();
    await stored.write(
      `/config/projects/-w-app/${NEW_ID}.jsonl`,
      transcript('/w/app', 'new'),
    );
    await stored.write(
      `/config/projects/-w-locked/${OLD_ID}.jsonl`,
      transcript('/w/locked', 'old'),
    );
    const locked = '/config/projects/-w-locked';
    const files: Files = {
      ...stored,
      list: (path) =>
        path === locked
          ? Promise.reject(new Error('EACCES'))
          : stored.list(path),
    };
    const { log, logged } = recordingLog();

    const projects = await listProjectFolders(
      { files, paths: posixPaths, log },
      '/config/projects',
    );

    expect(projects.map((project) => project.projectDir)).toEqual(['/w/app']);
    expect(logged).toContainEqual(['claude', expect.stringContaining(locked)]);
  });

  it('listProjects_MissingProjectsFolder_Empty', async () => {
    const { log } = recordingLog();

    const projects = await listProjectFolders(
      { files: createMemoryFiles(), paths: posixPaths, log },
      '/config/projects',
    );

    expect(projects).toEqual([]);
  });

  it('listProjects_FirstLinePastHead_NamedByItsCwd', async () => {
    const files = createMemoryFiles();
    await files.write(
      `/config/projects/-w-app/${NEW_ID}.jsonl`,
      imageFirstTranscript('/w/app', 'see image', TRANSCRIPT_HEAD_BYTES * 5),
    );
    const { log } = recordingLog();

    const projects = await listProjectFolders(
      { files, paths: posixPaths, log },
      '/config/projects',
    );

    expect(projects).toEqual([{ projectDir: '/w/app', modified: 0 }]);
  });
});
