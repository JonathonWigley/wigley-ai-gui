import { describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type AgentSession,
  type ConnectedSession,
  type GuardedToolCall,
  type Harness,
  type MarkOptions,
  type OwnedSession,
  type SessionInfo,
  sessionsRowsSlot,
  sessionsSelectionSlot,
  type SessionsState,
  type SessionTitles,
  type ToolCallContext,
  type ToolCallGuard,
  type ToolCallVerdict,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../contract';
import {
  createSessionList,
  KEPT_SESSION_MS,
  RESELECT_WINDOW_MS,
} from './session-list';

const MARK: MarkOptions = { text: 'Round from x', action: 'answer' };

const RESULT: ToolResult = { content: [{ type: 'text', text: 'done' }] };

function info(
  projectDir: string | null,
  harness: Harness | null = null,
): SessionInfo {
  return { sessionId: null, projectDir, harness };
}

function owned(hostId: string, projectDir = '/work/x'): SessionInfo {
  return {
    sessionId: hostId,
    projectDir,
    harness: 'claude',
  };
}

// A claude session's config folder as the fake harness resolves it; null for
// any other harness.
function resolvedFolder(session: SessionInfo): string | null {
  return session.harness === 'claude'
    ? `resolved:${session.profileDir ?? 'default'}`
    : null;
}

const CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

function tool(name: string): ToolDefinition {
  return { name, description: `${name} tool`, inputSchema: {} };
}

function setUp(
  projectName: (projectDir: string) => Promise<string | null> = async () =>
    null,
  hostSessionName: (info: SessionInfo) => Promise<string | null> = async () =>
    null,
) {
  let hexCount = 0;
  const emitted: [string, unknown][] = [];
  const store = createSlotStore(() => undefined);
  const rows = store.publish(sessionsRowsSlot);
  const selection = store.publish(sessionsSelectionSlot);
  // The whole state after each write, the creation's own left out.
  const states: SessionsState[] = [];
  const logged: string[] = [];
  const activated: string[] = [];
  // Each value the selection was set to, the creation's own left out.
  const selections: (string | null)[] = [];
  // `activated <id>`, `rows set <id>`, `rows delete <id>`, `selection <id>` and
  // `emit <event>`, in the order the list called them.
  const calls: string[] = [];
  store.onWrite((change) => {
    states.push({
      rows: [...rows.all().values()],
      selectedSessionId: selection.get() ?? null,
    });
    if (change.kind === 'keyed') {
      const verb = change.value === undefined ? 'delete' : 'set';
      calls.push(`rows ${verb} ${change.key}`);
    } else if (change.kind === 'value') {
      selections.push(change.value as string | null);
      calls.push(`selection ${String(change.value)}`);
    }
  });
  const clock = { time: 0, now: () => clock.time };
  // Each pending timer by handle, with its delay.
  const timers = new Map<number, { run(): void; ms: number }>();
  let timerHandles = 0;
  const list = createSessionList({
    timers: {
      set(run, ms) {
        timers.set(++timerHandles, { run, ms });
        return timerHandles;
      },
      clear: (handle) => timers.delete(handle),
    },
    randomHex: () => {
      hexCount++;
      return hexCount.toString(16).padStart(8, '0');
    },
    clock,
    log: (message) => logged.push(message),
    emit: (event, data) => {
      emitted.push([event, data]);
      calls.push(`emit ${event}`);
    },
    rows,
    selection,
    activated: (sessionId) => {
      activated.push(sessionId);
      calls.push(`activated ${sessionId}`);
    },
    projectName,
    hostSessionName,
    configFolder: resolvedFolder,
  });
  states.length = 0;
  selections.length = 0;
  calls.length = 0;
  return {
    list,
    clock,
    timers,
    emitted,
    states,
    logged,
    activated,
    calls,
    selections,
  };
}

// A contribution's start: records each session it starts for, and each tool
// session records its calls and counts its ends.
function fakeContribution() {
  const started: AgentSession[] = [];
  // Each started session's info as it was at start, held as a form session
  // holds it.
  const startedInfos: SessionInfo[] = [];
  const calls: { name: string; args: unknown; context: ToolCallContext }[] = [];
  let ends = 0;
  const start = (session: AgentSession): ToolSession => {
    started.push(session);
    startedInfos.push(session.info);
    return {
      call: async (name, args, context) => {
        calls.push({ name, args, context });
        return RESULT;
      },
      end: () => {
        ends++;
      },
    };
  };
  return { start, started, startedInfos, calls, ends: () => ends };
}

function labels(state: SessionsState): string[] {
  return state.rows.map((row) => row.label);
}

function rowProjects(state: SessionsState): string[] {
  return state.rows.map((row) => row.project);
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

// A promise the test settles by hand.
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type SessionList = ReturnType<typeof setUp>['list'];
type FakeClock = ReturnType<typeof setUp>['clock'];

// Connects a session and marks it, so it holds a row.
function connectWithRow(
  list: SessionList,
  sessionInfo: SessionInfo,
): ConnectedSession {
  const connected = list.connect(sessionInfo);
  list.mark(connected.session.id, MARK);
  return connected;
}

describe('createSessionList', () => {
  it('gives each connected session a fresh id and emits connected', () => {
    const { list, emitted } = setUp();
    const sessionInfo = info('/work/x');

    const connected = list.connect(sessionInfo);

    expect(connected.session.id).toBe('00000001');
    expect(connected.session.info).toEqual(sessionInfo);
    expect(emitted).toEqual([
      ['connected', { id: '00000001', info: sessionInfo, owned: false }],
    ]);
  });

  it('starts one tool session per contribution with the agent session', () => {
    const { list } = setUp();
    const first = fakeContribution();
    const second = fakeContribution();
    list.contributeTools([tool('a')], first.start);
    list.contributeTools([tool('b')], second.start);

    const { session } = list.connect(info('/work/x'));

    expect(first.started).toEqual([session]);
    expect(second.started).toEqual([session]);
  });

  it('routes a call to the contribution that holds the tool', async () => {
    const { list } = setUp();
    const first = fakeContribution();
    const second = fakeContribution();
    list.contributeTools([tool('a'), tool('b')], first.start);
    list.contributeTools([tool('c')], second.start);
    const connected = list.connect(info('/work/x'));
    const context = {
      toolUseId: 'toolu_01',
      signal: new AbortController().signal,
    };

    const result = await connected.call('c', { value: 1 }, context);

    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual([{ name: 'c', args: { value: 1 }, context }]);
    expect(second.calls[0].context).toBe(context);
    expect(result).toBe(RESULT);
  });

  it('rejects a call to a tool no contribution holds', async () => {
    const { list } = setUp();
    list.contributeTools([tool('a')], fakeContribution().start);
    const connected = list.connect(info('/work/x'));
    const guard = vi.fn<ToolCallGuard>(async () => ({ kind: 'run' }));
    list.addToolCallGuard(guard);

    await expect(
      connected.call(
        'zz',
        {},
        {
          toolUseId: null,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow('Unknown tool: zz. Valid tools are a.');
    expect(guard).not.toHaveBeenCalled();
  });

  // `guards` lists each registration by its guard's label, a label listed
  // twice registering one function twice. `held` is the first guard, which
  // waits until `whileHeld` has run. `relay` makes the caller a relay joined
  // to an owned session under host `host-a`, in place of a connected session.
  it.each<{
    case: string;
    guards: string[];
    answers: Record<string, ToolCallVerdict | Error>;
    disposedBefore?: number[];
    relay?: true;
    held?: string;
    whileHeld?(held: {
      contribution: Disposable;
      connected: ConnectedSession;
      ownedSession: OwnedSession | null;
      abort: AbortController;
      registrations: Disposable[];
    }): void;
    result: { resolves: ToolResult } | { rejects: string };
    handlerCalls: number;
    asked: string[];
  }>([
    {
      case: 'no guard',
      guards: [],
      answers: {},
      result: { resolves: RESULT },
      handlerCalls: 1,
      asked: [],
    },
    {
      case: 'one skip',
      guards: ['g1'],
      answers: { g1: { kind: 'skip', text: 'no change' } },
      result: { resolves: { content: [{ type: 'text', text: 'no change' }] } },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'run then skip',
      guards: ['g1', 'g2'],
      answers: {
        g1: { kind: 'run' },
        g2: { kind: 'skip', text: 'second says no' },
      },
      result: {
        resolves: { content: [{ type: 'text', text: 'second says no' }] },
      },
      handlerCalls: 0,
      asked: ['g1', 'g2'],
    },
    {
      case: 'skip first',
      guards: ['g1', 'g2'],
      answers: {
        g1: { kind: 'skip', text: 'first says no' },
        g2: { kind: 'run' },
      },
      result: {
        resolves: { content: [{ type: 'text', text: 'first says no' }] },
      },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'a guard rejects',
      guards: ['g1', 'g2'],
      answers: { g1: new Error('guard failed'), g2: { kind: 'run' } },
      result: { rejects: 'guard failed' },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'a disposed guard',
      guards: ['g1', 'g2'],
      answers: { g1: { kind: 'skip', text: 'gone' }, g2: { kind: 'run' } },
      disposedBefore: [0],
      result: { resolves: RESULT },
      handlerCalls: 1,
      asked: ['g2'],
    },
    {
      case: 'the contribution disposed during a guard',
      guards: ['g1'],
      answers: { g1: { kind: 'run' } },
      held: 'g1',
      whileHeld: ({ contribution }) => contribution.dispose(),
      result: { rejects: 'Unknown tool: a' },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'a guard disposed during its own answer',
      guards: ['g1', 'g2'],
      answers: {
        g1: { kind: 'skip', text: 'still decides' },
        g2: { kind: 'run' },
      },
      held: 'g1',
      whileHeld: ({ registrations }) => registrations[0].dispose(),
      result: {
        resolves: { content: [{ type: 'text', text: 'still decides' }] },
      },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'the session ended during a guard',
      guards: ['g1'],
      answers: { g1: { kind: 'run' } },
      held: 'g1',
      whileHeld: ({ connected }) => connected.end(),
      result: { rejects: 'Session ended' },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'the signal aborted during a guard',
      guards: ['g1'],
      answers: { g1: { kind: 'run' } },
      held: 'g1',
      whileHeld: ({ abort }) => abort.abort(new Error('call aborted')),
      result: { rejects: 'call aborted' },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: "the host moved during a relay call's guard",
      guards: ['g1'],
      answers: { g1: { kind: 'run' } },
      relay: true,
      held: 'g1',
      whileHeld: ({ ownedSession }) =>
        (ownedSession as OwnedSession).setHostSessionId('host-b'),
      result: { rejects: 'moved from host host-a to host-b' },
      handlerCalls: 0,
      asked: ['g1'],
    },
    {
      case: 'one guard added twice',
      guards: ['g1', 'g1'],
      answers: { g1: { kind: 'run' } },
      result: { resolves: RESULT },
      handlerCalls: 1,
      asked: ['g1', 'g1'],
    },
  ])(
    'routeCall_ToolCallGuards_$case',
    async ({
      guards,
      answers,
      disposedBefore = [],
      relay,
      held,
      whileHeld,
      result,
      handlerCalls,
      asked,
    }) => {
      const { list } = setUp();
      const handler = fakeContribution();
      const contribution = list.contributeTools([tool('a')], handler.start);
      const ownedSession = relay ? list.open(owned('host-a')) : null;
      const connected = list.connect(relay ? owned('host-a') : info('/work/x'));
      const askedLabels: string[] = [];
      const release = deferred<void>();
      const guardOf = new Map<string, ToolCallGuard>(
        [...new Set(guards)].map((label) => [
          label,
          async () => {
            askedLabels.push(label);
            if (label === held) {
              await release.promise;
            }
            const answer = answers[label];
            if (answer instanceof Error) {
              throw answer;
            }
            return answer;
          },
        ]),
      );
      const registrations = guards.map((label) =>
        list.addToolCallGuard(guardOf.get(label) as ToolCallGuard),
      );
      for (const index of disposedBefore) {
        registrations[index].dispose();
      }
      const abort = new AbortController();

      const call = connected.call(
        'a',
        {},
        { toolUseId: null, signal: abort.signal },
      );
      whileHeld?.({
        contribution,
        connected,
        ownedSession,
        abort,
        registrations,
      });
      release.resolve();

      if ('rejects' in result) {
        await expect(call).rejects.toThrow(result.rejects);
      } else {
        expect(await call).toStrictEqual(result.resolves);
      }
      expect(handler.calls).toHaveLength(handlerCalls);
      expect(askedLabels).toEqual(asked);
    },
  );

  it.each<{
    case: string;
    contribute(list: SessionList, call: ToolSession['call']): void;
    caller(list: SessionList): ConnectedSession;
    toolUseId: string | null;
    seen: GuardedToolCall;
  }>([
    {
      case: 'a main-agent-only contribution',
      contribute: (list, call) =>
        list.contributeTools([tool('a')], () => ({ call, end() {} }), {
          mainAgentOnly: true,
        }),
      caller: (list) => list.connect(info('/work/x')),
      toolUseId: 't1',
      seen: {
        sessionId: '00000001',
        tool: 'a',
        toolUseId: 't1',
        mainAgentOnly: true,
      },
    },
    {
      case: 'a contribution with no options',
      contribute: (list, call) =>
        list.contributeTools([tool('a')], () => ({ call, end() {} })),
      caller: (list) => list.connect(info('/work/x')),
      toolUseId: null,
      seen: {
        sessionId: '00000001',
        tool: 'a',
        toolUseId: null,
        mainAgentOnly: false,
      },
    },
    {
      case: 'main-agent-only disposed, then contributed with no options',
      contribute: (list, call) => {
        list
          .contributeTools([tool('a')], () => ({ call, end() {} }), {
            mainAgentOnly: true,
          })
          .dispose();
        list.contributeTools([tool('a')], () => ({ call, end() {} }));
      },
      caller: (list) => list.connect(info('/work/x')),
      toolUseId: 't1',
      seen: {
        sessionId: '00000001',
        tool: 'a',
        toolUseId: 't1',
        mainAgentOnly: false,
      },
    },
    {
      case: 'the second of two connected sessions',
      contribute: (list, call) =>
        list.contributeTools([tool('a')], () => ({ call, end() {} }), {
          mainAgentOnly: true,
        }),
      caller: (list) => {
        list.connect(info('/work/x'));
        return list.connect(info('/work/y'));
      },
      toolUseId: 't2',
      seen: {
        sessionId: '00000002',
        tool: 'a',
        toolUseId: 't2',
        mainAgentOnly: true,
      },
    },
    {
      case: 'a relay joined to an owned session',
      contribute: (list, call) =>
        list.contributeTools([tool('a')], () => ({ call, end() {} }), {
          mainAgentOnly: true,
        }),
      caller: (list) => {
        list.connect(info('/work/x'));
        list.open(owned('h1'));
        return list.connect(owned('h1'));
      },
      toolUseId: 't3',
      seen: {
        sessionId: '00000002',
        tool: 'a',
        toolUseId: 't3',
        mainAgentOnly: true,
      },
    },
  ])(
    'routeCall_GuardSeesTheCall_$case',
    async ({ contribute, caller, toolUseId, seen }) => {
      const { list } = setUp();
      contribute(list, async () => RESULT);
      const calls: GuardedToolCall[] = [];
      list.addToolCallGuard(async (call) => {
        calls.push(call);
        return { kind: 'run' };
      });

      await caller(list).call(
        'a',
        {},
        { toolUseId, signal: new AbortController().signal },
      );

      expect(calls).toEqual([seen]);
    },
  );

  it('throws on a tool name two contributions share', () => {
    const { list } = setUp();
    list.contributeTools([tool('a')], fakeContribution().start);

    expect(() =>
      list.contributeTools([tool('a')], fakeContribution().start),
    ).toThrow(/"a"/);
  });

  it('throws on a tool name one contribution lists twice', () => {
    const { list } = setUp();
    list.contributeTools([tool('x')], fakeContribution().start);

    expect(() =>
      list.contributeTools([tool('a'), tool('a')], fakeContribution().start),
    ).toThrow(/"a"/);
    expect(list.tools().map((each) => each.name)).toEqual(['x']);
  });

  it('lists contributed tools in contribution order', () => {
    const { list } = setUp();
    list.contributeTools([tool('a'), tool('b')], fakeContribution().start);
    list.contributeTools([tool('c')], fakeContribution().start);

    expect(list.tools().map((each) => each.name)).toEqual(['a', 'b', 'c']);
  });

  it('connect_ConnectedSession_AddsNoRowSendsNoStateAndEmitsConnected', () => {
    const { list, states, emitted } = setUp();

    const connected = list.connect(info('/work/x'));

    expect(list.state()).toEqual({ rows: [], selectedSessionId: null });
    expect(states).toEqual([]);
    expect(emitted).toEqual([
      ['connected', { ...connected.session, owned: false }],
    ]);
  });

  // `hidden` connects that many sessions with no row before the three rows;
  // the second row's session then ends and a fourth row connects.
  it.each<{
    name: string;
    hidden: number;
    before: string[];
    after: string[];
  }>([
    {
      name: 'rows only',
      hidden: 0,
      before: ['x', 'x 2', 'x 3'],
      after: ['x', 'x 3', 'x 2'],
    },
    {
      name: 'a connected session with no row holds its number',
      hidden: 1,
      before: ['x 2', 'x 3', 'x 4'],
      after: ['x 2', 'x 4', 'x 3'],
    },
  ])(
    'numbers sessions of one folder by the lowest free number: $name',
    ({ hidden, before, after }) => {
      const { list } = setUp();
      for (let count = 0; count < hidden; count++) {
        list.connect(info('/work/x'));
      }
      connectWithRow(list, info('/work/x'));
      const b = connectWithRow(list, info('/work/x'));
      connectWithRow(list, info('/work/x'));
      expect(labels(list.state())).toEqual(before);

      b.end();
      connectWithRow(list, info('/work/x'));

      expect(labels(list.state())).toEqual(after);
    },
  );

  it('label_IsTheRowsLabel_KeptWhileTheRowIsClosed_NullOnceTheSessionEnds', () => {
    const { list } = setUp();
    connectWithRow(list, info('/work/x'));
    const second = connectWithRow(list, info('/work/x'));
    const id = second.session.id;

    expect(list.label(id)).toBe('x 2');
    list.closeSession(id, false);
    expect(list.label(id)).toBe('x 2');
    second.end();
    expect(list.label(id)).toBeNull();
    expect(list.label('unknown')).toBeNull();
  });

  it('numbers two folders with one name as one group', () => {
    const { list } = setUp();

    connectWithRow(list, info('/a/x'));
    connectWithRow(list, info('/b/x'));

    expect(labels(list.state())).toEqual(['x', 'x 2']);
  });

  it('labels a session with no project folder session', () => {
    const { list } = setUp();

    connectWithRow(list, info(null));
    connectWithRow(list, info(null));

    expect(labels(list.state())).toEqual(['session', 'session 2']);
  });

  it('labels a codex session with no project folder Codex session', () => {
    const { list } = setUp();

    connectWithRow(list, info(null, 'codex'));
    connectWithRow(list, info(null, 'codex'));
    connectWithRow(list, info(null, 'claude'));

    expect(labels(list.state())).toEqual([
      'Codex session',
      'Codex session 2',
      'session',
    ]);
    expect(list.state().rows.map((row) => row.harness)).toEqual([
      'codex',
      'codex',
      'claude',
    ]);
  });

  it("adds a connected session's row at mark, selected when none is selected, else marked", () => {
    const { list, states } = setUp();
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    const c = list.connect(info('/work/x'));

    list.mark(b.session.id, MARK);
    list.mark(a.session.id, MARK);

    expect(
      states.map((state) => [
        state.rows.map((row) => [row.sessionId, row.marked]),
        state.selectedSessionId,
      ]),
    ).toEqual([
      [[[b.session.id, false]], null],
      [[[b.session.id, false]], b.session.id],
      [
        [
          [b.session.id, false],
          [a.session.id, true],
        ],
        b.session.id,
      ],
    ]);
    expect(list.state().rows.map((row) => row.sessionId)).not.toContain(
      c.session.id,
    );
  });

  it('sends nothing for the selected row or a row already marked', () => {
    const { list, states } = setUp();
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    list.mark(a.session.id, MARK);
    list.mark(b.session.id, MARK);
    const sentBefore = states.length;
    const before = list.state();

    list.mark(a.session.id, MARK);
    list.mark(b.session.id, MARK);

    expect(states).toHaveLength(sentBefore);
    expect(list.state()).toEqual(before);
  });

  it('selects a row when the selected one closed and none is left selected', () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id, MARK);
    list.closeSession(a.session.id, false);
    expect(list.state().selectedSessionId).toBeNull();
    const b = list.connect(info('/work/x'));

    list.mark(b.session.id, MARK);

    expect(list.state().selectedSessionId).toBe(b.session.id);
    expect(list.state().rows.map((row) => row.marked)).toEqual([false]);
  });

  it('brings a closed row back at the end on its next round', async () => {
    const { list } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    list.mark(a.session.id, MARK);
    list.mark(b.session.id, MARK);
    list.closeSession(b.session.id, false);

    list.mark(b.session.id, MARK);
    await b.call(
      'a',
      {},
      {
        toolUseId: null,
        signal: new AbortController().signal,
      },
    );

    const { rows } = list.state();
    expect(rows.map((row) => row.sessionId)).toEqual([
      a.session.id,
      b.session.id,
    ]);
    expect(rows.map((row) => row.marked)).toEqual([false, true]);
    expect(contribution.calls.map((call) => call.name)).toEqual(['a']);
  });

  // Sessions 00000001 and 00000002 hold rows, 00000001 selected and 00000002
  // marked; 00000003 is connected with no row.
  it.each<{
    name: string;
    method: 'activate';
    sessionId: string;
    rows: [string, boolean][];
  }>([
    {
      name: 'a marked row',
      method: 'activate',
      sessionId: '00000002',
      rows: [
        ['00000001', false],
        ['00000002', false],
      ],
    },
    {
      name: 'a connected session with no row',
      method: 'activate',
      sessionId: '00000003',
      rows: [
        ['00000001', false],
        ['00000002', true],
        ['00000003', false],
      ],
    },
  ])(
    'activates a row, clears its mark and reports activated first: $name',
    ({ method, sessionId, rows: expectedRows }) => {
      const { list, activated, calls } = setUp();
      connectWithRow(list, info('/work/x'));
      connectWithRow(list, info('/work/x'));
      list.connect(info('/work/x'));
      const callsBefore = calls.length;

      list[method](sessionId);

      expect(activated).toEqual([sessionId]);
      expect(calls.slice(callsBefore)).toEqual([
        `activated ${sessionId}`,
        `rows set ${sessionId}`,
        `selection ${sessionId}`,
      ]);
      const { rows, selectedSessionId } = list.state();
      expect(selectedSessionId).toBe(sessionId);
      expect(rows.map((row) => [row.sessionId, row.marked])).toEqual(
        expectedRows,
      );
    },
  );

  it('reports activated for the selected row and sends nothing once its mark toast is cleared', () => {
    const { list, states, activated } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id, MARK);
    list.activate(a.session.id);
    const sentBefore = states.length;

    list.activate(a.session.id);

    expect(activated).toEqual(['00000001', '00000001']);
    expect(states).toHaveLength(sentBefore);
  });

  it('moves to the right neighbour, else the left, when the selected row closes', () => {
    const { list } = setUp();
    const [a, b, c] = [1, 2, 3].map(() => list.connect(info('/work/x')));
    for (const connected of [a, b, c]) {
      list.mark(connected.session.id, MARK);
    }

    list.closeSession(a.session.id, false);
    expect(list.state().selectedSessionId).toBe(b.session.id);
    expect(list.state().rows[0].marked).toBe(false);

    list.activate(c.session.id);
    list.closeSession(c.session.id, false);
    expect(list.state().selectedSessionId).toBe(b.session.id);

    list.closeSession(b.session.id, false);
    expect(list.state()).toEqual({ rows: [], selectedSessionId: null });
  });

  it('ends tool sessions, drops the row and emits ended when a session ends', () => {
    const { list, emitted, states } = setUp();
    const firstContribution = fakeContribution();
    const secondContribution = fakeContribution();
    list.contributeTools([tool('a')], firstContribution.start);
    list.contributeTools([tool('b')], secondContribution.start);
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    list.mark(first.session.id, MARK);
    list.mark(second.session.id, MARK);

    first.end();

    expect(firstContribution.ends()).toBe(1);
    expect(secondContribution.ends()).toBe(1);
    expect(emitted.at(-1)).toEqual(['ended', { sessionId: '00000001' }]);
    expect(list.state()).toEqual({
      rows: [
        {
          sessionId: '00000002',
          label: 'x 2',
          project: 'x',
          harness: null,
          marked: false,
          markToast: MARK,
          projectDir: '/work/x',
          hostSessionId: null,
          titles: NO_TITLES,
          profileDir: null,
          owner: null,
        },
      ],
      selectedSessionId: '00000002',
    });

    const sentBefore = states.length;
    const emittedBefore = emitted.length;
    first.end();

    expect(firstContribution.ends()).toBe(1);
    expect(states).toHaveLength(sentBefore);
    expect(emitted).toHaveLength(emittedBefore);
  });

  it('ends the tool sessions already started when a later start throws, and rethrows', () => {
    const { list, emitted } = setUp();
    const first = fakeContribution();
    list.contributeTools([tool('a')], first.start);
    list.contributeTools([tool('b')], () => {
      throw new Error('forms could not start');
    });

    expect(() => list.connect(info('/work/x'))).toThrow(
      'forms could not start',
    );

    expect(first.started).toHaveLength(1);
    expect(first.ends()).toBe(1);
    expect(emitted).toEqual([]);
  });

  it('keeps the start error, logs the end error and ends the rest when an end throws undoing a start', () => {
    const { list, logged } = setUp();
    list.contributeTools([tool('a')], () => ({
      call: async () => RESULT,
      end: () => {
        throw new Error('end failed');
      },
    }));
    const later = fakeContribution();
    list.contributeTools([tool('b')], later.start);
    list.contributeTools([tool('c')], () => {
      throw new Error('forms could not start');
    });

    expect(() => list.connect(info('/work/x'))).toThrow(
      'forms could not start',
    );

    expect(later.ends()).toBe(1);
    expect(logged).toEqual([expect.stringContaining('end failed')]);
  });

  it('keeps a row a close guard refuses, with a log line and false, until every guard allows it', () => {
    const { list, states, logged } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    const id = connected.session.id;
    let roundOpen = true;
    list.addCloseGuard(() => null);
    list.addCloseGuard((sessionId) =>
      sessionId === id && roundOpen ? 'Round open' : null,
    );
    const sentBefore = states.length;

    expect(list.closeSession(id, false)).not.toBeNull();

    expect(list.state().rows.map((row) => row.sessionId)).toEqual([id]);
    expect(states).toHaveLength(sentBefore);
    expect(logged).toEqual([expect.stringContaining(id)]);
    roundOpen = false;
    expect(list.closeSession(id, false)).toBeNull();
    expect(list.state().rows).toEqual([]);
    list.mark(id, MARK);
    const refusing = list.addCloseGuard(() => 'refused');
    expect(list.closeSession(id, false)).not.toBeNull();
    refusing.dispose();
    expect(list.closeSession(id, false)).toBeNull();
  });

  it('keeps a row while one registration of the same guard remains', () => {
    const { list } = setUp();
    const id = connectWithRow(list, info('/work/x')).session.id;
    const refuse = () => 'refused';
    const first = list.addCloseGuard(refuse);
    const second = list.addCloseGuard(refuse);

    first.dispose();
    expect(list.closeSession(id, false)).not.toBeNull();

    second.dispose();
    expect(list.closeSession(id, false)).toBeNull();
  });

  it('first refusal wins and row stays', () => {
    const { list, logged } = setUp();
    const id = connectWithRow(list, info('/work/x')).session.id;
    list.addCloseGuard(() => null);
    list.addCloseGuard(() => 'Finish the round first');
    list.addCloseGuard(() => 'Finish the primer first');

    expect(list.closeSession(id, false)).toBe('Finish the round first');

    expect(list.state().rows.map((row) => row.sessionId)).toEqual([id]);
    expect(logged).toEqual([
      `closeSession for session ${id} kept by a close guard`,
    ]);
  });

  it('at once runs cancel holds then closes in one call', () => {
    const { list, emitted } = setUp();
    const id = connectWithRow(list, info('/work/x')).session.id;
    let isHeld = true;
    const cancelled: string[] = [];
    list.addCloseGuard(
      () => (isHeld ? 'Finish the round first' : null),
      (sessionId) => {
        cancelled.push(sessionId);
        isHeld = false;
      },
    );

    expect(list.closeSession(id, true)).toBeNull();

    expect(cancelled).toEqual([id]);
    expect(list.state().rows).toEqual([]);
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: id }]);
  });

  it('plain close never runs cancel holds', () => {
    const { list } = setUp();
    const id = connectWithRow(list, info('/work/x')).session.id;
    const cancelled: string[] = [];
    list.addCloseGuard(
      () => 'Finish the round first',
      (sessionId) => cancelled.push(sessionId),
    );

    expect(list.closeSession(id, false)).toBe('Finish the round first');

    expect(cancelled).toEqual([]);
  });

  it('cancel hold that throws leaves the row with the reason', () => {
    const { list, logged } = setUp();
    const id = connectWithRow(list, info('/work/x')).session.id;
    const cancelled: string[] = [];
    list.addCloseGuard(
      () => 'Finish the round first',
      () => {
        throw new Error('no such form');
      },
    );
    list.addCloseGuard(
      () => null,
      (sessionId) => cancelled.push(sessionId),
    );

    expect(list.closeSession(id, true)).toBe('Finish the round first');

    expect(cancelled).toEqual([id]);
    expect(list.state().rows.map((row) => row.sessionId)).toEqual([id]);
    expect(logged).toEqual([
      `cancelling what holds session ${id} failed: no such form`,
      `closeSession for session ${id} kept by a close guard`,
    ]);
  });

  it('mark keeps its text until activate', () => {
    const { list } = setUp();
    const a = connectWithRow(list, info('/work/x')).session.id;
    const b = list.connect(info('/work/y')).session.id;
    const markToastOf = (id: string) =>
      list.state().rows.find((row) => row.sessionId === id)?.markToast;

    list.mark(b, { text: 'Turn finished in y', action: 'read it' });
    list.activate(a);

    expect(markToastOf(b)).toEqual({
      text: 'Turn finished in y',
      action: 'read it',
    });
    list.activate(b);
    expect(markToastOf(b)).toBeNull();
  });

  it('first mark wins until activate', () => {
    const { list } = setUp();
    const a = connectWithRow(list, info('/work/x')).session.id;
    const b = list.connect(info('/work/y')).session.id;
    const later = { text: 'Turn finished in y', action: 'read it' };
    const markToastOf = () =>
      list.state().rows.find((row) => row.sessionId === b)?.markToast;

    list.mark(b, MARK);
    list.mark(b, later);
    expect(markToastOf()).toEqual(MARK);

    list.activate(b);
    list.activate(a);
    list.mark(b, later);
    expect(markToastOf()).toEqual(later);
  });

  it('a mark replaces the toast a mark that selected the row left there', () => {
    const { list } = setUp();
    const a = connectWithRow(list, info('/work/x')).session.id;
    const b = connectWithRow(list, info('/work/y')).session.id;
    const later = { text: 'Turn finished in x', action: 'read it' };
    const markToastOf = () =>
      list.state().rows.find((row) => row.sessionId === a)?.markToast;
    expect(list.state().selectedSessionId).toBe(a);
    expect(markToastOf()).toEqual(MARK);

    list.activate(b);
    list.mark(a, later);

    expect(markToastOf()).toEqual(later);
  });

  it('starts a contribution added after a session connected, and routes its calls', async () => {
    const { list } = setUp();
    const connected = list.connect(info('/work/x'));
    const contribution = fakeContribution();

    list.contributeTools([tool('a')], contribution.start);

    expect(contribution.started).toEqual([connected.session]);
    await expect(connected.call('a', {}, CONTEXT)).resolves.toBe(RESULT);
    expect(contribution.calls.map((call) => call.name)).toEqual(['a']);
  });

  it('ends a disposed contribution in every live session and frees its names', async () => {
    const { list } = setUp();
    const connected = list.connect(info('/work/x'));
    list.open(owned('host-1'));
    const contribution = fakeContribution();
    const handle = list.contributeTools([tool('a')], contribution.start);

    handle.dispose();

    expect(contribution.ends()).toBe(2);
    await expect(connected.call('a', {}, CONTEXT)).rejects.toThrow(
      'Unknown tool: a. Valid tools are .',
    );
    expect(list.tools()).toEqual([]);
    expect(() =>
      list.contributeTools([tool('a')], fakeContribution().start),
    ).not.toThrow();
    handle.dispose();
    expect(contribution.ends()).toBe(2);
  });

  it('undoes a live contribution whose start throws for one session, and rethrows', () => {
    const { list } = setUp();
    list.connect(info('/work/x'));
    list.connect(info('/work/y'));
    const first = fakeContribution();
    let starts = 0;
    const toolsChanged = vi.fn();
    list.onToolsChanged(toolsChanged);

    expect(() =>
      list.contributeTools([tool('a')], (session) => {
        starts++;
        if (starts === 2) {
          throw new Error('no tools for the second');
        }
        return first.start(session);
      }),
    ).toThrow('no tools for the second');

    expect(first.ends()).toBe(1);
    expect(list.tools()).toEqual([]);
    expect(toolsChanged).not.toHaveBeenCalled();
    expect(() =>
      list.contributeTools([tool('a')], fakeContribution().start),
    ).not.toThrow();
  });

  it.each<{
    change: string;
    act(list: SessionList, listening: Disposable): void;
    calls: number;
  }>([
    {
      change: 'an added contribution',
      act: (list) =>
        list.contributeTools([tool('a')], fakeContribution().start),
      calls: 1,
    },
    {
      change: 'a disposed contribution',
      act: (list) =>
        list.contributeTools([tool('a')], fakeContribution().start).dispose(),
      calls: 2,
    },
    {
      change: 'a second dispose',
      act: (list) => {
        const handle = list.contributeTools(
          [tool('a')],
          fakeContribution().start,
        );
        handle.dispose();
        handle.dispose();
      },
      calls: 2,
    },
    {
      change: 'a listener disposed before the add',
      act: (list, listening) => {
        listening.dispose();
        list.contributeTools([tool('a')], fakeContribution().start);
      },
      calls: 0,
    },
  ])('calls onToolsChanged once for $change', ({ act, calls }) => {
    const { list } = setUp();
    const listener = vi.fn();

    act(list, list.onToolsChanged(listener));

    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('drops the row of a session that ends whatever the close guards say', () => {
    const { list } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    list.addCloseGuard(() => 'refused');

    connected.end();

    expect(list.state().rows).toEqual([]);
  });

  it.each([
    { name: 'an unknown session', target: 'ffffffff', sent: false },
    { name: 'the selected row', target: '00000002', sent: false },
    { name: 'another row', target: '00000001', sent: true },
    {
      name: 'a connected session with no row',
      target: '00000003',
      sent: true,
    },
  ])(
    'activate says whether it wrote, which the page holds its echo for: $name',
    ({ target, sent }) => {
      const { list, states } = setUp();
      connectWithRow(list, info('/work/x'));
      list.activate(connectWithRow(list, info('/work/y')).session.id);
      list.connect(info('/work/z'));
      const sentBefore = states.length;

      const returned = list.activate(target);

      expect(returned).toBe(sent);
      expect(states.length > sentBefore).toBe(sent);
    },
  );

  it('ignores unknown sessions with a log line', () => {
    const { list, states, logged, activated } = setUp();
    connectWithRow(list, info('/work/x'));
    const sentBefore = states.length;

    list.mark('ffffffff', MARK);
    list.activate('fffffffe');
    expect(list.closeSession('fffffffd', false)).toBeNull();

    expect(logged).toEqual([
      expect.stringMatching(/mark .*ffffffff/),
      expect.stringMatching(/activate .*fffffffe/),
      expect.stringMatching(/closeSession .*fffffffd/),
    ]);
    expect(activated).toEqual([]);
    expect(states).toHaveLength(sentBefore);
  });

  // Ids count up from 00000001 in connect and open order. Each `act` runs on a
  // list whose 00000001 is selected and 00000002 marked, both with rows.
  it.each<{ name: string; act: (list: SessionList) => void; calls: string[] }>([
    {
      name: 'open',
      act: (list) => list.open(owned('h3')),
      calls: ['rows set 00000003', 'selection 00000003', 'emit connected'],
    },
    {
      name: 'activate with a mark',
      act: (list) => list.activate('00000002'),
      calls: ['activated 00000002', 'rows set 00000002', 'selection 00000002'],
    },
    {
      name: 'close selected',
      act: (list) => list.closeSession('00000001', false),
      calls: [
        'rows delete 00000001',
        'rows set 00000002',
        'selection 00000002',
        'emit closed',
      ],
    },
    {
      name: 'end selected',
      act: (list) => list.endAll(),
      calls: [
        'rows delete 00000001',
        'rows set 00000002',
        'selection 00000002',
        'emit ended',
        'rows delete 00000002',
        'selection null',
        'emit ended',
      ],
    },
    {
      name: 'setTitle',
      act: (list) => list.setTitle('00000001', 'user', 'Named'),
      calls: ['rows set 00000001', 'emit titleChanged'],
    },
  ])(
    'every operation writes rows, then selection, then emits: $name',
    ({ act, calls: expected }) => {
      const { list, calls } = setUp();
      list.open(owned('h1'));
      list.open(owned('h2'), { select: false });
      list.mark('00000002', MARK);
      calls.length = 0;

      act(list);

      expect(calls).toEqual(expected);
    },
  );

  it.each<{
    name: string;
    held: string[];
    selection: string | null | undefined;
    writes: string[];
  }>([
    {
      name: 'rows and a selection held',
      held: ['a', 'b'],
      selection: 'a',
      writes: ['rows delete a', 'rows delete b', 'selection null'],
    },
    { name: 'a slot holding null', held: [], selection: null, writes: [] },
    {
      name: 'a slot unwritten',
      held: [],
      selection: undefined,
      writes: ['selection null'],
    },
  ])('create_ClearsLeftovers: $name', ({ held, selection, writes }) => {
    const store = createSlotStore(() => undefined);
    const rows = store.publish(sessionsRowsSlot);
    const selected = store.publish(sessionsSelectionSlot);
    for (const key of held) {
      rows.set(key, { sessionId: key } as never);
    }
    if (selection !== undefined) {
      selected.set(selection);
    }
    const written: string[] = [];
    store.onWrite((change) =>
      written.push(
        change.kind === 'value'
          ? `selection ${String(change.value)}`
          : `rows delete ${'key' in change ? change.key : change.id}`,
      ),
    );

    const list = createSessionList({
      randomHex: () => 'id',
      clock: { now: () => 0 },
      timers: { set: () => 0, clear: () => undefined },
      log: () => undefined,
      emit: () => undefined,
      rows,
      selection: selected,
      activated: () => undefined,
      projectName: async () => null,
      hostSessionName: async () => null,
      configFolder: () => null,
    });

    expect(written).toEqual(writes);
    expect(list.state()).toEqual({ rows: [], selectedSessionId: null });
  });

  it('opens an owned session with a selected row and emits connected', () => {
    const { list, states, emitted } = setUp();

    const { session } = list.open(owned('host-1'));

    expect(session.id).toBe('00000001');
    expect(list.state()).toEqual({
      rows: [
        {
          sessionId: '00000001',
          label: 'x',
          project: 'x',
          harness: 'claude',
          marked: false,
          markToast: null,
          projectDir: '/work/x',
          hostSessionId: 'host-1',
          titles: NO_TITLES,
          profileDir: 'resolved:default',
          owner: null,
        },
      ],
      selectedSessionId: '00000001',
    });
    expect(states).toHaveLength(2);
    expect(emitted).toEqual([
      ['connected', { id: '00000001', info: owned('host-1'), owned: true }],
    ]);
  });

  it.each([
    { options: { select: true }, owner: null, selected: '00000001' },
    {
      options: { select: true, owner: 'practice' },
      owner: 'practice',
      selected: null,
    },
    {
      options: { select: false, owner: 'practice' },
      owner: 'practice',
      selected: null,
    },
  ])(
    'open_Owner_KeepsItOnTheRowAndNeverSelectsIt: $options',
    ({ options, owner, selected }) => {
      const { list } = setUp();

      list.open(owned('host-1'), options);

      const state = list.state();
      expect(state.rows.map((row) => row.owner)).toEqual([owner]);
      expect(state.selectedSessionId).toBe(selected);
    },
  );

  it.each([
    {
      call: 'mark',
      selectFirst: false,
      act: (list: SessionList, id: string) => list.mark(id, MARK),
    },
    {
      call: 'mark',
      selectFirst: true,
      act: (list: SessionList, id: string) => list.mark(id, MARK),
    },
    {
      call: 'activate',
      selectFirst: false,
      act: (list: SessionList, id: string) => list.activate(id),
    },
  ])(
    'rowWithAnOwner_MarkAndActivate_WriteNothingAndLog: $call, another row selected $selectFirst',
    ({ call, selectFirst, act }) => {
      const { list, states, logged, activated } = setUp();
      if (selectFirst) {
        connectWithRow(list, info('/work/y'));
      }
      const { id } = list.open(owned('host-1'), {
        select: false,
        owner: 'practice',
      }).session;
      const sentBefore = states.length;

      const returned = act(list, id);

      expect(states).toHaveLength(sentBefore);
      expect(activated).toEqual([]);
      expect(logged.at(-1)).toMatch(new RegExp(`${call} .*${id}.*owner`));
      if (call === 'activate') {
        expect(returned).toBe(false);
      }
    },
  );

  it.each([
    { order: ['a', 'o', 'b'], selected: 'b' },
    { order: ['a', 'o'], selected: null },
    { order: ['b', 'o', 'a'], selected: 'b' },
  ])(
    'release_SelectedRowBesideARowWithAnOwner_SkipsIt: $order',
    ({ order, selected }) => {
      const { list } = setUp();
      const ids = new Map<string, string>();
      for (const name of order) {
        const { id } =
          name === 'o'
            ? list.open(owned('host-o'), { select: false, owner: 'practice' })
                .session
            : connectWithRow(list, info(`/work/${name}`)).session;
        ids.set(name, id);
      }
      const a = ids.get('a') ?? '';
      list.activate(a);

      list.release(a);

      expect(list.state().selectedSessionId).toBe(
        selected === null ? null : ids.get(selected),
      );
    },
  );

  it.each([
    {
      name: 'a claude session in a profile',
      session: {
        ...info('/work/x', 'claude'),
        profileDir: '~/.claude-personal',
      },
      profileDir: 'resolved:~/.claude-personal',
    },
    {
      name: 'a claude session with no profile',
      session: info('/work/x', 'claude'),
      profileDir: 'resolved:default',
    },
    {
      name: 'a session of a harness the app does not run',
      session: info('/work/x', 'codex'),
      profileDir: null,
    },
  ])(
    'connect_RowCarriesTheResolvedConfigFolder ($name)',
    ({ session, profileDir }) => {
      const { list } = setUp();

      const { session: connected } = list.connect(session);
      list.mark(connected.id, MARK);

      expect(list.state().rows[0].profileDir).toBe(profileDir);
    },
  );

  it('selects the opened row over the selected one', () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id, MARK);

    list.open(owned('h'));

    const state = list.state();
    expect(state.selectedSessionId).toBe('00000002');
    expect(labels(state)).toEqual(['x', 'x 2']);
    expect(state.rows.map((row) => row.marked)).toEqual([false, false]);
  });

  it('open with select false keeps the selected row', () => {
    const { list, emitted } = setUp();
    const selected = list.connect(info('/work/x'));
    list.activate(selected.session.id);

    const opened = list.open(owned('h'), { select: false });

    const state = list.state();
    expect(state.selectedSessionId).toBe(selected.session.id);
    expect(state.rows.map((row) => [row.sessionId, row.marked])).toEqual([
      [selected.session.id, false],
      [opened.session.id, false],
    ]);
    expect(emitted.at(-1)).toEqual([
      'connected',
      { ...opened.session, owned: true },
    ]);
  });

  it('open with select false and no selection stays unselected', () => {
    const { list } = setUp();

    list.open(owned('h'), { select: false });

    expect(list.state().selectedSessionId).toBeNull();
  });

  it('open with a row id takes it back, and refuses one already held', () => {
    const { list } = setUp();

    const reopened = list.open(owned('host-1'), {
      select: false,
      rowId: 'kept-row',
    });

    expect(reopened.session.id).toBe('kept-row');
    expect(() =>
      list.open(owned('host-2'), { select: false, rowId: 'kept-row' }),
    ).toThrow(/kept-row/);
    expect(list.state().rows.map((row) => row.sessionId)).toEqual(['kept-row']);
  });

  it('open with a kept row id adopts the session as it is, ending nothing', () => {
    const { list, timers, emitted, calls } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const first = list.open(owned('host-1'), { select: true });
    const rowId = first.session.id;
    emitted.length = 0;
    calls.length = 0;

    first.keep();
    first.end();
    const adopted = list.open(owned('host-2'), { select: false, rowId });

    expect(adopted.session).toBe(first.session);
    expect(adopted.session.info.sessionId).toBe('host-2');
    expect(calls.filter((call) => call.startsWith('rows delete'))).toEqual([]);
    expect(emitted.map(([event]) => event)).toEqual(['hostSessionChanged']);
    expect(contribution.ends()).toBe(0);
    expect(list.state().selectedSessionId).toBe(rowId);
    expect(timers.size).toBe(0);
  });

  it.each<{ case: string; isAdopted: boolean }>([
    { case: 'no open adopts it before its timer', isAdopted: false },
    { case: 'its adopter ends it, then the timer would run', isAdopted: true },
  ])('a kept session ends once: $case', ({ isAdopted }) => {
    const { list, timers, emitted } = setUp();
    const first = list.open(owned('host-1'));
    const rowId = first.session.id;
    first.keep();
    const kept = [...timers.values()];

    if (isAdopted) {
      list.open(owned('host-1'), { select: false, rowId }).end();
    }
    for (const timer of timers.values()) {
      timer.run();
    }

    expect(kept.map((timer) => timer.ms)).toEqual([KEPT_SESSION_MS]);
    expect(emitted.filter(([event]) => event === 'ended')).toEqual([
      ['ended', { sessionId: rowId }],
    ]);
    expect(list.state().rows).toEqual([]);
  });

  it('starts the contributed tool sessions when an owned session opens', () => {
    const { list } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);

    const ownedSession = list.open(owned('host-1'));

    expect(contribution.started).toEqual([ownedSession.session]);
  });

  it('throws opening a session with no host id', () => {
    const { list, states, emitted } = setUp();

    expect(() => list.open({ ...owned('h'), sessionId: null })).toThrow();
    expect(states).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('throws opening a host id already open, owned or connected', () => {
    const { list } = setUp();
    list.open(owned('host-1'));

    expect(() => list.open(owned('host-1'))).toThrow(/host-1/);
    list.connect(owned('host-2'));
    expect(() => list.open(owned('host-2'))).toThrow(/host-2/);
    expect(list.state().rows).toHaveLength(1);
  });

  it('joins an owned session when its relay connects, adding no row', () => {
    const { list, states, emitted, logged } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const ownedSession = list.open(owned('host-1'));
    const sentBefore = states.length;

    const connected = list.connect(owned('host-1'));

    expect(connected.session).toBe(ownedSession.session);
    expect(list.state().rows).toHaveLength(1);
    expect(contribution.started).toHaveLength(1);
    expect(states).toHaveLength(sentBefore);
    expect(emitted.filter(([event]) => event === 'connected')).toHaveLength(1);
    expect(logged).toEqual([expect.stringContaining('00000001')]);
  });

  it("routes a joined relay's calls to the owned session's tool sessions", async () => {
    const { list } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    list.open(owned('host-1'));
    const connected = list.connect(owned('host-1'));

    const result = await connected.call('a', { v: 1 }, CONTEXT);

    expect(result).toBe(RESULT);
    expect(contribution.calls).toEqual([
      { name: 'a', args: { v: 1 }, context: CONTEXT },
    ]);
  });

  it('leaves the owned session and its row when its relay ends, and lets the next relay join', () => {
    const { list, emitted, logged } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const ownedSession = list.open(owned('host-1'));
    const connected = list.connect(owned('host-1'));

    connected.end();

    expect(contribution.ends()).toBe(0);
    expect(list.state().rows).toHaveLength(1);
    expect(emitted.map(([event]) => event)).not.toContain('ended');
    expect(logged.at(-1)).toEqual(expect.stringContaining('00000001'));

    const next = list.connect(owned('host-1'));
    expect(next.session).toBe(ownedSession.session);
    expect(list.state().rows).toHaveLength(1);

    // The first relay's handle has already left: a second end must not clear
    // the join `next` holds.
    const loggedBefore = logged.length;
    connected.end();
    expect(logged).toHaveLength(loggedBefore);
    next.end();
    expect(logged.at(-1)).toEqual(expect.stringContaining('00000001'));
  });

  it('hands the join to a newer relay that says hello before the older one closes', async () => {
    const { list, states, emitted, logged } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const ownedSession = list.open(owned('host-1'));
    const older = list.connect(owned('host-1'));
    const sentBefore = states.length;

    const newer = list.connect(owned('host-1'));

    expect(newer.session).toBe(ownedSession.session);
    expect(list.state().rows).toHaveLength(1);
    expect(contribution.started).toHaveLength(1);
    expect(states).toHaveLength(sentBefore);
    expect(emitted.filter(([event]) => event === 'connected')).toHaveLength(1);
    expect(logged.at(-1)).toEqual(expect.stringContaining('00000001'));

    // The older socket's close comes late and leaves the newer join alone.
    const loggedBefore = logged.length;
    older.end();
    expect(logged).toHaveLength(loggedBefore);
    expect(await newer.call('a', { v: 1 }, CONTEXT)).toBe(RESULT);

    newer.end();
    expect(logged.at(-1)).toEqual(expect.stringContaining('00000001'));
    expect(contribution.ends()).toBe(0);
  });

  it('setHostSessionId_MovesRowAndJoinToNewId', () => {
    const { list, states, emitted, calls, logged } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const ownedSession = list.open(owned('a'));
    list.setTitle(ownedSession.session.id, 'agent', 'Fix login');
    const sentBefore = states.length;
    const callsBefore = calls.length;

    ownedSession.setHostSessionId('b');

    expect(states).toHaveLength(sentBefore + 1);
    expect(states.at(-1)?.rows.map((row) => row.hostSessionId)).toEqual(['b']);
    expect(states.at(-1)?.rows[0].titles).toEqual({
      ...NO_TITLES,
      agent: 'Fix login',
    });
    expect(list.titles(ownedSession.session.id)?.agent).toBe('Fix login');
    expect(calls.slice(callsBefore)).toEqual([
      `rows set ${ownedSession.session.id}`,
      'emit hostSessionChanged',
    ]);
    const changed = emitted.filter(([event]) => event === 'hostSessionChanged');
    expect(changed).toEqual([['hostSessionChanged', ownedSession.session]]);
    expect(ownedSession.session.info.sessionId).toBe('b');
    expect(contribution.startedInfos[0].sessionId).toBe('b');

    expect(list.connect(owned('b')).session).toBe(ownedSession.session);
    expect(list.state().rows).toHaveLength(1);

    // A late hello for the retired id is refused rather than adding a row.
    const sentBeforeLateHello = states.length;
    expect(() => list.connect(owned('a'))).toThrow(/a.*00000001/);
    expect(logged.at(-1)).toEqual(
      expect.stringContaining('retired host a of session 00000001'),
    );
    expect(list.state().rows.map((row) => row.hostSessionId)).toEqual(['b']);
    expect(states).toHaveLength(sentBeforeLateHello);
  });

  it('setHostSessionId_RelayJoinedUnderOldId_LosesJoinAndItsCallsAreRefused', async () => {
    const { list, logged } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const ownedSession = list.open(owned('host-a'));
    const oldRelay = list.connect(owned('host-a'));

    ownedSession.setHostSessionId('host-b');

    await expect(oldRelay.call('a', { v: 1 }, CONTEXT)).rejects.toThrow(
      /host-a.*host-b/,
    );
    expect(contribution.calls).toEqual([]);
    expect(logged.at(-1)).toEqual(
      expect.stringContaining('retired host host-a'),
    );

    // The new relay joins rather than taking over, and the old relay's late
    // close leaves its join alone.
    const newRelay = list.connect(owned('host-b'));
    expect(logged.at(-1)).toEqual(
      expect.stringContaining('relay joined session 00000001'),
    );
    const loggedBefore = logged.length;
    oldRelay.end();
    expect(logged).toHaveLength(loggedBefore);
    expect(await newRelay.call('a', { v: 2 }, CONTEXT)).toBe(RESULT);
  });

  it('setHostSessionId_IdHeldElsewhere_ThrowsAndChangesNothing', () => {
    const { list, states, emitted } = setUp();
    const first = list.open(owned('host-a'));
    list.open(owned('host-b'));
    const stateBefore = list.state();
    const lengthsBefore = [states.length, emitted.length];

    expect(() => first.setHostSessionId('host-b')).toThrow(/host-b.*host-a/);

    expect(list.state()).toEqual(stateBefore);
    expect([states.length, emitted.length]).toEqual(lengthsBefore);
    expect(first.session.info.sessionId).toBe('host-a');
  });

  it('setHostSessionId_AfterEnd_DoesNothing', () => {
    const { list, states, emitted, logged } = setUp();
    const ownedSession = list.open(owned('host-a'));
    ownedSession.end();
    const lengthsBefore = [states.length, emitted.length, logged.length];

    ownedSession.setHostSessionId('host-b');

    expect([states.length, emitted.length, logged.length]).toEqual(
      lengthsBefore,
    );
    expect(emitted.map(([event]) => event)).not.toContain('hostSessionChanged');
    expect(ownedSession.session.info.sessionId).toBe('host-a');
  });

  it('setHostSessionId_RowClosedByUser_SendsNoStateAndMarkReaddsRowWithNewId', () => {
    const { list, states, emitted } = setUp();
    const ownedSession = list.open(owned('host-a'));
    list.closeSession(ownedSession.session.id, false);
    const sentBefore = states.length;

    ownedSession.setHostSessionId('host-b');

    expect(states).toHaveLength(sentBefore);
    expect(ownedSession.session.info.sessionId).toBe('host-b');
    expect(emitted.at(-1)).toEqual([
      'hostSessionChanged',
      ownedSession.session,
    ]);

    list.mark(ownedSession.session.id, MARK);

    expect(list.state().rows.map((row) => row.hostSessionId)).toEqual([
      'host-b',
    ]);
  });

  it('ends an owned session: its tool sessions, its row and an ended event', () => {
    const { list, states, emitted, logged } = setUp();
    const first = fakeContribution();
    const second = fakeContribution();
    list.contributeTools([tool('a')], first.start);
    list.contributeTools([tool('b')], second.start);
    const ownedSession = list.open(owned('host-1'));
    const relay = list.connect(owned('host-1'));

    ownedSession.end();

    expect(first.ends()).toBe(1);
    expect(second.ends()).toBe(1);
    expect(list.state()).toEqual({ rows: [], selectedSessionId: null });
    expect(emitted.at(-1)).toEqual(['ended', { sessionId: '00000001' }]);

    const lengthsBefore = [states.length, emitted.length, logged.length];
    ownedSession.end();
    relay.end();

    expect([states.length, emitted.length, logged.length]).toEqual(
      lengthsBefore,
    );
    expect(first.ends()).toBe(1);
    expect(second.ends()).toBe(1);
  });

  it('emits closed after the state when the user closes a row every guard allows', () => {
    const { list, emitted, calls } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    list.open(owned('host-1'));
    connectWithRow(list, info('/work/y'));

    expect(list.closeSession('00000001', false)).toBeNull();

    expect(calls.slice(-4)).toEqual([
      'rows delete 00000001',
      'rows set 00000002',
      'selection 00000002',
      'emit closed',
    ]);
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000001' }]);
    expect(contribution.ends()).toBe(0);

    list.closeSession('00000002', false);
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000002' }]);

    list.mark('00000001', MARK);
    expect(list.state().rows.map((row) => row.sessionId)).toEqual(['00000001']);
  });

  it('emits no closed for a row a guard keeps', () => {
    const { list, emitted } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    const id = connected.session.id;
    let allow = false;
    list.addCloseGuard(() => (allow ? null : 'refused'));
    const closedEvents = () => emitted.filter(([event]) => event === 'closed');

    expect(list.closeSession(id, false)).not.toBeNull();
    expect(closedEvents()).toEqual([]);

    allow = true;
    list.closeSession(id, false);
    expect(closedEvents()).toHaveLength(1);
  });

  // Each row arranges a fresh list and returns the id `closeSession` gets. A
  // close guard refusing every close shows the row's closed state is not
  // asked of the guards again.
  it.each<{ name: string; arrange: (list: SessionList) => string }>([
    {
      name: 'a row the user closed',
      arrange: (list) => {
        const { id } = connectWithRow(list, info('/work/x')).session;
        list.closeSession(id, false);
        return id;
      },
    },
    {
      name: 'a row release closed',
      arrange: (list) => {
        const { id } = connectWithRow(list, info('/work/x')).session;
        list.release(id);
        return id;
      },
    },
    {
      name: 'a connected session that never had a row',
      arrange: (list) => list.connect(info('/work/x')).session.id,
    },
    {
      name: 'an owned row the user closed',
      arrange: (list) => {
        const { id } = list.open(owned('h1')).session;
        list.closeSession(id, false);
        return id;
      },
    },
  ])(
    'closeSession_RowAlreadyClosed_ReturnsTrueAndChangesNothing: $name',
    ({ arrange }) => {
      const { list, states, emitted, logged } = setUp();
      const sessionId = arrange(list);
      list.addCloseGuard(() => 'refused');
      const lengthsBefore = [states.length, emitted.length, logged.length];

      expect(list.closeSession(sessionId, false)).toBeNull();

      expect([states.length, emitted.length, logged.length]).toEqual(
        lengthsBefore,
      );
    },
  );

  it('setTitle_ChangedTitle_StoresItNormalizedSendsStateThenEmitsOnce', () => {
    const { list, states, emitted, calls } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    const callsBefore = calls.length;

    list.setTitle(session.id, 'agent', '  Fix  login\nbug ');

    const expected = { ...NO_TITLES, agent: 'Fix login bug' };
    expect(calls.slice(callsBefore)).toEqual([
      `rows set ${session.id}`,
      'emit titleChanged',
    ]);
    expect(states.at(-1)?.rows[0].titles).toEqual(expected);
    expect(list.titles(session.id)).toEqual(expected);
    expect(emitted.at(-1)).toEqual([
      'titleChanged',
      { sessionId: session.id, titles: expected },
    ]);
  });

  it.each<{ name: string; title: string | null }>([
    { name: 'the same title', title: 'Fix login' },
    { name: 'the same title before normalizing', title: ' Fix   login ' },
  ])('setTitle_Unchanged_SendsAndEmitsNothing: $name', ({ title }) => {
    const { list, calls } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    list.setTitle(session.id, 'agent', 'Fix login');
    const callsBefore = calls.length;

    list.setTitle(session.id, 'agent', title);

    expect(calls.slice(callsBefore)).toEqual([]);
  });

  it.each<{ name: string; title: string | null }>([
    { name: 'null', title: null },
    { name: 'a title that normalizes to empty', title: ' \n ' },
  ])('setTitle_Cleared_ClearsOnlyThatSource: $name', ({ title }) => {
    const { list, emitted } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    list.setTitle(session.id, 'user', 'Mine');
    list.setTitle(session.id, 'agent', 'Theirs');

    list.setTitle(session.id, 'user', title);

    const expected = { ...NO_TITLES, agent: 'Theirs' };
    expect(list.state().rows[0].titles).toEqual(expected);
    expect(emitted.at(-1)).toEqual([
      'titleChanged',
      { sessionId: session.id, titles: expected },
    ]);
  });

  it('setTitle_UnknownOrEndedSession_LogsAndIgnores', () => {
    const { list, states, emitted, logged } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    connected.end();
    const lengthsBefore = [states.length, emitted.length];

    list.setTitle('ffffffff', 'agent', 'X');
    list.setTitle(connected.session.id, 'agent', 'X');

    expect([states.length, emitted.length]).toEqual(lengthsBefore);
    expect(logged.slice(-2)).toEqual([
      expect.stringMatching(/setTitle .*ffffffff/),
      expect.stringMatching(/setTitle .*00000001/),
    ]);
    expect(list.titles(connected.session.id)).toBeNull();
  });

  it('setTitle_RowClosedByUser_EmitsWithNoStateAndMarkBringsTheTitleBack', () => {
    const { list, states, emitted } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    list.closeSession(session.id, false);
    const sentBefore = states.length;

    list.setTitle(session.id, 'agent', 'X');

    expect(states).toHaveLength(sentBefore);
    expect(emitted.at(-1)).toEqual([
      'titleChanged',
      { sessionId: session.id, titles: { ...NO_TITLES, agent: 'X' } },
    ]);

    list.mark(session.id, MARK);

    expect(list.state().rows[0].titles.agent).toBe('X');
  });

  it('state_RowTitlesMutated_LeavesMainsTitlesAlone', () => {
    const { list } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    list.setTitle(session.id, 'agent', 'X');

    list.state().rows[0].titles.agent = 'changed';
    const titles = list.titles(session.id);
    if (titles !== null) {
      titles.user = 'changed';
    }

    expect(list.state().rows[0].titles).toEqual({ ...NO_TITLES, agent: 'X' });
    expect(list.titles(session.id)).toEqual({ ...NO_TITLES, agent: 'X' });
  });

  it.each<{
    name: string;
    title: string | null;
    maxLength: number;
    expected: string | null | Error;
  }>([
    {
      name: 'within the limit sets it',
      title: ' Mine ',
      maxLength: 40,
      expected: 'Mine',
    },
    {
      name: 'past the limit throws',
      title: 'a'.repeat(41),
      maxLength: 40,
      expected: new Error('The title is 41 characters; the limit is 40.'),
    },
    {
      name: 'the limit applies per call',
      title: 'a'.repeat(41),
      maxLength: 41,
      expected: 'a'.repeat(41),
    },
    { name: 'blank clears', title: '   ', maxLength: 40, expected: null },
    { name: 'null clears', title: null, maxLength: 40, expected: null },
  ])('setUserTitle: $name', ({ title, maxLength, expected }) => {
    const { list } = setUp();
    const { session } = connectWithRow(list, info('/work/x'));
    list.setTitle(session.id, 'user', 'Before');

    const rename = () => list.setUserTitle(session.id, title, maxLength);

    if (expected instanceof Error) {
      expect(rename).toThrow(expected.message);
      expect(list.titles(session.id)?.user).toBe('Before');
    } else {
      rename();
      expect(list.titles(session.id)?.user).toBe(expected);
    }
  });

  // Each row arranges a fresh list and returns the id `release` gets; ids
  // count up from 00000001 in connect and open order. `sent` is the state after
  // the release's last write as its row ids and selected id, empty for no write;
  // `events` and `logs` are what follows the release.
  it.each<{
    name: string;
    arrange: (list: SessionList) => string;
    sent: [string[], string | null][];
    events: [string, unknown][];
    logs: string[];
  }>([
    {
      name: 'closes when every guard allows',
      arrange: (list) => {
        list.open(owned('h1'));
        list.addCloseGuard(() => null);
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [[['00000001'], '00000001']],
      events: [['closed', { sessionId: '00000002' }]],
      logs: [],
    },
    {
      name: 'a guard keeps the row',
      arrange: (list) => {
        list.addCloseGuard(() => 'refused');
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [],
      events: [],
      logs: ['release for session 00000001 kept by a close guard'],
    },
    {
      name: 'one of two guards keeps the row',
      arrange: (list) => {
        list.addCloseGuard(() => null);
        list.addCloseGuard(() => 'refused');
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [],
      events: [],
      logs: ['release for session 00000001 kept by a close guard'],
    },
    {
      name: 'an owned session keeps its row',
      arrange: (list) => list.open(owned('h1')).session.id,
      sent: [],
      events: [],
      logs: [],
    },
    {
      name: 'a connected session with no row is silent',
      arrange: (list) => list.connect(info('/work/x')).session.id,
      sent: [],
      events: [],
      logs: [],
    },
    {
      name: 'an unknown session is silent',
      arrange: (list) => {
        connectWithRow(list, info('/work/x'));
        return 'ffffffff';
      },
      sent: [],
      events: [],
      logs: [],
    },
    {
      name: 'the selected row hands the selection to its right neighbour',
      arrange: (list) => {
        const [a] = [1, 2, 3].map(() => connectWithRow(list, info('/work/x')));
        return a.session.id;
      },
      sent: [[['00000002', '00000003'], '00000002']],
      events: [['closed', { sessionId: '00000001' }]],
      logs: [],
    },
    {
      name: 'the selected last row hands the selection to its left neighbour',
      arrange: (list) => {
        connectWithRow(list, info('/work/x'));
        const b = connectWithRow(list, info('/work/x'));
        list.activate(b.session.id);
        return b.session.id;
      },
      sent: [[['00000001'], '00000001']],
      events: [['closed', { sessionId: '00000002' }]],
      logs: [],
    },
  ])('release: $name', ({ arrange, sent, events, logs }) => {
    const { list, states, emitted, logged } = setUp();
    const sessionId = arrange(list);
    const [sentBefore, emittedBefore, loggedBefore] = [
      states.length,
      emitted.length,
      logged.length,
    ];

    list.release(sessionId);

    expect(
      states
        .slice(sentBefore)
        .slice(-1)
        .map((state) => [
          state.rows.map((row) => row.sessionId),
          state.selectedSessionId,
        ]),
    ).toEqual(sent);
    expect(emitted.slice(emittedBefore)).toEqual(events);
    expect(logged.slice(loggedBefore)).toEqual(logs);
  });

  // Each row runs its actions on a fresh list whose clock starts at 0; ids
  // count up from 00000001 in connect and open order.
  it.each<{
    name: string;
    act: (list: SessionList, clock: FakeClock) => void;
    expected: (string | null)[];
  }>([
    {
      name: 'open selecting',
      act: (list) => list.open(owned('h1')),
      expected: ['00000001'],
    },
    {
      name: 'open with select false',
      act: (list) => list.open(owned('h1'), { select: false }),
      expected: [],
    },
    {
      name: 'activate of another row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.activate('00000001');
        list.activate('00000002');
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'activate of the selected row, selected by a mark',
      act: (list) => {
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.activate('00000001');
      },
      expected: ['00000001'],
    },
    {
      name: 'mark with and without a selected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
      },
      expected: ['00000001'],
    },
    {
      name: 'close of the selected row with a neighbour',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        list.closeSession('00000001', false);
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'close of the last row, selected',
      act: (list) => {
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.closeSession('00000001', false);
      },
      expected: ['00000001', null],
    },
    {
      name: 'close of an unselected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        list.closeSession('00000002', false);
      },
      expected: ['00000001'],
    },
    {
      name: 'mark of a session whose selected row release closed, at the window',
      act: (list, clock) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        clock.time = 5_000;
        list.release('00000001');
        clock.time = 5_000 + RESELECT_WINDOW_MS;
        list.mark('00000001', MARK);
      },
      expected: ['00000001', '00000002', '00000001'],
    },
    {
      name: 'mark of a session whose selected row release closed, past the window',
      act: (list, clock) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        clock.time = 5_000;
        list.release('00000001');
        clock.time = 5_000 + RESELECT_WINDOW_MS + 1;
        list.mark('00000001', MARK);
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'mark after release of the selected row and a mark selecting another from none',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.release('00000001');
        list.mark('00000002', MARK);
        list.mark('00000001', MARK);
      },
      expected: ['00000001', null, '00000002'],
    },
    {
      name: 'mark after release of the selected row and an activate of another',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        list.mark('00000003', MARK);
        list.release('00000001');
        list.activate('00000003');
        list.mark('00000001', MARK);
      },
      expected: ['00000001', '00000002', '00000003'],
    },
    {
      name: 'mark after release of the selected row and a selecting open',
      act: (list) => {
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.release('00000001');
        list.open(owned('h1'));
        list.mark('00000001', MARK);
      },
      expected: ['00000001', null, '00000002'],
    },
    {
      name: 'mark within the window after an at-once close whose cancel hold released the selected row',
      act: (list, clock) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        list.addCloseGuard(
          () => null,
          (sessionId) => list.release(sessionId),
        );
        clock.time = 5_000;
        list.closeSession('00000001', true);
        clock.time = 5_000 + RESELECT_WINDOW_MS;
        list.mark('00000001', MARK);
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'mark after release of an unselected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001', MARK);
        list.mark('00000002', MARK);
        list.release('00000002');
        list.mark('00000002', MARK);
      },
      expected: ['00000001'],
    },
    {
      name: 'end of the selected row with a neighbour',
      act: (list) => {
        const first = list.open(owned('h1'));
        list.open(owned('h2'), { select: false });
        first.end();
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'end of the last row, selected',
      act: (list) => list.open(owned('h1')).end(),
      expected: ['00000001', null],
    },
  ])('selection_Changes_WritesOncePerChange: $name', ({ act, expected }) => {
    const { list, clock, selections } = setUp();

    act(list, clock);

    expect(selections).toEqual(expected);
  });

  it.each<{
    case: string;
    act(list: SessionList, first: OwnedSession, handle: Disposable): void;
    throwingEnds: number;
    laterEnds: number;
    rows: string[];
    ended: string[];
    toolsChanged: number;
  }>([
    {
      case: 'one session ending',
      act: (_list, first) => first.end(),
      throwingEnds: 1,
      laterEnds: 1,
      rows: ['00000002'],
      ended: ['00000001'],
      toolsChanged: 0,
    },
    {
      case: 'endAll',
      act: (list) => list.endAll(),
      throwingEnds: 2,
      laterEnds: 2,
      rows: [],
      ended: ['00000001', '00000002'],
      toolsChanged: 0,
    },
    {
      case: 'the contribution withdrawn',
      act: (_list, _first, handle) => handle.dispose(),
      throwingEnds: 2,
      laterEnds: 0,
      rows: ['00000001', '00000002'],
      ended: [],
      toolsChanged: 1,
    },
  ])(
    'a tool session end that throws skips nothing and rethrows: $case',
    ({ act, throwingEnds, laterEnds, rows, ended, toolsChanged }) => {
      const { list, emitted } = setUp();
      let thrown = 0;
      const handle = list.contributeTools([tool('throws')], () => ({
        call: async () => RESULT,
        end: () => {
          thrown++;
          throw new Error(`end failed ${thrown}`);
        },
      }));
      const later = fakeContribution();
      list.contributeTools([tool('later')], later.start);
      const first = list.open(owned('h1'));
      list.open(owned('h2'));
      const toolsChangedListener = vi.fn();
      list.onToolsChanged(toolsChangedListener);

      expect(() => act(list, first, handle)).toThrow('end failed 1');

      expect(thrown).toBe(throwingEnds);
      expect(later.ends()).toBe(laterEnds);
      expect(list.state().rows.map((row) => row.sessionId)).toEqual(rows);
      expect(
        emitted
          .filter(([event]) => event === 'ended')
          .map(([, data]) => (data as { sessionId: string }).sessionId),
      ).toEqual(ended);
      expect(toolsChangedListener).toHaveBeenCalledTimes(toolsChanged);
    },
  );

  it('endAll ends every connected and owned session once', () => {
    const { list, emitted } = setUp();
    let toolSessionEnds = 0;
    list.contributeTools([tool('ask')], () => ({
      call: async () => ({ content: [] }),
      end: () => {
        toolSessionEnds++;
      },
    }));
    const connected = list.connect(owned('host-1'));
    const opened = list.open(owned('host-2'));
    const endedIds = () =>
      emitted
        .filter(([event]) => event === 'ended')
        .map(([, data]) => (data as { sessionId: string }).sessionId);

    list.endAll();

    expect(endedIds()).toEqual([connected.session.id, opened.session.id]);
    expect(toolSessionEnds).toBe(2);
    expect(list.state().rows).toEqual([]);

    list.endAll();

    expect(endedIds()).toHaveLength(2);
  });
  // Each row connects `sessions`, gives them rows when `rowStage` says so,
  // lands each folder's lookup with its `landings` answer, an Error rejecting.
  // `sent` holds the projects of each state the landings sent.
  it.each<{
    name: string;
    sessions: SessionInfo[];
    rowStage:
      | 'at connect'
      | 'after landing'
      | 'ended before landing'
      | 'stopped before landing';
    landings: Record<string, string | null | Error>;
    projectsBeforeLanding: string[];
    sent: string[][];
    projects: string[];
    finalLabels: string[];
    logged: string[];
  }>([
    {
      name: 'two clones of one repo share a project and keep their labels',
      sessions: [
        info('/work/new-games-prototypes-2'),
        info('/work/new-games-prototypes-3'),
      ],
      rowStage: 'at connect',
      landings: {
        '/work/new-games-prototypes-2': 'new-games-prototypes',
        '/work/new-games-prototypes-3': 'new-games-prototypes',
      },
      projectsBeforeLanding: [
        'new-games-prototypes-2',
        'new-games-prototypes-3',
      ],
      sent: [
        ['new-games-prototypes', 'new-games-prototypes-3'],
        ['new-games-prototypes', 'new-games-prototypes'],
      ],
      projects: ['new-games-prototypes', 'new-games-prototypes'],
      finalLabels: ['new-games-prototypes-2', 'new-games-prototypes-3'],
      logged: [],
    },
    {
      name: 'a pending lookup shows the folder, then one more state',
      sessions: [info('/work/clone-2')],
      rowStage: 'at connect',
      landings: { '/work/clone-2': 'repo' },
      projectsBeforeLanding: ['clone-2'],
      sent: [['repo']],
      projects: ['repo'],
      finalLabels: ['clone-2'],
      logged: [],
    },
    {
      name: 'a null sends nothing',
      sessions: [info('/work/clone-2')],
      rowStage: 'at connect',
      landings: { '/work/clone-2': null },
      projectsBeforeLanding: ['clone-2'],
      sent: [],
      projects: ['clone-2'],
      finalLabels: ['clone-2'],
      logged: [],
    },
    {
      name: 'the fallback itself sends nothing',
      sessions: [info('/work/clone-2')],
      rowStage: 'at connect',
      landings: { '/work/clone-2': 'clone-2' },
      projectsBeforeLanding: ['clone-2'],
      sent: [],
      projects: ['clone-2'],
      finalLabels: ['clone-2'],
      logged: [],
    },
    {
      name: 'a rejection logs and keeps the fallback',
      sessions: [info('/work/clone-2')],
      rowStage: 'at connect',
      landings: { '/work/clone-2': new Error('git cannot start') },
      projectsBeforeLanding: ['clone-2'],
      sent: [],
      projects: ['clone-2'],
      finalLabels: ['clone-2'],
      logged: ['project of /work/clone-2 not read: git cannot start'],
    },
    {
      name: 'no folder asks nothing and takes the no-folder label',
      sessions: [info(null), info(null, 'codex')],
      rowStage: 'at connect',
      landings: {},
      projectsBeforeLanding: ['session', 'Codex session'],
      sent: [],
      projects: ['session', 'Codex session'],
      finalLabels: ['session', 'Codex session'],
      logged: [],
    },
    {
      name: 'a session that ended first sends nothing',
      sessions: [info('/work/clone-2')],
      rowStage: 'ended before landing',
      landings: { '/work/clone-2': 'repo' },
      projectsBeforeLanding: ['clone-2'],
      sent: [],
      projects: [],
      finalLabels: [],
      logged: [],
    },
    {
      name: 'a lookup landing after the stop sends nothing and keeps the fallback',
      sessions: [info('/work/clone-2')],
      rowStage: 'stopped before landing',
      landings: { '/work/clone-2': 'repo' },
      projectsBeforeLanding: ['clone-2'],
      sent: [],
      projects: ['clone-2'],
      finalLabels: ['clone-2'],
      logged: [],
    },
    {
      name: 'a session with no row sends nothing, and its later row carries it',
      sessions: [info('/work/clone-2')],
      rowStage: 'after landing',
      landings: { '/work/clone-2': 'repo' },
      projectsBeforeLanding: [],
      sent: [],
      projects: ['repo'],
      finalLabels: ['clone-2'],
      logged: [],
    },
  ])(
    'rowProjectFollowsTheLookup: $name',
    async ({
      sessions,
      rowStage,
      landings,
      projectsBeforeLanding,
      sent,
      projects,
      finalLabels,
      logged: expectedLogged,
    }) => {
      const lookups = new Map<string, Deferred<string | null>>();
      const { list, states, logged } = setUp((projectDir) => {
        const lookup = deferred<string | null>();
        lookups.set(projectDir, lookup);
        return lookup.promise;
      });
      const connected = sessions.map((session) => list.connect(session));
      if (rowStage !== 'after landing') {
        connected.forEach(({ session }) => list.mark(session.id, MARK));
      }
      expect(rowProjects(list.state())).toEqual(projectsBeforeLanding);
      if (rowStage === 'ended before landing') {
        connected.forEach((session) => session.end());
      }
      if (rowStage === 'stopped before landing') {
        list.stop();
      }
      expect([...lookups.keys()]).toEqual(Object.keys(landings));
      const statesBeforeLanding = states.length;

      for (const [projectDir, lookup] of lookups) {
        const answer = landings[projectDir];
        if (answer instanceof Error) {
          lookup.reject(answer);
        } else {
          lookup.resolve(answer);
        }
      }
      await new Promise((settle) => setImmediate(settle));

      expect(states.slice(statesBeforeLanding).map(rowProjects)).toEqual(sent);
      if (rowStage === 'after landing') {
        connected.forEach(({ session }) => list.mark(session.id, MARK));
      }
      expect(rowProjects(list.state())).toEqual(projects);
      expect(labels(list.state())).toEqual(finalLabels);
      expect(logged).toEqual(expectedLogged);
    },
  );
});

