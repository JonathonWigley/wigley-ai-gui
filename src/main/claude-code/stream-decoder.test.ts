import { describe, expect, it } from 'vitest';
import { createStreamDecoder } from './stream-decoder';

// Lines shaped after the excerpts in docs/features/agent-chat/claude-stream.md.
const line = (event: object) => JSON.stringify(event);

const streamLine = (event: object) =>
  line({ type: 'stream_event', event, parent_tool_use_id: null });

const messageStart = (id: string) =>
  streamLine({
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', content: [] },
  });

const textStart = (index: number) =>
  streamLine({
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  });

const textDelta = (index: number, text: string) =>
  streamLine({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  });

const blockStop = (index: number) =>
  streamLine({ type: 'content_block_stop', index });

const assistantEvent = (id: string, content: object[]) => ({
  type: 'assistant',
  message: {
    model: 'claude-haiku-5-5',
    id,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: null,
  },
  parent_tool_use_id: null,
});

// Measured lines, docs/features/agent-chat/claude-stream.md § Usage and § Other events.
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false}}';
const REPLY_LINE =
  '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":2000,"cache_read_input_tokens":40000,"output_tokens":120,"cache_creation":{"ephemeral_1h_input_tokens":2000,"ephemeral_5m_input_tokens":0}}},"parent_tool_use_id":null}';
const RESULT_LINE =
  '{"type":"result","subtype":"success","is_error":false,"result":"ok","stop_reason":"end_turn","total_cost_usd":0.25,"duration_ms":1850,"num_turns":1,"modelUsage":{"claude-opus-5-5":{"contextWindow":1000000,"maxOutputTokens":64000,"costUSD":0.25,"costBasis":"list"}}}';

const toolUseEvent = assistantEvent('m2', [
  {
    type: 'tool_use',
    id: 't1',
    name: 'Bash',
    input: { command: 'ls -la\necho' },
    caller: { type: 'direct' },
  },
]);

// Agent and subagent lines shaped after the excerpts in
// docs/features/agent-chat/claude-stream.md § Subagents and § Compaction.
const toolUseLine = (
  id: string,
  name: string,
  input: object,
  parent: string | null = null,
) =>
  line({
    ...assistantEvent(`msg-${id}`, [
      { type: 'tool_use', id, name, input, caller: { type: 'direct' } },
    ]),
    parent_tool_use_id: parent,
  });

const agentCall = (
  id: string,
  input: object = {},
  parent: string | null = null,
) =>
  toolUseLine(
    id,
    'Agent',
    {
      description: 'read notes',
      subagent_type: 'Explore',
      prompt: 'Read notes.txt.',
      ...input,
    },
    parent,
  );

const toolResultLine = (
  toolUseId: string,
  {
    isError = false,
    parent = null,
    toolUseResult = {},
  }: { isError?: boolean; parent?: string | null; toolUseResult?: object } = {},
) =>
  line({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: toolUseId,
          type: 'tool_result',
          content: 'ok',
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
    parent_tool_use_id: parent,
    tool_use_result: toolUseResult,
  });

const launchReceipt = (toolUseId: string, parent: string | null = null) =>
  toolResultLine(toolUseId, {
    parent,
    toolUseResult: {
      isAsync: true,
      status: 'async_launched',
      agentId: 'a4e45e22d2e0fef8f',
    },
  });

const taskNotification = (
  toolUseId: string,
  status: string,
  taskId = 'a4e45e22d2e0fef8f',
) =>
  line({
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    tool_use_id: toolUseId,
    status,
  });

// A `task_type` of undefined leaves the key out.
const taskStarted = (
  taskId: string,
  toolUseId: string,
  taskType: string | undefined,
  parentTaskId?: string,
) =>
  line({
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    tool_use_id: toolUseId,
    description: 'Sleep 6 seconds in background',
    is_backgrounded: true,
    ...(parentTaskId === undefined
      ? {}
      : { parent_task_id: parentTaskId, owned_by_subagent: true }),
    task_type: taskType,
  });

const taskBegan = (taskId: string, agentId = 'main') => ({
  type: 'taskStarted',
  taskId,
  agentId,
  description: 'Sleep 6 seconds in background',
});

const taskEnded = (taskId: string, outcome: 'done' | 'failed') => ({
  type: 'taskFinished',
  taskId,
  outcome,
});

const INTERRUPTED_RESULT_LINE = line({
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  stop_reason: 'tool_use',
  terminal_reason: 'aborted_tools',
});

const compactBoundary = (metadata: object) =>
  line({
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'manual', ...metadata },
  });

const spawned = (
  agentId: string,
  agentType = 'Explore',
  parentAgentId = 'main',
) => ({
  type: 'agentSpawned',
  agentId,
  parentAgentId,
  agentType,
  description: 'read notes',
});

const finished = (agentId: string, outcome: 'done' | 'failed') => ({
  type: 'agentFinished',
  agentId,
  outcome,
});

const skillStarted = (agentId: string, skill: string, args: string) => ({
  type: 'skillStarted',
  agentId,
  skill,
  args,
});

const written = (agentId: string, path: string) => ({
  type: 'fileWritten',
  agentId,
  path,
});

