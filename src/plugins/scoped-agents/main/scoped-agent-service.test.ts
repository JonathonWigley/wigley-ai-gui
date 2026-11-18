import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  ChatMainExports,
  LaunchRequest,
  ResumeRequest,
} from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';
import type {
  ScopedAgent,
  ScopedAgentRecord,
  ScopedAgentSpec,
  ScopedAgentStore,
} from '../contract';
import {
  createScopedAgentService,
  HOST_ID_WAIT_MS,
  type ScopedAgentService,
} from './scoped-agent-service';

// The host id chat's `sessionOpened` names for row `row-<n>`.
const hostOf = (id: string) => id.replace('row', 'host');

// A chat whose `launch` and `resume` resolve `row-1`, `row-2`, … and hold the
// row, `resume` rejecting with `resumeError` when set and `launch` rejecting,
// before it takes an id, with the error `setLaunchError` sets; `profileOf`
// answers from `held`. `beforeLaunchResolves` runs with the new id inside
// `launch`, as chat's `sessionOpened` does.
function fakeChat(options: {
  defaultProfile?: string | null;
  held?: string[];
  resumeError?: string;
  beforeLaunchResolves?: (id: string, request: LaunchRequest) => void;
}) {
  const held = new Set(options.held ?? []);
  const launches: LaunchRequest[] = [];
  const resumes: ResumeRequest[] = [];
  const sends: { id: string; text: string }[] = [];
  const closes: [string, string][] = [];
  let launchError: string | undefined;
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
      if (launchError !== undefined) {
        throw new Error(launchError);
      }
      const id = nextRow();
      options.beforeLaunchResolves?.(id, request);
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
  const setLaunchError = (message: string | undefined) => {
    launchError = message;
  };
  return { chat, launches, resumes, sends, closes, setLaunchError };
}

// A store over `records`, scope → record. `checkAsk` refuses a scope in
// `refused`; `afterRead` runs after each `read`, once its answer is taken, and
// `afterEntries` is awaited in each `entries` once its answer is taken;
// `writeError` and `entriesError`, when set, make `write` and `entries` reject.
function fakeStore(records: Record<string, ScopedAgentRecord> = {}) {
  const control = {
    records: new Map(Object.entries(records)),
    refused: new Set<string>(),
    superseded: null as ScopedAgentRecord | null,
    afterRead: undefined as ((scope: string) => void) | undefined,
    afterEntries: undefined as (() => Promise<void>) | undefined,
    writeError: undefined as string | undefined,
    entriesError: undefined as string | undefined,
  };
  const store: ScopedAgentStore = {
    async read(scope) {
      const record = control.records.get(scope) ?? null;
      control.afterRead?.(scope);
      return record;
    },
    async write(scope, record) {
      if (control.writeError !== undefined) {
        throw new Error(control.writeError);
      }
      if (record === null) {
        control.records.delete(scope);
      } else {
        control.records.set(scope, record);
      }
    },
    async entries() {
      if (control.entriesError !== undefined) {
        throw new Error(control.entriesError);
      }
      const entries = [...control.records].map(([scope, record]) => ({
        scope,
        record,
      }));
      await control.afterEntries?.();
      return entries;
    },
    async superseded() {
      return control.superseded;
    },
    async checkAsk(scope) {
      if (control.refused.has(scope)) {
        throw new Error(`${scope} has no attempt; open it first.`);
      }
    },
  };
  return Object.assign(control, { store });
}

// A registration whose scope `s` runs in `/work/s` with `Instructions for s.`,
// resumed as `Agent: s`.
function specOf(
  store: ScopedAgentStore,
  owner = 'practice',
  agentId = 'interviewer',
): ScopedAgentSpec {
  return {
    owner,
    agentId,
    folder: (scope) => `/work/${scope}`,
    instructions: async (scope) => `Instructions for ${scope}.`,
    title: async (scope) => `Agent: ${scope}`,
    store,
  };
}

