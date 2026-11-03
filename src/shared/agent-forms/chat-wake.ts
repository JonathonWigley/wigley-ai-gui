import type { UserMessage } from '../../contracts/agent';
import type { AgentFormWake } from '../../contracts/agent-forms';
import { errorText } from '../error-text';

// The parts of chat's main exports the wake uses, restated: shared code
// imports no plugin.
export interface ChatFormWakeTarget {
  // Null for a session chat does not own.
  profileOf(sessionId: string): string | null;
  send(sessionId: string, message: UserMessage): Promise<void>;
}

// Sends the wake as a user message to a session chat owns; any other session
// gets nothing. A send that rejects is logged.
export function createChatFormWake(
  chat: ChatFormWakeTarget,
  log: (source: string, message: string) => void,
  source: string,
): AgentFormWake {
  return {
    formFinishedUnheard: (sessionId, text) => {
      if (chat.profileOf(sessionId) === null) {
        return;
      }
      chat.send(sessionId, { text, images: [] }).catch((error: unknown) => {
        log(source, `form wake not sent to ${sessionId}: ${errorText(error)}`);
      });
    },
  };
}

// A wake that tells no one, for the layout previews and tests.
export const NO_FORM_WAKE: AgentFormWake = {
  formFinishedUnheard: () => {},
};
