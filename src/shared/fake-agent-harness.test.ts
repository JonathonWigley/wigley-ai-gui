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
import type { Timers } from '../contracts/ambient';
import type { Files } from '../contracts/files';
import {
  createFakeAgentHarness,
  type FakeAttachScript,
  FAKE_AGENTS_TEXT,
  FAKE_END_TEXT,
  FAKE_HISTORY_IMAGES,
  FAKE_HOLD_TEXT,
  FAKE_MICROTASK_TIMERS,
  FAKE_PAST_SESSIONS,
  FAKE_PERMISSION_TEXT,
  FAKE_SIGN_IN_CODE,
  FAKE_SIGN_IN_URL,
  FAKE_STEPS_TEXT,
  FAKE_TOOL_TEXT,
  FAKE_VISUAL_HOLD_MS,
  FAKE_VISUAL_TEXT,
  FAKE_WORKFLOW_FEATURE_TEXT,
  FAKE_WORKFLOW_STEP_TEXT,
  fakePlanRowUpdate,
  fakePlanUsage,
  fakeUsageEvent,
  fakeWorkflowPlan,
  isFakeAgentHarness,
} from './fake-agent-harness';
import { createMemoryFiles } from './memory-files';
import {
  SAMPLE_VISUALS_OPEN_TEXT,
  SAMPLE_VISUALS_TEXT,
} from './sample-visuals';

const clock = { now: () => 1000 };
// The second fake history entry's `at`.
const FAKE_HISTORY_AT_SECOND = 1767236646000;

const request: AgentStart = {
  processId: 'p-1',
  sessionId: 's-1',
  resume: false,
  projectDir: '/p',
  profileDir: null,
  controls: {},
  instructions: [],
  idleCompactMinTokens: null,
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
    messageDropped: (entryId) => hear('messageDropped', entryId),
    ended: (end) => hear('ended', end),
  };
  return { heard, agentEvents, timeline, events };
}

