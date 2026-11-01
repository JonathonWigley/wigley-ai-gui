import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  AgentProcessEvents,
  AgentStart,
  ChatEntry,
  LogInEvents,
} from '../contracts/agent';
import {
  createFakeAgentHarness,
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
};

// Every event the process emits, as `[event name, payload]`, in emit order.
function recordingEvents() {
  const heard: [string, unknown][] = [];
  const events: AgentProcessEvents = {
    entry: (entry) => heard.push(['entry', entry]),
    controls: (controls) => heard.push(['controls', controls]),
    activity: (activity) => heard.push(['activity', activity]),
    commands: (names) => heard.push(['commands', names]),
    planUsage: (update) => heard.push(['planUsage', update]),
    agentEvent: (event) => heard.push(['agentEvent', event]),
    ended: (end) => heard.push(['ended', end]),
  };
  return { heard, events };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// A started process with its start events flushed and cleared.
async function startedProcess() {
  const harness = createFakeAgentHarness(clock);
  const { heard, events } = recordingEvents();
  const agent = harness.start(request, events);
  await flush();
  heard.length = 0;
  return { harness, agent, heard, record: harness.processes[0] };
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
    const { agent, heard } = await startedProcess();

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
