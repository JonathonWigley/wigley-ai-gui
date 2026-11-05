import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../../contracts/agent';
import type { SlotChange } from '../../../contracts/state';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  chatCommandsSlot,
  chatControlsSlot,
  chatEntriesSlot,
  chatQueuedSlot,
  chatReturnedSlot,
  type ChatSessionState,
  chatSessionSlot,
  type QueuedMessage,
} from '../contract';
import { createChatSlots, type SessionSlots } from './chat-slots';

const NOTICE: ChatEntry = {
  kind: 'notice',
  id: 'n1',
  at: 1000,
  text: 'hello',
  tone: 'info',
  raw: [],
};

const QUEUED: QueuedMessage = {
  id: 'queued-1',
  text: 'later',
  images: [],
  sentEntryId: null,
  holdReason: null,
};

const STATE: ChatSessionState = {
  sessionId: 'row-1',
  projectDir: '/p',
  profile: 'work',
  entries: [],
  controls: [],
  activity: 'idle',
  background: 0,
  activeTime: NO_ACTIVE_TIME,
  commands: [],
  running: false,
  queued: [],
  compaction: null,
  returned: [],
  repo: 'p',
  branch: null,
};

// Chat's slots over a real store; `changes` holds each write in order.
function setUp() {
  const store = createSlotStore(() => undefined);
  const changes: SlotChange[] = [];
  store.onWrite((change) => changes.push(change));
  const slots = createChatSlots({
    session: store.publish(chatSessionSlot),
    entries: store.publish(chatEntriesSlot),
    controls: store.publish(chatControlsSlot),
    commands: store.publish(chatCommandsSlot),
    queued: store.publish(chatQueuedSlot),
    returned: store.publish(chatReturnedSlot),
  });
  return { store, changes, slots };
}

describe('createChatSlots', () => {
  it('chatSlots_SessionOpens_WritesSessionKeyLast', () => {
    const { changes, slots } = setUp();

    slots.open(STATE);

    expect(changes.at(-1)).toMatchObject({
      id: 'chat.session',
      key: 'row-1',
    });
    expect(changes.map((change) => change.id).sort()).toEqual([
      'chat.commands',
      'chat.controls',
      'chat.entries',
      'chat.queued',
      'chat.returned',
      'chat.session',
    ]);
  });

  it('chatSlots_SessionCloses_DeletesSessionKeyFirst', () => {
    const { changes, slots } = setUp();
    const session = slots.open(STATE);
    changes.length = 0;

    session.close();

    expect(changes).toHaveLength(6);
    expect(changes[0]).toMatchObject({
      id: 'chat.session',
      key: 'row-1',
      value: undefined,
    });
    expect(session.read()).toEqual(STATE);
  });

  it.each<{
    write: string;
    act(session: SessionSlots): void;
    answer: Partial<ChatSessionState>;
  }>([
    {
      write: 'setInfo',
      act: (session) => session.setInfo({ running: true }),
      answer: { running: true },
    },
    {
      write: 'putEntry',
      act: (session) => session.putEntry(NOTICE),
      answer: { entries: [NOTICE] },
    },
    {
      write: 'setQueued',
      act: (session) => session.setQueued([QUEUED]),
      answer: { queued: [QUEUED] },
    },
  ])('chatSlots_WriteAfterClose_SetsNoKeyAndReadsAnswer: $write', (row) => {
    const { store, changes, slots } = setUp();
    const session = slots.open(STATE);
    session.close();
    changes.length = 0;

    row.act(session);

    expect(changes).toEqual([]);
    expect(store.read(chatSessionSlot, 'test').get('row-1')).toBeUndefined();
    expect(session.read()).toEqual({ ...STATE, ...row.answer });
  });

  it('putEntry_SameIdTwice_ReplacesInPlaceOpenAndClosed', () => {
    const { slots } = setUp();
    const later: ChatEntry = { ...NOTICE, id: 'n2' };
    const changed: ChatEntry = { ...NOTICE, text: 'changed' };
    const session = slots.open({ ...STATE, entries: [NOTICE, later] });

    session.putEntry(changed);
    const whileOpen = session.entries();
    session.close();
    session.putEntry({ ...changed, text: 'late' });

    expect(whileOpen).toEqual([changed, later]);
    expect(session.entries()).toEqual([{ ...changed, text: 'late' }, later]);
  });
});
