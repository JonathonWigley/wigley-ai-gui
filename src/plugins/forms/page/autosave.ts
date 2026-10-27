import type { Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import { startAutosave } from '../../../shared/page/autosave';
import type { FormBody } from '../contract';
import { buildBody, type FormsStore } from './form-state';

export interface RoundAutosaveDeps {
  store: FormsStore;
  // Resolves once main has written the draft; rejects with main's error.
  save(roundId: string, body: FormBody): Promise<void>;
  // Read each time a save is scheduled.
  delayMs(): number;
  timers: Timers;
  log: Log;
}

// Saves a round's answers once its edits pause for `delayMs`, each round a
// draft of the shared autosave.
export function startRoundAutosave(deps: RoundAutosaveDeps): void {
  const { store } = deps;
  startAutosave({
    subscribe: (listener) => store.subscribe(listener),
    drafts: () => store.get().forms,
    idOf: (round) => round.formId,
    bodyOf: buildBody,
    saveStarted: (roundId, revision) =>
      store.dispatch({ type: 'saveStarted', formId: roundId, revision }),
    saveFinished: (roundId, revision, error) =>
      store.dispatch({
        type: 'saveFinished',
        formId: roundId,
        revision,
        error,
      }),
    save: (roundId, body) => deps.save(roundId, body),
    delayMs: () => deps.delayMs(),
    timers: deps.timers,
    log: deps.log,
    logSource: 'forms',
  });
}
