import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from './agent-definitions';
import { createStreamDecoder } from './stream-decoder';

// Lines shaped after the excerpts in docs/features/agent-chat/claude-stream.md.
const line = (event: object) => JSON.stringify(event);

const streamLine = (event: object, parent: string | null = null) =>
  line({ type: 'stream_event', event, parent_tool_use_id: parent });

const messageStart = (id: string, parent: string | null = null) =>
  streamLine(
    {
      type: 'message_start',
      message: { id, type: 'message', role: 'assistant', content: [] },
    },
    parent,
  );

const textStart = (index: number, parent: string | null = null) =>
  streamLine(
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' },
    },
    parent,
  );

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
    // The measured subagent-owned line carries `false`.
    is_backgrounded: parentTaskId === undefined,
    ...(parentTaskId === undefined
      ? {}
      : { parent_task_id: parentTaskId, owned_by_subagent: true }),
    task_type: taskType,
  });

const taskBegan = (
  taskId: string,
  agentId = 'main',
  command: string | null = null,
) => ({
  type: 'taskStarted',
  taskId,
  agentId,
  description: 'Sleep 6 seconds in background',
  command,
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
  facts: { name?: string; model?: string; effort?: string } = {},
) => ({
  type: 'agentSpawned',
  agentId,
  parentAgentId,
  agentType,
  description: 'read notes',
  name: facts.name ?? agentType,
  model: facts.model ?? null,
  effort: facts.effort ?? null,
});

const started = (
  agentId: string,
  toolUseId: string,
  tool: string,
  summary: string,
) => ({ type: 'toolStarted', agentId, toolUseId, tool, summary });

const replied = (
  agentId: string,
  model: string,
  spendUsd: number | null,
  contextTokens: number | null,
  contextWindow: number | null,
) => ({
  type: 'agentReplied',
  agentId,
  model,
  spendUsd: spendUsd === null ? null : expect.closeTo(spendUsd, 12),
  contextTokens,
  contextWindow,
  autocompactLimit: null,
});

const launched = (agentId: string) => ({ type: 'agentLaunched', agentId });

// A `SendMessage` call's `task_started` for a subagent it revives, as measured.
const reviveStarted = (taskId: string, sendMessageId: string) =>
  line({
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    tool_use_id: sendMessageId,
    description: 'read notes',
    subagent_type: 'Explore',
    is_backgrounded: true,
    task_type: 'local_agent',
  });

// A subagent's first line after a revive: `agent_id` is its `task_id`.
const revivedReply = (agentCallId: string, taskId: string) =>
  line({
    ...JSON.parse(toolUseLine(`t-${agentCallId}`, 'Read', {}, agentCallId)),
    agent_id: taskId,
  });

// A `result` whose `modelUsage` names each model's window.
const resultNaming = (windows: Record<string, number>) =>
  line({
    type: 'result',
    subtype: 'success',
    modelUsage: Object.fromEntries(
      Object.entries(windows).map(([model, contextWindow]) => [
        model,
        { contextWindow },
      ]),
    ),
  });

// A subagent reply of one text block with `usage`.
const subagentReply = (
  agentId: string,
  messageId: string,
  model: string,
  usage: object,
) =>
  line({
    type: 'assistant',
    message: {
      model,
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: null,
      usage,
    },
    parent_tool_use_id: agentId,
  });

// A subagent's hand-back turn's `result`: its `origin` names the subagent's
// `task_id`.
const handbackResult = (taskId: string) =>
  line({
    type: 'result',
    subtype: 'success',
    origin: {
      kind: 'peer',
      from: taskId,
      senderTaskId: taskId,
      handback: true,
    },
  });

// The measured subagent Read, claude-stream.md § Subagents (4.76).
const MEASURED_AGENT_CALL = 'toolu_01FqZQTLkePVaZcsvgWG3jqK';
const MEASURED_SUBAGENT_READ =
  '{"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_011CgdGgYLDfFWRV43cgsu25","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01Th9zCiM7nvQkeAH1gsms6w","name":"Read","input":{"file_path":"<project>/notes.txt"},"caller":{"type":"direct"}}],"stop_reason":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":15637,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":15637,"ephemeral_1h_input_tokens":0},"output_tokens":17}},"parent_tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","agent_id":"a4e45e22d2e0fef8f","request_id":"req_011CgdGgY1sEU695qQGKYAK9","subagent_type":"Explore","task_description":"read notes"}';
const SUBAGENT_BASH = 'python3 -c "import time; time.sleep(45)"\necho slept';

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
  it.each<{
    case: string;
    event: object;
    requestedMessages: string[];
    responseStarted: boolean;
  }>([
    {
      case: 'main requesting',
      event: {
        type: 'system',
        subtype: 'status',
        status: 'requesting',
        user_message_uuids: ['u1', 'u2'],
        parent_tool_use_id: null,
      },
      requestedMessages: ['u1', 'u2'],
      responseStarted: false,
    },
    {
      case: 'subagent requesting',
      event: {
        type: 'system',
        subtype: 'status',
        status: 'requesting',
        user_message_uuids: ['u1', 'u2'],
        parent_tool_use_id: 'call-1',
      },
      requestedMessages: [],
      responseStarted: false,
    },
    {
      case: 'another status',
      event: {
        type: 'system',
        subtype: 'status',
        status: 'compacting',
        user_message_uuids: ['u1', 'u2'],
        parent_tool_use_id: null,
      },
      requestedMessages: [],
      responseStarted: false,
    },
    {
      case: 'main message_start',
      event: {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'm1' } },
        parent_tool_use_id: null,
      },
      requestedMessages: [],
      responseStarted: true,
    },
    {
      case: 'subagent message_start',
      event: {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'm1' } },
        parent_tool_use_id: 'call-1',
      },
      requestedMessages: [],
      responseStarted: false,
    },
    {
      case: 'main model assistant',
      event: assistantEvent('m1', [{ type: 'text', text: 'ok' }]),
      requestedMessages: [],
      responseStarted: true,
    },
    {
      case: 'main synthetic assistant',
      event: {
        type: 'assistant',
        message: {
          model: '<synthetic>',
          id: 'm1',
          content: [{ type: 'text', text: 'ok' }],
        },
        parent_tool_use_id: null,
      },
      requestedMessages: [],
      responseStarted: false,
    },
    {
      case: 'subagent model assistant',
      event: {
        ...assistantEvent('m1', [{ type: 'text', text: 'ok' }]),
        parent_tool_use_id: 'call-1',
      },
      requestedMessages: [],
      responseStarted: false,
    },
  ])(
    'decode_DeliveryFields ($case)',
    ({ event, requestedMessages, responseStarted }) => {
      const decoded = createStreamDecoder().decode(line(event));

      expect(decoded.requestedMessages).toEqual(requestedMessages);
      expect(decoded.responseStarted).toBe(responseStarted);
    },
  );

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
      capabilities: ['msg_lifecycle_v1', 7, 'x'],
    };

    const decoded = decoder.decode(line(init));

    expect(decoded.commands).toEqual(['compact', 'model', 'wigley:feature']);
    expect(decoded.reported).toEqual({
      mode: 'auto',
      model: 'claude-opus-5-5[1m]',
    });
    expect(decoded.turnStarted).toBe(true);
    expect(decoded.capabilities).toEqual(['msg_lifecycle_v1', 'x']);
    expect(decoded.entries).toEqual([
      { kind: 'raw', id: 'turn-events-1', raw: [init] },
    ]);
  });

  it('decode_InitWithoutCapabilities_ReportsEmptyCapabilities', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(INIT_LINE);

    expect(decoded.turnStarted).toBe(true);
    expect(decoded.capabilities).toEqual([]);
  });

  it.each([
    {
      name: 'uuid and state',
      fields: { command_uuid: 'u-1', state: 'started' },
      lifecycle: { uuid: 'u-1', state: 'started' },
    },
    { name: 'no command_uuid', fields: { state: 'queued' }, lifecycle: null },
  ])(
    'decode_CommandLifecycle_ReportsStateAndGathers ($name)',
    ({ fields, lifecycle }) => {
      const decoder = createStreamDecoder();
      const init = { type: 'system', subtype: 'init' };
      const frame = { type: 'command_lifecycle', ...fields };
      decoder.decode(line(init));

      const decoded = decoder.decode(line(frame));

      expect(decoded.lifecycle).toEqual(lifecycle);
      expect(decoded.turnStarted).toBe(false);
      expect(decoded.capabilities).toBeNull();
      expect(decoded.entries).toEqual([
        { kind: 'raw', id: 'turn-events-1', raw: [init, frame] },
      ]);
    },
  );

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

  it.each([
    {
      case: 'main',
      input: line(toolUseEvent),
      expected: {
        kind: 'tool',
        id: 'tool-t1',
        toolUseId: 't1',
        name: 'Bash',
        summary: 'ls -la',
        result: null,
        agentId: 'main',
      },
    },
    {
      case: 'subagent',
      input: MEASURED_SUBAGENT_READ,
      expected: {
        kind: 'tool',
        id: 'tool-toolu_01Th9zCiM7nvQkeAH1gsms6w',
        toolUseId: 'toolu_01Th9zCiM7nvQkeAH1gsms6w',
        name: 'Read',
        agentId: 'toolu_01FqZQTLkePVaZcsvgWG3jqK',
      },
    },
  ])(
    'decode_ToolUse_AddsToolEntryWithSummaryAndAgent ($case)',
    ({ input, expected }) => {
      const decoder = createStreamDecoder();

      const [entry] = decoder.decode(input).entries;

      expect(entry).toMatchObject(expected);
    },
  );

  it.each([
    {
      case: 'main streamed text',
      lines: [
        messageStart('m1'),
        textStart(0),
        textDelta(0, 'Hi'),
        blockStop(0),
        line(assistantEvent('m1', [{ type: 'text', text: 'Hi' }])),
      ],
      kind: 'assistant',
      agentId: 'main',
    },
    {
      case: 'main unstreamed text',
      lines: [line(assistantEvent('m1', [{ type: 'text', text: 'Hi' }]))],
      kind: 'assistant',
      agentId: 'main',
    },
    {
      case: 'subagent text',
      lines: [subagentReply(MEASURED_AGENT_CALL, 'm2', 'claude-haiku-5-5', {})],
      kind: 'assistant',
      agentId: MEASURED_AGENT_CALL,
    },
    {
      case: 'subagent thinking',
      lines: [
        line({
          ...assistantEvent('m2', [{ type: 'thinking', thinking: 'hmm' }]),
          parent_tool_use_id: MEASURED_AGENT_CALL,
        }),
      ],
      kind: 'thinking',
      agentId: MEASURED_AGENT_CALL,
    },
    {
      case: 'subagent streamed text',
      lines: [
        messageStart('m3', 'b1'),
        textStart(0, 'b1'),
        line({
          ...assistantEvent('m3', [{ type: 'text', text: 'Hi' }]),
          parent_tool_use_id: 'b1',
        }),
      ],
      kind: 'assistant',
      agentId: 'b1',
    },
  ])(
    'decode_TextAndThinking_CarryTheirAgent ($case)',
    ({ lines, kind, agentId }) => {
      const decoder = createStreamDecoder();

      const sends = lines
        .flatMap((text) => decoder.decode(text).entries)
        .filter((entry) => entry.kind === kind);

      expect(sends).not.toHaveLength(0);
      for (const entry of sends) {
        expect(entry).toMatchObject({ kind, agentId });
      }
    },
  );

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

  it.each([
    {
      given: "a hand-back's result",
      before: [handbackResult('a4e45e22d2e0fef8f')],
      result: { result: '', num_turns: 0 },
      expected: ['turn-events-1', 'turn-events-1'],
    },
    {
      given: "a hand-back's result, then a turn with replies",
      before: [handbackResult('a4e45e22d2e0fef8f')],
      result: { result: 'done', num_turns: 1 },
      expected: ['turn-events-2', 'result-2'],
    },
    {
      given: 'a user turn',
      before: [RESULT_LINE],
      result: { result: '', num_turns: 0 },
      expected: ['turn-events-2', 'result-2'],
    },
  ])(
    'decode_EmptyResultAfterHandback_DrawsNoDivider ($given)',
    ({ before, result, expected }) => {
      const decoder = createStreamDecoder();
      for (const text of [INIT_LINE, ...before]) {
        decoder.decode(text);
      }

      const init = decoder.decode(INIT_LINE);
      const ended = decoder.decode(
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          ...result,
          origin: { kind: 'task-notification', producer: 'session-task' },
        }),
      );

      expect(ended.turnEnded).toBe(true);
      expect(
        [...init.entries, ...ended.entries].map((entry) => entry.id),
      ).toEqual(expected);
    },
  );

  it('opens a new events entry at the first content of the turn after a hand-back', () => {
    const decoder = createStreamDecoder();
    decoder.decode(INIT_LINE);
    decoder.decode(handbackResult('a'));

    const init = decoder.decode(INIT_LINE);
    const reply = decoder.decode(
      line(assistantEvent('m1', [{ type: 'text', text: 'ok' }])),
    );

    expect(init.entries).toEqual([]);
    expect(reply.entries[0]).toMatchObject({
      id: 'turn-events-2',
      raw: [{ type: 'system', subtype: 'init' }],
    });
  });

  it('gives a second hand-back turn its own events entry', () => {
    const decoder = createStreamDecoder();
    const decoded = [
      INIT_LINE,
      handbackResult('a'),
      INIT_LINE,
      line(assistantEvent('m1', [{ type: 'text', text: 'ok' }])),
      handbackResult('b'),
    ].map((text) => decoder.decode(text));

    const eventsIds = decoded
      .slice(2)
      .flatMap((out) => out.entries)
      .filter((entry) => entry.id.startsWith('turn-events-'))
      .map((entry) => entry.id);

    expect(eventsIds).toEqual(['turn-events-2']);
  });

  const STATUS_LINE = line({ type: 'system', subtype: 'status' });
  const followUpResult = (result: string, numTurns: number) =>
    line({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result,
      num_turns: numTurns,
      origin: { kind: 'task-notification', producer: 'session-task' },
    });
  // A raw event's subtype, else its type.
  const rawKind = (event: unknown) => {
    const { type, subtype } = event as { type: string; subtype?: string };
    return subtype ?? type;
  };

  it.each<{
    given: string;
    after: string[];
    expected: [string, string[]][];
    lifecycles: { uuid: string; state: string }[];
  }>([
    {
      given: 'status lines, then an empty result',
      after: [
        INIT_LINE,
        STATUS_LINE,
        line({ type: 'system', subtype: 'hook_started' }),
        followUpResult('', 0),
      ],
      expected: [
        [
          'turn-events-1',
          ['init', 'init', 'status', 'hook_started', 'success'],
        ],
      ],
      lifecycles: [],
    },
    {
      given: 'a lifecycle frame, then an empty result',
      after: [
        INIT_LINE,
        line({
          type: 'command_lifecycle',
          command_uuid: 'u1',
          state: 'started',
        }),
        followUpResult('', 0),
      ],
      expected: [
        ['turn-events-1', ['init', 'init', 'command_lifecycle', 'success']],
      ],
      lifecycles: [{ uuid: 'u1', state: 'started' }],
    },
    {
      given: 'a status line, then a result with replies',
      after: [INIT_LINE, STATUS_LINE, followUpResult('done', 1)],
      expected: [
        ['turn-events-2', ['init', 'status']],
        ['result-2', ['success']],
      ],
      lifecycles: [],
    },
  ])(
    "keeps the lines after a hand-back's init in wire order ($given)",
    ({ after, expected, lifecycles }) => {
      const decoder = createStreamDecoder();
      decoder.decode(INIT_LINE);
      decoder.decode(handbackResult('a'));

      const decoded = after.map((text) => decoder.decode(text));
      const kept = new Map<string, unknown[]>();
      for (const entry of decoded.flatMap((out) => out.entries)) {
        kept.set(entry.id, entry.raw);
      }

      expect(decoded.slice(0, -1).flatMap((out) => out.entries)).toEqual([]);
      expect(
        [...kept].map(([id, raw]) => [id, raw.map(rawKind)]),
      ).toEqual(expected);
      expect(
        decoded.flatMap((out) =>
          out.lifecycle === null ? [] : [out.lifecycle],
        ),
      ).toEqual(lifecycles);
    },
  );

  it.each([
    {
      name: 'both keys',
      fields: { user_message_uuid: 'a', user_message_uuids: ['a', 'b'] },
      opener: 'a',
      messages: ['a', 'b'],
    },
    { name: 'neither key', fields: {}, opener: null, messages: [] },
    {
      name: 'numeric opener',
      fields: { user_message_uuid: 7, user_message_uuids: ['a'] },
      opener: null,
      messages: ['a'],
    },
  ])(
    'decode_ResultMessageUuids_ReportsOpenerAndMessages ($name)',
    ({ fields, opener, messages }) => {
      const decoder = createStreamDecoder();

      const decoded = decoder.decode(
        line({ type: 'result', subtype: 'success', ...fields }),
      );

      expect(decoded.turnOpener).toBe(opener);
      expect(decoded.turnMessages).toEqual(messages);
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

  const compactStatus = (fields: object) =>
    line({ type: 'system', subtype: 'status', ...fields });

  it.each<{
    case: string;
    text: string;
    compaction: unknown;
    entries: object[];
  }>([
    {
      case: 'compacting status',
      text: compactStatus({ status: 'compacting' }),
      compaction: { phase: 'started' },
      entries: [{ kind: 'raw', id: 'turn-events-1' }],
    },
    {
      case: 'boundary',
      text: compactBoundary({
        pre_tokens: 37559,
        post_tokens: 9023,
        duration_ms: 8303,
      }),
      compaction: {
        phase: 'done',
        beforeTokens: 37559,
        durationMs: 8303,
        boundary: {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: {
            trigger: 'manual',
            pre_tokens: 37559,
            post_tokens: 9023,
            duration_ms: 8303,
          },
        },
      },
      entries: [],
    },
    {
      case: 'boundary without sizes',
      text: compactBoundary({}),
      compaction: {
        phase: 'done',
        beforeTokens: null,
        durationMs: null,
        boundary: expect.anything(),
      },
      entries: [],
    },
    {
      case: 'success status',
      text: compactStatus({ status: null, compact_result: 'success' }),
      compaction: null,
      entries: [{ kind: 'raw' }],
    },
    {
      case: 'failed status',
      text: compactStatus({
        status: null,
        compact_result: 'failed',
        compact_error: 'prompt_too_long',
      }),
      compaction: { phase: 'failed' },
      entries: [
        { kind: 'raw' },
        {
          kind: 'notice',
          text: 'Compaction failed: prompt_too_long',
          tone: 'error',
        },
      ],
    },
    {
      case: 'failed status of a refused /compact',
      text: compactStatus({
        status: null,
        compact_result: 'failed',
        compact_error: 'Not enough messages to compact.',
      }),
      compaction: { phase: 'failed' },
      entries: [{ kind: 'raw' }],
    },
    {
      case: 'failed status without error',
      text: compactStatus({ status: null, compact_result: 'failed' }),
      compaction: { phase: 'failed' },
      entries: [{ kind: 'raw' }],
    },
    {
      case: 'failed status of a plain interrupt',
      text: compactStatus({
        status: null,
        compact_result: 'failed',
        compact_error: 'API Error: Request was aborted.',
      }),
      compaction: { phase: 'failed' },
      entries: [{ kind: 'raw' }],
    },
    {
      case: 'failed status of a routine automatic attempt',
      text: compactStatus({
        status: null,
        compact_result: 'failed',
        compact_error: 'too_few_groups',
      }),
      compaction: { phase: 'failed' },
      entries: [{ kind: 'raw' }],
    },
    {
      case: "a subagent's boundary",
      text: line({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { pre_tokens: 1 },
        parent_tool_use_id: 'a1',
      }),
      compaction: null,
      entries: [{ kind: 'raw', id: 'raw-1' }],
    },
    {
      case: "a subagent's failed status",
      text: compactStatus({
        status: null,
        compact_result: 'failed',
        compact_error: 'boom',
        parent_tool_use_id: 'a1',
      }),
      compaction: null,
      entries: [{ kind: 'raw' }],
    },
  ])(
    'decode_CompactionLines_ReportCompaction ($case)',
    ({ text, compaction, entries }) => {
      const decoded = createStreamDecoder().decode(text);

      expect(decoded.compaction).toEqual(compaction);
      expect(decoded.entries).toMatchObject(entries);
      expect(decoded.entries).toHaveLength(entries.length);
    },
  );

  const COMPACTED_REPLAY = line({
    type: 'user',
    message: {
      role: 'user',
      content: '<local-command-stdout>Compacted </local-command-stdout>',
    },
    parent_tool_use_id: null,
    isReplay: true,
  });

  it.each<{ case: string; lines: string[]; entries: object[] }>([
    {
      case: 'after a boundary',
      lines: [compactBoundary({}), COMPACTED_REPLAY],
      entries: [{ kind: 'raw' }],
    },
    {
      case: "after the boundary turn's result",
      lines: [
        compactBoundary({}),
        line({ type: 'result', subtype: 'success', is_error: false }),
        COMPACTED_REPLAY,
      ],
      entries: [{ kind: 'notice', text: 'Compacted', tone: 'info' }],
    },
  ])(
    'decode_LocalOutputAfterBoundary_GathersInsteadOfNotice ($case)',
    ({ lines, entries }) => {
      const decoder = createStreamDecoder();

      const last = lines.map((text) => decoder.decode(text)).at(-1);

      expect(last?.entries).toMatchObject(entries);
      expect(last?.entries).toHaveLength(entries.length);
    },
  );

  it('decode_AutomaticCompactSummary_JoinsTheEvents', () => {
    const decoded = createStreamDecoder().decode(
      line({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'This session is being continued.' }],
        },
        parent_tool_use_id: null,
        isSynthetic: true,
      }),
    );

    expect(decoded.entries).toMatchObject([
      { kind: 'raw', id: 'turn-events-1' },
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
      expected: [started('main', 't1', 'Read', 'notes.txt')],
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
        started('a1', 't1', 'Read', 'notes.txt'),
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
        started('main', 't1', 'Read', 'missing.txt'),
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
        launched('b1'),
        started('b1', 't1', 'Read', 'notes.txt'),
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
      expected: [spawned('b1'), launched('b1'), finished('b1', 'failed')],
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
        launched('b1'),
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
      expected: [
        spawned('b1'),
        launched('b1'),
        spawned('n1', 'Explore', 'b1'),
        TURN_ENDED,
      ],
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
        launched('b1'),
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
        launched('b2'),
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
        started('a1', 't1', 'Read', 'notes.txt'),
        started('a1', 't2', 'Grep', 'x'),
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
        started('main', 't0', 'Bash', 'ls'),
        spawned('a1'),
        spawned('n1', 'Explore', 'a1'),
        started('a1', 't1', 'Read', 'notes.txt'),
        started('n1', 't2', 'Read', 'todo.txt'),
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
        started('main', 's1', 'Skill', 'wigley:feature'),
        skillStarted('main', 'wigley:feature', 'plan x'),
      ],
    },
    {
      case: 'skill without args',
      lines: [toolUseLine('s1', 'Skill', { skill: 'wigley:make' })],
      expected: [
        started('main', 's1', 'Skill', 'wigley:make'),
        skillStarted('main', 'wigley:make', ''),
      ],
    },
    {
      case: 'skill without a name',
      lines: [toolUseLine('s1', 'Skill', { args: 'x' })],
      expected: [started('main', 's1', 'Skill', 'x')],
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
        started('a1', 's1', 'Skill', 'wigley:feature'),
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
        started('main', 'w1', 'Write', '/p/docs/features/x/plan-y/plan.md'),
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
        started('main', 'e1', 'Edit', '/p/a.ts'),
        started('main', 'e2', 'MultiEdit', '/p/b.ts'),
        started('main', 'e3', 'NotebookEdit', '/p/c.ipynb'),
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
        started('main', 'w1', 'Write', '/p/a.md'),
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
        started('a1', 'w1', 'Write', '/p/a.md'),
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
        started('main', 't1', 'Read', '/p/a.md'),
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
      expected: [spawned('a1'), launched('a1'), taskBegan('bpdumb7hy', 'a1')],
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
      expected: [spawned('a1'), launched('a1'), finished('a1', 'done')],
    },
    {
      case: "revive in the Agent call's process",
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskNotification('a1', 'stopped', 'a8e9e7aad968da282'),
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a8e9e7aad968da282', 's1'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        taskNotification('s1', 'completed', 'a8e9e7aad968da282'),
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        finished('a1', 'failed'),
        started('main', 's1', 'SendMessage', ''),
        spawned('a1'),
        launched('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        taskEnded('bpdumb7hy', 'done'),
        finished('a1', 'done'),
      ],
    },
    {
      case: 'revive of a subagent still running spawns nothing',
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a8e9e7aad968da282', 's1'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        started('main', 's1', 'SendMessage', ''),
      ],
    },
    {
      case: "revive of an earlier process's subagent, spawned at its first reply",
      lines: [
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a798a61bb83ca1c3b', 's1'),
        toolUseLine('s2', 'SendMessage', {}),
        reviveStarted('a2222222222222222', 's2'),
        revivedReply('a9', 'a2222222222222222'),
        revivedReply('a8', 'a798a61bb83ca1c3b'),
        taskNotification('s1', 'completed', 'a798a61bb83ca1c3b'),
        taskNotification('s2', 'failed', 'a2222222222222222'),
      ],
      expected: [
        started('main', 's1', 'SendMessage', ''),
        started('main', 's2', 'SendMessage', ''),
        spawned('a9'),
        launched('a9'),
        started('a9', 't-a9', 'Read', ''),
        spawned('a8'),
        launched('a8'),
        started('a8', 't-a8', 'Read', ''),
        { type: 'toolFinished', agentId: 'a8', toolUseId: 't-a8', ok: false },
        finished('a8', 'done'),
        { type: 'toolFinished', agentId: 'a9', toolUseId: 't-a9', ok: false },
        finished('a9', 'failed'),
      ],
    },
    {
      case: 'revive ending before its first reply spawns nothing',
      lines: [
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a798a61bb83ca1c3b', 's1'),
        taskNotification('s1', 'stopped', 'a798a61bb83ca1c3b'),
        revivedReply('a8', 'a798a61bb83ca1c3b'),
      ],
      expected: [
        started('main', 's1', 'SendMessage', ''),
        started('a8', 't-a8', 'Read', ''),
      ],
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
      case: "launched subagent's end waits for its task",
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        taskNotification('a1', 'completed', 'a8e9e7aad968da282'),
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        taskEnded('bpdumb7hy', 'done'),
        finished('a1', 'done'),
      ],
    },
    {
      case: "launched subagent's end waits for its last task",
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        taskStarted('bq2', 'tb3', 'local_bash', 'a8e9e7aad968da282'),
        taskNotification('a1', 'completed', 'a8e9e7aad968da282'),
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
        taskNotification('tb3', 'completed', 'bq2'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        taskBegan('bq2', 'a1'),
        taskEnded('bpdumb7hy', 'done'),
        taskEnded('bq2', 'done'),
        finished('a1', 'done'),
      ],
    },
    {
      case: "held end keeps the notification's outcome",
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        taskNotification('a1', 'stopped', 'a8e9e7aad968da282'),
        handbackResult('a8e9e7aad968da282'),
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        TURN_ENDED,
        taskEnded('bpdumb7hy', 'done'),
        finished('a1', 'failed'),
      ],
    },
    {
      case: "foreground subagent's end does not wait for its task",
      lines: [
        agentCall('a1', { run_in_background: false }),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        toolResultLine('a1'),
      ],
      expected: [
        spawned('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        finished('a1', 'done'),
      ],
    },
    {
      case: 'revive of a held subagent drops its held end',
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a8e9e7aad968da282'),
        taskNotification('a1', 'completed', 'a8e9e7aad968da282'),
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a8e9e7aad968da282', 's1'),
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        taskBegan('bpdumb7hy', 'a1'),
        started('main', 's1', 'SendMessage', ''),
        taskEnded('bpdumb7hy', 'done'),
      ],
    },
    {
      case: 'late line lists an ended subagent again',
      lines: [
        agentCall('b1', { name: 'notes-reader', model: 'haiku' }),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-haiku-5-5', { output_tokens: 1000 }),
        taskNotification('b1', 'completed'),
        toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'b1'),
      ],
      expected: [
        spawned('b1', 'Explore', 'main', {
          name: 'notes-reader',
          model: 'haiku',
        }),
        launched('b1'),
        replied('b1', 'claude-haiku-5-5', 0.0005, 0, null),
        finished('b1', 'done'),
        spawned('b1', 'Explore', 'main', {
          name: 'notes-reader',
          model: 'haiku',
        }),
        launched('b1'),
        replied('b1', 'claude-haiku-5-5', 0.0005, 0, null),
        started('b1', 't1', 'Read', 'notes.txt'),
      ],
    },
    {
      case: 'revive of a listed-again subagent outlasts a result',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        toolResultLine('t9', { parent: 'b1' }),
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a4e45e22d2e0fef8f', 's1'),
        toolResultLine('s1'),
        RESULT_LINE,
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        started('main', 's1', 'SendMessage', ''),
        { type: 'toolFinished', agentId: 'main', toolUseId: 's1', ok: true },
        TURN_ENDED,
      ],
    },
    {
      case: 'revive then a line lists once',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        toolUseLine('s1', 'SendMessage', {}),
        reviveStarted('a4e45e22d2e0fef8f', 's1'),
        toolUseLine('t1', 'Read', {}, 'b1'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        started('main', 's1', 'SendMessage', ''),
        spawned('b1'),
        launched('b1'),
        started('b1', 't1', 'Read', ''),
      ],
    },
    {
      case: 'late tool result lists an ended subagent again until a result',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskNotification('b1', 'completed'),
        toolResultLine('t9', { parent: 'b1' }),
        RESULT_LINE,
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        TURN_ENDED,
      ],
    },
    {
      case: 'result leaves a listed-again subagent listed while its call runs',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskNotification('b1', 'completed'),
        toolUseLine('t1', 'Read', {}, 'b1'),
        RESULT_LINE,
        toolResultLine('t1', { parent: 'b1' }),
        RESULT_LINE,
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        started('b1', 't1', 'Read', ''),
        TURN_ENDED,
        { type: 'toolFinished', agentId: 'b1', toolUseId: 't1', ok: true },
        finished('b1', 'done'),
        TURN_ENDED,
      ],
    },
    {
      case: 'result leaves a listed-again subagent listed while its Agent call runs',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskNotification('b1', 'completed'),
        agentCall('c1', {}, 'b1'),
        RESULT_LINE,
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        spawned('c1', 'Explore', 'b1'),
        TURN_ENDED,
      ],
    },
    {
      case: "result holds a listed-again subagent's end for its task",
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        toolResultLine('t9', { parent: 'b1' }),
        taskStarted('bpdumb7hy', 'tb2', 'local_bash', 'a4e45e22d2e0fef8f'),
        RESULT_LINE,
        taskNotification('tb2', 'completed', 'bpdumb7hy'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        taskBegan('bpdumb7hy', 'b1'),
        TURN_ENDED,
        taskEnded('bpdumb7hy', 'done'),
        finished('b1', 'done'),
      ],
    },
    {
      case: 'notification ends a listed-again subagent',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        toolResultLine('t9', { parent: 'b1' }),
        taskNotification('b1', 'completed'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
      ],
    },
    {
      case: 'hand-back result ends a listed-again subagent',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        toolResultLine('t9', { parent: 'b1' }),
        handbackResult('a4e45e22d2e0fef8f'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        TURN_ENDED,
      ],
    },
    {
      case: 'late line after a stopped end lists nothing',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskNotification('b1', 'stopped'),
        toolUseLine('t1', 'Read', {}, 'b1'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'failed'),
        started('b1', 't1', 'Read', ''),
      ],
    },
    {
      case: 'hand-back result of an ended subagent ends nothing',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent'),
        taskNotification('b1', 'completed'),
        handbackResult('a4e45e22d2e0fef8f'),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        finished('b1', 'done'),
        TURN_ENDED,
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
    {
      case: 'spawn with name',
      lines: [agentCall('a1', { name: 'notes-reader' })],
      expected: [spawned('a1', 'Explore', 'main', { name: 'notes-reader' })],
    },
    {
      case: 'spawn of a defined type',
      definitions: { mapper: { model: 'sonnet', effort: 'high' } },
      lines: [agentCall('a1', { subagent_type: 'mapper' })],
      expected: [
        spawned('a1', 'mapper', 'main', { model: 'sonnet', effort: 'high' }),
      ],
    },
    {
      case: 'spawn whose input names model and effort',
      definitions: { Explore: { model: 'sonnet', effort: 'low' } },
      lines: [agentCall('a1', { model: 'opus', effort: 'max' })],
      expected: [
        spawned('a1', 'Explore', 'main', { model: 'opus', effort: 'max' }),
      ],
    },
    {
      case: 'subagent reply',
      lines: [agentCall(MEASURED_AGENT_CALL), MEASURED_SUBAGENT_READ],
      expected: [
        spawned(MEASURED_AGENT_CALL),
        replied(
          MEASURED_AGENT_CALL,
          'claude-haiku-5-5',
          0.001963325,
          15639,
          null,
        ),
        started(
          MEASURED_AGENT_CALL,
          'toolu_01Th9zCiM7nvQkeAH1gsms6w',
          'Read',
          '<project>/notes.txt',
        ),
      ],
    },
    {
      case: 'subagent reply re-sent for a second block',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-haiku-5-5', { output_tokens: 1000 }),
        subagentReply('a1', 'm1', 'claude-haiku-5-5', { output_tokens: 1000 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-haiku-5-5', 0.0005, 0, null),
        replied('a1', 'claude-haiku-5-5', 0.0005, 0, null),
      ],
    },
    {
      case: 'subagent replies of two messages',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-haiku-5-5', { output_tokens: 1000 }),
        subagentReply('a1', 'm2', 'claude-sonnet-5-5', {
          input_tokens: 3000,
          output_tokens: 2000,
        }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-haiku-5-5', 0.0005, 0, null),
        replied('a1', 'claude-sonnet-5-5', 0.0265, 3000, null),
      ],
    },
    {
      case: "subagent reply's context is its input tokens, cache included",
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', {
          input_tokens: 10,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 80000,
          output_tokens: 500,
        }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 82010, null),
      ],
    },
    {
      case: "subagent's context is its latest reply's, not a sum",
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { input_tokens: 700 }),
        subagentReply('a1', 'm2', 'claude-mythos-5-1', { input_tokens: 90 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 700, null),
        replied('a1', 'claude-mythos-5-1', null, 90, null),
      ],
    },
    {
      case: "subagent reply when no result named its model's window",
      lines: [
        resultNaming({ 'claude-opus-5-5': 1000000 }),
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { input_tokens: 40 }),
      ],
      expected: [
        TURN_ENDED,
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 40, null),
      ],
    },
    {
      case: 'subagent reply after a result named its window under a suffix',
      lines: [
        resultNaming({ 'claude-mythos-5-1[1m]': 1000000 }),
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { input_tokens: 40 }),
      ],
      expected: [
        TURN_ENDED,
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 40, 1000000),
      ],
    },
    {
      case: "result names a running subagent's window",
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-opus-5-5', {
          input_tokens: 70,
          output_tokens: 1000,
        }),
        resultNaming({ 'claude-opus-5-5': 200000 }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-opus-5-5', 0.02028, 70, null),
        replied('b1', 'claude-opus-5-5', 0.02028, 70, 200000),
        TURN_ENDED,
      ],
    },
    {
      case: 'result repeats a window already sent',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 70 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-mythos-5-1', null, 70, null),
        replied('b1', 'claude-mythos-5-1', null, 70, 200000),
        TURN_ENDED,
        TURN_ENDED,
      ],
    },
    {
      case: 'result names a new window under a suffix and no plain key',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-opus-5-5', { input_tokens: 70 }),
        resultNaming({ 'claude-opus-5-5': 200000 }),
        resultNaming({ 'claude-opus-5-5[1m]': 1000000 }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-opus-5-5', 0.00028, 70, null),
        replied('b1', 'claude-opus-5-5', 0.00028, 70, 200000),
        TURN_ENDED,
        replied('b1', 'claude-opus-5-5', 0.00028, 70, 1000000),
        TURN_ENDED,
      ],
    },
    {
      case: 'result names a plain key beside a suffixed key already learned',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 70 }),
        resultNaming({ 'claude-mythos-5-1[1m]': 1000000 }),
        resultNaming({
          'claude-mythos-5-1': 200000,
          'claude-mythos-5-1[1m]': 1000000,
        }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-mythos-5-1', null, 70, null),
        replied('b1', 'claude-mythos-5-1', null, 70, 1000000),
        TURN_ENDED,
        replied('b1', 'claude-mythos-5-1', null, 70, 200000),
        TURN_ENDED,
      ],
    },
    {
      case: 'result names no window for a subagent, and keeps what it learned',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 70 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
        resultNaming({}),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-mythos-5-1', null, 70, null),
        replied('b1', 'claude-mythos-5-1', null, 70, 200000),
        TURN_ENDED,
        TURN_ENDED,
      ],
    },
    {
      case: "result names one model's window among three running subagents",
      lines: [
        agentCall('b1'),
        agentCall('b2'),
        agentCall('b3'),
        launchReceipt('b1'),
        launchReceipt('b2'),
        launchReceipt('b3'),
        subagentReply('b2', 'm2', 'claude-mythos-5-1', { input_tokens: 20 }),
        subagentReply('b3', 'm3', 'claude-mythos-9-9', { input_tokens: 30 }),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 10 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
      ],
      expected: [
        spawned('b1'),
        spawned('b2'),
        spawned('b3'),
        launched('b1'),
        launched('b2'),
        launched('b3'),
        replied('b2', 'claude-mythos-5-1', null, 20, null),
        replied('b3', 'claude-mythos-9-9', null, 30, null),
        replied('b1', 'claude-mythos-5-1', null, 10, null),
        replied('b1', 'claude-mythos-5-1', null, 10, 200000),
        replied('b2', 'claude-mythos-5-1', null, 20, 200000),
        TURN_ENDED,
      ],
    },
    {
      case: 'result sends a new window to pending calls before launched ones',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        agentCall('n1', {}, 'b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 10 }),
        subagentReply('n1', 'm2', 'claude-mythos-5-1', { input_tokens: 20 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        spawned('n1', 'Explore', 'b1'),
        replied('b1', 'claude-mythos-5-1', null, 10, null),
        replied('n1', 'claude-mythos-5-1', null, 20, null),
        replied('n1', 'claude-mythos-5-1', null, 20, 200000),
        replied('b1', 'claude-mythos-5-1', null, 10, 200000),
        TURN_ENDED,
      ],
    },
    {
      case: 'result fails a pending main call and sends it no window',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { input_tokens: 10 }),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 10, null),
        finished('a1', 'failed'),
        TURN_ENDED,
      ],
    },
    {
      case: 'result sends no window to a finished subagent',
      lines: [
        agentCall('b1'),
        launchReceipt('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 10 }),
        taskNotification('b1', 'completed'),
        resultNaming({ 'claude-mythos-5-1': 200000 }),
      ],
      expected: [
        spawned('b1'),
        launched('b1'),
        replied('b1', 'claude-mythos-5-1', null, 10, null),
        finished('b1', 'done'),
        TURN_ENDED,
      ],
    },
    {
      case: 'subagent reply of an unpriced model',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { output_tokens: 1000 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 0, null),
      ],
    },
    {
      case: 'subagent replies priced then unpriced',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-haiku-5-5', { output_tokens: 1000 }),
        subagentReply('a1', 'm2', 'claude-mythos-5-1', { output_tokens: 1000 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-haiku-5-5', 0.0005, 0, null),
        replied('a1', 'claude-mythos-5-1', null, 0, null),
      ],
    },
    {
      case: 'subagent replies unpriced then priced',
      lines: [
        agentCall('a1'),
        subagentReply('a1', 'm1', 'claude-mythos-5-1', { output_tokens: 1000 }),
        subagentReply('a1', 'm2', 'claude-haiku-5-5', { output_tokens: 1000 }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-mythos-5-1', null, 0, null),
        replied('a1', 'claude-haiku-5-5', null, 0, null),
      ],
    },
    {
      case: 'launch receipt sets the resolved model',
      lines: [
        agentCall('b1', { model: 'haiku', run_in_background: true }),
        toolResultLine('b1', {
          toolUseResult: {
            isAsync: true,
            status: 'async_launched',
            agentId: 'a4e45e22d2e0fef8f',
            description: 'read notes',
            resolvedModel: 'claude-haiku-5-5',
          },
        }),
        taskNotification('b1', 'completed'),
      ],
      expected: [
        spawned('b1', 'Explore', 'main', { model: 'haiku' }),
        replied('b1', 'claude-haiku-5-5', null, null, null),
        launched('b1'),
        finished('b1', 'done'),
      ],
    },
    {
      case: "launch receipt carries the agent's context and its model's window",
      lines: [
        resultNaming({ 'claude-sonnet-5-5[1m]': 1000000 }),
        agentCall('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 70 }),
        toolResultLine('b1', {
          toolUseResult: {
            isAsync: true,
            status: 'async_launched',
            resolvedModel: 'claude-sonnet-5-5',
          },
        }),
      ],
      expected: [
        TURN_ENDED,
        spawned('b1'),
        replied('b1', 'claude-mythos-5-1', null, 70, null),
        replied('b1', 'claude-sonnet-5-5', null, 70, 1000000),
        launched('b1'),
      ],
    },
    {
      case: 'launch receipt with no resolved model',
      lines: [agentCall('b1'), launchReceipt('b1')],
      expected: [spawned('b1'), launched('b1')],
    },
    {
      case: 'launch receipt that failed',
      lines: [
        agentCall('b1'),
        toolResultLine('b1', {
          isError: true,
          toolUseResult: { isAsync: true },
        }),
      ],
      expected: [spawned('b1'), finished('b1', 'failed')],
    },
    {
      case: 'foreground completion receipt',
      lines: [
        agentCall('a1', { run_in_background: false }),
        toolResultLine('a1', {
          toolUseResult: {
            status: 'completed',
            resolvedModel: 'claude-haiku-5-5',
          },
        }),
      ],
      expected: [
        spawned('a1'),
        replied('a1', 'claude-haiku-5-5', null, null, null),
        finished('a1', 'done'),
      ],
    },
    {
      case: "result sends the window of the receipt's model",
      lines: [
        agentCall('b1'),
        subagentReply('b1', 'm1', 'claude-mythos-5-1', { input_tokens: 70 }),
        toolResultLine('b1', {
          toolUseResult: {
            isAsync: true,
            resolvedModel: 'claude-mythos-9-9',
          },
        }),
        resultNaming({ 'claude-mythos-9-9': 200000 }),
      ],
      expected: [
        spawned('b1'),
        replied('b1', 'claude-mythos-5-1', null, 70, null),
        replied('b1', 'claude-mythos-9-9', null, 70, null),
        launched('b1'),
        replied('b1', 'claude-mythos-9-9', null, 70, 200000),
        TURN_ENDED,
      ],
    },
    {
      case: 'receipt of a non-Agent tool',
      lines: [
        toolUseLine('t1', 'Bash', { command: 'ls' }),
        toolResultLine('t1', {
          toolUseResult: { stdout: '', resolvedModel: 'claude-haiku-5-5' },
        }),
      ],
      expected: [
        started('main', 't1', 'Bash', 'ls'),
        { type: 'toolFinished', agentId: 'main', toolUseId: 't1', ok: true },
      ],
    },
    {
      case: 'main reply',
      lines: [REPLY_LINE],
      expected: [],
    },
    {
      case: 'synthetic subagent reply',
      lines: [
        agentCall('a1'),
        replyWith((event) => {
          event.parent_tool_use_id = 'a1';
          event.message.model = '<synthetic>';
        }),
      ],
      expected: [spawned('a1')],
    },
    {
      case: 'main background Bash task',
      lines: [
        toolUseLine('toolu_016R', 'Bash', {
          command: 'sleep 6',
          run_in_background: true,
        }),
        taskStarted('bvrvtgapv', 'toolu_016R', 'local_bash'),
      ],
      expected: [
        started('main', 'toolu_016R', 'Bash', 'sleep 6'),
        taskBegan('bvrvtgapv', 'main', 'sleep 6'),
      ],
    },
    {
      case: 'subagent-owned Bash task',
      lines: [
        agentCall('a1'),
        launchReceipt('a1'),
        taskStarted('a8e9e7aad968da282', 'a1', 'local_agent'),
        toolUseLine('toolu_013y', 'Bash', { command: SUBAGENT_BASH }, 'a1'),
        taskStarted(
          'bpdumb7hy',
          'toolu_013y',
          'local_bash',
          'a8e9e7aad968da282',
        ),
      ],
      expected: [
        spawned('a1'),
        launched('a1'),
        started(
          'a1',
          'toolu_013y',
          'Bash',
          'python3 -c "import time; time.sleep(45)"',
        ),
        taskBegan('bpdumb7hy', 'a1', SUBAGENT_BASH),
      ],
    },
    {
      case: 'task with no linked call',
      lines: [taskStarted('bvrvtgapv', 'toolu_none', 'local_bash')],
      expected: [taskBegan('bvrvtgapv')],
    },
  ])('decode_AgentEvents_$case', ({ lines, expected, definitions }) => {
    const known = new Map<string, AgentDefinition>(
      Object.entries(definitions ?? {}),
    );
    const decoder = createStreamDecoder(
      undefined,
      (agentType) => known.get(agentType) ?? null,
    );

    const drafts = lines.flatMap((text) => decoder.decode(text).agentEvents);

    expect(drafts).toEqual(expected);
  });
});
