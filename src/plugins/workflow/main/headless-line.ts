import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';

export type HeadlessLineSession = Pick<AgentSession, 'id' | 'info'>;

// The line telling the agent a session is headless, on the results of every
// workflow tool: `HEADLESS_NOTE` on every result while the session is
// headless, and `HEADLESS_OFF_NOTE` on the first result from any tool after it
// stops being so. One state per app session, kept across tool sessions; a new
// host id, as `/clear` makes, starts it again from the flag at that time.
export interface HeadlessLines {
  // Starts the session's state when it has none under its host id; each tool
  // session calls it as it starts, so a flag that turns off before the first
  // call still gets its off line.
  track(session: HeadlessLineSession): void;
  append(session: HeadlessLineSession, text: string): string;
}

interface LineState {
  hostId: string | null;
  wasHeadless: boolean;
}

export function createHeadlessLines(
  isHeadless: (sessionId: string) => boolean,
): HeadlessLines {
  const states = new Map<string, LineState>();
  const stateOf = (session: HeadlessLineSession): LineState => {
    const hostId = session.info.sessionId;
    const held = states.get(session.id);
    if (held !== undefined && held.hostId === hostId) {
      return held;
    }
    const started = { hostId, wasHeadless: isHeadless(session.id) };
    states.set(session.id, started);
    return started;
  };
  return {
    track(session) {
      stateOf(session);
    },
    append(session, text) {
      const state = stateOf(session);
      const headless = isHeadless(session.id);
      const turnedOff = state.wasHeadless && !headless;
      state.wasHeadless = headless;
      if (headless) {
        return `${text}\n${HEADLESS_NOTE}`;
      }
      return turnedOff ? `${text}\n${HEADLESS_OFF_NOTE}` : text;
    },
  };
}
