import type { FormBody } from '../../contracts/forms';
import type { Log } from '../../contracts/log';
import { buildBody, saveState } from './form-state';
import type { FormsStore } from './forms-store';
import type { Timers } from './timers';

export interface AutosaveDeps {
  store: FormsStore;
  save(roundId: string, body: FormBody): void;
  delayMs: number;
  timers: Timers;
  log: Log;
}

interface PendingSave {
  revision: number;
  // null once a save of `revision` failed: the next edit schedules again.
  handle: number | null;
}

// Saves a round's answers once its edits pause for `delayMs`. `save` hands the
// body to main and returns, so a save has finished when it returns.
export function startAutosave(deps: AutosaveDeps): void {
  const pending = new Map<string, PendingSave>();
  deps.store.subscribe(() => {
    const { rounds } = deps.store.get();
    for (const [roundId, entry] of pending) {
      if (!rounds.some((round) => round.roundId === roundId)) {
        cancel(deps.timers, entry);
        pending.delete(roundId);
      }
    }
    for (const round of rounds) {
      const entry = pending.get(round.roundId);
      const isUnsaved = saveState(round) === 'unsaved';
      const isHandled = entry?.revision === round.revision;
      if (!isUnsaved || isHandled) {
        continue;
      }
      if (entry !== undefined) {
        cancel(deps.timers, entry);
      }
      const { roundId } = round;
      const handle = deps.timers.set(
        () => saveRound(deps, pending, roundId),
        deps.delayMs,
      );
      pending.set(roundId, { revision: round.revision, handle });
    }
  });
}

function saveRound(
  deps: AutosaveDeps,
  pending: Map<string, PendingSave>,
  roundId: string,
) {
  pending.delete(roundId);
  const round = deps.store
    .get()
    .rounds.find((candidate) => candidate.roundId === roundId);
  if (round === undefined || saveState(round) !== 'unsaved') {
    return;
  }
  const { revision } = round;
  deps.store.dispatch({ type: 'saveStarted', roundId, revision });
  let ok = true;
  try {
    deps.save(roundId, buildBody(round));
  } catch (error) {
    ok = false;
    pending.set(roundId, { revision, handle: null });
    deps.log('forms', `draft not saved for ${roundId}: ${messageOf(error)}`);
  }
  deps.store.dispatch({ type: 'saveFinished', roundId, revision, ok });
}

function cancel(timers: Timers, entry: PendingSave) {
  if (entry.handle !== null) {
    timers.clear(entry.handle);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
