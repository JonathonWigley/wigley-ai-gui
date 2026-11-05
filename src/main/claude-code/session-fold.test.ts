import { describe, expect, it } from 'vitest';
import type { AgentStart } from '../../contracts/agent';
import type { PipeDirection, PipeLine } from '../../contracts/session-host';
import { controlMessage, userMessage } from './claude-controls';
import {
  advanceFold,
  createSessionFoldState,
  type FoldEffect,
  foldPipeLine,
  foldUsageInput,
  replayPipeLog,
  type SessionFoldState,
} from './session-fold';
import { withConfiguredPercent } from './session-usage';

const request: AgentStart = {
  processId: 'p-1',
  sessionId: 's-1',
  resume: false,
  projectDir: '/proj',
  profileDir: null,
  controls: {},
  instructions: [],
  idleCompactMinTokens: null,
  rowId: 'row-1',
};

const GRACE_NOTICE =
  'Claude did not stop within 5 s; showing the session idle.';

// Measured lines, docs/features/agent-chat/claude-stream.md § Usage and § Other events.
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false}}';
const REPLY_LINE =
  '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":2000,"cache_read_input_tokens":40000,"output_tokens":120,"cache_creation":{"ephemeral_1h_input_tokens":2000,"ephemeral_5m_input_tokens":0}}},"parent_tool_use_id":null}';
// A main reply that only read the cache, 40123 tokens.
const CACHE_READ_LINE =
  '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_2","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,"usage":{"input_tokens":3,"cache_read_input_tokens":40000,"output_tokens":120}},"parent_tool_use_id":null}';

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
const settingsRequest = (requestId: string) =>
  controlRequest(requestId, 'get_settings');
const interruptRequest = (requestId: string) =>
  controlRequest(requestId, 'interrupt');
const interruptReply = (requestId: string) => ({
  type: 'control_response',
  response: { subtype: 'success', request_id: requestId },
});
// A `get_settings` reply to `wigley-2`, nested as the CLI nests it.
const settingsReply = (reply: object) => ({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'wigley-2',
    response: { effective: {}, sources: [], ...reply },
  },
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

function controlValues(state: SessionFoldState) {
  return Object.fromEntries(state.controls.map(({ id, value }) => [id, value]));
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
    isSettingsRequestOwed: state.isSettingsRequestOwed,
  };
}

const SEND_U1 = inLine(send('hi', 'u1'), 500);

const COMPACTING = { type: 'system', subtype: 'status', status: 'compacting' };
const BOUNDARY = {
  type: 'system',
  subtype: 'compact_boundary',
  compact_metadata: { pre_tokens: 37559, duration_ms: 8303 },
};

const usageEvents = (effects: readonly FoldEffect[]) =>
  effects.flatMap((effect) =>
    effect.kind === 'agentEvent' && effect.event.type === 'usage'
      ? [effect.event]
      : [],
  );