// One timeline event as a line: an entry as its kind, id and tool result text,
// an agent event as its type, task id, agent id and outcome, any other as its
// name and, for activity, its value.
function timelineLine([name, payload]: [string, unknown]): string {
  if (name === 'entry') {
    const entry = payload as ChatEntry;
    const resultText = entry.kind === 'tool' ? entry.result?.text : undefined;
    return [entry.kind, entry.id, resultText].filter(Boolean).join(' ');
  }
  if (name === 'agentEvent') {
    const event = payload as AgentEvent;
    const taskId = 'taskId' in event ? event.taskId : undefined;
    const agentId = 'agentId' in event ? event.agentId : undefined;
    const outcome = 'outcome' in event ? event.outcome : undefined;
    return [event.type, taskId, agentId, outcome].filter(Boolean).join(' ');
  }
  return name === 'activity' ? `activity ${String(payload)}` : name;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Timers that run nothing themselves: each `set` is recorded with a fresh
// handle for the test to run, and each `clear` records its handle.
function heldTimers() {
  const set: { run: () => void; ms: number; handle: number }[] = [];
  const cleared: number[] = [];
  const timers: Timers = {
    set(run, ms) {
      const handle = set.length + 1;
      set.push({ run, ms, handle });
      return handle;
    },
    clear(handle) {
      cleared.push(handle);
    },
  };
  return { timers, set, cleared };
}

// How many lines of `text` equal `line`.
const linesEqualTo = (text: string, line: string) =>
  text.split('\n').filter((each) => each === line).length;

// A started process with its start events flushed and cleared.
async function startedProcess(
  files: Pick<Files, 'write' | 'trash'> = createMemoryFiles(),
  timers: Timers = FAKE_MICROTASK_TIMERS,
) {
  const harness = createFakeAgentHarness(clock, files, timers);
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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

    const entryId = agent.send({ text: 'hi', images: [] });
    await flush();

    expect(entryId).toBe('user-1');
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
      agentId: MAIN_AGENT_ID,
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

  it.each([
    {
      given: 'allowed',
      ask: () => Promise.resolve(true),
      result: { text: 'fake', isError: false },
      reply: 'fake agent ran an allowed tool',
    },
    {
      given: 'refused',
      ask: () => Promise.resolve(false),
      result: { text: 'Permission denied', isError: true },
      reply: 'fake agent was refused',
    },
    {
      given: 'the ask failing',
      ask: () => Promise.reject(new Error('no chat session')),
      result: { text: 'no chat session', isError: true },
      reply: 'fake agent was refused',
    },
    {
      given: 'no ask set',
      ask: null,
      result: {
        text: 'fake harness has no permission ask',
        isError: true,
      },
      reply: 'fake agent was refused',
    },
  ])(
    'send_PermissionText_AsksThenFinishesTheTool given $given',
    async ({ ask, result, reply }) => {
      const { harness, agent, heard } = await startedProcess();
      const asked: unknown[][] = [];
      let answer: () => void = () => undefined;
      if (ask !== null) {
        harness.askPermissionsWith((...args) => {
          asked.push(args);
          return new Promise<boolean>((resolve, reject) => {
            answer = () => ask().then(resolve, reject);
          });
        });
      }

      agent.send({ text: FAKE_PERMISSION_TEXT, images: [] });
      await flush();
      const whileAsking = heard.map(timelineLine);
      answer();
      await flush();
      await flush();

      const tool = {
        kind: 'tool',
        id: 'tool-1',
        at: 1000,
        agentId: MAIN_AGENT_ID,
        toolUseId: 'fake-permission-1',
        name: 'Bash',
        input: { command: 'rm fake.txt' },
        summary: 'rm fake.txt',
      };
      if (ask !== null) {
        expect(whileAsking).toEqual([
          'user user-1',
          'activity working',
          'tool tool-1',
        ]);
        expect(asked).toEqual([
          [
            request,
            {
              toolName: 'Bash',
              input: tool.input,
              toolUseId: 'fake-permission-1',
            },
          ],
        ]);
      }
      expect(heard.slice(2, 5)).toEqual([
        ['entry', { ...tool, result: null, raw: [{ fake: 'tool' }] }],
        [
          'entry',
          {
            ...tool,
            result,
            raw: [{ fake: 'tool' }, { fake: 'tool-result' }],
          },
        ],
        [
          'entry',
          {
            kind: 'assistant',
            id: 'assistant-1',
            at: 1000,
            text: reply,
            streaming: false,
            raw: [{ fake: 'assistant', text: reply }],
          },
        ],
      ]);
      expect(heard.at(-1)).toEqual(['activity', 'idle']);
    },
  );

  it('send_PermissionText_InterruptedWhileAsking_EmitsNothingOnTheAnswer', async () => {
    const { harness, agent, heard } = await startedProcess();
    let allow: (allowed: boolean) => void = () => undefined;
    harness.askPermissionsWith(
      () =>
        new Promise<boolean>((resolve) => {
          allow = resolve;
        }),
    );
    agent.send({ text: FAKE_PERMISSION_TEXT, images: [] });
    await flush();
    agent.interrupt();
    await flush();
    const interrupted = heard.length;

    allow(true);
    await flush();

    expect(heard.slice(interrupted)).toEqual([]);
    expect(heard.at(-1)).toEqual(['activity', 'idle']);
  });

  it('send_VisualText_StreamsAnOpenBlockThenBothVisuals', async () => {
    const timers = heldTimers();
    const { agent, heard } = await startedProcess(
      createMemoryFiles(),
      timers.timers,
    );

    agent.send({ text: FAKE_VISUAL_TEXT, images: [] });
    await flush();

    const first = { fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT };
    expect(timers.set.map(({ ms }) => ms)).toEqual([FAKE_VISUAL_HOLD_MS]);
    expect(heard.slice(2)).toEqual([
      [
        'entry',
        {
          kind: 'assistant',
          id: 'assistant-1',
          at: 1000,
          text: SAMPLE_VISUALS_OPEN_TEXT,
          streaming: true,
          raw: [first],
        },
      ],
    ]);

    timers.set[0].run();
    await flush();

    expect(heard.slice(3)).toEqual([
      [
        'entry',
        {
          kind: 'assistant',
          id: 'assistant-1',
          at: 1000,
          text: SAMPLE_VISUALS_TEXT,
          streaming: false,
          raw: [
            first,
            {
              fake: 'assistant',
              text: SAMPLE_VISUALS_TEXT.slice(SAMPLE_VISUALS_OPEN_TEXT.length),
            },
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
    const fenceShape = (text: string) => [
      linesEqualTo(text, '```html'),
      linesEqualTo(text, '```'),
    ];
    expect(fenceShape(SAMPLE_VISUALS_OPEN_TEXT)).toEqual([2, 1]);
    expect(fenceShape(SAMPLE_VISUALS_TEXT)).toEqual([2, 2]);
    expect(SAMPLE_VISUALS_TEXT.startsWith(SAMPLE_VISUALS_OPEN_TEXT)).toBe(true);
  });

  const streamingVisualEntry = {
    kind: 'assistant',
    id: 'assistant-1',
    at: 1000,
    text: SAMPLE_VISUALS_OPEN_TEXT,
    streaming: true,
  };

  it.each([
    {
      case: 'interrupt',
      call: (agent: AgentProcess) => agent.interrupt(),
      lastEntry: {
        kind: 'notice',
        id: 'notice-1',
        text: 'Interrupted',
        tone: 'info',
      },
    },
    {
      case: 'end',
      call: (agent: AgentProcess) => agent.end(),
      lastEntry: streamingVisualEntry,
    },
    {
      case: 'kill',
      call: (agent: AgentProcess) => agent.kill(),
      lastEntry: streamingVisualEntry,
    },
    {
      case: 'send',
      call: (agent: AgentProcess) => agent.send({ text: 'hi', images: [] }),
      lastEntry: { kind: 'result', id: 'result-2' },
    },
  ])(
    'visualHold_CutShort_ClearsTheTimer ($case)',
    async ({ call, lastEntry }) => {
      const timers = heldTimers();
      const { agent, heard } = await startedProcess(
        createMemoryFiles(),
        timers.timers,
      );
      agent.send({ text: FAKE_VISUAL_TEXT, images: [] });
      await flush();

      await call(agent);
      await flush();

      expect(timers.cleared).toEqual(timers.set.map(({ handle }) => handle));
      expect(timers.set).toHaveLength(1);
      const entries = heard.filter(([name]) => name === 'entry');
      expect(entries.at(-1)?.[1]).toMatchObject(lastEntry);
    },
  );

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
    const stepSummaries = [
      'src/app.ts',
      'src/view.ts',
      'src/state.ts',
      'false',
      'src/app.ts',
      'npm test',
    ];
    expect(agentEvents).toEqual([
      { type: 'userMessage', at: 1000 },
      { type: 'turnStarted', at: 1000 },
      ...stepTools.flatMap((tool, index) => {
        const toolUseId = `fake-step-1-${index + 1}`;
        const agentId = MAIN_AGENT_ID;
        return [
          {
            type: 'toolStarted',
            at: 1000,
            agentId,
            toolUseId,
            tool,
            summary: stepSummaries[index],
          },
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

    const subagentTool = (
      n: number,
      tool: string,
      summary: string,
      reply: { model: string; spendUsd: number },
    ) => [
      {
        type: 'agentReplied',
        at: 1000,
        agentId: `fake-agent-1-${n}`,
        ...reply,
      },
      {
        type: 'toolStarted',
        at: 1000,
        agentId: `fake-agent-1-${n}`,
        toolUseId: `fake-agent-1-${n}-tool`,
        tool,
        summary,
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
      { type: 'turnStarted', at: 1000 },
      {
        type: 'agentSpawned',
        at: 1000,
        agentId: 'fake-agent-1-1',
        parentAgentId: MAIN_AGENT_ID,
        agentType: 'wigley:sonnet-medium',
        description: 'Map the stream decoder',
        name: 'map-decoder',
        model: 'sonnet',
        effort: 'medium',
      },
      {
        type: 'agentSpawned',
        at: 1000,
        agentId: 'fake-agent-1-2',
        parentAgentId: MAIN_AGENT_ID,
        agentType: 'Explore',
        description: 'Find every Files adapter',
        name: 'Explore',
        model: null,
        effort: null,
      },
      ...subagentTool(1, 'Read', 'src/main/claude-code/stream-decoder.ts', {
        model: 'claude-sonnet-5-5',
        spendUsd: 0.0421,
      }),
      ...subagentTool(2, 'Grep', 'append', {
        model: 'claude-haiku-5-5',
        spendUsd: 0.0019,
      }),
      {
        type: 'taskStarted',
        at: 1000,
        taskId: 'fake-task-1-1',
        agentId: MAIN_AGENT_ID,
        description: 'Run the self-test',
        command: 'npm run selftest',
      },
      {
        type: 'taskStarted',
        at: 1000,
        taskId: 'fake-task-1-2',
        agentId: 'fake-agent-1-1',
        description: 'Watch the build',
        command: 'npm run build -- --watch',
      },
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
    // Each tool entry as `[id, agentId]`.
    expect(
      heard.flatMap(([, payload]) => {
        const entry = payload as ChatEntry;
        return entry.kind === 'tool' ? [[entry.id, entry.agentId]] : [];
      }),
    ).toEqual([
      ['agent-1-1', MAIN_AGENT_ID],
      ['agent-1-2', MAIN_AGENT_ID],
      ['agent-1-1-tool', 'fake-agent-1-1'],
      ['agent-1-1-tool', 'fake-agent-1-1'],
      ['agent-1-2-tool', 'fake-agent-1-2'],
      ['agent-1-2-tool', 'fake-agent-1-2'],
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
        'taskFinished fake-task-1-1 failed',
        'taskFinished fake-task-1-2 failed',
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'turnEnded',
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
        'turnStarted',
        'activity working',
        'assistant assistant-2',
        'assistant assistant-2',
        'result result-2',
        'usage main',
        'planUsage',
        'turnEnded',
        'activity idle',
      ],
    },
    {
      case: 'sendAgentsThenInterrupt_FailsTasksOfEveryTurn',
      end: (agent: AgentProcess) => {
        agent.send({ text: FAKE_AGENTS_TEXT, images: [] });
        agent.interrupt();
      },
      lines: [
        'tool agent-1-1 fake subagent done',
        'agentFinished fake-agent-1-1 done',
        'tool agent-1-2 fake subagent done',
        'agentFinished fake-agent-1-2 done',
        'user user-2',
        'userMessage',
        'turnStarted',
        'activity working',
        'tool agent-2-1',
        'agentSpawned fake-agent-2-1',
        'tool agent-2-2',
        'agentSpawned fake-agent-2-2',
        'agentReplied fake-agent-2-1',
        'tool agent-2-1-tool',
        'toolStarted fake-agent-2-1',
        'tool agent-2-1-tool fake',
        'toolFinished fake-agent-2-1',
        'agentReplied fake-agent-2-2',
        'tool agent-2-2-tool',
        'toolStarted fake-agent-2-2',
        'tool agent-2-2-tool fake',
        'toolFinished fake-agent-2-2',
        'taskStarted fake-task-2-1 main',
        'taskStarted fake-task-2-2 fake-agent-2-1',
        'taskFinished fake-task-1-1 failed',
        'taskFinished fake-task-1-2 failed',
        'taskFinished fake-task-2-1 failed',
        'taskFinished fake-task-2-2 failed',
        'tool agent-2-1 Interrupted',
        'agentFinished fake-agent-2-1 failed',
        'tool agent-2-2 Interrupted',
        'agentFinished fake-agent-2-2 failed',
        'notice notice-2',
        'turnEnded',
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
        'taskFinished fake-task-1-1 failed',
        'taskFinished fake-task-1-2 failed',
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'turnEnded',
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
        'taskFinished fake-task-1-1 failed',
        'taskFinished fake-task-1-2 failed',
        'tool agent-1-1 Interrupted',
        'agentFinished fake-agent-1-1 failed',
        'tool agent-1-2 Interrupted',
        'agentFinished fake-agent-1-2 failed',
        'notice notice-1',
        'turnEnded',
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
        createFakeAgentHarness(
          clock,
          createMemoryFiles(),
          FAKE_MICROTASK_TIMERS,
        ).start(request, events);
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
      expected: [
        { type: 'userMessage', at: 1000 },
        { type: 'turnStarted', at: 1000 },
        { type: 'turnEnded', at: 1000 },
      ],
    },
    {
      case: 'slash send',
      run: async () => {
        const { agent, agentEvents } = await startedProcess();
        agent.send({ text: '/wigley:feature x', images: [] });
        await flush();
        return agentEvents;
      },
      expected: [
        { type: 'userMessage', at: 1000 },
        {
          type: 'skillStarted',
          at: 1000,
          agentId: MAIN_AGENT_ID,
          skill: 'wigley:feature',
          args: 'x',
        },
        { type: 'turnStarted', at: 1000 },
        { type: 'turnEnded', at: 1000 },
      ],
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
        { type: 'turnStarted', at: 1000 },
        {
          type: 'toolStarted',
          at: 1000,
          agentId: MAIN_AGENT_ID,
          toolUseId: 'fake-tool-1',
          tool: 'Bash',
          summary: 'echo fake',
        },
        {
          type: 'toolFinished',
          at: 1000,
          agentId: MAIN_AGENT_ID,
          toolUseId: 'fake-tool-1',
          ok: true,
        },
        { type: 'turnEnded', at: 1000 },
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );

    const sessions = await harness.listSessions('/a', '/p');

    expect(sessions).toEqual(FAKE_PAST_SESSIONS);
    expect(sessions).not.toBe(FAKE_PAST_SESSIONS);
    expect(harness.pastSessionCalls).toEqual([
      {
        method: 'listSessions',
        sessionId: null,
        projectDir: '/a',
        profileDir: '/p',
        before: null,
      },
    ]);
  });

  it('history_KnownUnknownAndFailNext', async () => {
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const known = '00000000-0000-4000-8000-000000000001';

    expect(await harness.history(known, '/a', null, null)).toEqual([
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
    await expect(harness.history('nope', '/a', null, null)).rejects.toThrow(
      /nope/,
    );
    harness.failNextHistory('cannot read');
    await expect(harness.history(known, '/a', null, null)).rejects.toThrow(
      'cannot read',
    );
    expect(await harness.history(known, '/a', null, null)).toHaveLength(2);
    const cut = FAKE_HISTORY_AT_SECOND;
    expect(
      (await harness.history(known, '/a', null, cut)).map(
        (entry) => entry.kind,
      ),
    ).toEqual(['user']);
    expect(harness.pastSessionCalls).toEqual([
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
        before: null,
      },
      {
        method: 'history',
        sessionId: 'nope',
        projectDir: '/a',
        profileDir: null,
        before: null,
      },
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
        before: null,
      },
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
        before: null,
      },
      {
        method: 'history',
        sessionId: known,
        projectDir: '/a',
        profileDir: null,
        before: FAKE_HISTORY_AT_SECOND,
      },
    ]);
  });

  it('planUsage_ResolvesFakeRows_FailNextRejectsOnce', async () => {
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );

    expect(await harness.planUsage('/p')).toEqual(fakePlanUsage(1000));
    harness.failNextPlanUsage('offline');
    await expect(harness.planUsage('/p')).rejects.toThrow('offline');
    expect(await harness.planUsage(null)).toEqual(fakePlanUsage(1000));
  });

  it('lastUsage_ScriptedUnscriptedAndFailNext_RecordsEveryCall', async () => {
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const event = fakeUsageEvent(2, 5000);
    harness.setLastUsage('s-1', event);
    harness.setLastUsage('s-2', null);

    expect(await harness.lastUsage('s-1', '/a', null)).toEqual(event);
    expect(await harness.lastUsage('s-2', '/a', null)).toBeNull();
    expect(await harness.lastUsage('s-3', '/a', null)).toBeNull();
    harness.failNextLastUsage('cannot read');
    await expect(harness.lastUsage('s-1', '/a', null)).rejects.toThrow(
      'cannot read',
    );
    expect(await harness.lastUsage('s-1', '/a', null)).toEqual(event);
    expect(harness.lastUsageCalls).toEqual(['s-1', 's-2', 's-3', 's-1', 's-1']);
    expect(harness.pastSessionCalls).toEqual([]);
  });

  it('lastUsage_Held_ResolvesOnlyAfterRelease', async () => {
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const event = fakeUsageEvent(1, 5000);
    harness.setLastUsage('s-1', event);
    const release = harness.holdNextLastUsage();
    let resolved: unknown = 'pending';

    const read = harness.lastUsage('s-1', '/a', null).then((value) => {
      resolved = value;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(resolved).toBe('pending');
    release();
    await read;

    expect(resolved).toEqual(event);
  });

  it('isFakeAgentHarness_TellsTheFakeFromAnother', () => {
    // A copy has every member of the fake but is not the object it made.
    const other: AgentHarness = {
      ...createFakeAgentHarness(
        clock,
        createMemoryFiles(),
        FAKE_MICROTASK_TIMERS,
      ),
    };

    expect(
      isFakeAgentHarness(
        createFakeAgentHarness(
          clock,
          createMemoryFiles(),
          FAKE_MICROTASK_TIMERS,
        ),
      ),
    ).toBe(true);
    expect(isFakeAgentHarness(other)).toBe(false);
  });
});

describe('createFakeAgentHarness attach and detach', () => {
  const replayedEntry: ChatEntry = {
    kind: 'notice',
    id: 'replayed',
    at: 1000,
    text: 'replayed',
    tone: 'info',
    raw: [],
  };
  const replayOne = (events: AgentProcessEvents) => events.entry(replayedEntry);

  function attachRig() {
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    return { harness, ...recordingEvents() };
  }

  it.each([
    { case: 'no script', script: null, resolved: 'null' },
    { case: 'null', script: { outcome: 'null' }, resolved: 'null' },
    {
      case: 'reject',
      script: { outcome: 'reject', message: 'gone' },
      resolved: 'gone',
    },
    {
      case: 'process',
      script: { outcome: 'process', replay: replayOne },
      resolved: 'process',
    },
  ] as { case: string; script: FakeAttachScript | null; resolved: string }[])(
    'attach_Scripted_ResolvesAsSet ($case)',
    async ({ script, resolved }) => {
      const { harness, events, heard, agentEvents } = attachRig();
      if (script !== null) {
        harness.scriptAttach('p-1', script);
      }

      const outcome = await harness.attach(request, events).then(
        (process) => (process === null ? 'null' : 'process'),
        (error: Error) => error.message,
      );
      const heardBeforeResolve = [...heard];
      await flush();

      expect(outcome).toBe(resolved);
      expect(harness.attachCalls).toEqual([request]);
      if (resolved === 'process') {
        expect(heardBeforeResolve).toEqual([['entry', replayedEntry]]);
        expect(harness.processes[0].attached).toBe(true);
        expect(agentEvents).toEqual([]);
        expect(heard).toEqual(heardBeforeResolve);
      } else {
        expect(heard).toEqual([]);
        expect(harness.processes).toEqual([]);
      }
    },
  );

  it('attach_Scripted_ScriptIsUsedOnce', async () => {
    const { harness, events } = attachRig();
    harness.scriptAttach('p-1', { outcome: 'process', replay: replayOne });

    await harness.attach(request, events);

    expect(await harness.attach(request, events)).toBeNull();
    expect(harness.attachCalls).toHaveLength(2);
  });

  it('attach_Scripted_TurnsContinueTheReplayedIds', async () => {
    const { harness, events } = attachRig();
    harness.scriptAttach('p-1', {
      outcome: 'process',
      turns: 2,
      replay: replayOne,
    });

    const agent = await harness.attach(request, events);

    expect(agent?.send({ text: 'hi', images: [] })).toBe('user-3');
  });

  it('detach_StopsEventsAndRefusesCalls', async () => {
    const { agent, heard, agentEvents, record } = await startedProcess();
    agent.send({ text: FAKE_HOLD_TEXT, images: [] });
    await flush();
    agent.interrupt();
    agent.detach();
    heard.length = 0;
    agentEvents.length = 0;

    await flush();
    expect(() => agent.send({ text: 'hi', images: [] })).toThrow(
      'fake agent process has detached',
    );
    expect(() => agent.interrupt()).toThrow('fake agent process has detached');
    expect(() => agent.setControl('mode', 'plan')).toThrow(
      'fake agent process has detached',
    );
    agent.kill();
    await agent.end();
    await flush();

    expect(heard).toEqual([]);
    expect(agentEvents).toEqual([]);
    expect(record.detached).toBe(true);
    expect(record.calls).toContainEqual({ method: 'detach' });
    expect(record.calls.slice(0, 3)).toEqual([
      { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
      { method: 'interrupt' },
      { method: 'detach' },
    ]);
  });

  it('detach_HeldEnd_SettlesItsOwnWithNoEnded', async () => {
    const { harness, agent, heard } = await startedProcess();
    const other = harness.start(request, recordingEvents().events);
    harness.holdEnd();
    let hasOtherSettled = false;
    void other.end().then(() => {
      hasOtherSettled = true;
    });

    const ending = agent.end();
    agent.detach();
    await ending;
    await flush();

    expect(hasOtherSettled).toBe(false);
    harness.releaseEnd();
    await flush();
    expect(hasOtherSettled).toBe(true);
    expect(heard).toEqual([]);
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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
    const harness = createFakeAgentHarness(
      clock,
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
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

describe('createFakeAgentHarness workflow', () => {
  const planDir = '/p/docs/features/fake-flow/plan-fake-flow';
  const planPath = `${planDir}/plan.md`;
  const workflowTypes = new Set([
    'skillStarted',
    'fileWritten',
    'turnStarted',
    'turnEnded',
  ]);

  // The events of the four workflow types, without their `at`.
  const workflowEvents = (agentEvents: readonly AgentEvent[]) =>
    agentEvents
      .filter((event) => workflowTypes.has(event.type))
      .map(({ at: _at, ...event }) => event);

  // Lets the queued events and the files' awaited changes run.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const turnStarted = { type: 'turnStarted' };
  const turnEnded = { type: 'turnEnded' };
  const planWritten = {
    type: 'fileWritten',
    agentId: MAIN_AGENT_ID,
    path: planPath,
  };
  const skillStarted = (skill: string, args: string) => ({
    type: 'skillStarted',
    agentId: MAIN_AGENT_ID,
    skill,
    args,
  });

  // The assistant entries' last texts, in emit order.
  const replies = (heard: readonly [string, unknown][]) =>
    heard.flatMap(([name, payload]) => {
      const entry = payload as ChatEntry;
      const isFinalReply =
        name === 'entry' && entry.kind === 'assistant' && !entry.streaming;
      return isFinalReply ? [entry.text] : [];
    });

  it.each([
    {
      case: 'none',
      ticked: 0,
      reviewRounds: 0,
      boxes: [
        '- [ ] [Fake first task](01-fake-first.md)',
        '- [ ] [Fake second task](02-fake-second.md)',
        '- [ ] [Fake third task](03-fake-third.md) — after 01, 02',
      ],
      rounds: [],
    },
    {
      case: 'wave one done',
      ticked: 2,
      reviewRounds: 0,
      boxes: [
        '- [x] [Fake first task](01-fake-first.md)',
        '- [x] [Fake second task](02-fake-second.md)',
        '- [ ] [Fake third task](03-fake-third.md) — after 01, 02',
      ],
      rounds: [],
    },
    {
      case: 'all done, two rounds',
      ticked: 3,
      reviewRounds: 2,
      boxes: [
        '- [x] [Fake first task](01-fake-first.md)',
        '- [x] [Fake second task](02-fake-second.md)',
        '- [x] [Fake third task](03-fake-third.md) — after 01, 02',
      ],
      rounds: ['- round 1 · no findings', '- round 2 · no findings'],
    },
  ])(
    'fakeWorkflowPlan_TicksAndRounds ($case)',
    ({ ticked, reviewRounds, boxes, rounds }) => {
      const lines = fakeWorkflowPlan(ticked, reviewRounds).split('\n');
      const roundsAt = lines.indexOf('### Review rounds');

      expect(lines.filter((line) => line.startsWith('- ['))).toEqual(boxes);
      expect(roundsAt).toBeGreaterThan(lines.indexOf('## Run log'));
      expect(
        lines.slice(roundsAt).filter((line) => line.startsWith('- ')),
      ).toEqual(rounds);
    },
  );

  it('workflowRun_FeatureThenMake_WalksEveryStage', async () => {
    const files = createMemoryFiles();
    const harness = createFakeAgentHarness(clock, files, FAKE_MICROTASK_TIMERS);
    const planText = async () =>
      (await files.stat(planDir)) === null ? null : files.read(planPath);
    const first = recordingEvents();
    const feature = harness.start(request, first.events);

    feature.send({ text: FAKE_WORKFLOW_FEATURE_TEXT, images: [] });
    await settle();

    expect(workflowEvents(first.agentEvents)).toEqual([
      turnStarted,
      skillStarted('wigley:feature', ''),
      planWritten,
      turnEnded,
    ]);
    expect(await planText()).toBe(fakeWorkflowPlan(0, 0));
    await feature.end();

    const second = recordingEvents();
    const make = harness.start(request, second.events);
    const steps = [
      {
        text: `/wigley:make ${planDir}`,
        events: [
          skillStarted('wigley:make', planDir),
          turnStarted,
          planWritten,
          turnEnded,
        ],
        plan: fakeWorkflowPlan(1, 0),
      },
      {
        text: FAKE_WORKFLOW_STEP_TEXT,
        events: [turnStarted, planWritten, turnEnded],
        plan: fakeWorkflowPlan(2, 0),
      },
      {
        text: FAKE_WORKFLOW_STEP_TEXT,
        events: [
          turnStarted,
          skillStarted('wigley:review', ''),
          planWritten,
          turnEnded,
        ],
        plan: fakeWorkflowPlan(3, 1),
      },
      {
        text: FAKE_WORKFLOW_STEP_TEXT,
        events: [turnStarted, turnEnded],
        plan: null,
      },
    ];
    for (const step of steps) {
      second.agentEvents.length = 0;

      make.send({ text: step.text, images: [] });
      await settle();

      expect(workflowEvents(second.agentEvents)).toEqual(step.events);
      expect(await planText()).toBe(step.plan);
    }
  });

  it('workflowTypedFeature_RunsTheScriptWithOneSkillStarted', async () => {
    const files = createMemoryFiles();
    const { agent, agentEvents } = await startedProcess(files);

    agent.send({
      text: `/wigley:feature ${FAKE_WORKFLOW_FEATURE_TEXT}`,
      images: [],
    });
    await settle();

    expect(await files.read(planPath)).toBe(fakeWorkflowPlan(0, 0));
    expect(workflowEvents(agentEvents)).toEqual([
      skillStarted('wigley:feature', FAKE_WORKFLOW_FEATURE_TEXT),
      turnStarted,
      planWritten,
      turnEnded,
    ]);
  });

  it.each([
    {
      case: 'makeOfAFolderNeverWritten',
      text: '/wigley:make /p/elsewhere',
      events: [
        skillStarted('wigley:make', '/p/elsewhere'),
        turnStarted,
        turnEnded,
      ],
    },
    {
      case: 'stepWithNoMakeRun',
      text: FAKE_WORKFLOW_STEP_TEXT,
      events: [turnStarted, turnEnded],
    },
  ])('workflowSend_$case', async ({ text, events }) => {
    const changed: string[] = [];
    const { agent, heard, agentEvents } = await startedProcess({
      write: async (path) => {
        changed.push(path);
      },
      trash: async (path) => {
        changed.push(path);
      },
    });
    agent.send({ text: FAKE_WORKFLOW_FEATURE_TEXT, images: [] });
    await settle();
    changed.length = 0;
    heard.length = 0;
    agentEvents.length = 0;

    agent.send({ text, images: [] });
    await settle();

    expect(workflowEvents(agentEvents)).toEqual(events);
    expect(replies(heard)).toEqual([`fake agent heard: ${text}`]);
    expect(changed).toEqual([]);
  });

  // Files whose writes and trashes land at once outside `hold()` and
  // `release()`, and between them wait in `pending` until the test settles
  // them. `changes` lists every write and trash in call order.
  function holdableFiles() {
    let isHeld = false;
    const pending: { resolve: () => void; reject: (error: Error) => void }[] =
      [];
    const changes: string[][] = [];
    const change = () =>
      isHeld
        ? new Promise<void>((resolve, reject) =>
            pending.push({ resolve, reject }),
          )
        : Promise.resolve();
    return {
      files: {
        write: (path: string, text: string) => {
          changes.push(['write', path, text]);
          return change();
        },
        trash: (path: string) => {
          changes.push(['trash', path]);
          return change();
        },
      },
      pending,
      changes,
      hold: () => {
        isHeld = true;
      },
      release: () => {
        isHeld = false;
      },
    };
  }

  const makeSteps = [
    FAKE_WORKFLOW_FEATURE_TEXT,
    `/wigley:make ${planDir}`,
    FAKE_WORKFLOW_STEP_TEXT,
    FAKE_WORKFLOW_STEP_TEXT,
  ];

  // `nextChanges` are the changes the next process's `/wigley:make` makes.
  it.each([
    {
      case: 'featureWriteLands',
      landed: [],
      held: FAKE_WORKFLOW_FEATURE_TEXT,
      settle: (change: { resolve: () => void }) => change.resolve(),
      nextChanges: [['write', planPath, fakeWorkflowPlan(1, 0)]],
    },
    {
      case: 'featureWriteRejects',
      landed: [],
      held: FAKE_WORKFLOW_FEATURE_TEXT,
      settle: (change: { reject: (error: Error) => void }) =>
        change.reject(new Error('disk full')),
      nextChanges: [],
    },
    {
      case: 'makeEditLands',
      landed: makeSteps.slice(0, 2),
      held: FAKE_WORKFLOW_STEP_TEXT,
      settle: (change: { resolve: () => void }) => change.resolve(),
      nextChanges: [['write', planPath, fakeWorkflowPlan(3, 1)]],
    },
    {
      case: 'makeTrashLands',
      landed: makeSteps,
      held: FAKE_WORKFLOW_STEP_TEXT,
      settle: (change: { resolve: () => void }) => change.resolve(),
      nextChanges: [],
    },
    {
      case: 'makeTrashRejects',
      landed: makeSteps,
      held: FAKE_WORKFLOW_STEP_TEXT,
      settle: (change: { reject: (error: Error) => void }) =>
        change.reject(new Error('disk full')),
      nextChanges: [['trash', planDir]],
    },
  ])(
    'workflowChange_EndBeforeItSettles_EmitsNothingAfterSessionEnded ($case)',
    async ({ landed, held, settle: settleChange, nextChanges }) => {
      const { files, pending, changes, hold, release } = holdableFiles();
      const { harness, agent, timeline } = await startedProcess(files);
      for (const text of landed) {
        agent.send({ text, images: [] });
        await settle();
      }
      hold();
      agent.send({ text: held, images: [] });
      await settle();
      expect(pending).toHaveLength(1);

      await agent.end();
      settleChange(pending[0]);
      await settle();

      const lines = timeline.map(timelineLine);
      expect(lines.slice(lines.indexOf('sessionEnded'))).toEqual([
        'sessionEnded',
        'ended',
      ]);

      release();
      changes.length = 0;
      const next = harness.start(request, recordingEvents().events);
      next.send({ text: `/wigley:make ${planDir}`, images: [] });
      await settle();

      expect(changes).toEqual(nextChanges);
    },
  );

  it('workflowWrite_Rejects_EndsTheTurnWithANotice', async () => {
    const { agent, heard, agentEvents } = await startedProcess({
      write: async () => {
        throw new Error('disk full');
      },
      trash: async () => {},
    });

    agent.send({ text: FAKE_WORKFLOW_FEATURE_TEXT, images: [] });
    await settle();

    expect(heard.map(([, payload]) => payload)).toContainEqual(
      expect.objectContaining({
        kind: 'notice',
        tone: 'error',
        text: expect.stringMatching(new RegExp(`${planPath}.*disk full`)),
      }),
    );
    expect(
      agentEvents.flatMap((event) =>
        event.type === 'toolFinished' ? [event.ok] : [],
      ),
    ).toEqual([true, false]);
    expect(workflowEvents(agentEvents)).toEqual([
      turnStarted,
      skillStarted('wigley:feature', ''),
      turnEnded,
    ]);
  });
});
