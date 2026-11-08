import type { ChannelShape } from '../../contracts/plugin';

// A stash the user asked for: the row's session and its note, null for none.
export interface StashRequest {
  sessionId: string;
  note: string | null;
}

// `stash` keeps the request until the session's close and answers true, or
// answers false, keeping nothing, for a session chat does not own (a terminal
// session). A user close of a kept session that was sent a message writes its
// stash; any other close drops it. `drop` forgets a kept request whose close
// did not happen. `forgetKept` drops every kept request: the page asks it as
// it starts, since a page that reloaded can no longer drop what it asked.
export interface SessionStashChannel extends ChannelShape {
  invoke: {
    stash(request: StashRequest): boolean;
    drop(sessionId: string): void;
    forgetKept(): void;
  };
  messages: Record<never, never>;
}
