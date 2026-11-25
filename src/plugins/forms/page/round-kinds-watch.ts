import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import type { FormsStore } from './form-state';
import { unregisteredKinds } from './round-answers';
import type { RoundState } from './round-model';

// What a round's kinds have already reported: the kinds seen registered on
// it, and the kinds whose leaving it toasted.
interface RoundKindNotes {
  registered: Set<string>;
  toasted: Set<string>;
}

// Watches each open round's kinds through the store. A round's first show
// logs each kind it holds items of with no page kind, and each registered
// kind whose body key differs from main's; a registered kind that leaves
// while a round holds its items toasts once per round and kind for that
// round's life.
export function watchRoundKinds(
  store: Pick<FormsStore, 'get' | 'subscribe'>,
  log: PluginLog,
  toast: (text: string, tone: ToastTone) => void,
): Disposable {
  const notes = new Map<string, RoundKindNotes>();
  const check = () => {
    const rounds = store.get().forms;
    const open = new Set(rounds.map((round) => round.formId));
    for (const formId of notes.keys()) {
      if (!open.has(formId)) {
        notes.delete(formId);
      }
    }
    for (const round of rounds) {
      let roundNotes = notes.get(round.formId);
      if (roundNotes === undefined) {
        roundNotes = { registered: new Set(), toasted: new Set() };
        notes.set(round.formId, roundNotes);
        logFirstShow(round, log);
      }
      for (const kind of round.kinds.kinds()) {
        roundNotes.registered.add(kind.spec.id);
      }
      for (const { kind, count } of unregisteredKinds(round)) {
        if (roundNotes.registered.has(kind) && !roundNotes.toasted.has(kind)) {
          roundNotes.toasted.add(kind);
          toast(waitingKindText(round, kind, count), 'info');
        }
      }
    }
  };
  check();
  return store.subscribe(check);
}

function logFirstShow(round: RoundState, log: PluginLog): void {
  for (const { kind, count } of unregisteredKinds(round)) {
    const items = count === 1 ? 'item' : 'items';
    log(
      `form ${round.formId} holds ${count} ${kind} ${items} with no page kind`,
    );
  }
  for (const kind of round.kinds.kinds()) {
    const mainKey = round.round.bodyKeys[kind.spec.id];
    if (mainKey !== undefined && mainKey !== kind.spec.bodyKey) {
      log(
        `page kind ${kind.spec.id} body key ${kind.spec.bodyKey} differs from main's ${mainKey}`,
      );
    }
  }
}

// The toast for a round's items of a kind whose page kind left.
function waitingKindText(
  round: RoundState,
  kind: string,
  count: number,
): string {
  const { label } = round;
  return count === 1
    ? `1 ${kind} item in ${label} waits for the plugin that draws it`
    : `${count} ${kind} items in ${label} wait for the plugin that draws them`;
}
