import {
  type ChatMainExports,
  HEADLESS_NOTE,
  HEADLESS_OFF_NOTE,
} from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';

export type HeadlessLineSession = Pick<AgentSession, 'id' | 'info'>;

export type HeadlessFlags = Pick<
  ChatMainExports,
  'isHeadless' | 'launchedHeadless'
>;

// The line telling the agent a session is headless, on the results of every
// workflow tool: `HEADLESS_NOTE` on every result while the session is
// headless, and `HEADLESS_OFF_NOTE` on the first result from any tool after it
// stops being so. One state per app session, kept across tool sessions. A
// state starts at the session's first result under a host id, from the flag
// its process started with, so a flag that turns off between that start (a
// `/clear` included) and the first call still gets its off line.
export interface HeadlessLines {
  append(session: HeadlessLineSession, text: string): string;
  // Drops the session's state; a later result starts it again.
  forget(session: HeadlessLineSession): void;
}

interface LineState {
  hostId: string | null;
  wasHeadless: boolean;
}

export function createHeadlessLines(flags: HeadlessFlags): HeadlessLines {
  const states = new Map<string, LineState>();
  const stateOf = (session: HeadlessLineSession): LineState => {
    const hostId = session.info.sessionId;
    const held = states.get(session.id);
    if (held !== undefined && held.hostId === hostId) {
      return held;
    }
    const started = {
      hostId,
      wasHeadless: flags.launchedHeadless(session.id),
    };
    states.set(session.id, started);
    return started;
  };
  return {
    append(session, text) {
      const state = stateOf(session);
      const headless = flags.isHeadless(session.id);
      const turnedOff = state.wasHeadless && !headless;
      state.wasHeadless = headless;
      if (headless) {
        return `${text}\n${HEADLESS_NOTE}`;
      }
      return turnedOff ? `${text}\n${HEADLESS_OFF_NOTE}` : text;
    },
    forget(session) {
      states.delete(session.id);
    },
  };
}
