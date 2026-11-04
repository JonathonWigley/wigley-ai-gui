import { describe, expect, it } from 'vitest';
import type {
  AgentSession,
  ConnectedSession,
  Harness,
  SessionInfo,
  SessionsState,
  SessionTitles,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';
import { createSessionList, RESELECT_WINDOW_MS } from './session-list';

const RESULT: ToolResult = { content: [{ type: 'text', text: 'done' }] };

function info(
  projectDir: string | null,
  harness: Harness | null = null,
): SessionInfo {
  return { sessionId: null, projectDir, deadlineSeconds: null, harness };
}

function owned(hostId: string, projectDir = '/work/x'): SessionInfo {
  return {
    sessionId: hostId,
    projectDir,
    deadlineSeconds: null,
    harness: 'claude',
  };
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
) {
  let hexCount = 0;
  const emitted: [string, unknown][] = [];
  const states: SessionsState[] = [];
  const logged: string[] = [];
  const activated: string[] = [];
  // `activated <id>`, `stateChanged` and `emit <event>`, in the order the list
  // called them.
  const calls: string[] = [];
  const clock = { time: 0, now: () => clock.time };
  const list = createSessionList({
    randomHex: () => {
      hexCount++;
      return hexCount.toString(16).padStart(8, '0');
    },
    clock,
    log: (source, message) => logged.push(`[${source}] ${message}`),
    emit: (event, data) => {
      emitted.push([event, data]);
      calls.push(`emit ${event}`);
    },
    stateChanged: (state) => {
      states.push(state);
      calls.push('stateChanged');
    },
    activated: (sessionId) => {
      activated.push(sessionId);
      calls.push(`activated ${sessionId}`);
    },
    projectName,
  });
  return { list, clock, emitted, states, logged, activated, calls };
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
  list.mark(connected.session.id);
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
      ['connected', { id: '00000001', info: sessionInfo }],
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

    await expect(
      connected.call(
        'zz',
        {},
        {
          toolUseId: null,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/"zz"/);
  });

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
    expect(emitted).toEqual([['connected', connected.session]]);
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
    list.closeSession(id);
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

    list.mark(b.session.id);
    list.mark(a.session.id);

    expect(
      states.map((state) => [
        state.rows.map((row) => [row.sessionId, row.marked]),
        state.selectedSessionId,
      ]),
    ).toEqual([
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
    list.mark(a.session.id);
    list.mark(b.session.id);
    const sentBefore = states.length;
    const before = list.state();

    list.mark(a.session.id);
    list.mark(b.session.id);

    expect(states).toHaveLength(sentBefore);
    expect(list.state()).toEqual(before);
  });

  it('selects a row when the selected one closed and none is left selected', () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id);
    list.closeSession(a.session.id);
    expect(list.state().selectedSessionId).toBeNull();
    const b = list.connect(info('/work/x'));

    list.mark(b.session.id);

    expect(list.state().selectedSessionId).toBe(b.session.id);
    expect(list.state().rows.map((row) => row.marked)).toEqual([false]);
  });

  it('brings a closed row back at the end on its next round', async () => {
    const { list } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    list.mark(a.session.id);
    list.mark(b.session.id);
    list.closeSession(b.session.id);

    list.mark(b.session.id);
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
    method: 'activate' | 'activateExistingRow';
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
    {
      name: 'a marked row, by activateExistingRow',
      method: 'activateExistingRow',
      sessionId: '00000002',
      rows: [
        ['00000001', false],
        ['00000002', false],
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
        'stateChanged',
        'emit selected',
      ]);
      const { rows, selectedSessionId } = list.state();
      expect(selectedSessionId).toBe(sessionId);
      expect(rows.map((row) => [row.sessionId, row.marked])).toEqual(
        expectedRows,
      );
    },
  );

  it('reports activated for the selected row and sends nothing', () => {
    const { list, states, activated } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id);
    const sentBefore = states.length;

    list.activate(a.session.id);

    expect(activated).toEqual(['00000001']);
    expect(states).toHaveLength(sentBefore);
  });

  it('moves to the right neighbour, else the left, when the selected row closes', () => {
    const { list } = setUp();
    const [a, b, c] = [1, 2, 3].map(() => list.connect(info('/work/x')));
    for (const connected of [a, b, c]) {
      list.mark(connected.session.id);
    }

    list.closeSession(a.session.id);
    expect(list.state().selectedSessionId).toBe(b.session.id);
    expect(list.state().rows[0].marked).toBe(false);

    list.activate(c.session.id);
    list.closeSession(c.session.id);
    expect(list.state().selectedSessionId).toBe(b.session.id);

    list.closeSession(b.session.id);
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
    list.mark(first.session.id);
    list.mark(second.session.id);

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
          projectDir: '/work/x',
          hostSessionId: null,
          titles: NO_TITLES,
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

  it('keeps a row a close guard refuses, with a log line and false, until every guard allows it', () => {
    const { list, states, logged } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    const id = connected.session.id;
    let roundOpen = true;
    list.addCloseGuard(() => true);
    list.addCloseGuard((sessionId) => !(sessionId === id && roundOpen));
    const sentBefore = states.length;

    expect(list.closeSession(id)).toBe(false);

    expect(list.state().rows.map((row) => row.sessionId)).toEqual([id]);
    expect(states).toHaveLength(sentBefore);
    expect(logged).toEqual([expect.stringContaining(id)]);
    roundOpen = false;
    expect(list.closeSession(id)).toBe(true);
    expect(list.state().rows).toEqual([]);
  });

  it('drops the row of a session that ends whatever the close guards say', () => {
    const { list } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    list.addCloseGuard(() => false);

    connected.end();

    expect(list.state().rows).toEqual([]);
  });

  it('ignores unknown sessions, and activateExistingRow of a session with no row, with a log line', () => {
    const { list, states, logged, activated } = setUp();
    connectWithRow(list, info('/work/x'));
    const released = connectWithRow(list, info('/work/x')).session.id;
    list.release(released);
    const sentBefore = states.length;

    list.mark('ffffffff');
    list.activate('fffffffe');
    expect(list.closeSession('fffffffd')).toBe(false);
    list.activateExistingRow('fffffffc');
    list.activateExistingRow(released);

    expect(logged).toEqual([
      expect.stringMatching(/mark .*ffffffff/),
      expect.stringMatching(/activate .*fffffffe/),
      expect.stringMatching(/closeSession .*fffffffd/),
      expect.stringMatching(/activateExistingRow .*fffffffc/),
      expect.stringMatching(/activateExistingRow .*00000002.*no row/),
    ]);
    expect(activated).toEqual([]);
    expect(states).toHaveLength(sentBefore);
  });

  it('sends the whole state on every change', () => {
    const { list, states } = setUp();
    const taken: SessionsState[] = [];
    const connected: ConnectedSession[] = [];
    connected.push(list.connect(info('/work/x')));
    connected.push(list.connect(info('/work/x')));
    const id = (index: number) => connected[index].session.id;
    const changes = [
      () => list.mark(id(0)),
      () => list.mark(id(1)),
      () => list.activate(id(1)),
      () => list.closeSession(id(1)),
      () => list.mark(id(1)),
      () => list.release(id(1)),
      () => connected[0].end(),
    ];

    for (const change of changes) {
      change();
      taken.push(list.state());
    }

    expect(states).toEqual(taken);
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
          projectDir: '/work/x',
          hostSessionId: 'host-1',
          titles: NO_TITLES,
        },
      ],
      selectedSessionId: '00000001',
    });
    expect(states).toHaveLength(1);
    expect(emitted).toEqual([
      ['selected', { sessionId: '00000001' }],
      ['connected', { id: '00000001', info: owned('host-1') }],
    ]);
  });

  it('selects the opened row over the selected one', () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    list.mark(a.session.id);

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
    expect(emitted.at(-1)).toEqual(['connected', opened.session]);
  });

  it('open with select false and no selection stays unselected', () => {
    const { list } = setUp();

    list.open(owned('h'), { select: false });

    expect(list.selectedSessionId()).toBeNull();
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
      'stateChanged',
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
    list.closeSession(ownedSession.session.id);
    const sentBefore = states.length;

    ownedSession.setHostSessionId('host-b');

    expect(states).toHaveLength(sentBefore);
    expect(ownedSession.session.info.sessionId).toBe('host-b');
    expect(emitted.at(-1)).toEqual([
      'hostSessionChanged',
      ownedSession.session,
    ]);

    list.mark(ownedSession.session.id);

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

    expect(list.closeSession('00000001')).toBe(true);

    expect(calls.slice(-3)).toEqual([
      'stateChanged',
      'emit selected',
      'emit closed',
    ]);
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000001' }]);
    expect(contribution.ends()).toBe(0);

    list.closeSession('00000002');
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000002' }]);

    list.mark('00000001');
    expect(list.state().rows.map((row) => row.sessionId)).toEqual(['00000001']);
  });

  it('emits no closed for a row a guard keeps', () => {
    const { list, emitted } = setUp();
    const connected = connectWithRow(list, info('/work/x'));
    const id = connected.session.id;
    let allow = false;
    list.addCloseGuard(() => allow);
    const closedEvents = () => emitted.filter(([event]) => event === 'closed');

    expect(list.closeSession(id)).toBe(false);
    expect(closedEvents()).toEqual([]);

    allow = true;
    list.closeSession(id);
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
        list.closeSession(id);
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
        list.closeSession(id);
        return id;
      },
    },
  ])(
    'closeSession_RowAlreadyClosed_ReturnsTrueAndChangesNothing: $name',
    ({ arrange }) => {
      const { list, states, emitted, logged } = setUp();
      const sessionId = arrange(list);
      list.addCloseGuard(() => false);
      const lengthsBefore = [states.length, emitted.length, logged.length];

      expect(list.closeSession(sessionId)).toBe(true);

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
      'stateChanged',
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
    list.closeSession(session.id);
    const sentBefore = states.length;

    list.setTitle(session.id, 'agent', 'X');

    expect(states).toHaveLength(sentBefore);
    expect(emitted.at(-1)).toEqual([
      'titleChanged',
      { sessionId: session.id, titles: { ...NO_TITLES, agent: 'X' } },
    ]);

    list.mark(session.id);

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
  // count up from 00000001 in connect and open order. `sent` is each state
  // sent as its row ids and selected id; `events` and `logs` are what follows
  // the release.
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
        list.addCloseGuard(() => true);
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [[['00000001'], '00000001']],
      events: [['closed', { sessionId: '00000002' }]],
      logs: [],
    },
    {
      name: 'a guard keeps the row',
      arrange: (list) => {
        list.addCloseGuard(() => false);
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [],
      events: [],
      logs: ['[sessions] release for session 00000001 kept by a close guard'],
    },
    {
      name: 'one of two guards keeps the row',
      arrange: (list) => {
        list.addCloseGuard(() => true);
        list.addCloseGuard(() => false);
        return connectWithRow(list, info('/work/x')).session.id;
      },
      sent: [],
      events: [],
      logs: ['[sessions] release for session 00000001 kept by a close guard'],
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
      events: [
        ['selected', { sessionId: '00000002' }],
        ['closed', { sessionId: '00000001' }],
      ],
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
      events: [
        ['selected', { sessionId: '00000001' }],
        ['closed', { sessionId: '00000002' }],
      ],
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
        list.mark('00000001');
        list.activate('00000001');
      },
      expected: ['00000001'],
    },
    {
      name: 'mark with and without a selected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
      },
      expected: ['00000001'],
    },
    {
      name: 'close of the selected row with a neighbour',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        list.closeSession('00000001');
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'close of the last row, selected',
      act: (list) => {
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.closeSession('00000001');
      },
      expected: ['00000001', null],
    },
    {
      name: 'close of an unselected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        list.closeSession('00000002');
      },
      expected: ['00000001'],
    },
    {
      name: 'mark of a session whose selected row release closed, at the window',
      act: (list, clock) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        clock.time = 5_000;
        list.release('00000001');
        clock.time = 5_000 + RESELECT_WINDOW_MS;
        list.mark('00000001');
      },
      expected: ['00000001', '00000002', '00000001'],
    },
    {
      name: 'mark of a session whose selected row release closed, past the window',
      act: (list, clock) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        clock.time = 5_000;
        list.release('00000001');
        clock.time = 5_000 + RESELECT_WINDOW_MS + 1;
        list.mark('00000001');
      },
      expected: ['00000001', '00000002'],
    },
    {
      name: 'mark after release of the selected row and a mark selecting another from none',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.release('00000001');
        list.mark('00000002');
        list.mark('00000001');
      },
      expected: ['00000001', null, '00000002'],
    },
    {
      name: 'mark after release of the selected row and an activate of another',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        list.mark('00000003');
        list.release('00000001');
        list.activate('00000003');
        list.mark('00000001');
      },
      expected: ['00000001', '00000002', '00000003'],
    },
    {
      name: 'mark after release of the selected row and a selecting open',
      act: (list) => {
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.release('00000001');
        list.open(owned('h1'));
        list.mark('00000001');
      },
      expected: ['00000001', null, '00000002'],
    },
    {
      name: 'mark after release of an unselected row',
      act: (list) => {
        list.connect(info('/work/x'));
        list.connect(info('/work/x'));
        list.mark('00000001');
        list.mark('00000002');
        list.release('00000002');
        list.mark('00000002');
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
  ])(
    'selected_SelectionChanges_EmitsOncePerChange: $name',
    ({ act, expected }) => {
      const { list, clock, emitted } = setUp();

      act(list, clock);

      expect(
        emitted
          .filter(([event]) => event === 'selected')
          .map(([, data]) => (data as { sessionId: string | null }).sessionId),
      ).toEqual(expected);
    },
  );

  // Each row connects `sessions`, gives them rows when `rowStage` says so,
  // lands each folder's lookup with its `landings` answer, an Error rejecting.
  // `sent` holds the projects of each state the landings sent.
  it.each<{
    name: string;
    sessions: SessionInfo[];
    rowStage: 'at connect' | 'after landing' | 'ended before landing';
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
      logged: ['[sessions] project of /work/clone-2 not read: git cannot start'],
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
        connected.forEach(({ session }) => list.mark(session.id));
      }
      expect(rowProjects(list.state())).toEqual(projectsBeforeLanding);
      if (rowStage === 'ended before landing') {
        connected.forEach((session) => session.end());
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
        connected.forEach(({ session }) => list.mark(session.id));
      }
      expect(rowProjects(list.state())).toEqual(projects);
      expect(labels(list.state())).toEqual(finalLabels);
      expect(logged).toEqual(expectedLogged);
    },
  );
});