const INIT_LINE = line({ type: 'system', subtype: 'init' });
const TURN_STARTED = { type: 'turnStarted' };
const TURN_ENDED = { type: 'turnEnded' };

describe('createStreamDecoder', () => {
  it('decode_Init_ReportsCommandsAndControls', () => {
    const decoder = createStreamDecoder();
    const init = {
      type: 'system',
      subtype: 'init',
      cwd: '/proj',
      model: 'claude-opus-5-5[1m]',
      permissionMode: 'auto',
      slash_commands: ['/compact', 'model'],
      skills: ['wigley:feature', 'compact'],
    };

    const decoded = decoder.decode(line(init));

    expect(decoded.commands).toEqual(['compact', 'model', 'wigley:feature']);
    expect(decoded.reported).toEqual({
      mode: 'auto',
      model: 'claude-opus-5-5[1m]',
    });
    expect(decoded.entries).toEqual([
      { kind: 'raw', id: 'turn-events-1', raw: [init] },
    ]);
  });

  it('decode_StartHooksAndTurnEvents_GatherIntoOneEntryPerTurn', () => {
    const decoder = createStreamDecoder();
    const hookStarted = {
      type: 'system',
      subtype: 'hook_started',
      hook_name: 'SessionStart:startup',
      hook_event: 'SessionStart',
    };
    const hookResponse = {
      type: 'system',
      subtype: 'hook_response',
      hook_name: 'SessionStart:startup',
      exit_code: 0,
      outcome: 'success',
    };
    const init = { type: 'system', subtype: 'init', model: 'claude-haiku-5-5' };
    const requesting = {
      type: 'system',
      subtype: 'status',
      status: 'requesting',
    };
    const rateLimit = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
    };
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
    };

    const seen = [hookStarted, hookResponse, init, requesting, rateLimit]
      .map((event) => decoder.decode(line(event)).entries)
      .flat();
    decoder.decode(line(result));
    const [nextTurn] = decoder.decode(line(init)).entries;

    expect(seen.map((entry) => entry.id)).toEqual([
      'turn-events-1',
      'turn-events-1',
      'turn-events-1',
      'turn-events-1',
      'turn-events-1',
    ]);
    expect(seen[seen.length - 1].raw).toEqual([
      hookStarted,
      hookResponse,
      init,
      requesting,
      rateLimit,
    ]);
    expect(nextTurn).toEqual({
      kind: 'raw',
      id: 'turn-events-2',
      raw: [init],
    });
  });

  it('decode_UnnamedEventTypes_EachGetsItsOwnRawEntry', () => {
    const decoder = createStreamDecoder();
    const newSubtype = { type: 'system', subtype: 'api_retry', attempt: 1 };
    const newType = { type: 'brand_new_event', value: 1 };

    const entries = [newSubtype, newType].flatMap(
      (event) => decoder.decode(line(event)).entries,
    );

    expect(entries).toEqual([
      { kind: 'raw', id: 'raw-1', raw: [newSubtype] },
      { kind: 'raw', id: 'raw-2', raw: [newType] },
    ]);
  });

  it('decode_ThinkingDeltaAndTokens_FoldIntoThinkingWithoutResend', () => {
    const decoder = createStreamDecoder();
    const thinkingStart = streamLine({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    });
    const thinkingDelta = streamLine({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 50 },
    });
    const tokens = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 50,
      estimated_tokens_delta: 50,
    };
    decoder.decode(messageStart('m1'));
    decoder.decode(thinkingStart);

    const midBlock = [
      ...decoder.decode(thinkingDelta).entries,
      ...decoder.decode(line(tokens)).entries,
    ];
    const [stopped] = decoder.decode(blockStop(0)).entries;
    const [afterStop] = decoder.decode(line(tokens)).entries;

    expect(midBlock).toEqual([]);
    expect(stopped.id).toBe('thinking-m1-0');
    expect(stopped.raw).toContainEqual(tokens);
    expect(afterStop.id).toBe('turn-events-1');
  });

  it('decode_ResultAfterInterruptMidThinking_ClosesAndResendsThinking', () => {
    const decoder = createStreamDecoder();
    const thinkingStart = streamLine({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    });
    const tokens = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 50,
      estimated_tokens_delta: 50,
    };
    const interrupted = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      stop_reason: 'tool_use',
    };
    decoder.decode(messageStart('m1'));
    decoder.decode(thinkingStart);
    decoder.decode(line(tokens));

    const [closed, result] = decoder.decode(line(interrupted)).entries;
    const [nextTurnTokens] = decoder.decode(line(tokens)).entries;

    expect(closed).toMatchObject({ id: 'thinking-m1-0', streaming: false });
    expect(closed.raw).toContainEqual(tokens);
    expect(result.kind).toBe('result');
    expect(nextTurnTokens.id).toBe('turn-events-1');
  });

  it('decode_ToolProgress_FoldsIntoThePendingToolEntry', () => {
    const decoder = createStreamDecoder();
    decoder.decode(line(toolUseEvent));
    const heartbeat = {
      type: 'tool_progress',
      tool_use_id: 't1-heartbeat-0',
      tool_name: 'Bash',
      parent_tool_use_id: 't1',
      elapsed_time_seconds: 30,
      heartbeat: true,
    };
    const strayHeartbeat = { ...heartbeat, parent_tool_use_id: 't9' };

    const [entry] = decoder.decode(line(heartbeat)).entries;
    const [stray] = decoder.decode(line(strayHeartbeat)).entries;

    expect(entry).toMatchObject({ kind: 'tool', id: 'tool-t1', result: null });
    expect(entry.raw).toEqual([toolUseEvent, heartbeat]);
    expect(stray).toEqual({
      kind: 'raw',
      id: 'turn-events-1',
      raw: [strayHeartbeat],
    });
  });

  it('decode_HostControlRequest_ReportsAndGathers', () => {
    const decoder = createStreamDecoder();
    const request = {
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool' },
    };

    const decoded = decoder.decode(line(request));

    expect(decoded.hostRequest).toEqual({
      requestId: 'r1',
      subtype: 'can_use_tool',
    });
    expect(decoded.entries).toEqual([
      { kind: 'raw', id: 'turn-events-1', raw: [request] },
    ]);
  });

  it('decode_TextStream_UpdatesOneEntry', () => {
    const decoder = createStreamDecoder();

    const lines = [
      messageStart('m1'),
      textStart(0),
      textDelta(0, 'Hel'),
      textDelta(0, 'lo'),
      blockStop(0),
    ];
    const seen = lines.flatMap((text) => decoder.decode(text).entries);

    expect(
      seen.map((entry) =>
        entry.kind === 'assistant'
          ? [entry.id, entry.text, entry.streaming]
          : entry.kind,
      ),
    ).toEqual([
      ['text-m1-0', '', true],
      ['text-m1-0', 'Hel', true],
      ['text-m1-0', 'Hello', true],
      ['text-m1-0', 'Hello', false],
    ]);
  });

  it('decode_AssistantBeforeBlockStop_ConfirmsStreamedEntry', () => {
    const decoder = createStreamDecoder();
    for (const text of [
      messageStart('m1'),
      textStart(0),
      textDelta(0, 'Hello'),
    ]) {
      decoder.decode(text);
    }
    const assistant = assistantEvent('m1', [{ type: 'text', text: 'Hello' }]);

    const confirmedEntries = decoder.decode(line(assistant)).entries;
    const stoppedEntries = decoder.decode(blockStop(0)).entries;

    expect(confirmedEntries).toHaveLength(1);
    const [confirmed] = confirmedEntries;
    expect(confirmed.id).toBe('text-m1-0');
    expect(confirmed.kind === 'assistant' && confirmed.streaming).toBe(false);
    expect(confirmed.raw).toHaveLength(2);
    expect(confirmed.raw[1]).toEqual(assistant);
    expect(stoppedEntries).toHaveLength(1);
    const [stopped] = stoppedEntries;
    expect(stopped.id).toBe('text-m1-0');
    expect(stopped.kind === 'assistant' && stopped.streaming).toBe(false);
    expect(stopped.raw).toHaveLength(2);
    expect(stopped.raw[1]).toEqual(assistant);
  });

  it('decode_AssistantTextDiffersFromStream_AdoptsAssistantText', () => {
    const decoder = createStreamDecoder();
    for (const text of [messageStart('m1'), textStart(0)]) {
      decoder.decode(text);
    }
    const assistant = assistantEvent('m1', [{ type: 'text', text: '1' }]);

    const confirmedEntries = decoder.decode(line(assistant)).entries;
    const stoppedEntries = decoder.decode(blockStop(0)).entries;

    expect(
      [...confirmedEntries, ...stoppedEntries].map((entry) =>
        entry.kind === 'assistant' ? [entry.id, entry.text] : entry.kind,
      ),
    ).toEqual([
      ['text-m1-0', '1'],
      ['text-m1-0', '1'],
    ]);
  });

  it('decode_ToolUse_AddsToolEntryWithSummary', () => {
    const decoder = createStreamDecoder();

    const [entry] = decoder.decode(line(toolUseEvent)).entries;

    expect(entry).toMatchObject({
      kind: 'tool',
      id: 'tool-t1',
      toolUseId: 't1',
      name: 'Bash',
      summary: 'ls -la',
      result: null,
    });
  });

  it('decode_ToolResult_PairsByToolUseId', () => {
    const decoder = createStreamDecoder();
    decoder.decode(line(toolUseEvent));

    const [entry] = decoder.decode(
      line({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [{ type: 'text', text: 'a' }, { type: 'image' }],
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: null,
      }),
    ).entries;

    expect(entry).toMatchObject({
      id: 'tool-t1',
      result: { text: 'a\n[image]', isError: true },
    });
    expect(entry.raw).toHaveLength(2);
  });

  it('decode_Result_AddsResultEntry', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        stop_reason: 'end_turn',
        total_cost_usd: 0.01,
        duration_ms: 1200,
      }),
    );

    expect(decoded.turnEnded).toBe(true);
    expect(decoded.turnFailed).toBe(false);
    expect(decoded.entries).toMatchObject([
      {
        kind: 'result',
        id: 'result-1',
        stopReason: 'end_turn',
        costUsd: 0.01,
        durationMs: 1200,
      },
    ]);
  });

  it.each([
    { origin: undefined, isUnrequested: false },
    { origin: { kind: 'peer', handback: true }, isUnrequested: true },
    {
      origin: { kind: 'task-notification', producer: 'session-task' },
      isUnrequested: true,
    },
  ])(
    'decode_ResultOrigin_MarksTurnsClaudeRanOnItsOwn ($origin.kind)',
    ({ origin, isUnrequested }) => {
      const decoder = createStreamDecoder();

      const decoded = decoder.decode(
        line({ type: 'result', subtype: 'success', result: '', origin }),
      );

      expect(decoded.turnEnded).toBe(true);
      expect(decoded.turnUnrequested).toBe(isUnrequested);
    },
  );

  it('decode_SecondResult_CostIsTheTurnsShare', () => {
    const decoder = createStreamDecoder();
    const result = (total: number) =>
      line({ type: 'result', subtype: 'success', total_cost_usd: total });
    decoder.decode(result(0.25));

    const [entry] = decoder.decode(result(0.75)).entries;

    expect(entry).toMatchObject({ kind: 'result', costUsd: 0.5 });
  });

  it('decode_TotalBelowLast_CostNullAndLastTotalKept', () => {
    const decoder = createStreamDecoder();
    const result = (total: number) =>
      line({ type: 'result', subtype: 'success', total_cost_usd: total });
    decoder.decode(result(0.5));

    const [lower] = decoder.decode(result(0.25)).entries;
    const [next] = decoder.decode(result(0.75)).entries;

    expect(lower).toMatchObject({ kind: 'result', costUsd: null });
    expect(next).toMatchObject({ kind: 'result', costUsd: 0.25 });
  });

  it('decode_ErrorResult_AddsNoticeThenResult', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'boom',
      }),
    );

    expect(decoded.turnFailed).toBe(true);
    expect(decoded.entries).toMatchObject([
      { kind: 'notice', id: 'notice-1', text: 'boom', tone: 'error' },
      {
        kind: 'result',
        stopReason: 'error_during_execution',
        costUsd: null,
      },
    ]);
  });

  it('decode_NotJson_AddsRawEntry', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode('not json');

    expect(decoded.entries).toEqual([
      { kind: 'raw', id: 'raw-1', raw: ['not json'] },
    ]);
  });

  it('decode_LocalCommandOutput_AddsNotice', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'user',
        message: {
          role: 'user',
          content:
            '<local-command-stdout>Set effort to high</local-command-stdout>',
        },
        parent_tool_use_id: null,
        isReplay: true,
      }),
    );

    expect(decoded.entries).toMatchObject([
      { kind: 'notice', text: 'Set effort to high', tone: 'info' },
    ]);
  });

  it('decode_SyntheticAssistant_AddsNotice', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'assistant',
        message: {
          id: 'c1155488',
          model: '<synthetic>',
          role: 'assistant',
          content: [{ type: 'text', text: 'Set effort level to high' }],
        },
        parent_tool_use_id: null,
        local_command_run: { command: 'effort', args: 'high' },
      }),
    );

    expect(decoded.entries).toMatchObject([
      {
        kind: 'notice',
        id: 'notice-1',
        text: 'Set effort level to high',
        tone: 'info',
      },
    ]);
  });

  it('decode_ModeStatus_ReportsModeAndGathers', () => {
    const decoder = createStreamDecoder();
    const status = {
      type: 'system',
      subtype: 'status',
      status: null,
      permissionMode: 'plan',
    };

    const decoded = decoder.decode(line(status));

    expect(decoded.reported).toEqual({ mode: 'plan' });
    expect(decoded.entries).toEqual([
      { kind: 'raw', id: 'turn-events-1', raw: [status] },
    ]);
  });

  it('decode_ControlResponse_ReportsRequestOutcome', () => {
    const decoder = createStreamDecoder();

    const success = decoder.decode(
      line({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'wigley-1',
          response: { mode: 'plan' },
        },
      }),
    );
    const failure = decoder.decode(
      line({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: 'wigley-2',
          error: 'Cannot set permission mode',
          error_code: 'invalid_mode',
        },
      }),
    );

    expect(success.controlResponse).toEqual({
      requestId: 'wigley-1',
      error: null,
      response: { mode: 'plan' },
    });
    expect(failure.controlResponse).toEqual({
      requestId: 'wigley-2',
      error: 'Cannot set permission mode',
      response: {},
    });
    expect(
      failure.entries.map((entry) => [entry.id, entry.raw.length]),
    ).toEqual([['turn-events-1', 2]]);
  });

  it('decode_ModeChangeBetweenTurns_JoinsThePreviousTurnsEvents', () => {
    const decoder = createStreamDecoder();
    const hookStarted = {
      type: 'system',
      subtype: 'hook_started',
      hook_name: 'SessionStart:startup',
    };
    const init = { type: 'system', subtype: 'init', model: 'claude-haiku-5-5' };
    const requesting = {
      type: 'system',
      subtype: 'status',
      status: 'requesting',
    };
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
    };
    const modeChanged = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-1',
        response: { mode: 'plan' },
      },
    };
    const modeStatus = {
      type: 'system',
      subtype: 'status',
      status: null,
      permissionMode: 'plan',
    };
    const nextInit = { ...init, permissionMode: 'plan' };
    for (const event of [hookStarted, init, result]) {
      decoder.decode(line(event));
    }

    const [response] = decoder.decode(line(modeChanged)).entries;
    const [status] = decoder.decode(line(modeStatus)).entries;
    const [nextTurn] = decoder.decode(line(nextInit)).entries;
    const [nextRequesting] = decoder.decode(line(requesting)).entries;

    expect(response.id).toBe('turn-events-1');
    expect(status).toEqual({
      kind: 'raw',
      id: 'turn-events-1',
      raw: [hookStarted, init, modeChanged, modeStatus],
    });
    expect(nextTurn).toEqual({
      kind: 'raw',
      id: 'turn-events-2',
      raw: [nextInit],
    });
    expect(nextRequesting).toEqual({
      kind: 'raw',
      id: 'turn-events-2',
      raw: [nextInit, requesting],
    });
  });

  it('decode_RateLimitEvent_ReportsPlanRowsAndGathers', () => {
    const decoder = createStreamDecoder();
    decoder.decode(line({ type: 'system', subtype: 'init' }));

    const decoded = decoder.decode(RATE_LIMIT_LINE);

    expect(decoded.planRows).toEqual([
      {
        kind: 'session',
        percent: 12,
        resetsAt: 1793434200000,
        severity: 'normal',
      },
      {
        kind: 'weekly_all',
        percent: 95,
        resetsAt: 1793426400000,
        severity: 'warning',
      },
    ]);
    const [entry] = decoded.entries;
    expect(entry.id).toBe('turn-events-1');
    expect(entry.raw.at(-1)).toEqual(JSON.parse(RATE_LIMIT_LINE));
  });

  // REPLY_LINE with `change` applied to its parsed event.
  type ReplyEvent = {
    parent_tool_use_id: unknown;
    message: Record<string, unknown>;
  };
  const replyWith = (change: (event: ReplyEvent) => void) => {
    const event: ReplyEvent = JSON.parse(REPLY_LINE);
    change(event);
    return JSON.stringify(event);
  };

  it.each([
    {
      name: 'MainReply',
      text: REPLY_LINE,
      expected: {
        contextTokens: 42123,
        cacheTtlMs: 3_600_000,
        readsCache: true,
      },
    },
    {
      name: 'SubagentReply',
      text: replyWith((event) => {
        event.parent_tool_use_id = 'toolu_1';
      }),
      expected: null,
    },
    {
      name: 'SyntheticReply',
      text: replyWith((event) => {
        event.message.model = '<synthetic>';
      }),
      expected: null,
    },
    {
      name: 'NoUsage',
      text: replyWith((event) => {
        delete event.message.usage;
      }),
      expected: null,
    },
  ])('decode_Assistant_ReplyUsage_$name', ({ text, expected }) => {
    expect(createStreamDecoder().decode(text).replyUsage).toEqual(expected);
  });

  it.each([
    {
      name: 'ModelOwnWindow',
      lines: [REPLY_LINE, RESULT_LINE],
      expected: { contextWindow: 1000000, spendUsd: 0.25 },
    },
    {
      name: 'ModelNotAKey_LargestWindow',
      lines: [
        REPLY_LINE,
        line({
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.5,
          modelUsage: {
            'claude-haiku-5-5': { contextWindow: 200000 },
            'claude-opus-5-5[1m]': { contextWindow: 1000000 },
          },
        }),
      ],
      expected: { contextWindow: 1000000, spendUsd: 0.5 },
    },
    {
      name: 'ModelKeyWithoutWindow_Null',
      lines: [
        REPLY_LINE,
        line({
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.5,
          modelUsage: {
            'claude-opus-5-5': { costUSD: 0.5 },
            'claude-haiku-5-5': { contextWindow: 200000 },
          },
        }),
      ],
      expected: { contextWindow: null, spendUsd: 0.5 },
    },
    {
      name: 'NoReplyNoModelUsage',
      lines: [
        line({
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.25,
          modelUsage: {},
        }),
      ],
      expected: { contextWindow: null, spendUsd: 0.25 },
    },
  ])('decode_Result_TurnUsage_$name', ({ lines, expected }) => {
    const decoder = createStreamDecoder();

    const decoded = lines.map((text) => decoder.decode(text));

    expect(decoded.at(-1)?.turnUsage).toEqual(expected);
  });

  it.each([
    {
      case: 'main tool',
      lines: [toolUseLine('t1', 'Read', { file_path: 'notes.txt' })],
      expected: [
        { type: 'toolStarted', agentId: 'main', toolUseId: 't1', tool: 'Read' },
      ],
    },
    {
      case: 'spawn',
      lines: [agentCall('a1')],
      expected: [spawned('a1')],
    },
    {
      case: 'spawn without type',
      lines: [agentCall('a1', { subagent_type: undefined })],
      expected: [spawned('a1', 'general-purpose')],
    },
    {
      case: 'subagent tool start and ok result',
      lines: [
        agentCall('a1'),
        toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'a1'),
        toolResultLine('t1', { parent: 'a1' }),
      ],
      expected: [
        spawned('a1'),
        { type: 'toolStarted', agentId: 'a1', toolUseId: 't1', tool: 'Read' },
        { type: 'toolFinished', agentId: 'a1', toolUseId: 't1', ok: true },
      ],
    },
    {
      case: 'tool error result',
      lines: [
        toolUseLine('t1', 'Read', { file_path: 'missing.txt' }),
        toolResultLine('t1', { isError: true }),
      ],
      expected: [
        { type: 'toolStarted', agentId: 'main', toolUseId: 't1', tool: 'Read' },
        { type: 'toolFinished', agentId: 'main', toolUseId: 't1', ok: false },
      ],
    },
    {
      case: 'agent done',
      lines: [
        agentCall('a1', { run_in_background: false }),
        toolResultLine('a1', { toolUseResult: { status: 'completed' } }),
      ],
      expected: [spawned('a1'), finished('a1', 'done')],
    },
    {
      case: 'agent failed',
      lines: [
        agentCall('a1', { subagent_type: 'no-such-agent' }),
        toolResultLine('a1', { isError: true }),
      ],
      expected: [spawned('a1', 'no-such-agent'), finished('a1', 'failed')],
    },
    {
      case: 'unknown tool result',
      lines: [toolResultLine('t9')],
      expected: [],
    },
    {
      case: 'heartbeat',
      lines: [
        agentCall('a1', { run_in_background: false }),
        line({
          type: 'tool_progress',
          tool_use_id: 'a1-heartbeat-0',
          tool_name: 'Agent',
          parent_tool_use_id: 'a1',
          elapsed_time_seconds: 30,
          heartbeat: true,
        }),
      ],
      expected: [spawned('a1')],
    },
    {
      case: 'compaction',
      lines: [compactBoundary({ pre_tokens: 37559, post_tokens: 9023 })],
      expected: [{ type: 'compacted', beforeTokens: 37559, afterTokens: null }],
    },
    {
      case: 'compaction without before size',
      lines: [compactBoundary({ post_tokens: 9023 })],
      expected: [{ type: 'compacted', beforeTokens: null, afterTokens: null }],
    },
    {
      case: 'background spawn',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'b1'),
        toolResultLine('t1', { parent: 'b1' }),
        taskNotification('b1', 'completed'),
      ],
      expected: [
        spawned('b1'),
        { type: 'toolStarted', agentId: 'b1', toolUseId: 't1', tool: 'Read' },
        { type: 'toolFinished', agentId: 'b1', toolUseId: 't1', ok: true },
        finished('b1', 'done'),
      ],
    },
    {
      case: 'background launch failed',
      lines: [agentCall('b1'), toolResultLine('b1', { isError: true })],
      expected: [spawned('b1'), finished('b1', 'failed')],
    },
    {
      case: 'background stopped',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskNotification('b1', 'stopped'),
      ],
      expected: [spawned('b1'), finished('b1', 'failed')],
    },
    {
      case: 'foreground notification then result',
      lines: [
        agentCall('a1', { run_in_background: false }),
        taskNotification('a1', 'completed'),
        toolResultLine('a1', { toolUseResult: { status: 'completed' } }),
      ],
      expected: [spawned('a1'), finished('a1', 'done')],
    },
    {
      case: 'interrupted foreground subagent',
      lines: [
        agentCall('a1', { run_in_background: false }),
        agentCall('b1'),
        launchReceipt('b1'),
        INTERRUPTED_RESULT_LINE,
      ],
      expected: [
        spawned('a1'),
        spawned('b1'),
        finished('a1', 'failed'),
        TURN_ENDED,
      ],
    },
    {
      case: 'interrupted foreground subagent, measured order',
      lines: [
        agentCall('a1', { run_in_background: false }),
        taskNotification('a1', 'stopped'),
        toolResultLine('a1', { isError: true }),
        line({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '[Request interrupted by user for tool use]',
              },
            ],
          },
          parent_tool_use_id: null,
        }),
        INTERRUPTED_RESULT_LINE,
      ],
      expected: [spawned('a1'), finished('a1', 'failed'), TURN_ENDED],
    },
    {
      case: 'background subagent spawn outlives main result',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        agentCall('n1', { run_in_background: false }, 'b1'),
        RESULT_LINE,
      ],
      expected: [spawned('b1'), spawned('n1', 'Explore', 'b1'), TURN_ENDED],
    },
    {
      case: 'interrupted foreground subagent fails its nested call',
      lines: [
        agentCall('a1', { run_in_background: false }),
        agentCall('n1', { run_in_background: false }, 'a1'),
        taskNotification('a1', 'stopped'),
        toolResultLine('a1', { isError: true }),
        INTERRUPTED_RESULT_LINE,
      ],
      expected: [
        spawned('a1'),
        spawned('n1', 'Explore', 'a1'),
        finished('a1', 'failed'),
        finished('n1', 'failed'),
        TURN_ENDED,
      ],
    },
    {
      case: 'background subagent end fails its nested call',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        agentCall('n1', { run_in_background: false }, 'b1'),
        taskNotification('b1', 'completed'),
      ],
      expected: [
        spawned('b1'),
        spawned('n1', 'Explore', 'b1'),
        finished('b1', 'done'),
        finished('n1', 'failed'),
      ],
    },
    {
      case: 'main result fails a call two levels deep',
      lines: [
        agentCall('a1', { run_in_background: false }),
        agentCall('n1', { run_in_background: false }, 'a1'),
        agentCall('n2', { run_in_background: false }, 'n1'),
        RESULT_LINE,
      ],
      expected: [
        spawned('a1'),
        spawned('n1', 'Explore', 'a1'),
        spawned('n2', 'Explore', 'n1'),
        finished('a1', 'failed'),
        finished('n1', 'failed'),
        finished('n2', 'failed'),
        TURN_ENDED,
      ],
    },
    {
      case: 'subagent background call outlives its end',
      lines: [
        agentCall('a1', { run_in_background: false }),
        agentCall('b2', {}, 'a1'),
        launchReceipt('b2', 'a1'),
        taskNotification('a1', 'completed'),
      ],
      expected: [
        spawned('a1'),
        spawned('b2', 'Explore', 'a1'),
        finished('a1', 'done'),
      ],
    },
    {
      case: 'subagent end fails its open tool call',
      lines: [
        agentCall('a1', { run_in_background: false }),
        toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'a1'),
        toolUseLine('t2', 'Grep', { pattern: 'x' }, 'a1'),
        toolResultLine('t2', { parent: 'a1' }),
        toolResultLine('a1', { isError: true }),
        toolResultLine('t1', { parent: 'a1' }),
      ],
      expected: [
        spawned('a1'),
        { type: 'toolStarted', agentId: 'a1', toolUseId: 't1', tool: 'Read' },
        { type: 'toolStarted', agentId: 'a1', toolUseId: 't2', tool: 'Grep' },
        { type: 'toolFinished', agentId: 'a1', toolUseId: 't2', ok: true },
        { type: 'toolFinished', agentId: 'a1', toolUseId: 't1', ok: false },
        finished('a1', 'failed'),
      ],
    },
    {
      case: 'main result fails open tool calls of swept agents',
      lines: [
        toolUseLine('t0', 'Bash', { command: 'ls' }),
        agentCall('a1', { run_in_background: false }),
        agentCall('n1', { run_in_background: false }, 'a1'),
        toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'a1'),
        toolUseLine('t2', 'Read', { file_path: 'todo.txt' }, 'n1'),
        RESULT_LINE,
        toolResultLine('t2', { parent: 'n1' }),
      ],
      expected: [
        { type: 'toolStarted', agentId: 'main', toolUseId: 't0', tool: 'Bash' },
        spawned('a1'),
        spawned('n1', 'Explore', 'a1'),
        { type: 'toolStarted', agentId: 'a1', toolUseId: 't1', tool: 'Read' },
        { type: 'toolStarted', agentId: 'n1', toolUseId: 't2', tool: 'Read' },
        { type: 'toolFinished', agentId: 'a1', toolUseId: 't1', ok: false },
        finished('a1', 'failed'),
        { type: 'toolFinished', agentId: 'n1', toolUseId: 't2', ok: false },
        finished('n1', 'failed'),
        TURN_ENDED,
      ],
    },
    {
      case: 'main skill',
      lines: [
        toolUseLine('s1', 'Skill', {
          skill: 'wigley:feature',
          args: ' plan x ',
        }),
      ],
      expected: [
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 's1',
          tool: 'Skill',
        },
        skillStarted('main', 'wigley:feature', 'plan x'),
      ],
    },
    {
      case: 'skill without args',
      lines: [toolUseLine('s1', 'Skill', { skill: 'wigley:make' })],
      expected: [
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 's1',
          tool: 'Skill',
        },
        skillStarted('main', 'wigley:make', ''),
      ],
    },
    {
      case: 'skill without a name',
      lines: [toolUseLine('s1', 'Skill', { args: 'x' })],
      expected: [
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 's1',
          tool: 'Skill',
        },
      ],
    },
    {
      case: 'subagent skill',
      lines: [
        agentCall('a1'),
        toolUseLine(
          's1',
          'Skill',
          { skill: 'wigley:feature', args: 'plan x' },
          'a1',
        ),
      ],
      expected: [
        spawned('a1'),
        { type: 'toolStarted', agentId: 'a1', toolUseId: 's1', tool: 'Skill' },
        skillStarted('a1', 'wigley:feature', 'plan x'),
      ],
    },
    {
      case: 'write ok',
      lines: [
        toolUseLine('w1', 'Write', {
          file_path: '/p/docs/features/x/plan-y/plan.md',
          content: '# Plan',
        }),
        toolResultLine('w1'),
        RESULT_LINE,
      ],
      expected: [
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 'w1',
          tool: 'Write',
        },
        { type: 'toolFinished', agentId: 'main', toolUseId: 'w1', ok: true },
        written('main', '/p/docs/features/x/plan-y/plan.md'),
        TURN_ENDED,
      ],
    },
    {
      case: 'edit, multi edit and notebook edit',
      lines: [
        toolUseLine('e1', 'Edit', { file_path: '/p/a.ts', old_string: 'a' }),
        toolUseLine('e2', 'MultiEdit', { file_path: '/p/b.ts', edits: [] }),
        toolUseLine('e3', 'NotebookEdit', {
          notebook_path: '/p/c.ipynb',
          new_source: 'x',
        }),
        toolResultLine('e1'),
        toolResultLine('e2'),
        toolResultLine('e3'),
      ],
      expected: [
        { type: 'toolStarted', agentId: 'main', toolUseId: 'e1', tool: 'Edit' },
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 'e2',
          tool: 'MultiEdit',
        },
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 'e3',
          tool: 'NotebookEdit',
        },
        { type: 'toolFinished', agentId: 'main', toolUseId: 'e1', ok: true },
        written('main', '/p/a.ts'),
        { type: 'toolFinished', agentId: 'main', toolUseId: 'e2', ok: true },
        written('main', '/p/b.ts'),
        { type: 'toolFinished', agentId: 'main', toolUseId: 'e3', ok: true },
        written('main', '/p/c.ipynb'),
      ],
    },
    {
      case: 'write error result',
      lines: [
        toolUseLine('w1', 'Write', { file_path: '/p/a.md', content: 'x' }),
        toolResultLine('w1', { isError: true }),
      ],
      expected: [
        {
          type: 'toolStarted',
          agentId: 'main',
          toolUseId: 'w1',
          tool: 'Write',
        },
        { type: 'toolFinished', agentId: 'main', toolUseId: 'w1', ok: false },
      ],
    },
    {
      case: "write open at its agent's end fails with no write",
      lines: [
        agentCall('a1', { run_in_background: false }),
        toolUseLine(
          'w1',
          'Write',
          { file_path: '/p/a.md', content: 'x' },
          'a1',
        ),
        toolResultLine('a1', { toolUseResult: { status: 'completed' } }),
        toolResultLine('w1', { parent: 'a1' }),
      ],
      expected: [
        spawned('a1'),
        { type: 'toolStarted', agentId: 'a1', toolUseId: 'w1', tool: 'Write' },
        { type: 'toolFinished', agentId: 'a1', toolUseId: 'w1', ok: false },
        finished('a1', 'done'),
      ],
    },
    {
      case: 'read is no write',
      lines: [
        toolUseLine('t1', 'Read', { file_path: '/p/a.md' }),
        toolResultLine('t1'),
      ],
      expected: [
        { type: 'toolStarted', agentId: 'main', toolUseId: 't1', tool: 'Read' },
        { type: 'toolFinished', agentId: 'main', toolUseId: 't1', ok: true },
      ],
    },
    {
      case: 'result ends the turn',
      lines: [RESULT_LINE],
      expected: [TURN_ENDED],
    },
    {
      case: 'init starts the turn',
      lines: [INIT_LINE],
      expected: [TURN_STARTED],
    },
    {
      case: 'unrequested turn',
      lines: [
        INIT_LINE,
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'ok',
          stop_reason: 'end_turn',
          origin: { kind: 'task-notification', producer: 'session-task' },
        }),
      ],
      expected: [TURN_STARTED, TURN_ENDED],
    },
    {
      case: 'main background task start and end',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskNotification('tb1', 'completed', 'bvrvtgapv'),
      ],
      expected: [taskBegan('bvrvtgapv'), taskEnded('bvrvtgapv', 'done')],
    },
    {
      case: 'subagent task names its subagent',
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
      ],
      expected: [spawned('a1'), taskBegan('bpdumb7hy', 'a1')],
    },
    {
      case: 'failed task',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskNotification('tb1', 'failed', 'bvrvtgapv'),
      ],
      expected: [taskBegan('bvrvtgapv'), taskEnded('bvrvtgapv', 'failed')],
    },
    {
      case: 'stopped task',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskNotification('tb1', 'stopped', 'bvrvtgapv'),
      ],
      expected: [taskBegan('bvrvtgapv'), taskEnded('bvrvtgapv', 'failed')],
    },
    {
      case: 'killed task',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskNotification('tb1', 'killed', 'bvrvtgapv'),
      ],
      expected: [taskBegan('bvrvtgapv'), taskEnded('bvrvtgapv', 'failed')],
    },
    {
      case: 'subagent task_started starts no task',
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskNotification('a1', 'completed', 'a8e9e7aad968da282'),
      ],
      expected: [spawned('a1'), finished('a1', 'done')],
    },
    {
      case: 'task with no type starts nothing',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', undefined),
        taskNotification('tb1', 'completed', 'bvrvtgapv'),
      ],
      expected: [],
    },
    {
      case: 'task with an unknown parent',
      lines: [
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
      ],
      expected: [taskBegan('bpdumb7hy')],
    },
    {
      case: "task outlives the turn's result",
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        RESULT_LINE,
        taskNotification('tb1', 'completed', 'bvrvtgapv'),
      ],
      expected: [
        taskBegan('bvrvtgapv'),
        TURN_ENDED,
        taskEnded('bvrvtgapv', 'done'),
      ],
    },
    {
      case: 'notification for an unknown task',
      lines: [taskNotification('tb1', 'completed', 'bvrvtgapv')],
      expected: [],
    },
    {
      case: 'repeated start and notification',
      lines: [
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskStarted('bvrvtgapv', 'tb1', 'local_bash'),
        taskNotification('tb1', 'completed', 'bvrvtgapv'),
        taskNotification('tb1', 'completed', 'bvrvtgapv'),
      ],
      expected: [taskBegan('bvrvtgapv'), taskEnded('bvrvtgapv', 'done')],
    },
  ])('decode_AgentEvents_$case', ({ lines, expected }) => {
    const decoder = createStreamDecoder();

    const drafts = lines.flatMap((text) => decoder.decode(text).agentEvents);

    expect(drafts).toEqual(expected);
  });
});
