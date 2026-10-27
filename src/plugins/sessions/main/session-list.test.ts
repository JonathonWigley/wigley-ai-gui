import { describe, expect, it } from 'vitest';
import type {
  AgentSession,
  ConnectedSession,
  Harness,
  SessionInfo,
  SessionsState,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';
import { createSessionList } from './session-list';

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

function tool(name: string): ToolDefinition {
  return { name, description: `${name} tool`, inputSchema: {} };
}

function setUp() {
  let hexCount = 0;
  const emitted: [string, unknown][] = [];
  const states: SessionsState[] = [];
  const logged: string[] = [];
  const activated: string[] = [];
  // `activated <id>`, `stateChanged` and `emit <event>`, in the order the list
  // called them.
  const calls: string[] = [];
  const list = createSessionList({
    randomHex: () => {
      hexCount++;
      return hexCount.toString(16).padStart(8, '0');
    },
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
  });
  return { list, emitted, states, logged, activated, calls };
}

// A contribution's start: records each session it starts for, and each tool
// session records its calls and counts its ends.
function fakeContribution() {
  const started: AgentSession[] = [];
  const calls: { name: string; args: unknown; context: ToolCallContext }[] = [];
  let ends = 0;
  const start = (session: AgentSession): ToolSession => {
    started.push(session);
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
  return { start, started, calls, ends: () => ends };
}

function labels(state: SessionsState): string[] {
  return state.rows.map((row) => row.label);
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
    ).rejects.toThrow('No plugin contributed the tool "zz"');
  });

  it('throws on a tool name two contributions share', () => {
    const { list } = setUp();
    list.contributeTools([tool('a')], fakeContribution().start);

    expect(() =>
      list.contributeTools([tool('a')], fakeContribution().start),
    ).toThrow('Two tool contributions both name the tool "a"');
  });

  it('throws on a tool name one contribution lists twice', () => {
    const { list } = setUp();
    list.contributeTools([tool('x')], fakeContribution().start);

    expect(() =>
      list.contributeTools([tool('a'), tool('a')], fakeContribution().start),
    ).toThrow('One tool contribution names the tool "a" twice');
    expect(list.tools().map((each) => each.name)).toEqual(['x']);
  });

  it('lists contributed tools in contribution order', () => {
    const { list } = setUp();
    list.contributeTools([tool('a'), tool('b')], fakeContribution().start);
    list.contributeTools([tool('c')], fakeContribution().start);

    expect(list.tools().map((each) => each.name)).toEqual(['a', 'b', 'c']);
  });

  it('adds an unselected, unmarked row for each connected session', () => {
    const { list, states } = setUp();

    list.connect(info('/work/x'));
    list.connect(info('/work/x'));

    const expected: SessionsState = {
      rows: [
        {
          sessionId: '00000001',
          label: 'x',
          harness: null,
          marked: false,
          projectDir: '/work/x',
          hostSessionId: null,
        },
        {
          sessionId: '00000002',
          label: 'x 2',
          harness: null,
          marked: false,
          projectDir: '/work/x',
          hostSessionId: null,
        },
      ],
      selectedSessionId: null,
    };
    expect(list.state()).toEqual(expected);
    expect(states).toHaveLength(2);
    expect(states[1]).toEqual(expected);
  });

  it('numbers sessions of one folder by the lowest free number', () => {
    const { list } = setUp();
    list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    list.connect(info('/work/x'));
    expect(labels(list.state())).toEqual(['x', 'x 2', 'x 3']);

    b.end();
    list.connect(info('/work/x'));

    expect(labels(list.state())).toEqual(['x', 'x 3', 'x 2']);
  });

  it('numbers two folders with one name as one group', () => {
    const { list } = setUp();

    list.connect(info('/a/x'));
    list.connect(info('/b/x'));

    expect(labels(list.state())).toEqual(['x', 'x 2']);
  });

  it('labels a session with no project folder session', () => {
    const { list } = setUp();

    list.connect(info(null));
    list.connect(info(null));

    expect(labels(list.state())).toEqual(['session', 'session 2']);
  });

  it('labels a codex session with no project folder Codex session', () => {
    const { list } = setUp();

    list.connect(info(null, 'codex'));
    list.connect(info(null, 'codex'));
    list.connect(info(null, 'claude'));

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

  it("selects the round's row when none is selected and marks a later one", () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));

    list.mark(a.session.id);
    list.mark(b.session.id);

    const { rows, selectedSessionId } = list.state();
    expect(selectedSessionId).toBe(a.session.id);
    expect(rows.map((row) => row.marked)).toEqual([false, true]);
  });

  it("selects the second session's row when its round arrives first", () => {
    const { list } = setUp();
    list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));

    list.mark(b.session.id);

    const { rows, selectedSessionId } = list.state();
    expect(selectedSessionId).toBe(b.session.id);
    expect(rows.map((row) => row.marked)).toEqual([false, false]);
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

  it('activates a row, clears its mark and reports activated first', () => {
    const { list, activated, calls } = setUp();
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    list.mark(a.session.id);
    list.mark(b.session.id);
    const callsBefore = calls.length;

    list.activate(b.session.id);

    expect(activated).toEqual(['00000002']);
    expect(calls.slice(callsBefore)).toEqual([
      'activated 00000002',
      'stateChanged',
    ]);
    expect(list.state().selectedSessionId).toBe('00000002');
    expect(list.state().rows[1].marked).toBe(false);
  });

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
          harness: null,
          marked: false,
          projectDir: '/work/x',
          hostSessionId: null,
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
    const connected = list.connect(info('/work/x'));
    const id = connected.session.id;
    let roundOpen = true;
    list.addCloseGuard(() => true);
    list.addCloseGuard((sessionId) => !(sessionId === id && roundOpen));
    const sentBefore = states.length;

    expect(list.closeSession(id)).toBe(false);

    expect(list.state().rows.map((row) => row.sessionId)).toEqual([id]);
    expect(states).toHaveLength(sentBefore);
    expect(logged).toEqual([
      `[sessions] closeSession for session ${id} kept by a close guard`,
    ]);
    roundOpen = false;
    expect(list.closeSession(id)).toBe(true);
    expect(list.state().rows).toEqual([]);
  });

  it('drops the row of a session that ends whatever the close guards say', () => {
    const { list } = setUp();
    const connected = list.connect(info('/work/x'));
    list.addCloseGuard(() => false);

    connected.end();

    expect(list.state().rows).toEqual([]);
  });

  it('ignores unknown sessions and rows it does not hold, with a log line', () => {
    const { list, states, logged, activated } = setUp();
    const connected = list.connect(info('/work/x'));
    list.closeSession(connected.session.id);
    const sentBefore = states.length;

    list.mark('ffffffff');
    list.activate(connected.session.id);
    expect(list.closeSession(connected.session.id)).toBe(false);

    expect(logged).toEqual([
      '[sessions] mark for unknown session ffffffff ignored',
      '[sessions] activate for session 00000001 with no row ignored',
      '[sessions] closeSession for session 00000001 with no row ignored',
    ]);
    expect(activated).toEqual([]);
    expect(states).toHaveLength(sentBefore);
  });

  it('sends the whole state on every change', () => {
    const { list, states } = setUp();
    const taken: SessionsState[] = [];
    const connected: ConnectedSession[] = [];
    const id = (index: number) => connected[index].session.id;
    const changes = [
      () => connected.push(list.connect(info('/work/x'))),
      () => connected.push(list.connect(info('/work/x'))),
      () => list.mark(id(0)),
      () => list.mark(id(1)),
      () => list.activate(id(1)),
      () => list.closeSession(id(1)),
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
          harness: 'claude',
          marked: false,
          projectDir: '/work/x',
          hostSessionId: 'host-1',
        },
      ],
      selectedSessionId: '00000001',
    });
    expect(states).toHaveLength(1);
    expect(emitted).toEqual([
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

    expect(() => list.open({ ...owned('h'), sessionId: null })).toThrow(
      'open needs a host session id',
    );
    expect(states).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('throws opening a host id already open, owned or connected', () => {
    const { list } = setUp();
    list.open(owned('host-1'));

    expect(() => list.open(owned('host-1'))).toThrow(
      'Host session host-1 is already open',
    );
    list.connect(owned('host-2'));
    expect(() => list.open(owned('host-2'))).toThrow(
      'Host session host-2 is already open',
    );
    expect(list.state().rows).toHaveLength(2);
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
    expect(logged).toEqual(['[sessions] relay joined session 00000001']);
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
    expect(logged.at(-1)).toBe('[sessions] relay left session 00000001');

    const next = list.connect(owned('host-1'));
    expect(next.session).toBe(ownedSession.session);
    expect(list.state().rows).toHaveLength(1);

    // The first relay's handle has already left: a second end must not clear
    // the join `next` holds.
    const loggedBefore = logged.length;
    connected.end();
    expect(logged).toHaveLength(loggedBefore);
    next.end();
    expect(logged.at(-1)).toBe('[sessions] relay left session 00000001');
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
    expect(logged.at(-1)).toBe(
      '[sessions] newer relay took over session 00000001',
    );

    // The older socket's close comes late and leaves the newer join alone.
    const loggedBefore = logged.length;
    older.end();
    expect(logged).toHaveLength(loggedBefore);
    expect(await newer.call('a', { v: 1 }, CONTEXT)).toBe(RESULT);

    newer.end();
    expect(logged.at(-1)).toBe('[sessions] relay left session 00000001');
    expect(contribution.ends()).toBe(0);
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
    list.connect(info('/work/y'));

    expect(list.closeSession('00000001')).toBe(true);

    expect(calls.slice(-2)).toEqual(['stateChanged', 'emit closed']);
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000001' }]);
    expect(contribution.ends()).toBe(0);

    list.closeSession('00000002');
    expect(emitted.at(-1)).toEqual(['closed', { sessionId: '00000002' }]);

    list.mark('00000001');
    expect(list.state().rows.map((row) => row.sessionId)).toEqual(['00000001']);
  });

  it('emits no closed for a row a guard keeps or a row already gone', () => {
    const { list, emitted } = setUp();
    const connected = list.connect(info('/work/x'));
    const id = connected.session.id;
    let allow = false;
    list.addCloseGuard(() => allow);
    const closedEvents = () => emitted.filter(([event]) => event === 'closed');

    expect(list.closeSession(id)).toBe(false);
    expect(closedEvents()).toEqual([]);

    allow = true;
    list.closeSession(id);
    expect(list.closeSession(id)).toBe(false);
    expect(closedEvents()).toHaveLength(1);
  });

  it('reads the selected session id', () => {
    const { list } = setUp();
    expect(list.selectedSessionId()).toBeNull();

    list.open(owned('host-1'));
    expect(list.selectedSessionId()).toBe('00000001');

    list.connect(info('/work/x'));
    list.activate('00000002');
    expect(list.selectedSessionId()).toBe('00000002');
  });
});
