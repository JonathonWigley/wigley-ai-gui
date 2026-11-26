import type { ChatSessionInfo } from '../../chat/contract';

// The `settleSeconds` a missing or bad setting reads as.
export const DEFAULT_SETTLE_SECONDS = 5;

// How long after a start a running retro's row has to come back before the run is dropped.
export const RESTORE_WAIT_MS = 30_000;

// `busy` still working or about to start, `done` rested after its first turn, `lost` rested without one.
export type RetroRowState = 'busy' | 'done' | 'lost';

// `hasStarted`: the row's first turn began. `hasEnded`: its process exited. `isRestored`: a restored row whose
// history was read once chat's restore ended.
export interface RetroRowFacts {
  hasStarted: boolean;
  hasEnded: boolean;
  isRestored: boolean;
}

// A started row is done once it rests: its process ended, or its turn is idle with no subagent, task or compaction
// still running. A row that never started is lost once its process exited, or once a restored row rests; any other
// row that never started is busy, since a launched row reads not running before its process attaches and idle while
// it waits for its first turn.
export function retroRowState(
  info: ChatSessionInfo | undefined,
  facts: RetroRowFacts,
): RetroRowState {
  if (info === undefined) {
    return 'busy';
  }
  const rests =
    !info.running ||
    (info.activity === 'idle' &&
      info.background === 0 &&
      info.compaction === null);
  if (facts.hasStarted) {
    return rests ? 'done' : 'busy';
  }
  if (facts.hasEnded) {
    return 'lost';
  }
  if (facts.isRestored && rests) {
    return 'lost';
  }
  return 'busy';
}
