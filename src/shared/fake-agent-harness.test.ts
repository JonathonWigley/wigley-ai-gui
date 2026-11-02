import { describe, expect, it } from 'vitest';
import {
  MAIN_AGENT_ID,
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  type ChatEntry,
  type LogInEvents,
} from '../contracts/agent';
import {
  createFakeAgentHarness,
  FAKE_AGENTS_TEXT,
  FAKE_END_TEXT,
  FAKE_HISTORY_IMAGES,
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_SIGN_IN_CODE,
  FAKE_SIGN_IN_URL,
  FAKE_STEPS_TEXT,
  FAKE_TOOL_TEXT,
  fakePlanRowUpdate,
  fakePlanUsage,
  fakeUsageEvent,
  isFakeAgentHarness,
} from './fake-agent-harness';

const clock = { now: () => 1000 };

const request: AgentStart = {
  sessionId: 's-1',
  resume: false,
  projectDir: '/p',
  profileDir: null,
  controls: {},
};

// Every event the process emits, as `[event name, payload]`, in emit order,
// except the agent events other than `usage`, which `agentEvents` holds.
// `timeline` holds every event, those included, in emit order.
function recordingEvents() {
  const heard: [string, unknown][] = [];
  const agentEvents: AgentEvent[] = [];
  const timeline: [string, unknown][] = [];
  const hear = (name: string, payload: unknown) => {
    heard.push([name, payload]);
    timeline.push([name, payload]);
  };
  const events: AgentProcessEvents = {
    entry: (entry) => hear('entry', entry),
    controls: (controls) => hear('controls', controls),
    activity: (activity) => hear('activity', activity),
    commands: (names) => hear('commands', names),
    planUsage: (update) => hear('planUsage', update),
    agentEvent: (event) => {
      if (event.type === 'usage') {
        hear('agentEvent', event);
        return;
      }
      agentEvents.push(event);
      timeline.push(['agentEvent', event]);
    },
    ended: (end) => hear('ended', end),
  };
  return { heard, agentEvents, timeline, events };
}

