import type {
  AgentCommand,
  ChatEntry,
  SessionControl,
} from '../../../contracts/agent';
import type { KeyedSlotWriter, ListSlotWriter } from '../../../contracts/state';
import { listWithPut } from '../../../shared/state/slot-store';
import type {
  ChatSessionInfo,
  ChatSessionState,
  QueuedMessage,
  ReturnedMessage,
} from '../contract';

export interface ChatSlotWriters {
  session: KeyedSlotWriter<ChatSessionInfo>;
  entries: ListSlotWriter<ChatEntry>;
  controls: KeyedSlotWriter<SessionControl[]>;
  commands: KeyedSlotWriter<AgentCommand[]>;
  queued: KeyedSlotWriter<QueuedMessage[]>;
  returned: KeyedSlotWriter<ReturnedMessage[]>;
}

// One session's view of the slots: the only path chat main and the preview read
// or write a session's state. Each `set` and `put` is one slot change, and a value
// is not changed after it is set. `close` deletes the session's key in all six
// slots, `chat.session` first; after it, reads and writes use a private copy and
// no slot changes, so a late process event cannot bring a closed session's key back.
export interface SessionSlots {
  readonly sessionId: string;
  // A new object holding new lists.
  read(): ChatSessionState;
  info(): ChatSessionInfo;
  setInfo(
    change: Partial<
      Omit<ChatSessionInfo, 'sessionId' | 'projectDir' | 'profile'>
    >,
  ): void;
  entries(): readonly ChatEntry[];
  putEntry(entry: ChatEntry): void;
  replaceEntries(entries: readonly ChatEntry[]): void;
  controls(): SessionControl[];
  setControls(controls: SessionControl[]): void;
  commands(): AgentCommand[];
  setCommands(commands: AgentCommand[]): void;
  queued(): QueuedMessage[];
  setQueued(queued: QueuedMessage[]): void;
  returned(): ReturnedMessage[];
  setReturned(returned: ReturnedMessage[]): void;
  close(): void;
}

// `open` writes the session's lists, then `chat.session` last, so a reader that
// finds the session key finds its lists.
export interface ChatSlots {
  open(state: ChatSessionState): SessionSlots;
}

// The key `open` wrote, which only `close` deletes.
function required<V>(value: V | undefined, slot: string, key: string): V {
  if (value === undefined) {
    throw new Error(`${slot} holds no key ${key}`);
  }
  return value;
}

export function createChatSlots(writers: ChatSlotWriters): ChatSlots {
  return {
    open(state) {
      const { sessionId } = state;
      const {
        entries: openingEntries,
        controls: openingControls,
        commands: openingCommands,
        queued: openingQueued,
        returned: openingReturned,
        ...openingInfo
      } = state;
      writers.entries.replace(sessionId, openingEntries);
      writers.controls.set(sessionId, openingControls);
      writers.commands.set(sessionId, openingCommands);
      writers.queued.set(sessionId, openingQueued);
      writers.returned.set(sessionId, openingReturned);
      writers.session.set(sessionId, openingInfo);

      // Null until `close`, then the one copy every later read and write uses.
      let detached: ChatSessionState | null = null;

      const info = (): ChatSessionInfo =>
        detached ??
        required(writers.session.get(sessionId), 'chat.session', sessionId);
      const entries = (): readonly ChatEntry[] =>
        detached?.entries ?? writers.entries.get(sessionId);
      const controls = () =>
        detached?.controls ??
        required(writers.controls.get(sessionId), 'chat.controls', sessionId);
      const commands = () =>
        detached?.commands ??
        required(writers.commands.get(sessionId), 'chat.commands', sessionId);
      const queued = () =>
        detached?.queued ??
        required(writers.queued.get(sessionId), 'chat.queued', sessionId);
      const returned = () =>
        detached?.returned ??
        required(writers.returned.get(sessionId), 'chat.returned', sessionId);
      const read = (): ChatSessionState => {
        return {
          ...info(),
          entries: [...entries()],
          controls: [...controls()],
          commands: [...commands()],
          queued: [...queued()],
          returned: [...returned()],
        };
      };

      return {
        sessionId,
        read,
        info,
        setInfo(change) {
          if (detached !== null) {
            detached = { ...detached, ...change };
            return;
          }
          writers.session.set(sessionId, { ...info(), ...change });
        },
        entries,
        putEntry(entry) {
          if (detached !== null) {
            detached.entries = listWithPut(detached.entries, entry);
            return;
          }
          writers.entries.put(sessionId, entry);
        },
        replaceEntries(next) {
          if (detached !== null) {
            detached.entries = [...next];
            return;
          }
          writers.entries.replace(sessionId, next);
        },
        controls,
        setControls(next) {
          if (detached !== null) {
            detached.controls = next;
            return;
          }
          writers.controls.set(sessionId, next);
        },
        commands,
        setCommands(next) {
          if (detached !== null) {
            detached.commands = next;
            return;
          }
          writers.commands.set(sessionId, next);
        },
        queued,
        setQueued(next) {
          if (detached !== null) {
            detached.queued = next;
            return;
          }
          writers.queued.set(sessionId, next);
        },
        returned,
        setReturned(next) {
          if (detached !== null) {
            detached.returned = next;
            return;
          }
          writers.returned.set(sessionId, next);
        },
        close() {
          if (detached !== null) {
            return;
          }
          detached = read();
          writers.session.delete(sessionId);
          writers.entries.delete(sessionId);
          writers.controls.delete(sessionId);
          writers.commands.delete(sessionId);
          writers.queued.delete(sessionId);
          writers.returned.delete(sessionId);
        },
      };
    },
  };
}
