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

const toolUseEvent = assistantEvent('m2', [
  {
    type: 'tool_use',
    id: 't1',
    name: 'Bash',
    input: { command: 'ls -la\necho' },
    caller: { type: 'direct' },
  },
]);

describe('createStreamDecoder', () => {
  it('decode_Init_ReportsCommandsAndControls', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'system',
        subtype: 'init',
        cwd: '/proj',
        model: 'claude-opus-5-5[1m]',
        permissionMode: 'auto',
        slash_commands: ['/compact', 'model'],
        skills: ['wigley:feature', 'compact'],
      }),
    );

    expect(decoded.commands).toEqual(['compact', 'model', 'wigley:feature']);
    expect(decoded.reported).toEqual({
      mode: 'auto',
      model: 'claude-opus-5-5[1m]',
    });
    expect(decoded.entries).toEqual([]);
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

  it('decode_SecondResult_CostIsTheTurnsShare', () => {
    const decoder = createStreamDecoder();
    const result = (total: number) =>
      line({ type: 'result', subtype: 'success', total_cost_usd: total });
    decoder.decode(result(0.25));

    const [entry] = decoder.decode(result(0.75)).entries;

    expect(entry).toMatchObject({ kind: 'result', costUsd: 0.5 });
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

  it('decode_ModeStatus_ReportsModeWithNoEntry', () => {
    const decoder = createStreamDecoder();

    const decoded = decoder.decode(
      line({
        type: 'system',
        subtype: 'status',
        status: null,
        permissionMode: 'plan',
      }),
    );

    expect(decoded.reported).toEqual({ mode: 'plan' });
    expect(decoded.entries).toEqual([]);
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
    });
    expect(failure.controlResponse).toEqual({
      requestId: 'wigley-2',
      error: 'Cannot set permission mode',
    });
    expect([...success.entries, ...failure.entries]).toEqual([]);
  });
});