// One timeline event as a line: an entry as its kind, id and tool result text,
// an agent event as its type, agent id and outcome, any other as its name and,
// for activity, its value.
function timelineLine([name, payload]: [string, unknown]): string {
  if (name === 'entry') {
    const entry = payload as ChatEntry;
    const resultText = entry.kind === 'tool' ? entry.result?.text : undefined;
    return [entry.kind, entry.id, resultText].filter(Boolean).join(' ');
  }
  if (name === 'agentEvent') {
    const event = payload as AgentEvent;
    const agentId = 'agentId' in event ? event.agentId : undefined;
    const outcome = 'outcome' in event ? event.outcome : undefined;
    return [event.type, agentId, outcome].filter(Boolean).join(' ');
  }
  return name === 'activity' ? `activity ${String(payload)}` : name;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// A started process with its start events flushed and cleared.
async function startedProcess() {
  const harness = createFakeAgentHarness(clock);
  const { heard, agentEvents, timeline, events } = recordingEvents();
  const agent = harness.start(request, events);
  await flush();
  heard.length = 0;
  agentEvents.length = 0;
  timeline.length = 0;
  return {
    harness,
    agent,
    heard,
    agentEvents,
    timeline,
    record: harness.processes[0],
  };
}

describe('createFakeAgentHarness', () => {
  it('start_RecordsRequestAndEvents_ThenControlsCommandsIdle', async () => {
    const harness = createFakeAgentHarness(clock);
    const { heard, events } = recordingEvents();

    harness.start(request, events);
    expect(heard).toEqual([]);
    await flush();

    expect(harness.processes[0].request).toBe(request);
    expect(harness.processes[0].events).toBe(events);
    expect(heard.map(([name]) => name)).toEqual([
      'controls',
      'commands',
      'activity',
    ]);
    const controls = heard[0][1] as Parameters<
      AgentProcessEvents['controls']
    >[0];
    expect(controls.map((control) => control.id)).toEqual([
      'mode',
      'effort',
      'model',
      'verbosity',
    ]);
    expect(heard[2]).toEqual(['activity', 'idle']);
  });

  it('start_RequestControls_ReplaceStartingValues', async () => {
    const harness = createFakeAgentHarness(clock);
    const { heard, events } = recordingEvents();

    harness.start({ ...request, controls: { effort: 'high' } }, events);
    await flush();

    const controls = heard[0][1] as Parameters<
      AgentProcessEvents['controls']
    >[0];
    expect(controls.map((control) => [control.id, control.value])).toEqual([
      ['mode', 'auto'],
      ['effort', 'high'],
      ['model', 'fake-small'],
      ['verbosity', 'brief'],
    ]);
  });

  it('failNextStart_ThrowsOnce', () => {
    const harness = createFakeAgentHarness(clock);
    harness.failNextStart('no claude');

    expect(() => harness.start(request, recordingEvents().events)).toThrow(
      'no claude',
    );
    expect(harness.processes).toHaveLength(0);
    harness.start(request, recordingEvents().events);
    expect(harness.processes).toHaveLength(1);
  });

  it('send_PlainText_StreamsReplyThenResult', async () => {
    const { agent, heard, record } = await startedProcess();

    agent.send({ text: 'hi', images: [] });
    await flush();

    expect(heard).toEqual([
      [
        'entry',
        {
          kind: 'user',
          id: 'user-1',
          at: 1000,
          text: 'hi',
          images: [],
          raw: [{ fake: 'user', text: 'hi' }],
        },
      ],
      ['activity', 'working'],
      [
        'entry',
        {
          kind: 'assistant',
          id: 'assistant-1',
          at: 1000,
          text: 'fake agent heard: ',
          streaming: true,
          raw: [{ fake: 'assistant', text: 'fake agent heard: ' }],
        },
      ],
      [
        'entry',
        {
          kind: 'assistant',
          id: 'assistant-1',
          at: 1000,
          text: 'fake agent heard: hi',
          streaming: false,
          raw: [
            { fake: 'assistant', text: 'fake agent heard: ' },
            { fake: 'assistant', text: 'hi' },
          ],
        },
      ],
      [
        'entry',
        {
          kind: 'result',
          id: 'result-1',
          at: 1000,
          stopReason: 'end_turn',
          costUsd: null,
          durationMs: null,
          raw: [{ fake: 'result' }],
        },
      ],
      ['agentEvent', fakeUsageEvent(1, 1000)],
      ['planUsage', fakePlanRowUpdate(1, 1000)],
      ['activity', 'idle'],
    ]);
    expect(record.calls).toEqual([
      { method: 'send', text: 'hi', imageCount: 0 },
    ]);
  });

  it('send_ToolText_EmitsToolWithResult', async () => {
    const { agent, heard } = await startedProcess();

    agent.send({ text: FAKE_TOOL_TEXT, images: [] });
    await flush();

    const tool = {
      kind: 'tool',
      id: 'tool-1',
      at: 1000,
      toolUseId: 'fake-tool-1',
      name: 'Bash',
      input: { command: 'echo fake' },
      summary: 'echo fake',
    };
    expect(heard.slice(2)).toEqual([
      ['entry', { ...tool, result: null, raw: [{ fake: 'tool' }] }],
      [
        'entry',
        {
          ...tool,
          result: { text: 'fake', isError: false },
          raw: [{ fake: 'tool' }, { fake: 'tool-result' }],
        },
      ],
      [
        'entry',
        {
          kind: 'assistant',
          id: 'assistant-1',
          at: 1000,
          text: 'fake agent ran a tool',
          streaming: false,
          raw: [{ fake: 'assistant', text: 'fake agent ran a tool' }],
        },
      ],
      [
        'entry',
        {
          kind: 'result',
          id: 'result-1',
          at: 1000,
          stopReason: 'end_turn',
          costUsd: null,
          durationMs: null,
          raw: [{ fake: 'result' }],
        },
      ],
      ['agentEvent', fakeUsageEvent(1, 1000)],
      ['planUsage', fakePlanRowUpdate(1, 1000)],
      ['activity', 'idle'],
    ]);
    expect(heard.slice(0, 2)).toEqual([
      [
        'entry',
        {
          kind: 'user',
          id: 'user-1',
          at: 1000,
          text: FAKE_TOOL_TEXT,
          images: [],
          raw: [{ fake: 'user', text: FAKE_TOOL_TEXT }],
        },
      ],
      ['activity', 'working'],
    ]);
  });

  it('send_HoldText_HoldsTurnOpen', async () => {
    const { agent, heard } = await startedProcess();

    agent.send({ text: FAKE_HOLD_TEXT, images: [] });
    await flush();

    expect(heard).toEqual([
      [
        'entry',
        {
          kind: 'user',
          id: 'user-1',
          at: 1000,
          text: FAKE_HOLD_TEXT,
          images: [],
          raw: [{ fake: 'user', text: FAKE_HOLD_TEXT }],
        },
      ],
      ['activity', 'working'],
    ]);
  });

  it('interrupt_HeldTurn_EndsWithNotice', async () => {
    const { agent, heard, record } = await startedProcess();
    agent.send({ text: FAKE_HOLD_TEXT, images: [] });
    await flush();
    heard.length = 0;

    agent.interrupt();
    await flush();

    expect(heard).toEqual([
      [
        'entry',
        {
          kind: 'notice',
          id: 'notice-1',
          at: 1000,
          text: 'Interrupted',
          tone: 'info',
          raw: [{ fake: 'interrupt' }],
        },
      ],
      ['activity', 'idle'],
    ]);
    expect(record.calls.at(-1)).toEqual({ method: 'interrupt' });
  });

  it('send_StepsText_EmitsStepsAndHoldsTurnOpen', async () => {
    const { agent, heard, agentEvents } = await startedProcess();

    agent.send({ text: FAKE_STEPS_TEXT, images: [] });
    await flush();

    // Each event as `[kind, id]` for an entry, `[event name, payload]` else.
    expect(
      heard.map(([name, payload]) =>
        name === 'entry'
          ? [(payload as ChatEntry).kind, (payload as ChatEntry).id]
          : [name, payload],
      ),
    ).toEqual([
      ['user', 'user-1'],
      ['activity', 'working'],
      ['tool', 'step-1-1'],
      ['tool', 'step-1-2'],
      ['tool', 'step-1-3'],
      ['tool', 'step-1-4'],
      ['tool', 'step-1-5'],
      ['tool', 'step-1-6'],
      ['thinking', 'step-1-7'],
    ]);
    const steps = heard.slice(2).map(([, payload]) => payload as ChatEntry);
    expect(steps.every((step) => step.at === 1000)).toBe(true);
    expect(
      steps.map((step) =>
        step.kind === 'tool'
          ? [step.name, step.summary, step.result?.isError]
          : step.kind,
      ),
    ).toEqual([
      ['Read', 'src/app.ts', false],
      ['Read', 'src/view.ts', false],
      ['Read', 'src/state.ts', false],
      ['Bash', 'false', true],
      ['Edit', 'src/app.ts', false],
      ['Bash', 'npm test', false],
      'thinking',
    ]);
    const stepTools = ['Read', 'Read', 'Read', 'Bash', 'Edit', 'Bash'];
    expect(agentEvents).toEqual([
      { type: 'userMessage', at: 1000 },
      ...stepTools.flatMap((tool, index) => {
        const toolUseId = `fake-step-1-${index + 1}`;
        const agentId = MAIN_AGENT_ID;
        return [
          { type: 'toolStarted', at: 1000, agentId, toolUseId, tool },
          {
            type: 'toolFinished',
            at: 1000,
            agentId,
            toolUseId,
            ok: index !== 3,
          },
        ];
      }),
    ]);
    heard.length = 0;

    agent.interrupt();
    await flush();

    expect(heard).toEqual([
      [
        'entry',
        {
          kind: 'notice',
          id: 'notice-1',
          at: 1000,
          text: 'Interrupted',
          tone: 'info',
          raw: [{ fake: 'interrupt' }],
        },
      ],
      ['activity', 'idle'],
    ]);
  });

  it('interrupt_NoTurn_EmitsNothing', async () => {
    const { agent, heard, record } = await startedProcess();

    agent.interrupt();
    await flush();

    expect(heard).toEqual([]);
    expect(record.calls).toEqual([{ method: 'interrupt' }]);
  });

  it('send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn', async () => {
    const { agent, heard, agentEvents } = await startedProcess();

    agent.send({ text: FAKE_AGENTS_TEXT, images: [] });
    await flush();

    const subagentTool = (n: number, tool: string) => [
      {
        type: 'toolStarted',
        at: 1000,
        agentId: `fake-agent-1-${n}`,
        toolUseId: `fake-agent-1-${n}-tool`,
        tool,
      },
      {
        type: 'toolFinished',
        at: 1000,
        agentId: `fake-agent-1-${n}`,
        toolUseId: `fake-agent-1-${n}-tool`,
        ok: true,
      },
    ];
    expect(agentEvents).toEqual([
      { type: 'userMessage', at: 1000 },
      {
        type: 'agentSpawned',
        at: 1000,
        agentId: 'fake-agent-1-1',
        parentAgentId: MAIN_AGENT_ID,
        agentType: 'wigley:sonnet-medium',
        description: 'Map the stream decoder',
      },
      {
        type: 'agentSpawned',
        at: 1000,
        agentId: 'fake-agent-1-2',
        parentAgentId: MAIN_AGENT_ID,
        agentType: 'Explore',
        description: 'Find every Files adapter',
      },
      ...subagentTool(1, 'Read'),
      ...subagentTool(2, 'Grep'),
    ]);
    // Each entry as `[kind, id, tool result text]`.
    expect(
      heard.map(([name, payload]) => {
        const entry = payload as ChatEntry;
        return name === 'entry'
          ? [entry.kind, entry.id, entry.kind === 'tool' && entry.result?.text]
          : [name, payload];
      }),
    ).toEqual([
      ['user', 'user-1', false],
      ['activity', 'working'],
      ['tool', 'agent-1-1', undefined],
      ['tool', 'agent-1-2', undefined],
      ['tool', 'agent-1-1-tool', undefined],
      ['tool', 'agent-1-1-tool', 'fake'],
      ['tool', 'agent-1-2-tool', undefined],
      ['tool', 'agent-1-2-tool', 'fake'],
    ]);
    expect(heard[2][1]).toMatchObject({
      toolUseId: 'fake-agent-1-1',
      name: 'Agent',
      input: {
        subagent_type: 'wigley:sonnet-medium',
        description: 'Map the stream decoder',
      },
      summary: 'Map the stream decoder',
    });
  });

  // vitest reads `$name_suffix` as one key, so each row's case names the
  // whole tail.
  it.each([
    {
      case: 'interrupt_FinishesSubagentsAsFailed',
      end: (agent: AgentProcess) => agent.interrupt(),
      lines: [
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'activity idle',
      ],
    },
    {
      case: 'send_FinishesSubagentsAsDone',
      end: (agent: AgentProcess) => agent.send({ text: 'hi', images: [] }),
      lines: [
        'tool agent-1-1 fake subagent done',
        'agentFinished fake-agent-1-1 done',
        'tool agent-1-2 fake subagent done',
        'agentFinished fake-agent-1-2 done',
        'user user-2',
        'userMessage',
        'activity working',
        'assistant assistant-2',
        'assistant assistant-2',
        'result result-2',
        'usage main',
        'planUsage',
        'activity idle',
      ],
    },
    {
      case: 'end_LeavesSubagentsToSessionEnded',
      end: (agent: AgentProcess) => void agent.end(),
      lines: ['sessionEnded', 'ended'],
    },
    {
      case: 'interruptThenEnd_FinishesSubagentsBeforeSessionEnded',
      end: (agent: AgentProcess) => {
        agent.interrupt();
        void agent.end();
      },
      lines: [
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'activity idle',
        'sessionEnded',
        'ended',
      ],
    },
    {
      case: 'interruptThenKill_FinishesSubagentsBeforeSessionEnded',
      end: (agent: AgentProcess) => {
        agent.interrupt();
        agent.kill();
      },
      lines: [
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'activity idle',
        'sessionEnded',
        'ended',
      ],
    },
  ])('agentsTurn_$case', async ({ end, lines }) => {
    const { agent, timeline } = await startedProcess();
    agent.send({ text: FAKE_AGENTS_TEXT, images: [] });
    await flush();
    timeline.length = 0;

    end(agent);
    await flush();

    expect(timeline.map(timelineLine)).toEqual(lines);
  });

  it.each([
    {
      case: 'start',
      run: async () => {
        const { agentEvents, events } = recordingEvents();
        createFakeAgentHarness(clock).start(request, events);
        await flush();
        return agentEvents;
      },
      expected: [{ type: 'sessionStarted', at: 1000 }],
    },
    {
      case: 'plain send',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        agent.send({ text: 'hi', images: [] });
        await flush();
        return agentEvents;
      },
      expected: [{ type: 'userMessage', at: 1000 }],
    },
    {
      case: 'tool turn',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        agent.send({ text: FAKE_TOOL_TEXT, images: [] });
        await flush();
        return agentEvents;
      },
      expected: [
        { type: 'userMessage', at: 1000 },
        {
          type: 'toolStarted',
          at: 1000,
          agentId: MAIN_AGENT_ID,
          toolUseId: 'fake-tool-1',
          tool: 'Bash',
        },
        {
          type: 'toolFinished',
          at: 1000,
          agentId: MAIN_AGENT_ID,
          toolUseId: 'fake-tool-1',
          ok: true,
        },
      ],
    },
    {
      case: 'end',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        await agent.end();
        return agentEvents;
      },
      expected: [{ type: 'sessionEnded', at: 1000 }],
    },
    {
      case: 'kill',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        agent.kill();
        await flush();
        return agentEvents;
      },
      expected: [{ type: 'sessionEnded', at: 1000 }],
    },
    {
      case: 'held end released',
      run: async () => {
        const { harness, agent, agentEvents } = await startedProcess();
        harness.holdEnd();
        const ending = agent.end();
        await flush();
        harness.releaseEnd();
        await ending;
        return agentEvents;
      },
      expected: [{ type: 'sessionEnded', at: 1000 }],
    },
    {
      case: 'end text',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        agent.send({ text: FAKE_END_TEXT, images: [] });
        await flush();
        return agentEvents;
      },
      expected: [
        { type: 'userMessage', at: 1000 },
        { type: 'sessionEnded', at: 1000 },
      ],
    },
  ])('sessionEvents_$case', async ({ run, expected }) => {
    expect(await run()).toEqual(expected);
  });

  it('setControl_KnownChoice_ReportsNewValue', async () => {
    const { agent, heard, record } = await startedProcess();

    agent.setControl('effort', 'high');
    await flush();

    expect(heard).toEqual([
      [
        'controls',
        [
          expect.objectContaining({ id: 'mode', value: 'auto' }),
          expect.objectContaining({ id: 'effort', value: 'high' }),
          expect.objectContaining({ id: 'model', value: 'fake-small' }),
          expect.objectContaining({ id: 'verbosity', value: 'brief' }),
        ],
      ],
    ]);
    expect(record.calls).toEqual([
      { method: 'setControl', id: 'effort', value: 'high' },
    ]);
  });

  it('setControl_UnknownChoice_Throws', async () => {
    const { agent, record } = await startedProcess();

    expect(() => agent.setControl('effort', 'max')).toThrow(/effort.*max/);
    expect(record.calls).toEqual([
      { method: 'setControl', id: 'effort', value: 'max' },
    ]);
  });

  it('end_EndsOnceAndRefusesSend', async () => {
    const { agent, heard, record } = await startedProcess();

    await agent.end();
    await agent.end();
    await flush();

    expect(heard).toEqual([['ended', { code: 0, error: null }]]);
    expect(record.ended).toBe(true);
    expect(() => agent.send({ text: 'x', images: [] })).toThrow();
  });

  it('send_EndText_EmitsUserEntryThenEnded', async () => {
    const { agent, heard, record } = await startedProcess();

    agent.send({ text: FAKE_END_TEXT, images: [] });
    await flush();

    expect(heard).toEqual([
      [
        'entry',
        {
          kind: 'user',
          id: 'user-1',
          at: 1000,
          text: FAKE_END_TEXT,
          images: [],
          raw: [{ fake: 'user', text: FAKE_END_TEXT }],
        },
      ],
      ['activity', 'working'],
      ['ended', { code: 0, error: null }],
    ]);
    expect(record.ended).toBe(true);
  });

  it('end_AfterEndText_ResolvesWithoutSecondEnded', async () => {
    const { agent, heard } = await startedProcess();
    agent.send({ text: FAKE_END_TEXT, images: [] });
    await flush();
    heard.length = 0;

    await agent.end();
    await flush();

    expect(heard).toEqual([]);
  });

  it('send_AfterEndText_Throws', async () => {
    const { agent } = await startedProcess();
    agent.send({ text: FAKE_END_TEXT, images: [] });
    await flush();

    expect(() => agent.send({ text: 'x', images: [] })).toThrow();
  });

  it('holdEnd_KeepsEndPendingUntilRelease', async () => {
    const { harness, agent, heard, record } = await startedProcess();
    harness.holdEnd();
    let isSettled = false;

    const ending = agent.end().then(() => {
      isSettled = true;
    });
    await flush();

    expect(record.ended).toBe(true);
    expect(heard).toEqual([]);
    expect(isSettled).toBe(false);
    harness.releaseEnd();
    await ending;
    expect(heard).toEqual([['ended', { code: 0, error: null }]]);
    expect(isSettled).toBe(true);
  });

  it('holdEnd_SecondEndPendingUntilRelease', async () => {
    const { harness, agent } = await startedProcess();
    harness.holdEnd();
    let isSecondSettled = false;

    void agent.end();
    const secondEnding = agent.end().then(() => {
      isSecondSettled = true;
    });
    await flush();

    expect(isSecondSettled).toBe(false);
    harness.releaseEnd();
    await secondEnding;
    expect(isSecondSettled).toBe(true);
  });

  it('listSessions_ReturnsTheFakeSessionsAndRecords', async () => {
    const harness = createFakeAgentHarness(clock);

    const sessions = await harness.listSessions('/a', '/p');

    expect(sessions).toEqual(FAKE_PAST_SESSIONS);
    expect(sessions).not.toBe(FAKE_PAST_SESSIONS);
    expect(harness.pastSessionCalls).toEqual([
      {
        method: 'listSessions',
        sessionId: null,
        projectDir: '/a',
        profileDir: '/p',
      },
    ]);
  });

  it('history_KnownUnknownAndFailNext', async () => {
    const harness = createFakeAgentHarness(clock);
    const known = '00000000-0000-4000-8000-000000000001';

    expect(await harness.history(known, '/a', null)).toEqual([
      {
        kind: 'user',
        id: `history:${known}-user`,
        at: 1767236645000,
        text: 'fake earlier message',
        images: FAKE_HISTORY_IMAGES,
        raw: [{ fake: 'history-user' }],
      },
      {
        kind: 'assistant',
        id: `history:${known}-assistant`,
        at: 1767236646000,
        text: 'fake earlier reply',
        streaming: false,
        raw: [{ fake: 'history-assistant' }],
      },
    ]);
    await expect(harness.history('nope', '/a', null)).rejects.toThrow(/nope/);
    harness.failNextHistory('cannot read');
    await expect(harness.history(known, '/a', null)).rejects.toThrow(
      'cannot read',
    );
    expect(await harness.history(known, '/a', null)).toHaveLength(2);
    expect(harness.pastSessionCalls).toEqual([
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
      },
      {
        method: 'history',
        sessionId: 'nope',
        projectDir: '/a',
        profileDir: null,
      },
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
      },
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
      },
    ]);
  });

  it('planUsage_ResolvesFakeRows_FailNextRejectsOnce', async () => {
    const harness = createFakeAgentHarness(clock);

    expect(await harness.planUsage('/p')).toEqual(fakePlanUsage(1000));
    harness.failNextPlanUsage('offline');
    await expect(harness.planUsage('/p')).rejects.toThrow('offline');
    expect(await harness.planUsage(null)).toEqual(fakePlanUsage(1000));
  });

  it('isFakeAgentHarness_TellsTheFakeFromAnother', () => {
    // A copy has every member of the fake but is not the object it made.
    const other: AgentHarness = { ...createFakeAgentHarness(clock) };

    expect(isFakeAgentHarness(createFakeAgentHarness(clock))).toBe(true);
    expect(isFakeAgentHarness(other)).toBe(false);
  });
});

