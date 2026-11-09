import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  ChatMainExports,
  LaunchRequest,
  ResumeRequest,
} from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';
import type { Attempt } from '../contract';
import { IMPORT_INSTRUCTIONS, INTERVIEWER_INSTRUCTIONS } from './instructions';
import {
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { createPracticeSessions, HOST_ID_WAIT_MS } from './practice-sessions';
import { createProblemStore } from './problem-store';
import { createProgress } from './progress';

const PROGRESS = `${PRACTICE_FOLDER}/problems/two-sum/progress.json`;

function attempt(
  id: string,
  interviewer: Attempt['interviewer'] = null,
): Attempt {
  return {
    id,
    started: '2026-11-08T12:00:00.000Z',
    peeked: false,
    interviewer,
  };
}

// A chat whose `launch` and `resume` resolve `row-1`, `row-2`, … and hold the
// row, `resume` rejecting with `resumeError` when set; `profileOf` answers
// from `held`. `beforeLaunchResolves` runs with the new id inside `launch`, as
// chat's `sessionOpened` does.
function fakeChat(options: {
  defaultProfile?: string | null;
  held?: string[];
  resumeError?: string;
  beforeLaunchResolves?: (id: string) => void;
}) {
  const held = new Set(options.held ?? []);
  const launches: LaunchRequest[] = [];
  const resumes: ResumeRequest[] = [];
  const sends: { id: string; text: string }[] = [];
  const closes: [string, string][] = [];
  let rows = 0;
  const nextRow = () => {
    rows += 1;
    const id = `row-${rows}`;
    held.add(id);
    return id;
  };
  const chat: Pick<
    ChatMainExports,
    'launch' | 'resume' | 'defaultProfile' | 'profileOf' | 'send' | 'close'
  > = {
    async launch(request) {
      launches.push(request);
      const id = nextRow();
      options.beforeLaunchResolves?.(id);
      return id;
    },
    async resume(request) {
      resumes.push(request);
      await Promise.resolve();
      if (options.resumeError !== undefined) {
        throw new Error(options.resumeError);
      }
      return nextRow();
    },
    defaultProfile: () =>
      options.defaultProfile === undefined ? 'default' : options.defaultProfile,
    profileOf: (sessionId) => (held.has(sessionId) ? 'default' : null),
    async send(id, message) {
      sends.push({ id, text: message.text });
    },
    async close(id, reason) {
      closes.push([id, reason]);
      held.delete(id);
    },
  };
  return { chat, launches, resumes, sends, closes };
}

async function setUp(
  options: Parameters<typeof fakeChat>[0] & {
    attempts?: Attempt[];
    interviewerMd?: string;
  } = {},
) {
  const files = createMemoryFiles();
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: () => undefined,
    folder: () => PRACTICE_FOLDER,
  });
  const progress = createProgress({
    store,
    clock: { now: () => Date.parse('2026-11-09T12:00:00Z') },
    randomHex: () => 'new',
    steps: () => [1, 3],
  });
  await writeProblem(files, TWO_SUM);
  if (options.attempts !== undefined) {
    await files.write(
      PROGRESS,
      JSON.stringify({
        status: 'new',
        review: { step: null, due: null },
        attempts: options.attempts,
      }),
    );
  }
  if (options.interviewerMd !== undefined) {
    await files.write(
      `${PRACTICE_FOLDER}/interviewer.md`,
      options.interviewerMd,
    );
  }
  let sessions: ReturnType<typeof createPracticeSessions> | null = null;
  const opened = (id: string, host = 'host-1') =>
    sessions?.opened({
      sessionId: id,
      hostSessionId: host,
      projectDir: PRACTICE_FOLDER,
    });
  const fake = fakeChat({
    ...options,
    beforeLaunchResolves: options.beforeLaunchResolves ?? ((id) => opened(id)),
  });
  const logs: string[] = [];
  sessions = createPracticeSessions({
    chat: fake.chat,
    store,
    progress,
    files,
    paths: posixPaths,
    timers: globalTimers,
    log: (line) => logs.push(line),
  });
  const interviewers = async () =>
    (await progress.read('two-sum')).attempts.map((one) => one.interviewer);
  return { ...fake, sessions, progress, opened, interviewers, files, logs };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('practice sessions', () => {
  it('startImport launches a visible session with the import instructions', async () => {
    const { sessions, launches } = await setUp();

    const id = await sessions.startImport('Add the Blind 75 graph problems');

    expect(id).toBe('row-1');
    expect(launches).toStrictEqual([
      {
        projectDir: PRACTICE_FOLDER,
        profile: 'default',
        message: { text: 'Add the Blind 75 graph problems', images: [] },
        instructions: [IMPORT_INSTRUCTIONS],
      },
    ]);
  });

  it.each<{
    case: string;
    interviewerMd?: string;
    instructions: string[];
    openedAfterLaunch: boolean;
  }>([
    {
      case: 'built-in instructions, opened inside launch',
      instructions: [INTERVIEWER_INSTRUCTIONS],
      openedAfterLaunch: false,
    },
    {
      case: 'interviewer.md, opened after launch',
      interviewerMd: 'Be terse.',
      instructions: ['Be terse.'],
      openedAfterLaunch: true,
    },
  ])(
    'askInterviewer launches an owned session and stores it: $case',
    async ({ interviewerMd, instructions, openedAfterLaunch }) => {
      const part = await setUp({
        attempts: [attempt('a1')],
        interviewerMd,
        beforeLaunchResolves: openedAfterLaunch ? () => undefined : undefined,
      });

      const asking = part.sessions.askInterviewer('two-sum', 'Where to start?');
      if (openedAfterLaunch) {
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        part.opened('row-1');
      }

      expect(await asking).toBe('row-1');
      expect(part.launches).toEqual([
        {
          projectDir: PRACTICE_FOLDER,
          profile: 'default',
          message: { text: 'Where to start?', images: [] },
          instructions,
          owner: 'practice',
        },
      ]);
      expect(await part.interviewers()).toEqual([
        { sessionId: 'row-1', hostSessionId: 'host-1' },
      ]);
    },
  );

  it.each([
    { case: 'one after another', together: false },
    { case: 'both at once', together: true },
  ])(
    'askInterviewer sends the second ask to the first launch: $case',
    async ({ together }) => {
      const part = await setUp({ attempts: [attempt('a1')] });
      const ask = (text: string) =>
        part.sessions.askInterviewer('two-sum', text);

      const ids = together
        ? await Promise.all([ask('first'), ask('second')])
        : [await ask('first'), await ask('second')];

      expect(ids).toEqual(['row-1', 'row-1']);
      expect(part.launches).toHaveLength(1);
      expect(part.sends).toEqual([{ id: 'row-1', text: 'second' }]);
    },
  );

  it('askInterviewer launches afresh when chat refuses the resume', async () => {
    const part = await setUp({
      attempts: [
        attempt('a1', { sessionId: 'row-0', hostSessionId: 'host-0' }),
      ],
      resumeError: 'Session host-0 belongs to another owner.',
    });

    const id = await part.sessions.askInterviewer('two-sum', 'hi');

    expect(id).toBe('row-1');
    expect(part.resumes).toHaveLength(1);
    expect(part.launches).toHaveLength(1);
    expect(part.sends).toEqual([]);
    expect(await part.interviewers()).toEqual([
      { sessionId: 'row-1', hostSessionId: 'host-1' },
    ]);
    expect(part.logs).toEqual([expect.stringContaining('row-0 not resumed')]);
  });

  it.each<{
    case: string;
    attempts?: Attempt[];
    defaultProfile?: null;
    noOpened?: boolean;
    storeFails?: boolean;
    attemptChanges?: boolean;
    error: string;
    launches: number;
    closes: [string, string][];
    stored: Attempt['interviewer'][];
    logs: string[];
  }>([
    {
      case: 'no sessionOpened',
      attempts: [attempt('a1')],
      noOpened: true,
      error: 'Chat sent no sessionOpened for interviewer row-1.',
      launches: 1,
      closes: [['row-1', 'finished']],
      stored: [null],
      logs: ['row-1 sent no sessionOpened'],
    },
    {
      case: 'interviewer not stored',
      attempts: [attempt('a1')],
      storeFails: true,
      error: 'disk full',
      launches: 1,
      closes: [['row-1', 'finished']],
      stored: [null],
      logs: [],
    },
    {
      case: 'no profile',
      attempts: [attempt('a1')],
      defaultProfile: null,
      error: 'Chat has no profiles.',
      launches: 0,
      closes: [],
      stored: [null],
      logs: [],
    },
    {
      case: 'no attempt',
      error: 'two-sum has no attempt; open it first.',
      launches: 0,
      closes: [],
      stored: [],
      logs: [],
    },
    {
      case: 'attempt changed under the ask',
      attempts: [
        attempt('a1', { sessionId: 'row-0', hostSessionId: 'host-0' }),
      ],
      attemptChanges: true,
      error: 'two-sum has no interviewer; ask again.',
      launches: 0,
      closes: [],
      stored: [{ sessionId: 'row-0', hostSessionId: 'host-0' }, null],
      logs: [],
    },
  ])(
    'askInterviewer refuses without a stored interviewer, a profile or its attempt: $case',
    async ({
      attempts,
      defaultProfile,
      noOpened,
      storeFails,
      attemptChanges,
      error,
      launches,
      closes,
      stored,
      logs,
    }) => {
      const part = await setUp({
        attempts,
        defaultProfile,
        beforeLaunchResolves: noOpened === true ? () => undefined : undefined,
      });
      if (storeFails === true) {
        vi.spyOn(part.progress, 'setInterviewer').mockRejectedValueOnce(
          new Error('disk full'),
        );
      }
      if (attemptChanges === true) {
        const read = part.progress.read.bind(part.progress);
        vi.spyOn(part.progress, 'read').mockImplementationOnce(async (slug) => {
          const file = await read(slug);
          await part.files.write(
            PROGRESS,
            JSON.stringify({
              ...file,
              attempts: [...file.attempts, attempt('a2')],
            }),
          );
          return file;
        });
      }

      const asking = part.sessions.askInterviewer('two-sum', 'hi');
      if (noOpened === true) {
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        await vi.advanceTimersByTimeAsync(HOST_ID_WAIT_MS);
      }

      await expect(asking).rejects.toThrow(error);
      expect(part.launches).toHaveLength(launches);
      expect(part.closes).toEqual(closes);
      expect(await part.interviewers()).toEqual(stored);
      expect(part.logs).toEqual(
        logs.map((line) => expect.stringContaining(line)),
      );
    },
  );

  it.each([
    { case: 'held', held: ['row-0'], closes: [['row-0', 'finished']] },
    { case: 'not held', held: [], closes: [] },
  ])(
    'askInterviewer on a new attempt closes the old interviewer: $case',
    async ({ held, closes }) => {
      const part = await setUp({
        attempts: [
          attempt('a1', { sessionId: 'row-0', hostSessionId: 'host-0' }),
          attempt('a2'),
        ],
        held,
      });

      await part.sessions.askInterviewer('two-sum', 'hi');

      expect(part.launches).toHaveLength(1);
      expect(part.closes).toEqual(closes);
    },
  );

  it.each<{
    case: string;
    interviewer: Attempt['interviewer'];
    held: string[];
    resumeError?: string;
    calls: number;
    id: string | null;
    resumes: number;
    stored: Attempt['interviewer'];
  }>([
    {
      case: 'no interviewer',
      interviewer: null,
      held: [],
      calls: 1,
      id: null,
      resumes: 0,
      stored: null,
    },
    {
      case: 'row held',
      interviewer: { sessionId: 'row-0', hostSessionId: 'host-1' },
      held: ['row-0'],
      calls: 1,
      id: 'row-0',
      resumes: 0,
      stored: { sessionId: 'row-0', hostSessionId: 'host-1' },
    },
    {
      case: 'row gone',
      interviewer: { sessionId: 'row-0', hostSessionId: 'host-1' },
      held: [],
      calls: 1,
      id: 'row-1',
      resumes: 1,
      stored: { sessionId: 'row-1', hostSessionId: 'host-1' },
    },
    {
      case: 'resume refused',
      interviewer: { sessionId: 'row-0', hostSessionId: 'host-1' },
      held: [],
      resumeError: 'Chat has no session host-1.',
      calls: 1,
      id: null,
      resumes: 1,
      stored: null,
    },
    {
      case: 'row gone, two calls at once',
      interviewer: { sessionId: 'row-0', hostSessionId: 'host-1' },
      held: [],
      calls: 2,
      id: 'row-1',
      resumes: 1,
      stored: { sessionId: 'row-1', hostSessionId: 'host-1' },
    },
  ])(
    'interviewerOf brings the interviewer back: $case',
    async ({ interviewer, held, resumeError, calls, id, resumes, stored }) => {
      const part = await setUp({
        attempts: [attempt('a1', interviewer)],
        held,
        resumeError,
      });

      const ids = await Promise.all(
        Array.from({ length: calls }, () =>
          part.sessions.interviewerOf('two-sum'),
        ),
      );

      expect(ids).toEqual(Array.from({ length: calls }, () => id));
      expect(part.resumes).toHaveLength(resumes);
      if (resumes > 0) {
        expect(part.resumes[0]).toEqual({
          projectDir: PRACTICE_FOLDER,
          profile: 'default',
          hostSessionId: 'host-1',
          title: 'Interviewer: Two Sum',
          instructions: [INTERVIEWER_INSTRUCTIONS],
          owner: 'practice',
        });
      }
      expect(await part.interviewers()).toEqual([stored]);
    },
  );

  it('cleared moves the stored host id', async () => {
    const part = await setUp({
      attempts: [
        attempt('a1', { sessionId: 'row-1', hostSessionId: 'host-1' }),
      ],
    });

    part.sessions.cleared({ sessionId: 'row-1', newHostSessionId: 'host-2' });

    await vi.waitFor(async () =>
      expect(await part.interviewers()).toEqual([
        { sessionId: 'row-1', hostSessionId: 'host-2' },
      ]),
    );
  });

  it.each<{
    case: string;
    id: string;
    hostId: string | null;
    slug: string | null;
  }>([
    { case: 'row id', id: 'row-1', hostId: null, slug: 'two-sum' },
    { case: 'host id', id: 'row-9', hostId: 'host-1', slug: 'two-sum' },
    { case: 'an older attempt', id: 'row-0', hostId: 'host-0', slug: null },
    { case: 'any other', id: 'row-9', hostId: 'host-9', slug: null },
  ])(
    'interviewerSlug matches the current attempt only: $case',
    async ({ id, hostId, slug }) => {
      const part = await setUp({
        attempts: [
          attempt('a1', { sessionId: 'row-0', hostSessionId: 'host-0' }),
          attempt('a2', { sessionId: 'row-1', hostSessionId: 'host-1' }),
        ],
      });
      const session = {
        id,
        info: { sessionId: hostId, projectDir: null, harness: null },
      } as AgentSession;

      expect(await part.sessions.interviewerSlug(session)).toBe(slug);
    },
  );
});
