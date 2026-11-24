import type { ChatSessionInfo } from '../../chat/contract';
import type { CloneClaim, PoolClone } from '../../unity-pool/contract';
import type { SessionFlow } from '../../workflow/contract';

// An idle, running chat session of row `A` in `/r/c2/src`.
export function chatInfo(
  fields: Partial<ChatSessionInfo> = {},
): ChatSessionInfo {
  return {
    sessionId: 'A',
    projectDir: '/r/c2/src',
    harness: 'claude',
    profile: 'default',
    activity: 'idle',
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'c2',
    branch: null,
    worktrees: [],
    headless: false,
    ...fields,
  };
}

// Row `A`'s medium flow in stage `build`, with nothing running.
export function flow(fields: Partial<SessionFlow> = {}): SessionFlow {
  return {
    sessionId: 'A',
    projectDir: '/r/c2/src',
    workflow: 'medium',
    movedUpFrom: null,
    stage: 'build',
    checklist: null,
    checklistReported: false,
    plan: null,
    counters: {},
    enteredFrom: null,
    countdownEndsAt: null,
    unclaimedWork: false,
    turnRunning: false,
    runningSubagents: [],
    ...fields,
  };
}

// A pool clone with no facts, handoff or history.
export function poolClone(
  number: number,
  path: string,
  claim: CloneClaim | null,
): PoolClone {
  return {
    number,
    path,
    facts: { branch: null, dirty: null, editor: 'unknown', probedAt: null },
    claim,
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
  };
}

// An agent claim with no row or session, at 0.
export function cloneClaim(fields: Partial<CloneClaim> = {}): CloneClaim {
  return {
    kind: 'agent',
    session: null,
    row: null,
    since: 0,
    renewedAt: 0,
    ...fields,
  };
}
