import type { ChannelShape } from '../../contracts/plugin';

// A stash the user asked for: the row's session and its note, null for none.
export interface StashRequest {
  sessionId: string;
  note: string | null;
}

// `stash` keeps the request until the session's close: a user close of a
// session that was sent a message writes its stash, and anything else drops
// it.
export interface SessionStashChannel extends ChannelShape {
  invoke: { stash(request: StashRequest): void };
  messages: Record<never, never>;
}
