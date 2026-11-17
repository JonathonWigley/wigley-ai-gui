import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { isJsonObject } from '../../../shared/json';
import { compareText } from '../../../shared/key-hints';
import {
  createSerialQueue,
  type SerialQueue,
} from '../../../shared/serial-queue';
import {
  ENTRY_KINDS,
  isMessageRef,
  isParticipant,
  type NewMessage,
  POST_KINDS,
  type RoomMessage,
  type RoomStore,
} from '../contract';
import { ROOMS_FOLDER, roomFileName, roomOfFileName } from './room-store';

const MESSAGE_KINDS: readonly string[] = [...POST_KINDS, ...ENTRY_KINDS];

// A room as loaded from its file: its messages in id order, and whether the
// file's last line may be cut, so the next append leads with a newline.
interface LoadedRoom {
  messages: RoomMessage[];
  tailMayBeCut: boolean;
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

function isRoomMessage(value: unknown): value is RoomMessage {
  if (!isJsonObject(value)) {
    return false;
  }
  const hasStoreId = Number.isInteger(value.id) && (value.id as number) >= 1;
  const hasParticipants =
    isParticipant(value.from) &&
    Array.isArray(value.to) &&
    value.to.every(isParticipant);
  const hasRefs = Array.isArray(value.refs) && value.refs.every(isMessageRef);
  return (
    hasStoreId &&
    hasParticipants &&
    hasRefs &&
    typeof value.room === 'string' &&
    typeof value.thread === 'string' &&
    MESSAGE_KINDS.includes(value.kind as string) &&
    typeof value.body === 'string' &&
    isNumberOrNull(value.replyTo) &&
    isNumberOrNull(value.answerBy) &&
    isStringOrNull(value.onNoAnswer) &&
    isStringOrNull(value.key) &&
    typeof value.at === 'number' &&
    typeof value.userWord === 'boolean'
  );
}

function parsedMessage(line: string): RoomMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return isRoomMessage(value) ? value : null;
}

// The file's whole messages in id order, the first of two lines with one id
// kept; each other non-blank line is logged by its 1-based number.
function wholeMessages(
  text: string,
  filePath: string,
  log: PluginLog,
): RoomMessage[] {
  const messages: RoomMessage[] = [];
  const ids = new Set<number>();
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') {
      continue;
    }
    const message = parsedMessage(line);
    if (message === null || ids.has(message.id)) {
      log(`${filePath} line ${index + 1} skipped: not a whole message`);
    } else {
      ids.add(message.id);
      messages.push(message);
    }
  }
  return messages.sort((a, b) => a.id - b.id);
}

function roomPath(room: string): string {
  return `${ROOMS_FOLDER}/${roomFileName(room)}`;
}

function lastId(room: LoadedRoom): number {
  return room.messages.length === 0
    ? 0
    : room.messages[room.messages.length - 1].id;
}

// The store over `rooms/<roomFileName(room)>` in plugin data, one JSON line
// per message. A room's file is read once, at its first call, and its
// messages kept after that; a failed read caches nothing. Each room's calls
// run one at a time, in call order.
export function createJsonlRoomStore(deps: {
  files: Pick<Files, 'read' | 'append' | 'list'>;
  log: PluginLog;
}): RoomStore {
  const loaded = new Map<string, LoadedRoom>();
  const queues = new Map<string, SerialQueue>();

  const queueOf = (room: string): SerialQueue => {
    let queue = queues.get(room);
    if (queue === undefined) {
      queue = createSerialQueue();
      queues.set(room, queue);
    }
    return queue;
  };

  // Run only inside the room's queue, so one load runs per room.
  const loadedRoom = async (room: string): Promise<LoadedRoom> => {
    const cached = loaded.get(room);
    if (cached !== undefined) {
      return cached;
    }
    const path = roomPath(room);
    const text = await readIfPresent(deps.files, path);
    const fresh: LoadedRoom = {
      messages: text === null ? [] : wholeMessages(text, path, deps.log),
      tailMayBeCut: true,
    };
    loaded.set(room, fresh);
    return fresh;
  };

  const appendInTurn = async (
    message: NewMessage,
    path: string,
  ): Promise<RoomMessage> => {
    const room = await loadedRoom(message.room);
    const stored: RoomMessage = { ...message, id: lastId(room) + 1 };
    const line = JSON.stringify(stored) + '\n';
    try {
      await deps.files.append(path, room.tailMayBeCut ? '\n' + line : line);
    } catch (error) {
      room.tailMayBeCut = true;
      throw error;
    }
    room.tailMayBeCut = false;
    room.messages.push(stored);
    return stored;
  };

  return {
    async append(message) {
      const path = roomPath(message.room);
      return queueOf(message.room).run(() => appendInTurn(message, path));
    },
    async read(room, afterId) {
      if (room === '') {
        return [];
      }
      return queueOf(room).run(async () => {
        const { messages } = await loadedRoom(room);
        return messages.filter((message) => message.id > afterId);
      });
    },
    async rooms() {
      const entries = await deps.files.list(ROOMS_FOLDER);
      const filed = entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => roomOfFileName(entry.path))
        .filter((room) => room !== null);
      await Promise.all(
        filed.map((room) => queueOf(room).run(() => loadedRoom(room))),
      );
      return [...loaded]
        .filter(([, room]) => room.messages.length > 0)
        .map(([room]) => room)
        .sort(compareText);
    },
  };
}
