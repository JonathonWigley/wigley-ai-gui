import { describe, expect, it } from 'vitest';
import type {
  AgentSession,
  SessionInfo,
  SessionsState,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';
import { createSessionList } from './session-list';

const RESULT: ToolResult = { content: [{ type: 'text', text: 'done' }] };

function info(projectDir: string | null): SessionInfo {
  return { sessionId: null, projectDir, deadlineSeconds: null };
}

function tool(name: string): ToolDefinition {
  return { name, description: `${name} tool`, inputSchema: {} };
}

function setUp() {
  let hexCount = 0;
  const emitted: [string, unknown][] = [];
  const states: SessionsState[] = [];
  const logged: string[] = [];
  const list = createSessionList({
    randomHex: () => {
      hexCount++;
      return hexCount.toString(16).padStart(8, '0');
    },
    log: (source, message) => logged.push(`[${source}] ${message}`),
    emit: (event, data) => emitted.push([event, data]),
    stateChanged: (state) => states.push(state),
  });
  return { list, emitted, states, logged };
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
  return state.tabs.map((tab) => tab.label);
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

  it('lists contributed tools in contribution order', () => {
    const { list } = setUp();
    list.contributeTools([tool('a'), tool('b')], fakeContribution().start);
    list.contributeTools([tool('c')], fakeContribution().start);

    expect(list.tools().map((each) => each.name)).toEqual(['a', 'b', 'c']);
  });

  it('numbers sessions of one folder by the lowest free number', () => {
    const { list } = setUp();
    const a = list.connect(info('/work/x'));
    const b = list.connect(info('/work/x'));
    const c = list.connect(info('/work/x'));
    for (const connected of [a, b, c]) {
      list.showTab(connected.session.id);
    }
    expect(labels(list.state())).toEqual(['x', 'x 2', 'x 3']);

    b.end();
    const d = list.connect(info('/work/x'));
    list.showTab(d.session.id);

    expect(labels(list.state())).toEqual(['x', 'x 3', 'x 2']);
  });

  it('numbers two folders with one name as one group', () => {
    const { list } = setUp();
    const first = list.connect(info('/a/x'));
    const second = list.connect(info('/b/x'));

    list.showTab(first.session.id);
    list.showTab(second.session.id);

    expect(labels(list.state())).toEqual(['x', 'x 2']);
  });

  it('labels a session with no project folder session', () => {
    const { list } = setUp();
    const first = list.connect(info(null));
    const second = list.connect(info(null));

    list.showTab(first.session.id);
    list.showTab(second.session.id);

    expect(labels(list.state())).toEqual(['session', 'session 2']);
  });

  it('shows the first tab active and later tabs marked', () => {
    const { list } = setUp();
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));

    list.showTab(first.session.id);
    list.showTab(second.session.id);

    expect(list.state()).toEqual({
      tabs: [
        { sessionId: '00000001', label: 'x', marked: false },
        { sessionId: '00000002', label: 'x 2', marked: true },
      ],
      activeSessionId: '00000001',
    });
  });

  it('marks a background tab when it is shown again and leaves the active tab alone', () => {
    const { list, states } = setUp();
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    list.showTab(first.session.id);
    list.showTab(second.session.id);
    list.activate(second.session.id);
    list.activate(first.session.id);
    const sentBefore = states.length;

    list.showTab(first.session.id);
    expect(states).toHaveLength(sentBefore);

    list.showTab(second.session.id);
    expect(list.state().tabs[1]).toEqual({
      sessionId: '00000002',
      label: 'x 2',
      marked: true,
    });
  });

  it('activates a tab and clears its mark', () => {
    const { list } = setUp();
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    list.showTab(first.session.id);
    list.showTab(second.session.id);

    list.activate(second.session.id);

    expect(list.state().activeSessionId).toBe('00000002');
    expect(list.state().tabs[1].marked).toBe(false);
  });

  it('moves to the right neighbour, else the left, when the active tab closes', () => {
    const { list } = setUp();
    const [a, b, c] = [1, 2, 3].map(() => list.connect(info('/work/x')));
    for (const connected of [a, b, c]) {
      list.showTab(connected.session.id);
    }

    list.closeTab(a.session.id);
    expect(list.state().activeSessionId).toBe(b.session.id);
    expect(list.state().tabs[0].marked).toBe(false);

    list.activate(c.session.id);
    list.closeTab(c.session.id);
    expect(list.state().activeSessionId).toBe(b.session.id);

    list.closeTab(b.session.id);
    expect(list.state()).toEqual({ tabs: [], activeSessionId: null });
  });

  it('keeps a session connected after its tab closes and brings the tab back at the end', async () => {
    const { list } = setUp();
    const contribution = fakeContribution();
    list.contributeTools([tool('a')], contribution.start);
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    list.showTab(first.session.id);
    list.showTab(second.session.id);

    list.closeTab(first.session.id);
    list.showTab(first.session.id);
    await first.call(
      'a',
      {},
      {
        toolUseId: null,
        signal: new AbortController().signal,
      },
    );

    expect(list.state().tabs.map((tab) => tab.sessionId)).toEqual([
      second.session.id,
      first.session.id,
    ]);
    expect(contribution.calls.map((call) => call.name)).toEqual(['a']);
  });

  it('ends tool sessions, drops the tab and emits ended when a session ends', () => {
    const { list, emitted, states } = setUp();
    const firstContribution = fakeContribution();
    const secondContribution = fakeContribution();
    list.contributeTools([tool('a')], firstContribution.start);
    list.contributeTools([tool('b')], secondContribution.start);
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    list.showTab(first.session.id);
    list.showTab(second.session.id);

    first.end();

    expect(firstContribution.ends()).toBe(1);
    expect(secondContribution.ends()).toBe(1);
    expect(emitted.at(-1)).toEqual(['ended', { sessionId: '00000001' }]);
    expect(list.state()).toEqual({
      tabs: [{ sessionId: '00000002', label: 'x 2', marked: false }],
      activeSessionId: '00000002',
    });

    const sentBefore = states.length;
    const emittedBefore = emitted.length;
    first.end();

    expect(firstContribution.ends()).toBe(1);
    expect(states).toHaveLength(sentBefore);
    expect(emitted).toHaveLength(emittedBefore);
  });

  it('ignores unknown sessions and tabs it does not hold, with a log line', () => {
    const { list, states, logged } = setUp();
    list.connect(info('/work/x'));

    list.showTab('ffffffff');
    list.closeTab('00000001');

    expect(logged).toEqual([
      '[sessions] showTab for unknown session ffffffff ignored',
      '[sessions] closeTab for session 00000001 with no tab ignored',
    ]);
    expect(states).toEqual([]);
  });

  it('sends the whole state on every change', () => {
    const { list, states } = setUp();
    const first = list.connect(info('/work/x'));
    const second = list.connect(info('/work/x'));
    const taken: SessionsState[] = [];
    const changes = [
      () => list.showTab(first.session.id),
      () => list.showTab(second.session.id),
      () => list.activate(second.session.id),
      () => list.closeTab(second.session.id),
      () => first.end(),
    ];

    for (const change of changes) {
      change();
      taken.push(list.state());
    }

    expect(states).toEqual(taken);
  });
});