describe('createFakeAgentHarness accounts and projects', () => {
  // Every event a sign-in emits, as `[event name, payload]`, in emit order.
  function recordingLogIn() {
    const heard: [string, unknown][] = [];
    const events: LogInEvents = {
      link: (url) => heard.push(['link', url]),
      ended: (end) => heard.push(['ended', end]),
    };
    return { heard, events };
  }

  it('logIn_RightCode_SignsIn', async () => {
    const harness = createFakeAgentHarness(clock);
    await harness.logOut('/p');
    const { heard, events } = recordingLogIn();

    const login = harness.logIn('/p', events);
    await flush();
    login.sendCode(FAKE_SIGN_IN_CODE);
    await flush();

    const signedIn = { signedIn: true, account: 'fake@example.invalid' };
    expect(heard).toEqual([
      ['link', FAKE_SIGN_IN_URL],
      ['ended', { status: signedIn, error: null }],
    ]);
    expect(await harness.accountStatus('/p')).toEqual(signedIn);
  });

  it('logIn_WrongCodeThenCancel_EndsOnceWithStatusUnchanged', async () => {
    const harness = createFakeAgentHarness(clock);
    const { heard, events } = recordingLogIn();

    const login = harness.logIn(null, events);
    login.sendCode('nope');
    login.cancel();
    await flush();

    expect(heard).toEqual([
      ['link', FAKE_SIGN_IN_URL],
      [
        'ended',
        {
          status: { signedIn: true, account: 'fake@example.invalid' },
          error: 'Wrong code',
        },
      ],
    ]);
  });

  it('logOut_ThenStatus_SignedOut', async () => {
    const harness = createFakeAgentHarness(clock);
    expect(await harness.accountStatus(null)).toEqual({
      signedIn: true,
      account: 'fake@example.invalid',
    });

    await harness.logOut(null);

    expect(await harness.accountStatus(null)).toEqual({
      signedIn: false,
      account: null,
    });
    expect((await harness.accountStatus('/other')).signedIn).toBe(true);
  });

  it('listProjects_StartedFolders_NewestFirst', async () => {
    const harness = createFakeAgentHarness(clock);
    const { events } = recordingEvents();
    harness.start({ ...request, projectDir: '/a', profileDir: '/p' }, events);
    harness.start({ ...request, projectDir: '/b', profileDir: '/p' }, events);
    harness.start({ ...request, projectDir: '/c', profileDir: null }, events);
    harness.start({ ...request, projectDir: '/a', profileDir: '/p' }, events);

    const projects = await harness.listProjects('/p');

    expect(projects.map((project) => project.projectDir)).toEqual(['/a', '/b']);
    expect(projects[0].modified).toBeGreaterThan(projects[1].modified);
  });
});
