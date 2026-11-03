import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  OPEN_SESSIONS_FILE,
  type SavedSessions,
  createOpenSessions,
} from './open-sessions';

const UNREADABLE = OPEN_SESSIONS_FILE;

const TWO_SESSIONS: SavedSessions = {
  sessions: [
    {
      hostSessionId: 's-alpha',
      projectDir: '/work/alpha',
      profile: 'personal',
      sent: true,
      busy: false,
      titles: { user: null, agent: 'Plan review', firstMessage: 'hi there' },
    },
    {
      hostSessionId: 's-beta',
      projectDir: '/work/beta',
      profile: 'work',
      sent: false,
      busy: true,
      titles: { user: 'Mine', agent: null, firstMessage: null },
    },
  ],
  selectedHostSessionId: 's-beta',
};

const ONE_SESSION: SavedSessions = {
  sessions: [
    {
      hostSessionId: 's-gamma',
      projectDir: '/work/gamma',
      profile: 'work',
      sent: true,
      busy: true,
      titles: { user: null, agent: null, firstMessage: 'gamma work' },
    },
  ],
  selectedHostSessionId: null,
};

function setUp() {
  const data = createMemoryFiles();
  return {
    data,
    open: createOpenSessions(data),
    saved: async (): Promise<unknown> =>
      JSON.parse(await data.read(OPEN_SESSIONS_FILE)),
  };
}

function withSessions(sessions: unknown): string {
  return JSON.stringify({ sessions, selectedHostSessionId: null });
}

describe('createOpenSessions', () => {
  it.each([
    {
      file: 'missing',
      text: null,
      expected: { sessions: [], selectedHostSessionId: null },
    },
    {
      file: 'valid two-record',
      text: JSON.stringify(TWO_SESSIONS, null, 2),
      expected: TWO_SESSIONS,
    },
    {
      file: 'written before titles were saved',
      text: withSessions([
        {
          hostSessionId: 's-alpha',
          projectDir: '/work/alpha',
          profile: 'personal',
          sent: true,
          busy: false,
        },
      ]),
      expected: {
        sessions: [
          {
            hostSessionId: 's-alpha',
            projectDir: '/work/alpha',
            profile: 'personal',
            sent: true,
            busy: false,
            titles: { user: null, agent: null, firstMessage: null },
          },
        ],
        selectedHostSessionId: null,
      },
    },
  ])('load_FileShape_ReadsOrRejects: $file → snapshot', async (row) => {
    const test = setUp();
    if (row.text !== null) {
      await test.data.write(OPEN_SESSIONS_FILE, row.text);
    }

    expect(await test.open.load()).toEqual(row.expected);
  });

  it.each([
    { file: 'not JSON', text: '{oops' },
    { file: 'sessions not an array', text: withSessions('x') },
    {
      file: 'a record missing profile',
      text: withSessions([
        {
          hostSessionId: 's-alpha',
          projectDir: '/work/alpha',
          sent: true,
          busy: false,
        },
      ]),
    },
    {
      file: 'a title a number',
      text: withSessions([
        {
          ...TWO_SESSIONS.sessions[0],
          titles: { user: null, agent: 7, firstMessage: null },
        },
      ]),
    },
    {
      file: 'busy a string',
      text: withSessions([{ ...TWO_SESSIONS.sessions[0], busy: 'yes' }]),
    },
    {
      file: 'selectedHostSessionId a number',
      text: JSON.stringify({ ...TWO_SESSIONS, selectedHostSessionId: 7 }),
    },
  ])('load_FileShape_ReadsOrRejects: $file → rejects', async (row) => {
    const test = setUp();
    await test.data.write(OPEN_SESSIONS_FILE, row.text);

    await expect(test.open.load()).rejects.toThrow(UNREADABLE);
  });

  it('save_AfterUnreadableLoad_WritesNothing', async () => {
    const test = setUp();
    const text = '{"sessions": "x"}';
    await test.data.write(OPEN_SESSIONS_FILE, text);

    await expect(test.open.load()).rejects.toThrow(UNREADABLE);
    await expect(test.open.save(TWO_SESSIONS)).rejects.toThrow(UNREADABLE);
    expect(await test.data.read(OPEN_SESSIONS_FILE)).toBe(text);
  });

  it('save_TwoCallsInARow_FileHoldsTheSecond', async () => {
    const test = setUp();

    const first = test.open.save(TWO_SESSIONS);
    const second = test.open.save(ONE_SESSION);
    await Promise.all([first, second]);

    expect(await test.saved()).toEqual(ONE_SESSION);
  });
});
