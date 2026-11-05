import type { ChannelShape } from '../../contracts/plugin';

// The pool as unity-pool's state files hold it (its README, § State file), every time in epoch milliseconds.

// `unknown` also stands for an editor word this app does not know.
export type EditorState = 'ready' | 'busy' | 'play' | 'closed' | 'unknown';

// A session by its Claude Code session id and the app's row id; both null for a user hold.
export interface PoolHolder {
  session: string | null;
  row: string | null;
}

// The clone's last probe; `branch`, `dirty` and `probedAt` null for a clone never probed, `branch` null on a
// detached HEAD.
export interface CloneFacts {
  branch: string | null;
  dirty: boolean | null;
  editor: EditorState;
  probedAt: number | null;
}

export interface CloneClaim extends PoolHolder {
  kind: 'agent' | 'hold';
  since: number;
  renewedAt: number;
}

// An open `/clear` handoff of the clone's claim.
export interface CloneHandoff extends PoolHolder {
  until: number;
}

export interface CloneStranded extends PoolHolder {
  since: number;
  reason: 'expired-dirty' | 'session-ended-dirty';
}

export interface CloneWarmup {
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface PoolClone {
  number: number;
  path: string;
  facts: CloneFacts;
  claim: CloneClaim | null;
  handoff: CloneHandoff | null;
  stranded: CloneStranded | null;
  lastHolder: PoolHolder | null;
  lastReleasedAt: number | null;
  warmup: CloneWarmup | null;
}

export interface QueueTicket {
  session: string;
  row: string | null;
  branch: string;
  enqueuedAt: number;
  polledAt: number;
  longWait: boolean;
}

// `clones` sorted by number; `queue` in its first-in, first-out order.
export interface PoolState {
  pool: string;
  updatedAt: number;
  clones: PoolClone[];
  queue: QueueTicket[];
}

// Every pool main reads, sorted by name.
export interface PoolSnapshot {
  pools: PoolState[];
}

export type PoolAction = 'hold' | 'release';

// The CLI's own JSON answer, or `no-cli` and `cli-failed` when it gave none.
export type PoolActionResult =
  | { ok: true; pool: string; clone: number }
  | { ok: false; error: string; message: string };

// `snapshot` answers the pools main holds now, and `changed` sends them after each change. `originName` is a
// folder's origin repo name, null outside a clone with an origin. `run` runs `unity-pool <action> <pool> <clone>`.
export interface UnityPoolChannel extends ChannelShape {
  invoke: {
    snapshot(): PoolSnapshot;
    originName(folder: string): Promise<string | null>;
    run(
      action: PoolAction,
      pool: string,
      clone: number,
    ): Promise<PoolActionResult>;
  };
  messages: { changed: PoolSnapshot };
}
