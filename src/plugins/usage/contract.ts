// The usage plugin's records and its channel between its main and page parts.

import type {
  CompactionTrigger,
  PlanUsage,
  UsageAgentEvent,
} from '../../contracts/agent';
import type { ChannelShape } from '../../contracts/plugin';

// One chat profile's plan usage. `profileDir` is the profile's `configDir` as
// chat's `profiles` setting writes it; `isDefault` is true for the first
// profile only. `usage` is the last good poll with the live rows folded in,
// null before the first good poll; `lastGoodAt` is that poll's `at`. `error`
// is the last poll's failure, null once a poll succeeds; `stale` is true
// while it stands.
export interface ProfilePlan {
  name: string;
  profileDir: string | null;
  isDefault: boolean;
  usage: PlanUsage | null;
  lastGoodAt: number | null;
  error: string | null;
  stale: boolean;
}

// One session's profile, its last main-agent `usage` event and the compaction
// it is running; `usage` is null until its first one, `compaction` null while
// none runs, its `startedAt` the `compactionStarted` event's `at`.
export interface SessionUsage {
  sessionId: string;
  profileDir: string | null;
  usage: UsageAgentEvent | null;
  compaction: { trigger: CompactionTrigger; startedAt: number } | null;
}

// `plans` in chat's profile order; `sessions` in the order each was first
// reported.
export interface UsageSnapshot {
  plans: readonly ProfilePlan[];
  sessions: readonly SessionUsage[];
}

// `changed` carries the whole snapshot after every change.
export interface UsageChannel extends ChannelShape {
  invoke: { snapshot(): UsageSnapshot };
  messages: { changed: UsageSnapshot };
}

// A part usage draws one session's usage line into: the same { id, build }
// shape as chat's status part and sessions' bar part.
export interface UsageLinePart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose(): void };
}

// The page part's exports. `sessionLinePart` returns a part with the given
// `id` that draws a session's line through usage's layout into the wrapper its
// host hands it, a zero line (context `0k`) while the session has no usage,
// and logs through `log` `session line in <name>: <text>` when a session's
// text changes, the name its side-bar label. Usage redraws every such part for
// the page's life.
export interface UsagePageExports {
  sessionLinePart(id: string, log: (line: string) => void): UsageLinePart;
}
