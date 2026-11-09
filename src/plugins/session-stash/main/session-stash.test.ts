import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type {
  ChatMainEvents,
  ResumeSectionRow,
  SessionOrigin,
} from '../../chat/contract';
import { createSessionStash } from './session-stash';
import { createStashStore, STASHED_FILE } from './stash-store';

const AT = 1000;

type Closed = ChatMainEvents['sessionClosed'];

function closed(sessionId: string, changes: Partial<Closed> = {}): Closed {
  return {
    sessionId,
    hostSessionId: `host-${sessionId}`,
    projectDir: `/projects/${sessionId}`,
    profile: 'work',
    titles: { user: null, agent: `${sessionId} title`, firstMessage: 'hi' },
    sent: true,
    headless: false,
    reason: 'user',
    ...changes,
  };
}

function opened(
  sessionId: string,
  origin: SessionOrigin,
): ChatMainEvents['sessionOpened'] {
  return {
    sessionId: `reopened-${sessionId}`,
    profileDir: '~/.claude',
    hostSessionId: `host-${sessionId}`,
    projectDir: `/projects/${sessionId}`,
    profile: 'work',
    origin,
  };
}

function row(
  sessionId: string,
  changes: Partial<ResumeSectionRow> = {},
): ResumeSectionRow {
  return {
    hostSessionId: `host-${sessionId}`,
    projectDir: `/projects/${sessionId}`,
    profile: 'work',
    title: `${sessionId} title`,
    at: AT,
    ...changes,
  };
}

function setUp() {
  const data = createMemoryFiles();
  const store = createStashStore(data);
  const logged: string[] = [];
  const stash = createSessionStash({
    store,
    log: (line) => logged.push(line),
    now: () => AT,
    ownsSession: (sessionId) => sessionId !== 'terminal',
  });
  return {
    data,
    stash,
    logged,
    // Every write and its log line have landed.
    settled: async () => {
      await store.settled();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const anyResumable = () => true;

describe('createSessionStash', () => {
  it.each([
    {
      given: 'a note',
      note: 'after lunch',
      headless: false,
      expected: [row('s1', { note: 'after lunch' })],
    },
    { given: 'no note', note: null, headless: false, expected: [row('s1')] },
    {
      given: 'a headless session',
      note: null,
      headless: true,
      expected: [row('s1', { headless: true })],
    },
  ])(
    'closed_PendingUserCloseSent_ListsTheStash given $given',
    async ({ note, headless, expected }) => {
      const test = setUp();

      test.stash.request({ sessionId: 's1', note });
      test.stash.closed(closed('s1', { headless }));
      await test.settled();

      expect(await test.stash.rows(anyResumable)).toEqual(expected);
      expect(test.logged).toEqual(['stashed "s1 title"']);
    },
  );

  it('closed_NoTitles_StashesAsUntitled', async () => {
    const test = setUp();

    test.stash.request({ sessionId: 's1', note: null });
    test.stash.closed(
      closed('s1', {
        titles: { user: null, agent: null, firstMessage: null },
      }),
    );
    await test.settled();

    expect(await test.stash.rows(anyResumable)).toEqual([
      { ...row('s1'), title: 'Untitled session' },
    ]);
  });

  it.each([
    {
      given: 'a close never asked to stash',
      run: (test: ReturnType<typeof setUp>) => test.stash.closed(closed('s1')),
      logged: [],
    },
    {
      given: 'a close never sent a message',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.closed(closed('s1', { sent: false }));
      },
      logged: ['closed without a stash, never sent a message: "s1 title"'],
    },
    {
      given: 'a project closing',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.closed(closed('s1', { reason: 'project-closed' }));
      },
      logged: [],
    },
    {
      given: 'a finished close',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.closed(closed('s1', { reason: 'finished' }));
      },
      logged: [],
    },
    {
      given: 'a close the page dropped as kept open',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.drop('s1');
        test.stash.closed(closed('s1'));
      },
      logged: ['stash dropped: s1 stayed open'],
    },
    {
      given: 'a page that started again before the close',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.request({ sessionId: 's2', note: null });
        test.stash.forgetKept();
        test.stash.forgetKept();
        test.stash.closed(closed('s1'));
      },
      logged: ['stash dropped: 2 kept when the page started'],
    },
    {
      given: 'a session chat does not own',
      run: (test: ReturnType<typeof setUp>) => {
        expect(test.stash.request({ sessionId: 'terminal', note: 'n' })).toBe(
          false,
        );
        test.stash.closed(closed('terminal'));
      },
      logged: ['stash refused: terminal is not a session the app started'],
    },
    {
      given: 'a second close after the first dropped the pending note',
      run: (test: ReturnType<typeof setUp>) => {
        test.stash.request({ sessionId: 's1', note: 'n' });
        test.stash.closed(closed('s1', { sent: false }));
        test.stash.closed(closed('s1'));
      },
      logged: ['closed without a stash, never sent a message: "s1 title"'],
    },
  ])('closed_NotAStash_WritesNothing given $given', async (test) => {
    const setup = setUp();

    test.run(setup);
    await setup.settled();

    expect(await setup.stash.rows(anyResumable)).toEqual([]);
    expect(setup.logged).toEqual(test.logged);
  });

  it.each([
    { origin: 'resumed' as const, expected: [row('s2')] },
    { origin: 'restored' as const, expected: [row('s1'), row('s2')] },
    { origin: 'new' as const, expected: [row('s1'), row('s2')] },
  ])(
    'opened_Origin_RemovesOnlyAResumedStash: $origin',
    async ({ origin, expected }) => {
      const test = setUp();
      for (const sessionId of ['s1', 's2']) {
        test.stash.request({ sessionId, note: null });
        test.stash.closed(closed(sessionId));
      }

      test.stash.opened(opened('s1', origin));
      await test.settled();

      expect(await test.stash.rows(anyResumable)).toEqual(expected);
    },
  );

  it('rows_UnresumableSession_LeftOutNewestLast', async () => {
    const test = setUp();
    for (const sessionId of ['s1', 's2', 's3']) {
      test.stash.request({ sessionId, note: null });
      test.stash.closed(closed(sessionId));
    }
    await test.settled();

    expect(
      await test.stash.rows((hostSessionId) => hostSessionId !== 'host-s2'),
    ).toEqual([row('s1'), row('s3')]);
  });

  it('closed_UnreadableFile_LogsAndKeepsIt', async () => {
    const test = setUp();
    await test.data.write(STASHED_FILE, '{oops');

    test.stash.request({ sessionId: 's1', note: null });
    test.stash.closed(closed('s1'));
    await test.settled();

    expect(await test.data.read(STASHED_FILE)).toBe('{oops');
    expect(test.logged).toEqual([
      `stash of "s1 title" not written: ${STASHED_FILE} is not a JSON array of stashed sessions`,
    ]);
  });
});
