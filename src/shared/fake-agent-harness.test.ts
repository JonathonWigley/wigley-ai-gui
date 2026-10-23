import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  AgentProcessEvents,
  AgentStart,
  LogInEvents,
} from '../contracts/agent';
import {
  createFakeAgentHarness,
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_SIGN_IN_CODE,
  FAKE_SIGN_IN_URL,
  FAKE_TOOL_TEXT,
  isFakeAgentHarness,
} from './fake-agent-harness';

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
  const harness = createFakeAgentHarness();
  const { heard, events } = recordingEvents();
  const agent = harness.start(request, events);
  await flush();
  heard.length = 0;
  return { harness, agent, heard, record: harness.processes[0] };
}

describe('createFakeAgentHarness', () => {
  it('start_RecordsRequestAndEvents_ThenControlsCommandsIdle', async () => {
    const harness = createFakeAgentHarness();
    const { heard, events } = recordingEvents();

    harness.start(request, events);
    expect(heard).toEqual([]);
    await flush();

    expect(harness.processes[0].request).toBe(request);
    expect(harness.processes[0].events).toBe(events);
    expect(heard).toEqual([
      [
        'controls',
        [
          {
            id: 'mode',
            label: 'Mode',
            choices: [
              { value: 'auto', label: 'Auto' },
              { value: 'plan', label: 'Plan' },
            ],
            value: 'auto',
          },
          {
            id: 'effort',
            label: 'Effort',
            choices: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ],
            value: 'medium',
          },
        ],
      ],
      ['commands', ['fake-command']],
      ['activity', 'idle'],
    ]);
  });

  it('failNextStart_ThrowsOnce', () => {
    const harness = createFakeAgentHarness();
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
          stopReason: 'end_turn',
          costUsd: null,
          durationMs: null,
          raw: [{ fake: 'result' }],
        },
      ],
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
          stopReason: 'end_turn',
          costUsd: null,
          durationMs: null,
          raw: [{ fake: 'result' }],
        },
      ],
      ['activity', 'idle'],
    ]);
    expect(heard.slice(0, 2)).toEqual([
      [
        'entry',
        {
          kind: 'user',
          id: 'user-1',
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
          text: 'Interrupted',
          tone: 'info',
          raw: [{ fake: 'interrupt' }],
        },
      ],
      ['activity', 'idle'],
    ]);
    expect(record.calls.at(-1)).toEqual({ method: 'interrupt' });
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
        ],
      ],
    ]);
    expect(record.calls).toEqual([
      { method: 'setControl', id: 'effort', value: 'high' },
    ]);
  });

  it('setControl_UnknownChoice_Throws', async () => {
    const { agent, record } = await startedProcess();

    expect(() => agent.setControl('effort', 'max')).toThrow(
      'fake agent control effort has no choice max',
    );
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
    expect(() => agent.send({ text: 'x', images: [] })).toThrow(
      'fake agent process has ended',
    );
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
    const harness = createFakeAgentHarness();

    const sessions = await harness.listSessions('/a', '/p');

    expect(sessions).toEqual([
      {
        sessionId: '00000000-0000-4000-8000-000000000001',
        title: 'fake past session one',
        modified: 1767323045000,
      },
      {
        sessionId: '00000000-0000-4000-8000-000000000002',
        title: 'fake past session two',
        modified: 1767236645000,
      },
    ]);
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
    const harness = createFakeAgentHarness();
    const known = '00000000-0000-4000-8000-000000000001';

    expect(await harness.history(known, '/a', null)).toEqual([
      {
        kind: 'user',
        id: `history:${known}-user`,
        text: 'fake earlier message',
        images: [],
        raw: [{ fake: 'history-user' }],
      },
      {
        kind: 'assistant',
        id: `history:${known}-assistant`,
        text: 'fake earlier reply',
        streaming: false,
        raw: [{ fake: 'history-assistant' }],
      },
    ]);
    await expect(harness.history('nope', '/a', null)).rejects.toThrow(
      'fake agent has no saved session nope',
    );
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

  it('isFakeAgentHarness_TellsTheFakeFromAnother', () => {
    // A copy has every member of the fake but is not the object it made.
    const other: AgentHarness = { ...createFakeAgentHarness() };

    expect(isFakeAgentHarness(createFakeAgentHarness())).toBe(true);
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
    const harness = createFakeAgentHarness();
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

  it('logIn_WrongCodeThenCancel_EndsOnceSignedOut', async () => {
    const harness = createFakeAgentHarness();
    const { heard, events } = recordingLogIn();

    const login = harness.logIn(null, events);
    login.sendCode('nope');
    login.cancel();
    await flush();

    expect(heard).toEqual([
      ['link', FAKE_SIGN_IN_URL],
      [
        'ended',
        { status: { signedIn: false, account: null }, error: 'Wrong code' },
      ],
    ]);
  });

  it('logOut_ThenStatus_SignedOut', async () => {
    const harness = createFakeAgentHarness();
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
    const harness = createFakeAgentHarness();
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
