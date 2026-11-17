import { compareText } from '../../../shared/key-hints';
import type { RoomMessage, RoomStore } from '../contract';

// The store held in a `Map`, touching no file: the double tests use.
export function createMemoryRoomStore(): RoomStore {
  const roomMessages = new Map<string, RoomMessage[]>();
  return {
    async append(message) {
      if (message.room === '') {
        throw new Error('a room name is empty');
      }
      const messages = roomMessages.get(message.room) ?? [];
      const lastId =
        messages.length === 0 ? 0 : messages[messages.length - 1].id;
      const stored: RoomMessage = { ...message, id: lastId + 1 };
      messages.push(stored);
      roomMessages.set(message.room, messages);
      return stored;
    },
    async read(room, afterId) {
      return (roomMessages.get(room) ?? []).filter(
        (message) => message.id > afterId,
      );
    },
    async rooms() {
      return [...roomMessages.keys()].sort(compareText);
    },
  };
}
