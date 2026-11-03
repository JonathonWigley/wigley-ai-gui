import { describe, expect, it } from 'vitest';
import type { AgentStart } from '../../contracts/agent';
import type { PipeDirection, PipeLine } from '../../contracts/session-host';
import { controlMessage, userMessage } from './claude-controls';
import {
  advanceFold,
  createSessionFoldState,
  foldPipeLine,
  replayPipeLog,
  type SessionFoldState,
} from './session-fold';

const request: AgentStart = {
  processId: 'p-1',
  sessionId: 's-1',
  resume: false,
  projectDir: '/proj',
  profileDir: null,
  controls: {},
  instructions: [],
};

const GRACE_NOTICE =
  'Claude did not stop within 5 s; showing the session idle.';

// Measured lines, docs/features/agent-chat/claude-stream.md § Usage and § Other events.
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false}}';
const REPLY_LINE =
  '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":2000,"cache_read_input_tokens":40000,"output_tokens":120,"cache_creation":{"ephemeral_1h_input_tokens":2000,"ephemeral_5m_input_tokens":0}}},"parent_tool_use_id":null}';

const lifecycleInit = {
  type: 'system',
  subtype: 'init',
  capabilities: ['msg_lifecycle_v1'],
};
const plainInit = { type: 'system', subtype: 'init' };
const lifecycle = (uuid: string, state: string) => ({
  type: 'command_lifecycle',
  command_uuid: uuid,
  state,
});
const successResult = (result: string, uuids: string[] = []) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  total_cost_usd: 0,
  num_turns: 0,
  ...(uuids.length === 0
    ? {}
    : { user_message_uuid: uuids[0], user_message_uuids: uuids }),
});
const controlRequest = (requestId: string, subtype: string) => ({
  type: 'control_request',
  request_id: requestId,
  request: { subtype },
});
const contextUsageRequest = (requestId: string) =>
  controlRequest(requestId, 'get_context_usage');
const interruptRequest = (requestId: string) =>
  controlRequest(requestId, 'interrupt');
const interruptReply = (requestId: string) => ({
  type: 'control_response',
  response: { subtype: 'success', request_id: requestId },
});
const send = (text: string, uuid: string) =>
  userMessage({ text, images: [] }, uuid);

const streamLine = (event: object) => ({
  type: 'stream_event',
  event,
  parent_tool_use_id: null,
});
const messageStart = (id: string) =>
  streamLine({
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', content: [] },
  });
const textStart = streamLine({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
});
const textDelta = (text: string) =>
  streamLine({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });

const pipeLine = (
  dir: PipeDirection,
  message: object | string,
  at: number,
): PipeLine => ({
  seq: 0,
  dir,
  at,
  text: typeof message === 'string' ? message : JSON.stringify(message),
});
const inLine = (message: object | string, at = 100) =>
  pipeLine('in', message, at);
const outLine = (message: object | string, at = 100) =>
  pipeLine('out', message, at);

function foldedState(lines: readonly PipeLine[]): SessionFoldState {
  const state = createSessionFoldState(request);
  for (const line of lines) {
    foldPipeLine(state, line);
  }
  return state;
}

// The fields the `in` lines change, with the maps as plain values.
function snapshot(state: SessionFoldState) {
  return {
    sendCount: state.sendCount,
    requestCount: state.requestCount,
    noticeCount: state.noticeCount,
    pending: Object.fromEntries(state.pendingRequests),
    heldUuids: [...state.heldMessages.keys()],
    heldDrafts: [...state.heldMessages.values()].map((held) => held.draft),
    heldSkills: [...state.heldMessages.values()].map((held) => held.skill),
    trackerActivity: state.tracker.activity(),
    activity: state.activity,
    graceDeadline: state.graceDeadline,
    isContextRequestOwed: state.isContextRequestOwed,
  };
}

const SEND_U1 = inLine(send('hi', 'u1'), 500);

