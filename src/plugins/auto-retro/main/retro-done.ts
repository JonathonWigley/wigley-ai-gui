import type { ChatSessionInfo } from '../../chat/contract';

// The `settleSeconds` a missing or bad setting reads as.
export const DEFAULT_SETTLE_SECONDS = 5;

// How long after a start a running retro's row has to come back before the run is dropped.
export const RESTORE_WAIT_MS = 30_000;

// True once a retro row that has started its first turn rests with nothing running: its process ended, or its
// turn is idle with no subagent, task or compaction still running. `hasStarted` false is a row whose first turn
// has not begun, which reads idle too.
export function isRetroDone(
  info: ChatSessionInfo | undefined,
  hasStarted: boolean,
): boolean {
  if (info === undefined || !hasStarted) {
    return false;
  }
  if (!info.running) {
    return true;
  }
  return (
    info.activity === 'idle' &&
    info.background === 0 &&
    info.compaction === null
  );
}
