import { describe, expect, it } from 'vitest';
import {
  type NewMessage,
  type Participant,
  type RoomStore,
  USER_PARTICIPANT,
} from '../contract';

const lead: Participant = {
  kind: 'agent',
  rowId: 'row-1',
  agentId: null,
  mirrorId: null,
  name: 'Shop Revamp',
};

const worker: Participant = {
  kind: 'agent',
  rowId: 'row-2',
  agentId: 'agent-7',
  mirrorId: null,
  name: 'Lint Fix ▸ worker',
};

// A note in `room` with `body`, every optional field left empty.
export function newMessage(room: string, body: string): NewMessage {
  return {
    room,
    thread: 'shop-revamp',
    from: lead,
    to: [],
    kind: 'note',
    body,
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    at: 1000,
    userWord: false,
  };
}

// A question in `room` with `body`, every field set to a value other than
// its empty one.
export function messageWithEveryField(room: string, body: string): NewMessage {
  return {
    room,
    thread: 'session:row-1',
    from: worker,
    to: [lead, USER_PARTICIPANT],
    kind: 'question',
    body,
    refs: [
      { type: 'file', value: 'src/shop.ts' },
      { type: 'commit', value: 'cb36fdae8' },
    ],
    replyTo: 4,
    answerBy: 1_700_000_060_000,
    onNoAnswer: 'I take the editor',
    key: 'retry-1',
    at: 1_700_000_000_000,
    userWord: true,
  };
}

async function idsOf(store: RoomStore, room: string): Promise<number[]> {
  return (await store.read(room, 0)).map((message) => message.id);
}

// The behaviour every `RoomStore` adapter shares, which callers rely on
// whichever adapter they hold. `current` returns the store under test, called
// inside each test.
export function describeRoomStoreContract(current: () => RoomStore): void {
  describe('RoomStore contract', () => {
    it.each([
      { appendedTo: ['shop', 'shop', 'shop'], expected: { shop: [1, 2, 3] } },
      { appendedTo: ['a', 'b', 'a'], expected: { a: [1, 2], b: [1] } },
    ])(
      'append_AssignsIdsPerRoom: $appendedTo',
      async ({ appendedTo, expected }) => {
        const store = current();
        const given: Record<string, number[]> = {};

        for (const room of appendedTo) {
          const stored = await store.append(newMessage(room, 'hello'));
          (given[room] ??= []).push(stored.id);
        }

        expect(given).toEqual(expected);
        for (const [room, ids] of Object.entries(expected)) {
          expect(await idsOf(store, room)).toEqual(ids);
        }
      },
    );

    it('append_ReturnsTheMessageWithItsId', async () => {
      const store = current();
      const message = messageWithEveryField('shop', 'Is the editor free?');

      const stored = await store.append(message);

      expect(stored).toEqual({ ...message, id: 1 });
      expect(await store.read('shop', 0)).toEqual([{ ...message, id: 1 }]);
    });

    it('append_Concurrent_GetsDistinctIdsInOrder', async () => {
      const store = current();
      const count = 20;
      const ordinals = Array.from({ length: count }, (_, index) => index + 1);

      const stored = await Promise.all(
        ordinals.map((ordinal) =>
          store.append(newMessage('shop', `message ${ordinal}`)),
        ),
      );

      expect(stored.map((message) => message.id)).toEqual(ordinals);
      expect(
        (await store.read('shop', 0)).map(({ id, body }) => ({ id, body })),
      ).toEqual(
        ordinals.map((ordinal) => ({
          id: ordinal,
          body: `message ${ordinal}`,
        })),
      );
    });

    it.each([
      { room: 'shop', afterId: 0, expected: [1, 2, 3, 4, 5] },
      { room: 'shop', afterId: 3, expected: [4, 5] },
      { room: 'shop', afterId: 5, expected: [] },
      { room: 'unknown', afterId: 0, expected: [] },
    ])(
      'read_AfterId: $room after $afterId → $expected',
      async ({ room, afterId, expected }) => {
        const store = current();
        for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
          await store.append(newMessage('shop', `message ${ordinal}`));
        }

        const read = await store.read(room, afterId);

        expect(read.map((message) => message.id)).toEqual(expected);
      },
    );

    it.each([
      {
        appendedTo: ['b', 'Shop Revamp', 'a', 'é'],
        expected: ['Shop Revamp', 'a', 'b', 'é'],
      },
      { appendedTo: [], expected: [] },
    ])(
      'rooms_ListsRoomsWithMessagesSorted: $appendedTo',
      async ({ appendedTo, expected }) => {
        const store = current();
        for (const room of appendedTo) {
          await store.append(newMessage(room, 'hello'));
        }

        expect(await store.rooms()).toEqual(expected);
      },
    );

    it('append_EmptyRoom_Rejects', async () => {
      const store = current();

      await expect(store.append(newMessage('', 'hello'))).rejects.toThrow();

      expect(await store.rooms()).toEqual([]);
    });
  });
}
