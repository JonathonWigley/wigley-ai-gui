import type { Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { FormBody } from '../contract';
import { buildBody, saveState } from './form-state';
import type { FormsStore } from './forms-store';

export interface AutosaveDeps {
  store: FormsStore;
  // Resolves once main has written the draft; rejects with main's error.
  save(roundId: string, body: FormBody): Promise<void>;
  // Read each time a save is scheduled.
  delayMs(): number;
  timers: Timers;
  log: Log;
}

interface PendingSave {
  revision: number;
  // null once a save of `revision` failed: the next edit schedules again.
  handle: number | null;
}

// Saves a round's answers once its edits pause for `delayMs`. A save is in
// flight until `save` settles; a failed one leaves the round unsaved with its
// message, and the next edit schedules a save again.
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
        () => void saveRound(deps, pending, roundId),
        deps.delayMs(),
      );
      pending.set(roundId, { revision: round.revision, handle });
    }
  });
}

async function saveRound(
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
  try {
    await deps.save(roundId, buildBody(round));
  } catch (error) {
    const message = errorText(error);
    // An edit made during the save has its own save scheduled already.
    if (!pending.has(roundId)) {
      pending.set(roundId, { revision, handle: null });
    }
    deps.log('forms', `draft not saved for ${roundId}: ${message}`);
    deps.store.dispatch({
      type: 'saveFinished',
      roundId,
      revision,
      ok: false,
      error: message,
    });
    return;
  }
  deps.store.dispatch({ type: 'saveFinished', roundId, revision, ok: true });
}

function cancel(timers: Timers, entry: PendingSave) {
  if (entry.handle !== null) {
    timers.clear(entry.handle);
  }
}