describe('session-fold', () => {
  it.each<{
    case: string;
    setup?: PipeLine[];
    line: PipeLine;
    state: Partial<ReturnType<typeof snapshot>> | 'unchanged';
    effects?: unknown[];
  }>([
    {
      case: 'send',
      line: inLine(send('hi', 'u1')),
      state: {
        sendCount: 1,
        heldUuids: ['u1'],
        trackerActivity: 'working',
        activity: 'working',
      },
    },
    {
      case: 'send with an image',
      line: inLine(
        userMessage(
          { text: 'see', images: [{ mediaType: 'image/png', data: 'AAA' }] },
          'u1',
        ),
      ),
      state: {
        heldDrafts: [
          expect.objectContaining({
            id: 'user-1',
            text: 'see',
            images: [{ mediaType: 'image/png', data: 'AAA' }],
          }),
        ],
      },
    },
    {
      case: 'app pick',
      line: inLine(controlMessage('effort', 'high', '00000000-1')),
      state: { sendCount: 0, heldUuids: [], trackerActivity: 'working' },
    },
    {
      case: 'app command, not a pick',
      line: inLine(send('/compact', '00000000-1')),
      state: { sendCount: 0, heldUuids: [], trackerActivity: 'working' },
    },
    {
      case: 'typed command',
      line: inLine(send('/effort high', 'u2')),
      state: {
        sendCount: 1,
        heldDrafts: [expect.objectContaining({ text: '/effort high' })],
        heldSkills: [null],
      },
    },
    {
      case: 'typed skill',
      line: inLine(send('/wigley:feature add x', 'u2')),
      state: { heldSkills: [{ skill: 'wigley:feature', args: 'add x' }] },
    },
    {
      case: 'context request',
      line: inLine(contextUsageRequest('wigley-4')),
      state: {
        requestCount: 4,
        pending: { 'wigley-4': { kind: 'contextUsage' } },
        isContextRequestOwed: false,
      },
    },
    {
      case: 'interrupt',
      setup: [SEND_U1],
      line: inLine(interruptRequest('wigley-2'), 1000),
      state: {
        pending: { 'wigley-2': { kind: 'interrupt' } },
        graceDeadline: 6000,
        noticeCount: 1,
        activity: 'working',
      },
      effects: [
        {
          kind: 'entry',
          entry: expect.objectContaining({
            kind: 'notice',
            id: 'control-notice-1',
            at: 1000,
            text: 'Interrupted',
            tone: 'info',
          }),
        },
      ],
    },
    {
      case: 'interrupt while idle',
      line: inLine(interruptRequest('wigley-2'), 1000),
      state: {
        pending: { 'wigley-2': { kind: 'interrupt' } },
        graceDeadline: null,
        noticeCount: 1,
      },
      effects: [
        {
          kind: 'entry',
          entry: expect.objectContaining({
            id: 'control-notice-1',
            at: 1000,
            text: 'Interrupted',
          }),
        },
      ],
    },
    {
      case: 'mode',
      line: inLine(controlMessage('mode', 'plan', 'wigley-3')),
      state: { pending: { 'wigley-3': { kind: 'mode', value: 'plan' } } },
    },
    {
      case: 'refusal',
      line: inLine({
        type: 'control_response',
        response: { subtype: 'error', request_id: 'r-1', error: 'no' },
      }),
      state: 'unchanged',
    },
    { case: 'not JSON', line: inLine('oops'), state: 'unchanged' },
  ])(
    'foldPipeLine_InLines_RebuildStdinState ($case)',
    ({ setup = [], line, state: expected, effects = [] }) => {
      const state = foldedState(setup);
      const before = snapshot(state);

      const step = foldPipeLine(state, line);

      expect(step.effects.filter((e) => e.kind !== 'activity')).toEqual(
        effects,
      );
      expect(snapshot(state)).toMatchObject(
        expected === 'unchanged' ? before : expected,
      );
    },
  );

  it('foldPipeLine_TurnEnd_OwesAContextRequest', () => {
    const state = foldedState([
      SEND_U1,
      outLine(lifecycleInit),
      outLine(lifecycle('u1', 'started')),
    ]);

    const { effects } = foldPipeLine(
      state,
      outLine(successResult('ok', ['u1'])),
    );

    expect(state.isContextRequestOwed).toBe(true);
    expect(effects.filter((e) => e.kind === 'requestContextUsage')).toEqual([
      { kind: 'requestContextUsage' },
    ]);
    foldPipeLine(state, inLine(contextUsageRequest('wigley-2')));
    expect(state.isContextRequestOwed).toBe(false);
  });

  it('foldPipeLine_FallbackSend_EmitsTheUserMessage', () => {
    const state = foldedState([outLine(plainInit)]);

    const { effects } = foldPipeLine(
      state,
      inLine(send('/skill arg', 'u1'), 300),
    );

    expect(effects).toEqual([
      {
        kind: 'entry',
        entry: expect.objectContaining({ id: 'user-1', at: 300 }),
      },
      { kind: 'agentEvent', event: { type: 'userMessage', at: 300 } },
      {
        kind: 'agentEvent',
        event: {
          type: 'skillStarted',
          at: 300,
          agentId: 'main',
          skill: 'skill',
          args: 'arg',
        },
      },
    ]);
    expect(state.heldMessages.size).toBe(0);
  });

  it('foldPipeLine_StampsWithTheLineTime', () => {
    const state = createSessionFoldState(request);

    const init = foldPipeLine(state, outLine(lifecycleInit, 7000));
    foldPipeLine(state, outLine(messageStart('m1'), 7000));
    foldPipeLine(state, outLine(textStart, 7000));
    const first = foldPipeLine(state, outLine(textDelta('a'), 7000));
    const next = foldPipeLine(state, outLine(textDelta('b'), 9000));
    const reply = foldPipeLine(state, outLine(REPLY_LINE, 9500));
    const plan = foldPipeLine(state, outLine(RATE_LIMIT_LINE, 9700));

    expect(init.effects).toContainEqual({
      kind: 'agentEvent',
      event: { type: 'turnStarted', at: 7000 },
    });
    for (const { effects } of [first, next]) {
      expect(effects).toEqual([
        {
          kind: 'entry',
          entry: expect.objectContaining({ kind: 'assistant', at: 7000 }),
        },
      ]);
    }
    expect(reply.effects).toContainEqual({
      kind: 'agentEvent',
      event: expect.objectContaining({
        type: 'usage',
        at: 9500,
        cacheExpiresAt: 9500 + 3_600_000,
      }),
    });
    expect(plan.effects).toContainEqual({
      kind: 'planUsage',
      update: expect.objectContaining({ at: 9700 }),
    });
  });

  it('foldPipeLine_LineAfterDeadline_EndsTheGraceFirst', () => {
    const state = foldedState([
      SEND_U1,
      outLine(lifecycleInit, 600),
      inLine(interruptRequest('wigley-2'), 1000),
    ]);

    const { effects } = foldPipeLine(state, outLine(REPLY_LINE, 7000));

    expect(effects[0]).toEqual({
      kind: 'entry',
      entry: expect.objectContaining({ text: GRACE_NOTICE, at: 6000 }),
    });
    expect(effects.map((effect) => effect.kind).slice(1, 3)).toEqual([
      'log',
      'activity',
    ]);
    expect(state.graceDeadline).toBeNull();
  });

  it.each<{
    case: string;
    setup: PipeLine[];
    at: number;
    effects: unknown[];
    deadlineAfter: number | null;
  }>([
    {
      case: 'before the deadline',
      setup: [SEND_U1, inLine(interruptRequest('wigley-2'), 1000)],
      at: 5999,
      effects: [],
      deadlineAfter: 6000,
    },
    {
      case: 'at the deadline',
      setup: [SEND_U1, inLine(interruptRequest('wigley-2'), 1000)],
      at: 6000,
      effects: [
        {
          kind: 'entry',
          entry: expect.objectContaining({
            kind: 'notice',
            at: 6000,
            text: GRACE_NOTICE,
            tone: 'info',
          }),
        },
        { kind: 'log', text: expect.stringContaining('unanswered') },
        { kind: 'activity', activity: 'idle' },
      ],
      deadlineAfter: null,
    },
    {
      case: 'idle at the deadline',
      setup: [
        SEND_U1,
        inLine(interruptRequest('wigley-2'), 1000),
        outLine(interruptReply('wigley-2'), 2000),
      ],
      at: 6000,
      effects: [],
      deadlineAfter: null,
    },
  ])('advanceFold_Grace ($case)', ({ setup, at, effects, deadlineAfter }) => {
    const state = foldedState(setup);

    const step = advanceFold(state, at);

    expect(step.effects).toEqual(effects);
    expect(state.graceDeadline).toBe(deadlineAfter);
  });

  it('replayPipeLog_Emissions_CollapsedAndFiltered', () => {
    const messages: (object | string)[] = [
      {
        type: 'system',
        subtype: 'init',
        capabilities: ['msg_lifecycle_v1'],
        slash_commands: ['/compact'],
      },
      messageStart('m1'),
      textStart,
      textDelta('a'),
      textDelta('b'),
      textDelta('c'),
      RATE_LIMIT_LINE,
      successResult('ok'),
      {
        type: 'control_request',
        request_id: 'r-1',
        request: { subtype: 'can_use_tool' },
      },
    ];
    const log = [
      ...messages.map((message, index) => outLine(message, 1000 * (index + 1))),
      pipeLine('err', 'warn', 1000 * (messages.length + 1)),
    ];

    const effects = replayPipeLog(createSessionFoldState(request), log, 60000);

    expect(effects[0]).toEqual({
      kind: 'agentEvent',
      event: { type: 'sessionStarted', at: 1000 },
    });
    const assistant = effects.flatMap((effect) =>
      effect.kind === 'entry' && effect.entry.kind === 'assistant'
        ? [effect.entry]
        : [],
    );
    expect(assistant).toEqual([
      expect.objectContaining({ text: 'abc', at: 3000 }),
    ]);
    const kinds = effects.map((effect) => effect.kind);
    for (const dropped of [
      'planUsage',
      'requestContextUsage',
      'refuseHostRequest',
      'log',
      'messageDropped',
    ]) {
      expect(kinds).not.toContain(dropped);
    }
    expect(kinds.filter((kind) => kind === 'controls')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'commands')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'activity')).toHaveLength(1);
    const [controls, commands, activity] = effects.slice(-3);
    expect(controls).toEqual({
      kind: 'controls',
      controls: expect.arrayContaining([
        expect.objectContaining({ id: 'mode', value: null }),
        expect.objectContaining({ id: 'effort', value: null }),
        expect.objectContaining({ id: 'model', value: null }),
      ]),
    });
    expect(commands).toEqual({ kind: 'commands', commands: ['compact'] });
    expect(activity).toEqual({ kind: 'activity', activity: 'idle' });
  });

  it.each([
    {
      case: 'expired while away',
      now: 60000,
      noticeAt: 6000,
      activity: 'idle',
      graceDeadline: null,
    },
    {
      case: 'still pending',
      now: 3000,
      noticeAt: null,
      activity: 'working',
      graceDeadline: 6000,
    },
  ])(
    'replayPipeLog_GraceAcrossTheBoundary ($case)',
    ({ now, noticeAt, activity, graceDeadline }) => {
      const state = createSessionFoldState(request);
      const log = [
        SEND_U1,
        outLine(lifecycleInit, 600),
        outLine(lifecycle('u1', 'started'), 700),
        inLine(interruptRequest('wigley-2'), 1000),
      ];

      const effects = replayPipeLog(state, log, now);

      const notices = effects.flatMap((effect) =>
        effect.kind === 'entry' &&
        effect.entry.kind === 'notice' &&
        effect.entry.text === GRACE_NOTICE
          ? [effect.entry.at]
          : [],
      );
      expect(notices).toEqual(noticeAt === null ? [] : [noticeAt]);
      expect(effects.at(-1)).toEqual({ kind: 'activity', activity });
      expect(state.graceDeadline).toBe(graceDeadline);
    },
  );

  it('replayPipeLog_EmptyLog_StartsAtNow', () => {
    const effects = replayPipeLog(createSessionFoldState(request), [], 4000);

    expect(effects.map((effect) => effect.kind)).toEqual([
      'agentEvent',
      'controls',
      'activity',
    ]);
    expect(effects[0]).toEqual({
      kind: 'agentEvent',
      event: { type: 'sessionStarted', at: 4000 },
    });
    expect(effects[2]).toEqual({ kind: 'activity', activity: 'idle' });
  });
});