describe("a connected session's harness name", () => {
  const NO_PROJECT = async () => null;

  it('mark_ConnectedSession_TitlesTheRowWithItsHarnessName', async () => {
    const { list, states } = setUp(NO_PROJECT, async () => 'tournaments-wip');
    const { session } = list.connect(info('/work/x'));

    list.mark(session.id, MARK);
    await vi.waitFor(() =>
      expect(states.at(-1)?.rows[0].titles.firstMessage).toBe(
        'tournaments-wip',
      ),
    );
  });

  it('mark_NameChangedSinceLastForm_TakesTheNewName', async () => {
    let name = 'first name';
    const { list } = setUp(NO_PROJECT, async () => name);
    const { session } = list.connect(info('/work/x'));

    list.mark(session.id, MARK);
    await vi.waitFor(() =>
      expect(list.titles(session.id)?.firstMessage).toBe('first name'),
    );
    name = 'renamed';
    list.mark(session.id, MARK);
    await vi.waitFor(() =>
      expect(list.titles(session.id)?.firstMessage).toBe('renamed'),
    );
  });

  it('mark_NameBesideAgentTitle_KeepsTheAgentTitleSet', async () => {
    const { list } = setUp(NO_PROJECT, async () => 'cli name');
    const { session } = list.connect(info('/work/x'));
    list.setTitle(session.id, 'agent', 'Agent Heading');

    list.mark(session.id, MARK);
    await vi.waitFor(() =>
      expect(list.titles(session.id)).toEqual({
        user: null,
        agent: 'Agent Heading',
        firstMessage: 'cli name',
      }),
    );
  });

  it('open_OwnedSession_NeverAsksItsHarnessName', () => {
    const hostSessionName = vi.fn(async () => 'cli name');
    const { list } = setUp(NO_PROJECT, hostSessionName);
    const { session } = list.open(owned('host-1'));

    list.mark(session.id, MARK);
    list.activate(session.id);

    expect(hostSessionName).not.toHaveBeenCalled();
  });

  it('mark_ReadRejects_LogsAndKeepsTheRowUntitled', async () => {
    const { list, logged } = setUp(NO_PROJECT, async () => {
      throw new Error('no transcript');
    });
    const { session } = list.connect(info('/work/x'));

    list.mark(session.id, MARK);
    await vi.waitFor(() =>
      expect(logged).toContainEqual(expect.stringContaining('no transcript')),
    );
    expect(list.titles(session.id)?.firstMessage).toBeNull();
  });

  it('mark_SessionEndsBeforeTheNameLands_ChangesNothing', async () => {
    let land: (name: string) => void = () => undefined;
    const { list, logged } = setUp(
      NO_PROJECT,
      () => new Promise((resolve) => (land = resolve)),
    );
    const connected = list.connect(info('/work/x'));

    list.mark(connected.session.id, MARK);
    connected.end();
    land('late');
    await Promise.resolve();
    await Promise.resolve();

    expect(logged.filter((line) => line.includes('setTitle'))).toEqual([]);
  });
});
