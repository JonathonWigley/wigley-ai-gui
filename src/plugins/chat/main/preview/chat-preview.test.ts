import { describe, expect, it, vi } from 'vitest';
import { type ChatEntry, MAIN_AGENT_ID } from '../../../../contracts/agent';
import { createSlotStore } from '../../../../shared/state/slot-store';
import type { SessionInfo } from '../../../sessions/contract';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatAgentEvent,
  chatCommandsSlot,
  chatControlsSlot,
  chatEntriesSlot,
  chatQueuedSlot,
  chatReturnedSlot,
  chatSessionSlot,
} from '../../contract';
import { createChatSlots } from '../chat-slots';
import { createChatPreview } from './chat-preview';
import { previewAgentEvents } from './preview-agent-events';

// A preview over sessions whose `open` hands out rows `row-1`, `row-2`, …;
// `ends` holds each row whose owned session ended, `emitted` each agent event
// published, and `order` each slot written and event emitted by name.
function setUp() {
  const opened: [SessionInfo, unknown][] = [];
  const order: string[] = [];
  const ends: string[] = [];
  const store = createSlotStore(() => undefined);
  store.onWrite((change) => order.push(change.id));
  const puts: ChatEntry[] = [];
  store.onWrite((change) => {
    if (change.kind === 'list' && change.change.kind === 'put') {
      puts.push(change.change.item as ChatEntry);
    }
  });
  const emitted: ChatAgentEvent[] = [];
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
    slots: createChatSlots({
      session: store.publish(chatSessionSlot),
      entries: store.publish(chatEntriesSlot),
      controls: store.publish(chatControlsSlot),
      commands: store.publish(chatCommandsSlot),
      queued: store.publish(chatQueuedSlot),
      returned: store.publish(chatReturnedSlot),
    }),
    emit(event, data) {
      emitted.push(data);
      order.push(event);
    },
    log: () => undefined,
    clock: { now: () => 5000 },
  });
  const sessionKeys = () => [
    ...store.read(chatSessionSlot, 'test').all().keys(),
  ];
  return {
    preview,
    opened,
    ends,
    activate,
    store,
    sessionKeys,
    puts,
    emitted,
    order,
  };
}

describe('chat preview', () => {
  it('open_FirstPress_OpensSelectedRowWithEveryKindAndControl', () => {
    const { preview, opened, activate, store } = setUp();

    preview.open();

    expect(opened).toEqual([
      [
        expect.objectContaining({ sessionId: CHAT_PREVIEW_HOST_ID }),
        { select: true },
      ],
    ]);
    expect(activate).toHaveBeenCalledWith('row-1');
    const entries = store.read(chatEntriesSlot, 'test').get('row-1');
    expect(new Set(entries.map((entry) => entry.kind))).toEqual(
      new Set([
        'user',
        'assistant',
        'thinking',
        'tool',
        'permission',
        'result',
        'notice',
        'raw',
        'compaction',
      ]),
    );
    const controls = store.read(chatControlsSlot, 'test').get('row-1') ?? [];
    const controlIds = controls.map((control) => control.id);
    expect(controlIds).toEqual(
      expect.arrayContaining(['mode', 'effort', 'model']),
    );
    expect(
      controlIds.some((id) => !['mode', 'effort', 'model'].includes(id)),
    ).toBe(true);
    expect(store.read(chatSessionSlot, 'test').get('row-1')).toMatchObject({
      sessionId: 'row-1',
      running: true,
      activity: 'idle',
    });
  });

  it('open_SecondPress_ActivatesTheSameRow', () => {
    const { preview, opened, activate, sessionKeys, emitted } = setUp();

    preview.open();
    preview.open();

    expect(opened).toHaveLength(1);
    expect(activate.mock.calls).toEqual([['row-1'], ['row-1']]);
    expect(sessionKeys()).toEqual(['row-1']);
    expect(emitted).toHaveLength(previewAgentEvents(5000).length);
  });

  it('open_FirstPress_EmitsTheSampleAgentEventsAfterStarting', () => {
    const { preview, emitted, order } = setUp();

    preview.open();

    const events = previewAgentEvents(5000);
    expect(order.slice(-events.length - 1)).toEqual([
      chatSessionSlot.id,
      ...events.map(() => 'agentEvent'),
    ]);
    expect(emitted).toEqual(
      events.map((event) => ({
        sessionId: 'row-1',
        profileDir: null,
        hostSessionId: CHAT_PREVIEW_HOST_ID,
        event,
        replayed: false,
      })),
    );
  });

  it('previewAgentEvents_ListsTwoSubagentsOneFinishedATaskWithACommandAndASkillForMainAndASubagent', () => {
    const events = previewAgentEvents(5000);
    const count = (type: string) =>
      events.filter((event) => event.type === type).length;

    expect({
      agentSpawned: count('agentSpawned'),
      agentReplied: count('agentReplied'),
      agentLaunched: count('agentLaunched'),
      agentFinished: events.flatMap((event) =>
        event.type === 'agentFinished' ? [event.outcome] : [],
      ),
      tasksWithCommand: events.filter(
        (event) => event.type === 'taskStarted' && event.command !== null,
      ).length,
      skillsByMain: events.filter(
        (event) =>
          event.type === 'skillStarted' && event.agentId === MAIN_AGENT_ID,
      ).length,
      skillsBySubagents: events.filter(
        (event) =>
          event.type === 'skillStarted' && event.agentId !== MAIN_AGENT_ID,
      ).length,
    }).toEqual({
      agentSpawned: 2,
      agentReplied: 1,
      agentLaunched: 0,
      agentFinished: ['done'],
      tasksWithCommand: 1,
      skillsByMain: 1,
      skillsBySubagents: 1,
    });
  });

  it('closed_PreviewRow_EndsItAndAllowsANewOne', () => {
    const { preview, opened, ends, sessionKeys } = setUp();
    preview.open();

    preview.closed('other-row');
    const afterOther = { ends: [...ends], keys: sessionKeys() };
    preview.closed('row-1');
    const afterClose = { ends: [...ends], keys: sessionKeys() };
    preview.open();

    expect(afterOther).toEqual({ ends: [], keys: ['row-1'] });
    expect(afterClose).toEqual({ ends: ['row-1'], keys: [] });
    expect(opened).toHaveLength(2);
  });

  it('notice_Preview_AddsANoticeEntry', () => {
    const { preview, puts } = setUp();
    preview.open();

    preview.notice('Signed in.', 'error');

    expect(puts).toEqual([
      expect.objectContaining({
        kind: 'notice',
        at: 5000,
        text: 'Signed in.',
        tone: 'error',
      }),
    ]);
  });
});
