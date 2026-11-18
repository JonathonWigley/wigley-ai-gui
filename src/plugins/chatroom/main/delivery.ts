import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports, ChatSessionInfo } from '../../chat/contract';
import {
  type Participant,
  participantKey,
  type PostKind,
  type RoomMessage,
} from '../contract';
import type { RoomService } from './room-service';
import type { Roster } from './roster';

const WAKING_KINDS: readonly PostKind[] = ['question', 'blocker', 'handoff'];

// `chatState` reads the row's `chat.session` value, undefined before it has
// one. `onTurnFinished` hears chat's `turnFinished`, `onSessionEnded`
// sessions' `ended`.
export interface DeliveryDeps {
  readonly room: Pick<RoomService, 'onMessage' | 'unreadAddressed'>;
  readonly roster: Pick<Roster, 'sessions' | 'participant' | 'roomOf'>;
  readonly chat: Pick<ChatMainExports, 'profileOf' | 'send'>;
  chatState(
    rowId: string,
  ): Pick<ChatSessionInfo, 'activity' | 'running'> | undefined;
  onTurnFinished(
    listener: (sessionId: string, how: 'idle' | 'rested') => void,
  ): Disposable;
  onSessionEnded(listener: (sessionId: string) => void): Disposable;
  readonly log: PluginLog;
}

function addresses(message: RoomMessage, participant: Participant): boolean {
  const key = participantKey(participant);
  return message.to.some((target) => participantKey(target) === key);
}

function wakeText(message: RoomMessage, isUserWord: boolean): string {
  return isUserWord
    ? `Chatroom: the user wrote to you in thread ${message.thread}. Call chatroom_read to read it.`
    : `Chatroom: ${message.from.name} sent you a ${message.kind} in thread ${message.thread}. Call chatroom_read to read it.`;
}

// Wakes an app-run session's main agent with a chat message when a question,
// blocker or handoff names it, or the user's word reaches it: at once when the
// session is idle with its process running, else at its next idle turn end if
// still unread. A resting session (no process running: stopped, exited, or not
// started since the app opened) is never woken, so a wake never starts a resting
// session's process.
export function startDelivery(deps: DeliveryDeps): Disposable {
  const { room, roster, chat } = deps;

  const isIdle = (rowId: string): boolean => {
    const state = deps.chatState(rowId);
    return state?.running === true && state.activity === 'idle';
  };
  // Row id → message id → the wake text, for rows that were busy.
  const pending = new Map<
    string,
    Map<number, { room: string; text: string }>
  >();
  let isStopped = false;

  const send = (rowId: string, text: string): void => {
    if (isStopped) {
      return;
    }
    chat.send(rowId, { text, images: [] }).catch((error: unknown) => {
      deps.log(`chatroom wake not sent to ${rowId}: ${errorText(error)}`);
    });
  };

  const keepPending = (
    rowId: string,
    messageId: number,
    wake: { room: string; text: string },
  ): void => {
    const wakes = pending.get(rowId) ?? new Map();
    wakes.set(messageId, wake);
    pending.set(rowId, wakes);
  };

  // The wake text when `message` wakes the row's main agent, else null.
  const wakeFor = async (
    message: RoomMessage,
    mainAgent: Participant,
  ): Promise<string | null> => {
    const isAddressed = addresses(message, mainAgent);
    const isAddressedAsk =
      isAddressed && WAKING_KINDS.includes(message.kind as PostKind);
    if (message.userWord) {
      if (isAddressed) {
        return wakeText(message, true);
      }
      if (message.to.length === 0) {
        const unread = await room.unreadAddressed(message.room, mainAgent);
        if (unread.some(({ id }) => id === message.id)) {
          return wakeText(message, true);
        }
      }
    }
    return isAddressedAsk ? wakeText(message, false) : null;
  };

  const heard = async (message: RoomMessage): Promise<void> => {
    const rows = roster
      .sessions()
      .filter(
        ({ rowId }) =>
          roster.roomOf(rowId) === message.room &&
          chat.profileOf(rowId) !== null,
      );
    for (const { rowId } of rows) {
      const text = await wakeFor(message, roster.participant(rowId, null));
      if (text === null || isStopped) {
        continue;
      }
      if (isIdle(rowId)) {
        send(rowId, text);
      } else {
        keepPending(rowId, message.id, { room: message.room, text });
      }
    }
  };

  const sendPending = async (rowId: string): Promise<void> => {
    const wakes = pending.get(rowId);
    if (wakes === undefined) {
      return;
    }
    pending.delete(rowId);
    const mainAgent = roster.participant(rowId, null);
    for (const [messageId, wake] of wakes) {
      const unread = await room.unreadAddressed(wake.room, mainAgent);
      if (unread.some(({ id }) => id === messageId)) {
        send(rowId, wake.text);
      }
    }
  };

  const logFailure = (what: string) => (error: unknown) => {
    deps.log(`chatroom ${what} failed: ${errorText(error)}`);
  };

  const listeners = [
    room.onMessage((message) => {
      heard(message).catch(logFailure('wake'));
    }),
    deps.onTurnFinished((sessionId, how) => {
      if (how === 'idle') {
        sendPending(sessionId).catch(logFailure('pending wake'));
      }
    }),
    deps.onSessionEnded((sessionId) => {
      pending.delete(sessionId);
    }),
  ];

  return {
    dispose() {
      isStopped = true;
      for (const listener of listeners) {
        listener.dispose();
      }
      pending.clear();
    },
  };
}
