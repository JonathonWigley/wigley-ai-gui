import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
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
import { createPracticeSessions } from './practice-sessions';
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

// A `Timers` the test fires by hand; `pending` counts the timers set and not
// yet fired or cleared.
function manualTimers() {
  const pending = new Map<number, () => void>();
  let lastHandle = 0;
  const timers: Timers = {
    set: (run) => {
      lastHandle += 1;
      pending.set(lastHandle, run);
      return lastHandle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fireAll = () => {
    for (const [handle, run] of pending) {
      pending.delete(handle);
      run();
    }
  };
  return { timers, pending, fireAll };
}

// A chat whose `launch` and `resume` resolve `row-1`, `row-2`, … and hold the
// row; `profileOf` answers from `held`. `beforeLaunchResolves` runs with the
// new id inside `launch`, as chat's `sessionOpened` does.
function fakeChat(options: {
  defaultProfile?: string | null;
  held?: string[];
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
  const timers = manualTimers();
  const logs: string[] = [];
  sessions = createPracticeSessions({
    chat: fake.chat,
    store,
    progress,
    files,
    paths: posixPaths,
    timers: timers.timers,
    log: (line) => logs.push(line),
  });
  const interviewers = async () =>
    (await progress.read('two-sum')).attempts.map((one) => one.interviewer);
  return { ...fake, sessions, timers, opened, interviewers, files, logs };
}

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
        await vi.waitFor(() => expect(part.timers.pending.size).toBe(1));
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

  it('askInterviewer sends to an existing interviewer', async () => {
    const part = await setUp({ attempts: [attempt('a1')] });

    await part.sessions.askInterviewer('two-sum', 'first');
    const id = await part.sessions.askInterviewer('two-sum', 'second');

    expect(id).toBe('row-1');
    expect(part.launches).toHaveLength(1);
    expect(part.sends).toEqual([{ id: 'row-1', text: 'second' }]);
  });

  it.each<{
    case: string;
    attempts?: Attempt[];
    defaultProfile?: null;
    noOpened?: boolean;
    error: string;
    launches: number;
    closes: [string, string][];
  }>([
    {
      case: 'no sessionOpened',
      attempts: [attempt('a1')],
      noOpened: true,
      error: 'Chat sent no sessionOpened for interviewer row-1.',
      launches: 1,
      closes: [['row-1', 'finished']],
    },
    {
      case: 'no profile',
      attempts: [attempt('a1')],
      defaultProfile: null,
      error: 'Chat has no profiles.',
      launches: 0,
      closes: [],
    },
    {
      case: 'no attempt',
      error: 'two-sum has no attempt; open it first.',
      launches: 0,
      closes: [],
    },
  ])(
    'askInterviewer refuses without a host id, a profile or an attempt: $case',
    async ({ attempts, defaultProfile, noOpened, error, launches, closes }) => {
      const part = await setUp({
        attempts,
        defaultProfile,
        beforeLaunchResolves: noOpened === true ? () => undefined : undefined,
      });

      const asking = part.sessions.askInterviewer('two-sum', 'hi');
      if (noOpened === true) {
        await vi.waitFor(() => expect(part.timers.pending.size).toBe(1));
        part.timers.fireAll();
      }

      await expect(asking).rejects.toThrow(error);
      expect(part.launches).toHaveLength(launches);
      expect(part.closes).toEqual(closes);
      if (attempts !== undefined) {
        expect(await part.interviewers()).toEqual([null]);
      }
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
    async ({ interviewer, held, calls, id, resumes, stored }) => {
      const part = await setUp({
        attempts: [attempt('a1', interviewer)],
        held,
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
