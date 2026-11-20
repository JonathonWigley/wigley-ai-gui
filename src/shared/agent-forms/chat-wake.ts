import type { UserMessage } from '../../contracts/agent';
import type { AgentFormWake } from '../../contracts/agent-forms';
import type { PluginLog } from '../../contracts/log';
import { errorText } from '../error-text';

// The parts of chat's main exports the wake uses, restated: shared code
// imports no plugin.
export interface ChatFormWakeTarget {
  // Null for a session chat does not own.
  profileOf(sessionId: string): string | null;
  send(sessionId: string, message: UserMessage): Promise<void>;
  sendIntoTurn(sessionId: string, message: UserMessage): Promise<boolean>;
}

// Sends each message as a user message to a session chat owns; any other
// session gets nothing. A send that rejects is logged. A message sent before
// the answers goes into the running turn, so the agent takes it in with them.
export function createChatFormWake(
  chat: ChatFormWakeTarget,
  log: PluginLog,
): AgentFormWake {
  return {
    formFinishedUnheard: (sessionId, text) => {
      if (chat.profileOf(sessionId) === null) {
        return;
      }
      chat.send(sessionId, { text, images: [] }).catch((error: unknown) => {
        log(`form wake not sent to ${sessionId}: ${errorText(error)}`);
      });
    },
    sendBeforeAnswers: async (sessionId, text) => {
      if (chat.profileOf(sessionId) === null) {
        return false;
      }
      try {
        return await chat.sendIntoTurn(sessionId, { text, images: [] });
      } catch (error) {
        log(`form message not sent to ${sessionId}: ${errorText(error)}`);
        return false;
      }
    },
  };
}

// A wake that tells no one, for the layout previews and tests.
export const NO_FORM_WAKE: AgentFormWake = {
  formFinishedUnheard: () => {},
  sendBeforeAnswers: () => Promise.resolve(false),
};