const compactionEvents = (effects: readonly FoldEffect[]) =>
  effects.flatMap((effect) =>
    effect.kind === 'agentEvent' && effect.event.type.startsWith('compaction')
      ? [effect.event]
      : [],
  );

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
      case: 'settings request',
      line: inLine(settingsRequest('wigley-4')),
      state: {
        requestCount: 4,
        pending: { 'wigley-4': { kind: 'appliedSettings' } },
        isSettingsRequestOwed: false,
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
      case: 'interrupt of a /compact past its first status',
      setup: [
        inLine(send('/compact', 'u1'), 500),
        outLine(lifecycle('u1', 'started'), 600),
        outLine(COMPACTING, 700),
      ],
      line: inLine(interruptRequest('wigley-2'), 1000),
      state: {
        pending: { 'wigley-2': { kind: 'interrupt' } },
        graceDeadline: 6000,
        noticeCount: 0,
      },
    },
    {
      case: 'interrupt of a /compact before its first status',
      setup: [
        inLine(send('/compact', 'u1'), 500),
        outLine(lifecycle('u1', 'started'), 600),
      ],
      line: inLine(interruptRequest('wigley-2'), 1000),
      state: { noticeCount: 1 },
      effects: [
        {
          kind: 'entry',
          entry: expect.objectContaining({ text: 'Interrupted' }),
        },
      ],
    },
    {
      case: 'interrupt of a model turn during its own compaction',
      setup: [
        SEND_U1,
        outLine(lifecycle('u1', 'started'), 600),
        outLine(lifecycleInit, 650),
        outLine(COMPACTING, 700),
      ],
      line: inLine(interruptRequest('wigley-2'), 1000),
      state: { noticeCount: 1 },
      effects: [
        {
          kind: 'entry',
          entry: expect.objectContaining({ text: 'Interrupted' }),
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

  it.each([
    { case: 'a model turn', text: 'hi' },
    { case: 'a local command', text: '/effort high' },
  ])(
    'foldPipeLine_TurnEnd_OwesContextAndSettingsRequests ($case)',
    ({ text }) => {
      const state = foldedState([
        inLine(settingsRequest('wigley-1')),
        inLine(send(text, 'u1')),
        outLine(lifecycleInit),
        outLine(lifecycle('u1', 'started')),
      ]);
      expect(state.isSettingsRequestOwed).toBe(false);

      const { effects } = foldPipeLine(
        state,
        outLine(successResult('ok', ['u1'])),
      );

      expect(state.isContextRequestOwed).toBe(true);
      expect(state.isSettingsRequestOwed).toBe(true);
      expect(
        effects.filter(
          (e) =>
            e.kind === 'requestContextUsage' ||
            e.kind === 'requestAppliedSettings',
        ),
      ).toEqual([
        { kind: 'requestContextUsage' },
        { kind: 'requestAppliedSettings' },
      ]);
      foldPipeLine(state, inLine(contextUsageRequest('wigley-2')));
      expect(state.isContextRequestOwed).toBe(false);
      foldPipeLine(state, inLine(settingsRequest('wigley-3')));
      expect(state.isSettingsRequestOwed).toBe(false);
    },
  );

  it.each<{
    case: string;
    held: Record<string, string>;
    reply: object;
    kinds: string[];
    controls: { model: string | null; effort: string | null };
  }>([
    {
      case: 'a new session reads what the process applies',
      held: {},
      reply: settingsReply({
        applied: { model: 'claude-opus-5-5', effort: 'medium' },
      }),
      kinds: ['controls'],
      controls: { model: 'opus', effort: 'medium' },
    },
    {
      case: 'a model with no effort support clears the effort',
      held: { model: 'haiku', effort: 'high' },
      reply: settingsReply({
        applied: { model: 'claude-haiku-4-5', effort: null },
      }),
      kinds: ['controls'],
      controls: { model: 'haiku', effort: null },
    },
    {
      case: 'only the model changed',
      held: { model: 'opus', effort: 'low' },
      reply: settingsReply({
        applied: { model: 'claude-sonnet-5-5', effort: 'low' },
      }),
      kinds: ['controls'],
      controls: { model: 'sonnet', effort: 'low' },
    },
    {
      case: 'held values equal the reply',
      held: { model: 'opus', effort: 'medium' },
      reply: settingsReply({
        applied: { model: 'claude-opus-5-5', effort: 'medium' },
      }),
      kinds: [],
      controls: { model: 'opus', effort: 'medium' },
    },
    {
      case: 'an error reply',
      held: { model: 'opus', effort: 'high' },
      reply: {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: 'wigley-2',
          error: 'busy',
        },
      },
      kinds: ['log'],
      controls: { model: 'opus', effort: 'high' },
    },
    {
      case: 'a reply with no applied model',
      held: { model: 'opus', effort: 'high' },
      reply: settingsReply({ effective: { effortLevel: 'low' } }),
      kinds: ['log'],
      controls: { model: 'opus', effort: 'high' },
    },
    {
      case: 'an effort outside the choices stays raw',
      held: { model: 'opus', effort: 'high' },
      reply: settingsReply({
        applied: { model: 'claude-opus-5-5', effort: 'ultra' },
      }),
      kinds: ['controls'],
      controls: { model: 'opus', effort: 'ultra' },
    },
  ])(
    'foldPipeLine_SettingsReply_HoldsAppliedValues ($case)',
    ({ held, reply, kinds, controls }) => {
      const state = createSessionFoldState({ ...request, controls: held });
      foldPipeLine(state, inLine(settingsRequest('wigley-2')));

      const { effects } = foldPipeLine(state, outLine(reply));

      expect(effects.map((effect) => effect.kind)).toEqual(kinds);
      expect(controlValues(state)).toEqual({ mode: null, ...controls });
      for (const effect of effects) {
        if (effect.kind === 'controls') {
          expect(effect.controls).toEqual(state.controls);
        }
      }
    },
  );

  it.each<{
    case: string;
    text: string;
    held: Record<string, string>;
    reportsControls: boolean;
    effort: string | null;
  }>([
    {
      case: 'a value already held confirms the pick',
      text: '/effort medium',
      held: { effort: 'medium' },
      reportsControls: true,
      effort: 'medium',
    },
    {
      case: 'a new value',
      text: '/effort high',
      held: { effort: 'medium' },
      reportsControls: true,
      effort: 'high',
    },
    {
      case: 'a value outside the choices, none held',
      text: '/effort auto',
      held: {},
      reportsControls: false,
      effort: null,
    },
  ])(
    'foldPipeLine_ControlCommandResult_ReportsControls ($case)',
    ({ text, held, reportsControls, effort }) => {
      const state = createSessionFoldState({ ...request, controls: held });
      foldPipeLine(state, inLine(send(text, 'u1')));
      foldPipeLine(state, outLine(lifecycleInit));
      foldPipeLine(state, outLine(lifecycle('u1', 'started')));

      const { effects } = foldPipeLine(
        state,
        outLine(successResult('Set', ['u1'])),
      );

      expect(effects.some((effect) => effect.kind === 'controls')).toBe(
        reportsControls,
      );
      expect(controlValues(state).effort).toBe(effort);
    },
  );

  it('foldPipeLine_HostRequest_OwedUntilAnswered', () => {
    const state = createSessionFoldState(request);

    const { effects } = foldPipeLine(
      state,
      outLine(controlRequest('r-1', 'can_use_tool')),
    );

    expect(effects).toContainEqual({
      kind: 'refuseHostRequest',
      requestId: 'r-1',
      subtype: 'can_use_tool',
    });
    expect([...state.owedHostRequests]).toEqual([['r-1', 'can_use_tool']]);
    foldPipeLine(
      state,
      inLine({
        type: 'control_response',
        response: { subtype: 'error', request_id: 'r-1', error: 'no' },
      }),
    );
    expect(state.owedHostRequests.size).toBe(0);
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

  it.each([
    { name: 'WithAnOverride', percent: 30, limit: 300_000 },
    { name: 'WithNoOverride', percent: null, limit: null },
  ])(
    'foldPipeLine_SubagentReply_AutocompactLimit_$name',
    ({ percent, limit }) => {
      const state = foldedState([
        outLine({
          type: 'result',
          subtype: 'success',
          modelUsage: { 'claude-opus-5-5': { contextWindow: 1_000_000 } },
        }),
      ]);
      foldUsageInput(
        state,
        (usage) => withConfiguredPercent(usage, percent),
        200,
      );

      const { effects } = foldPipeLine(
        state,
        outLine({
          type: 'assistant',
          parent_tool_use_id: 'toolu_1',
          message: {
            id: 'msg_sub',
            model: 'claude-opus-5-5',
            content: [],
            usage: { input_tokens: 174_000 },
          },
        }),
      );

      expect(effects).toContainEqual({
        kind: 'agentEvent',
        event: expect.objectContaining({
          type: 'agentReplied',
          contextWindow: 1_000_000,
          autocompactLimit: limit,
        }),
      });
    },
  );

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

    const effects = replayPipeLog(
      createSessionFoldState(request),
      log,
      60000,
      null,
    );

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
      'requestAppliedSettings',
      'refuseHostRequest',
      'log',
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

      const effects = replayPipeLog(state, log, now, null);

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

  it('replayPipeLog_DroppedMessage_ReportsItsTextAndImages', () => {
    const image = { mediaType: 'image/png', data: 'aGk=' };
    const log = [
      inLine(userMessage({ text: 'hi', images: [image] }, 'u1'), 500),
      outLine(lifecycleInit, 600),
      outLine(lifecycle('u1', 'cancelled'), 700),
    ];

    const effects = replayPipeLog(
      createSessionFoldState(request),
      log,
      800,
      null,
    );

    expect(
      effects.filter((effect) => effect.kind === 'messageDropped'),
    ).toEqual([
      {
        kind: 'messageDropped',
        entryId: 'user-1',
        message: { text: 'hi', images: [image] },
      },
    ]);
  });

  it('replayPipeLog_EmptyLog_StartsAtNow', () => {
    const effects = replayPipeLog(
      createSessionFoldState(request),
      [],
      4000,
      null,
    );

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

  const HOUR_MS = 3_600_000;
  const SAVED_WRITE_AT_100 = [
    {
      reply: { contextTokens: 500, cacheTtlMs: HOUR_MS, readsCache: false },
      at: 100,
    },
  ];
  it.each([
    {
      case: 'a logged reply only reads the cache',
      saved: SAVED_WRITE_AT_100,
      log: [outLine(lifecycleInit, 2000), outLine(CACHE_READ_LINE, 5000)],
      usage: [
        { at: 2000, contextTokens: 500, cacheExpiresAt: 100 + HOUR_MS },
        { at: 5000, contextTokens: 40123, cacheExpiresAt: 5000 + HOUR_MS },
      ],
    },
    {
      case: 'an empty log',
      saved: SAVED_WRITE_AT_100,
      log: [],
      usage: [{ at: 4000, contextTokens: 500, cacheExpiresAt: 100 + HOUR_MS }],
    },
    {
      case: 'no saved replies',
      saved: null,
      log: [outLine(lifecycleInit, 2000), outLine(CACHE_READ_LINE, 5000)],
      usage: [{ at: 5000, contextTokens: 40123, cacheExpiresAt: null }],
    },
  ])(
    'replayPipeLog_SavedReplies_FoldFirst ($case)',
    ({ saved, log, usage }) => {
      const state = createSessionFoldState({ ...request, resume: true });

      const effects = replayPipeLog(state, log, 4000, saved);

      const replayed = effects.flatMap((effect) =>
        effect.kind === 'agentEvent' && effect.event.type === 'usage'
          ? [effect.event]
          : [],
      );
      expect(replayed).toEqual(
        usage.map((row) => expect.objectContaining(row)),
      );
    },
  );

  it.each<{
    case: string;
    between: (state: SessionFoldState) => FoldEffect[];
    spendUsd: number | null;
  }>([
    {
      case: "the /compact's own result",
      between: (state) =>
        foldPipeLine(
          state,
          outLine(
            {
              ...successResult('', ['u1']),
              total_cost_usd: 0.5,
              local_command: 'compact',
            },
            3000,
          ),
        ).effects,
      spendUsd: 0.5,
    },
    {
      case: 'a context usage reply with no total',
      between: (state) => {
        foldPipeLine(state, inLine(contextUsageRequest('wigley-2'), 3000));
        return foldPipeLine(
          state,
          outLine(
            {
              type: 'control_response',
              response: {
                subtype: 'success',
                request_id: 'wigley-2',
                response: { maxTokens: 1000, autoCompactThreshold: 900 },
              },
            },
            3100,
          ),
        ).effects;
      },
      spendUsd: null,
    },
    {
      case: 'a settings read',
      between: (state) =>
        foldUsageInput(state, (usage) => ({ ...usage, reported: 900 }), 3000)
          .effects,
      spendUsd: null,
    },
  ])(
    'foldPipeLine_AfterABoundary_UsageWaitsForTheNextReply ($case)',
    ({ between, spendUsd }) => {
      const state = foldedState([
        inLine(send('/compact', 'u1'), 500),
        outLine(REPLY_LINE, 600),
        outLine(lifecycle('u1', 'started'), 700),
        outLine(COMPACTING, 800),
      ]);

      const boundary = foldPipeLine(state, outLine(BOUNDARY, 2000));
      const gap = between(state);
      const reply = foldPipeLine(state, outLine(CACHE_READ_LINE, 5000));

      expect(usageEvents([...boundary.effects, ...gap])).toEqual([]);
      expect(usageEvents(reply.effects)).toEqual([
        expect.objectContaining({
          at: 5000,
          contextTokens: 40123,
          spendUsd,
        }),
      ]);
    },
  );

  it('foldPipeLine_AContextTotalAfterABoundary_SendsTheAfterSizeWithNoCacheExpiry', () => {
    const state = foldedState([
      inLine(send('/compact', 'u1'), 500),
      outLine(REPLY_LINE, 600),
      outLine(lifecycle('u1', 'started'), 700),
      outLine(COMPACTING, 800),
      outLine(BOUNDARY, 2000),
      inLine(contextUsageRequest('wigley-2'), 3000),
    ]);
    const compactionEntries = (effects: readonly FoldEffect[]) =>
      effects.flatMap((effect) =>
        effect.kind === 'entry' && effect.entry.kind === 'compaction'
          ? [effect.entry]
          : [],
      );

    const { effects } = foldPipeLine(
      state,
      outLine(
        {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: 'wigley-2',
            response: { maxTokens: 1000, totalTokens: 900 },
          },
        },
        3100,
      ),
    );
    const reply = foldPipeLine(state, outLine(CACHE_READ_LINE, 5000));

    expect(usageEvents(effects)).toEqual([
      expect.objectContaining({
        at: 3100,
        contextTokens: 900,
        cacheExpiresAt: null,
      }),
    ]);
    expect(compactionEntries(effects)).toEqual([
      expect.objectContaining({ afterTokens: 900 }),
    ]);
    expect(usageEvents(reply.effects)).toEqual([
      expect.objectContaining({ contextTokens: 40123 }),
    ]);
    expect(compactionEntries(reply.effects)).toEqual([]);
  });

  it.each<{ case: string; beforeResult: object[]; afterResult: object[] }>([
    {
      case: 'the interrupt answered before the result',
      beforeResult: [interruptReply('wigley-2')],
      afterResult: [],
    },
    {
      case: 'the interrupt answered in the gap after the result',
      beforeResult: [],
      afterResult: [interruptReply('wigley-2')],
    },
  ])(
    'foldPipeLine_CompactQueuedBehindAnInterruptedTurn_StillRuns ($case)',
    ({ beforeResult, afterResult }) => {
      const state = foldedState([
        SEND_U1,
        outLine(lifecycle('u1', 'started'), 600),
        outLine(lifecycleInit, 650),
        inLine(send('/compact', 'u2'), 700),
        inLine(interruptRequest('wigley-2'), 1000),
        ...beforeResult.map((line) => outLine(line, 1100)),
        outLine(
          {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            user_message_uuid: 'u1',
            user_message_uuids: ['u1'],
          },
          1200,
        ),
        ...afterResult.map((line) => outLine(line, 1300)),
      ]);

      const lines = [
        outLine(lifecycle('u2', 'started'), 8000),
        outLine(COMPACTING, 8100),
        outLine(BOUNDARY, 8200),
      ];

      expect(
        compactionEvents(
          lines.flatMap((line) => foldPipeLine(state, line).effects),
        ),
      ).toEqual([
        { type: 'compactionStarted', at: 8100, trigger: 'manual' },
        {
          type: 'compactionEnded',
          at: 8200,
          trigger: 'manual',
          outcome: 'done',
          beforeTokens: 37559,
          durationMs: 8303,
        },
      ]);
    },
  );

  it('foldPipeLine_InterruptInTheStartedToInitGap_LeavesAQueuedCompact', () => {
    const state = foldedState([
      SEND_U1,
      outLine(lifecycle('u1', 'started'), 600),
      inLine(send('/compact', 'u2'), 700),
    ]);

    foldPipeLine(state, inLine(interruptRequest('wigley-2'), 1000));

    expect(state.compaction.interrupted).toBeNull();
    expect(state.compaction.armed.map((command) => command.uuid)).toEqual([
      'u2',
    ]);
  });

  it.each<{
    case: string;
    log: PipeLine[];
    later: PipeLine[];
    replayedLastAt: number;
    events: object[];
  }>([
    {
      case: 'interrupted, and `now` past the grace',
      log: [inLine(interruptRequest('wigley-2'), 1000)],
      later: [],
      replayedLastAt: 6000,
      events: [
        {
          type: 'compactionEnded',
          at: 6000,
          trigger: 'app',
          outcome: 'interrupted',
          beforeTokens: null,
          durationMs: 5880,
        },
      ],
    },
    {
      case: 'mid-compaction, ended by a later live boundary',
      log: [],
      later: [outLine(BOUNDARY, 61000)],
      replayedLastAt: 120,
      events: [
        {
          type: 'compactionEnded',
          at: 61000,
          trigger: 'app',
          outcome: 'done',
          beforeTokens: 37559,
          durationMs: 8303,
        },
      ],
    },
  ])(
    'replayPipeLog_CompactionAcrossTheEnd ($case)',
    ({ log, later, replayedLastAt, events }) => {
      const state = createSessionFoldState(request);

      const replayed = replayPipeLog(
        state,
        [
          inLine(send('/compact', '00000000-1'), 100),
          outLine(lifecycle('00000000-1', 'started'), 110),
          outLine(COMPACTING, 120),
          ...log,
        ],
        60000,
        null,
      );
      const emitted = [
        ...replayed,
        ...later.flatMap((line) => foldPipeLine(state, line).effects),
      ];

      expect(compactionEvents(emitted)).toEqual([
        { type: 'compactionStarted', at: 120, trigger: 'app' },
        ...events,
      ]);
      expect(compactionEvents(replayed).at(-1)?.at).toBe(replayedLastAt);
    },
  );

  it('replayPipeLog_AppCompact_KeepsItsTriggerAndEntry', () => {
    const boundary = BOUNDARY;
    const state = createSessionFoldState(request);

    const effects = replayPipeLog(
      state,
      [
        inLine(send('/compact', '00000000-1'), 100),
        outLine(lifecycle('00000000-1', 'started'), 110),
        outLine(COMPACTING, 120),
        outLine(boundary, 130),
        outLine(CACHE_READ_LINE, 140),
      ],
      150,
      null,
    );

    expect(
      effects.flatMap((effect) =>
        effect.kind === 'agentEvent' &&
        effect.event.type.startsWith('compaction')
          ? [effect.event]
          : [],
      ),
    ).toEqual([
      { type: 'compactionStarted', at: 120, trigger: 'app' },
      {
        type: 'compactionEnded',
        at: 130,
        trigger: 'app',
        outcome: 'done',
        beforeTokens: 37559,
        durationMs: 8303,
      },
    ]);
    expect(
      effects.flatMap((effect) =>
        effect.kind === 'entry' && effect.entry.kind === 'compaction'
          ? [effect.entry]
          : [],
      ),
    ).toEqual([
      {
        kind: 'compaction',
        id: 'compaction-1',
        at: 130,
        trigger: 'app',
        beforeTokens: 37559,
        afterTokens: 40123,
        durationMs: 8303,
        raw: [boundary],
      },
    ]);
  });
});
