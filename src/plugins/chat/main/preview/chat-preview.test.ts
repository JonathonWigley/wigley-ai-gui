import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../../../contracts/agent';
import type { SessionInfo } from '../../../sessions/contract';
import { CHAT_PREVIEW_HOST_ID, type ChatSessionState } from '../../contract';
import { createChatPreview } from './chat-preview';

// A preview over sessions whose `open` hands out rows `row-1`, `row-2`, …;
// `sent` holds each channel message, `ends` each row whose owned session
// ended.
function setUp() {
  const opened: [SessionInfo, unknown][] = [];
  const ends: string[] = [];
  const sent: { message: string; data: unknown }[] = [];
  const activate = vi.fn<(sessionId: string) => void>();
  const preview = createChatPreview({
    sessions: {
      open(info, options) {
        opened.push([info, options]);
        const id = `row-${opened.length}`;
        return {
          session: { id } as never,
          end: () => ends.push(id),
          setHostSessionId: () => undefined,
        };
      },
      activate,
    },
    send: (message, data) => sent.push({ message, data }),
    log: () => undefined,
    clock: { now: () => 5000 },
  });
  const started = () =>
    sent
      .filter((held) => held.message === 'sessionStarted')
      .map((held) => held.data as ChatSessionState);
  const entries = () =>
    sent
      .filter((held) => held.message === 'entry')
      .map((held) => (held.data as { entry: ChatEntry }).entry);
  return { preview, opened, ends, activate, started, entries };
}

describe('chat preview', () => {
  it('open_FirstPress_OpensSelectedRowWithEveryKindAndControl', () => {
    const { preview, opened, activate, started } = setUp();

    preview.open();

    expect(opened).toEqual([
      [
        expect.objectContaining({ sessionId: CHAT_PREVIEW_HOST_ID }),
        { select: true },
      ],
    ]);
    expect(activate).toHaveBeenCalledWith('row-1');
    const [state] = started();
    expect(new Set(state.entries.map((entry) => entry.kind))).toEqual(
      new Set([
        'user',
        'assistant',
        'thinking',
        'tool',
        'permission',
        'result',
        'notice',
        'raw',
      ]),
    );
    const controlIds = state.controls.map((control) => control.id);
    expect(controlIds).toEqual(
      expect.arrayContaining(['mode', 'effort', 'model']),
    );
    expect(
      controlIds.some((id) => !['mode', 'effort', 'model'].includes(id)),
    ).toBe(true);
    expect(state).toMatchObject({
      sessionId: 'row-1',
      running: true,
      activity: 'idle',
    });
  });

  it('open_SecondPress_ActivatesTheSameRow', () => {
    const { preview, opened, activate, started } = setUp();

    preview.open();
    preview.open();

    expect(opened).toHaveLength(1);
    expect(activate.mock.calls).toEqual([['row-1'], ['row-1']]);
    expect(started()).toHaveLength(1);
  });

  it('closed_PreviewRow_EndsItAndAllowsANewOne', () => {
    const { preview, opened, ends } = setUp();
    preview.open();

    preview.closed('other-row');
    const afterOther = { ends: [...ends], states: preview.states().length };
    preview.closed('row-1');
    const afterClose = { ends: [...ends], states: preview.states() };
    preview.open();

    expect(afterOther).toEqual({ ends: [], states: 1 });
    expect(afterClose).toEqual({ ends: ['row-1'], states: [] });
    expect(opened).toHaveLength(2);
  });

  it('notice_Preview_AddsANoticeEntry', () => {
    const { preview, entries } = setUp();
    preview.open();

    preview.notice('Signed in.', 'error');

    expect(entries()).toEqual([
      expect.objectContaining({
        kind: 'notice',
        at: 5000,
        text: 'Signed in.',
        tone: 'error',
      }),
    ]);
  });
});