// The service with one registration, practice/interviewer, over `records`.
// By default chat's `sessionOpened` names `host-<n>` inside each launch.
function setUp(
  options: Parameters<typeof fakeChat>[0] & {
    records?: Record<string, ScopedAgentRecord>;
  } = {},
) {
  let service: ScopedAgentService | null = null;
  const opened = (id: string, projectDir = '/work/s') =>
    service?.opened({ sessionId: id, hostSessionId: hostOf(id), projectDir });
  const fake = fakeChat({
    ...options,
    beforeLaunchResolves:
      options.beforeLaunchResolves ??
      ((id, request) =>
        opened(id, 'projectDir' in request ? request.projectDir : undefined)),
  });
  const logs: string[] = [];
  service = createScopedAgentService({
    chat: fake.chat,
    paths: posixPaths,
    timers: globalTimers,
    log: (line) => logs.push(line),
  });
  const store = fakeStore(options.records);
  const agent = service.add(specOf(store.store));
  return { ...fake, service, agent, store, opened, logs };
}

// Waits for the host-id read to start, then lets it time out.
async function timeOut() {
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  await vi.advanceTimersByTimeAsync(HOST_ID_WAIT_MS);
}

function sessionWith(id: string, hostId: string | null): AgentSession {
  return {
    id,
    info: { sessionId: hostId, projectDir: null, harness: null, rowId: null },
  } as AgentSession;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scoped agent service', () => {
  it.each([
    { case: 'opened inside launch', openedAfterLaunch: false },
    { case: 'opened after launch', openedAfterLaunch: true },
  ])(
    'ask launches an owned session and stores it: $case',
    async ({ openedAfterLaunch }) => {
      const part = setUp({
        beforeLaunchResolves: openedAfterLaunch ? () => undefined : undefined,
      });

      const asking = part.agent.ask('s', 'Where to start?');
      if (openedAfterLaunch) {
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        part.opened('row-1');
      }

      expect(await asking).toBe('row-1');
      expect(part.launches).toEqual([
        {
          projectDir: '/work/s',
          profile: 'default',
          message: { text: 'Where to start?', images: [] },
          instructions: ['Instructions for s.'],
          owner: 'practice',
        },
      ]);
      expect(part.store.records.get('s')).toEqual({
        sessionId: 'row-1',
        hostSessionId: 'host-1',
      });
    },
  );

  it.each([
    { case: 'one after another', together: false },
    { case: 'both at once', together: true },
  ])(
    'ask sends the second ask to the first launch: $case',
    async ({ together }) => {
      const part = setUp();
      const ask = (text: string) => part.agent.ask('s', text);

      const ids = together
        ? await Promise.all([ask('first'), ask('second')])
        : [await ask('first'), await ask('second')];

      expect(ids).toEqual(['row-1', 'row-1']);
      expect(part.launches).toHaveLength(1);
      expect(part.sends).toEqual([{ id: 'row-1', text: 'second' }]);
    },
  );

  it('ask launches afresh when chat refuses the resume', async () => {
    const part = setUp({
      records: { s: { sessionId: 'row-0', hostSessionId: 'host-0' } },
      resumeError: 'Session host-0 belongs to another owner.',
    });

    const id = await part.agent.ask('s', 'hi');

    expect(id).toBe('row-1');
    expect(part.resumes).toHaveLength(1);
    expect(part.launches).toHaveLength(1);
    expect(part.sends).toEqual([]);
    expect(part.store.records.get('s')).toEqual({
      sessionId: 'row-1',
      hostSessionId: 'host-1',
    });
    expect(part.logs).toEqual([expect.stringContaining('row-0 not resumed')]);
  });

  it('ask launches when the record goes away between its two reads', async () => {
    const part = setUp({
      records: { s: { sessionId: 'row-0', hostSessionId: 'host-0' } },
    });
    let reads = 0;
    part.store.afterRead = (scope) => {
      reads += 1;
      if (reads === 1) {
        part.store.records.delete(scope);
      }
    };

    const id = await part.agent.ask('s', 'hi');

    expect(id).toBe('row-1');
    expect(part.launches).toHaveLength(1);
    expect(part.resumes).toEqual([]);
    expect(part.store.records.get('s')).toEqual({
      sessionId: 'row-1',
      hostSessionId: 'host-1',
    });
  });

  it('ask does not launch when the second checkAsk refuses', async () => {
    const part = setUp({
      records: { s: { sessionId: 'row-0', hostSessionId: 'host-0' } },
      resumeError: 'Chat has no session host-0.',
    });
    let reads = 0;
    part.store.afterRead = (scope) => {
      reads += 1;
      if (reads === 2) {
        part.store.refused.add(scope);
      }
    };

    await expect(part.agent.ask('s', 'hi')).rejects.toThrow(
      's has no attempt; open it first.',
    );
    expect(part.resumes).toHaveLength(1);
    expect(part.launches).toEqual([]);
    expect(part.store.records.has('s')).toBe(false);
  });

  // `openedIn` is the folder chat's `sessionOpened` names inside the launch,
  // null for no `sessionOpened`.
  it.each<{
    case: string;
    defaultProfile?: null;
    openedIn?: string | null;
    timesOut?: boolean;
    writeError?: string;
    refused?: boolean;
    error: string;
    launches: number;
    closes: [string, string][];
    logs: string[];
  }>([
    {
      case: 'no sessionOpened',
      openedIn: null,
      timesOut: true,
      error: 'Chat sent no sessionOpened for interviewer row-1.',
      launches: 1,
      closes: [['row-1', 'finished']],
      logs: ['interviewer row-1 sent no sessionOpened'],
    },
    {
      case: 'sessionOpened in another folder',
      openedIn: '/work/other',
      timesOut: true,
      error: 'Chat sent no sessionOpened for interviewer row-1.',
      launches: 1,
      closes: [['row-1', 'finished']],
      logs: ['interviewer row-1 sent no sessionOpened'],
    },
    {
      case: 'record not stored',
      writeError: 'disk full',
      error: 'disk full',
      launches: 1,
      closes: [['row-1', 'finished']],
      logs: [],
    },
    {
      case: 'no profile',
      defaultProfile: null,
      error: 'Chat has no profiles.',
      launches: 0,
      closes: [],
      logs: [],
    },
    {
      case: 'checkAsk refuses',
      refused: true,
      error: 's has no attempt; open it first.',
      launches: 0,
      closes: [],
      logs: [],
    },
  ])(
    'ask refuses and closes what it launched: $case',
    async ({
      defaultProfile,
      openedIn,
      timesOut,
      writeError,
      refused,
      error,
      launches,
      closes,
      logs,
    }) => {
      let part: ReturnType<typeof setUp> | null = null;
      part = setUp({
        defaultProfile,
        beforeLaunchResolves:
          openedIn === undefined
            ? undefined
            : (id) => {
                if (openedIn !== null) {
                  part?.opened(id, openedIn);
                }
              },
      });
      part.store.writeError = writeError;
      if (refused === true) {
        part.store.refused.add('s');
      }

      const asking = part.agent.ask('s', 'hi');
      if (timesOut === true) {
        await timeOut();
      }

      await expect(asking).rejects.toThrow(error);
      expect(part.launches).toHaveLength(launches);
      expect(part.closes).toEqual(closes);
      expect(part.store.records.has('s')).toBe(false);
      expect(part.logs).toEqual(
        logs.map((line) => expect.stringContaining(line)),
      );
    },
  );

  it.each([
    { case: 'no launch yet', launchFirst: false },
    { case: 'after a launch that rejected', launchFirst: true },
  ])('opened is not kept outside a launch: $case', async ({ launchFirst }) => {
    const part = setUp({ beforeLaunchResolves: () => undefined });
    if (launchFirst) {
      part.setLaunchError('spawn failed');
      await expect(part.agent.ask('s', 'hi')).rejects.toThrow('spawn failed');
    }

    part.opened('row-1');
    part.setLaunchError(undefined);
    const asking = part.agent.ask('s', 'hi');
    await timeOut();

    await expect(asking).rejects.toThrow(
      'Chat sent no sessionOpened for interviewer row-1.',
    );
  });

  it('closed drops a buffered host id', async () => {
    let part: ReturnType<typeof setUp> | null = null;
    part = setUp({
      beforeLaunchResolves: (id) => {
        part?.opened(id);
        part?.service.closed({ sessionId: id });
      },
    });

    const asking = part.agent.ask('s', 'hi');
    await timeOut();

    await expect(asking).rejects.toThrow(
      'Chat sent no sessionOpened for interviewer row-1.',
    );
  });

  it.each([
    { case: 'held', held: ['row-0'], closes: [['row-0', 'finished']] },
    { case: 'not held', held: [], closes: [] },
  ])('ask closes the superseded session: $case', async ({ held, closes }) => {
    const part = setUp({ held });
    part.store.superseded = { sessionId: 'row-0', hostSessionId: 'host-0' };

    await part.agent.ask('s', 'hi');

    expect(part.launches).toHaveLength(1);
    expect(part.closes).toEqual(closes);
  });

  it.each<{
    case: string;
    record: ScopedAgentRecord | null;
    held: string[];
    resumeError?: string;
    writeError?: string;
    calls: number;
    id: string | null;
    // The rejection each call gets in place of `id`.
    error?: string;
    resumes: number;
    stored: ScopedAgentRecord | null;
    logs?: string[];
  }>([
    {
      case: 'no record',
      record: null,
      held: [],
      calls: 1,
      id: null,
      resumes: 0,
      stored: null,
    },
    {
      case: 'row held',
      record: { sessionId: 'row-0', hostSessionId: 'host-7' },
      held: ['row-0'],
      calls: 1,
      id: 'row-0',
      resumes: 0,
      stored: { sessionId: 'row-0', hostSessionId: 'host-7' },
    },
    {
      case: 'row gone',
      record: { sessionId: 'row-0', hostSessionId: 'host-7' },
      held: [],
      calls: 1,
      id: 'row-1',
      resumes: 1,
      stored: { sessionId: 'row-1', hostSessionId: 'host-7' },
    },
    {
      case: 'resume refused',
      record: { sessionId: 'row-0', hostSessionId: 'host-7' },
      held: [],
      resumeError: 'Chat has no session host-7.',
      calls: 1,
      id: null,
      resumes: 1,
      stored: null,
      logs: ['interviewer row-0 not resumed, so cleared'],
    },
    {
      case: 'resume refused, the clear not written',
      record: { sessionId: 'row-0', hostSessionId: 'host-7' },
      held: [],
      resumeError: 'Chat has no session host-7.',
      writeError: 'disk full',
      calls: 1,
      id: null,
      error: 'disk full',
      resumes: 1,
      stored: { sessionId: 'row-0', hostSessionId: 'host-7' },
      logs: [],
    },
    {
      case: 'row gone, two calls at once',
      record: { sessionId: 'row-0', hostSessionId: 'host-7' },
      held: [],
      calls: 2,
      id: 'row-1',
      resumes: 1,
      stored: { sessionId: 'row-1', hostSessionId: 'host-7' },
    },
  ])(
    'sessionOf brings the session back: $case',
    async ({
      record,
      held,
      resumeError,
      writeError,
      calls,
      id,
      error,
      resumes,
      stored,
      logs,
    }) => {
      const part = setUp({
        records: record === null ? {} : { s: record },
        held,
        resumeError,
      });
      part.store.writeError = writeError;

      const answers = await Promise.allSettled(
        Array.from({ length: calls }, () => part.agent.sessionOf('s')),
      );

      expect(
        answers.map((answer) =>
          answer.status === 'fulfilled'
            ? answer.value
            : (answer.reason as Error).message,
        ),
      ).toEqual(Array.from({ length: calls }, () => error ?? id));
      expect(part.resumes).toHaveLength(resumes);
      if (resumes > 0) {
        expect(part.resumes[0]).toEqual({
          projectDir: '/work/s',
          profile: 'default',
          hostSessionId: 'host-7',
          title: 'Agent: s',
          instructions: ['Instructions for s.'],
          owner: 'practice',
        });
      }
      expect(part.store.records.get('s') ?? null).toEqual(stored);
      expect(part.logs).toEqual(
        (logs ?? []).map((line) => expect.stringContaining(line)),
      );
    },
  );

  it('cleared moves the stored host id of the registration holding the row', async () => {
    const part = setUp({
      records: { s: { sessionId: 'row-1', hostSessionId: 'host-1' } },
    });
    const other = fakeStore({
      global: { sessionId: 'row-2', hostSessionId: 'host-2' },
    });
    part.service.add(specOf(other.store, 'backlog', 'assistant'));

    part.service.cleared({ sessionId: 'row-1', newHostSessionId: 'host-9' });

    await vi.waitFor(() =>
      expect(part.store.records.get('s')).toEqual({
        sessionId: 'row-1',
        hostSessionId: 'host-9',
      }),
    );
    expect([...other.records]).toEqual([
      ['global', { sessionId: 'row-2', hostSessionId: 'host-2' }],
    ]);
  });

  it('cleared leaves a record an ask replaced after its entries read', async () => {
    const part = setUp({
      records: { s: { sessionId: 'row-0', hostSessionId: 'host-0' } },
    });
    let releaseEntries: () => void = () => undefined;
    part.store.afterEntries = () =>
      new Promise<void>((resolve) => {
        releaseEntries = () => resolve();
      });
    let reads = 0;
    part.store.afterRead = () => {
      reads += 1;
    };

    part.service.cleared({ sessionId: 'row-0', newHostSessionId: 'host-9' });
    // The ask resumes row-0 as row-1 and stores it, in two reads.
    const id = await part.agent.ask('s', 'hi');
    releaseEntries();

    expect(id).toBe('row-1');
    await vi.waitFor(() => expect(reads).toBe(3));
    expect(part.store.records.get('s')).toEqual({
      sessionId: 'row-1',
      hostSessionId: 'host-0',
    });
  });

  it.each<{
    case: string;
    id: string;
    hostId: string | null;
    entriesError?: string;
    scope: string | null;
    logs: string[];
  }>([
    { case: 'row id', id: 'row-5', hostId: null, scope: 't', logs: [] },
    { case: 'host id', id: 'row-9', hostId: 'host-1', scope: 's', logs: [] },
    {
      case: 'any other',
      id: 'row-9',
      hostId: 'host-9',
      scope: null,
      logs: [],
    },
    {
      case: 'entries rejects',
      id: 'row-1',
      hostId: 'host-1',
      entriesError: 'disk gone',
      scope: null,
      logs: ['interviewer records not read: disk gone'],
    },
  ])(
    'scopeOf matches a stored record: $case',
    async ({ id, hostId, entriesError, scope, logs }) => {
      const part = setUp({
        records: {
          s: { sessionId: 'row-1', hostSessionId: 'host-1' },
          t: { sessionId: 'row-5', hostSessionId: 'host-5' },
        },
      });
      part.store.entriesError = entriesError;

      expect(await part.agent.scopeOf(sessionWith(id, hostId))).toBe(scope);
      expect(part.logs).toEqual(
        logs.map((line) => expect.stringContaining(line)),
      );
    },
  );

  it('add refuses a second registration of one owner and agent id', () => {
    const part = setUp();

    expect(() => part.service.add(specOf(fakeStore().store))).toThrow(
      'Scoped agent practice/interviewer is already registered.',
    );
  });

  it.each<{
    case: string;
    added: boolean;
    disposed: boolean;
    id: string | null;
  }>([
    {
      case: 'the matching registration answers',
      added: true,
      disposed: false,
      id: 'row-0',
    },
    {
      case: 'a disposed registration',
      added: true,
      disposed: true,
      id: null,
    },
    { case: 'an unknown pair', added: false, disposed: false, id: null },
  ])(
    'ask and sessionOf route by owner and agent id: $case',
    async ({ added, disposed, id }) => {
      const { chat, sends } = fakeChat({ held: ['row-0', 'row-5'] });
      const service = createScopedAgentService({
        chat,
        paths: posixPaths,
        timers: globalTimers,
        log: () => undefined,
      });
      const assistant = fakeStore({
        s: { sessionId: 'row-5', hostSessionId: 'host-5' },
      });
      service.add(specOf(assistant.store, 'backlog', 'assistant'));
      if (added) {
        const interviewer = fakeStore({
          s: { sessionId: 'row-0', hostSessionId: 'host-0' },
        });
        const agent = service.add(specOf(interviewer.store));
        if (disposed) {
          agent.dispose();
        }
      }

      const answers = await Promise.allSettled([
        service.sessionOf('practice', 'interviewer', 's'),
        service.ask('practice', 'interviewer', 's', 'hi'),
      ]);

      const noAgent = 'No scoped agent practice/interviewer.';
      expect(
        answers.map((answer) =>
          answer.status === 'fulfilled'
            ? answer.value
            : (answer.reason as Error).message,
        ),
      ).toEqual(id === null ? [noAgent, noAgent] : [id, id]);
      expect(sends).toEqual(id === null ? [] : [{ id, text: 'hi' }]);
    },
  );

  it.each<{
    case: string;
    run: (agent: ScopedAgent) => Promise<unknown>;
    refuses: boolean;
  }>([
    { case: 'ask', run: (agent) => agent.ask('s', 'hi'), refuses: true },
    { case: 'sessionOf', run: (agent) => agent.sessionOf('s'), refuses: true },
    {
      case: 'scopeOf',
      run: (agent) => agent.scopeOf(sessionWith('row-1', 'host-1')),
      refuses: false,
    },
  ])('a disposed handle refuses: $case', async ({ run, refuses }) => {
    const part = setUp({
      records: { s: { sessionId: 'row-1', hostSessionId: 'host-1' } },
      held: ['row-1'],
    });

    part.agent.dispose();
    const answer = run(part.agent);

    if (refuses) {
      await expect(answer).rejects.toThrow(
        'No scoped agent practice/interviewer.',
      );
    } else {
      expect(await answer).toBeNull();
    }
    expect(part.launches).toEqual([]);
    expect(part.sends).toEqual([]);
  });

  it("a re-added registration survives the old handle's second dispose", async () => {
    const part = setUp();
    part.agent.dispose();
    const spec = specOf(fakeStore().store);
    const first = part.service.add(spec);
    first.dispose();
    const second = part.service.add(spec);

    first.dispose();

    expect(await second.ask('s', 'hi')).toBe('row-1');
    expect(part.launches).toHaveLength(1);
  });

  it('two registrations keep one scope string apart', async () => {
    const part = setUp({ beforeLaunchResolves: () => undefined });
    const first = fakeStore();
    const second = fakeStore();
    const agents = [
      part.service.add(specOf(first.store, 'a', 'x')),
      part.service.add(specOf(second.store, 'b', 'y')),
    ];

    const asking = Promise.all(
      agents.map((agent) => agent.ask('global', 'hi')),
    );
    await vi.waitFor(() => expect(part.launches).toHaveLength(2));
    part.opened('row-1', '/work/global');
    part.opened('row-2', '/work/global');
    const [firstId, secondId] = await asking;

    expect(firstId).not.toBe(secondId);
    expect(part.launches.map((launch) => launch.owner).sort()).toEqual([
      'a',
      'b',
    ]);
    expect(first.records.get('global')).toEqual({
      sessionId: firstId,
      hostSessionId: hostOf(firstId),
    });
    expect(second.records.get('global')).toEqual({
      sessionId: secondId,
      hostSessionId: hostOf(secondId),
    });
  });
});
