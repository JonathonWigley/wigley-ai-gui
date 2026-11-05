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
      processId: 's-alpha-1-1000',
      queued: [],
      returned: [],
      launchControls: { effort: 'high' },
      launchResume: true,
      controls: [
        {
          id: 'effort',
          label: 'Effort',
          choices: [{ value: 'high', label: 'High' }],
          value: 'high',
        },
      ],
      confirmedPicks: { effort: 'high' },
      returnedDrops: [],
      activeMs: 42000,
    },
    {
      hostSessionId: 's-beta',
      projectDir: '/work/beta',
      profile: 'work',
      sent: false,
      busy: true,
      titles: { user: 'Mine', agent: null, firstMessage: null },
      processId: null,
      queued: [{ text: 'next', images: [] }],
      returned: [{ text: 'returned', images: [] }],
      launchControls: {},
      launchResume: false,
      controls: [],
      confirmedPicks: {},
      returnedDrops: [],
      activeMs: 0,
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
      processId: null,
      queued: [],
      returned: [],
      launchControls: {},
      launchResume: false,
      controls: [],
      confirmedPicks: {},
      returnedDrops: [],
      activeMs: 1500,
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
            processId: null,
            launchControls: {},
            launchResume: false,
            queued: [],
            returned: [],
            controls: [],
            confirmedPicks: {},
            returnedDrops: [],
            activeMs: 0,
          },
        ],
        selectedHostSessionId: null,
      },
    },
    {
      file: 'written before confirmedPicks were saved',
      text: withSessions([
        {
          ...TWO_SESSIONS.sessions[0],
          confirmedPicks: undefined,
          controls: [
            { id: 'mode', label: 'Mode', choices: [], value: 'plan' },
            { id: 'model', label: 'Model', choices: [], value: 'opus' },
            { id: 'effort', label: 'Effort', choices: [], value: null },
          ],
          userSetControls: ['model', 'effort', 'gone'],
        },
      ]),
      expected: {
        sessions: [
          {
            ...TWO_SESSIONS.sessions[0],
            controls: [
              { id: 'mode', label: 'Mode', choices: [], value: 'plan' },
              { id: 'model', label: 'Model', choices: [], value: 'opus' },
              { id: 'effort', label: 'Effort', choices: [], value: null },
            ],
            confirmedPicks: { model: 'opus' },
          },
        ],
        selectedHostSessionId: null,
      },
    },
    {
      file: 'a session without activeMs',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], activeMs: undefined },
      ]),
      expected: {
        sessions: [{ ...TWO_SESSIONS.sessions[0], activeMs: 0 }],
        selectedHostSessionId: null,
      },
    },
    {
      file: 'a queued message holding an image',
      text: withSessions([
        {
          ...TWO_SESSIONS.sessions[0],
          queued: [
            {
              text: 'look',
              images: [{ mediaType: 'image/png', data: 'AAAA' }],
            },
          ],
        },
      ]),
      expected: {
        sessions: [
          {
            ...TWO_SESSIONS.sessions[0],
            queued: [
              {
                text: 'look',
                images: [{ mediaType: 'image/png', data: 'AAAA' }],
              },
            ],
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
      file: 'queued holding a message whose text is a number',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], queued: [{ text: 1 }] },
      ]),
    },
    {
      file: 'launchControls holding a number',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], launchControls: { effort: 1 } },
      ]),
    },
    {
      file: 'controls holding one with no id',
      text: withSessions([
        {
          ...TWO_SESSIONS.sessions[0],
          controls: [{ label: 'Mode', choices: [], value: null }],
        },
      ]),
    },
    {
      file: 'confirmedPicks holding a number',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], confirmedPicks: { effort: 1 } },
      ]),
    },
    {
      file: 'userSetControls holding a number',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], userSetControls: [1] },
      ]),
    },
    {
      file: 'returned holding a message whose text is a number',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], returned: [{ text: 1 }] },
      ]),
    },
    {
      file: 'returnedDrops a string',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], returnedDrops: 'user-1' },
      ]),
    },
    {
      file: 'activeMs negative',
      text: withSessions([{ ...TWO_SESSIONS.sessions[0], activeMs: -1 }]),
    },
    {
      file: 'activeMs a string',
      text: withSessions([{ ...TWO_SESSIONS.sessions[0], activeMs: '42000' }]),
    },
    {
      file: 'launchResume a string',
      text: withSessions([
        { ...TWO_SESSIONS.sessions[0], launchResume: 'yes' },
      ]),
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
