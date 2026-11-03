import type { Timers } from '../../../contracts/ambient';
import type { PendingKeys } from '../../../contracts/keymap';
import type { PluginLog } from '../../../contracts/log';
import type { WhichKeyModel } from './which-key';

export interface WhichKeyView {
  show(model: WhichKeyModel): void;
  hide(): void;
}

// `model` gives what continues a pending sequence, null when nothing does.
// `delayMs` and `timeoutMs` are read each time a wait is scheduled, so a
// changed setting applies from the next one; `timeoutMs` null leaves an open
// panel's sequence pending until it ends.
export interface WhichKeyDeps {
  onPending(listener: (pending: PendingKeys | null) => void): void;
  holdPending(): void;
  cancelPending(): void;
  model(pending: PendingKeys): WhichKeyModel | null;
  view: WhichKeyView;
  timers: Timers;
  delayMs(): number;
  timeoutMs(): number | null;
  log: PluginLog;
}

// Opens the panel once a sequence has been pending `delayMs`, holding the
// sequence while it shows; an open panel redraws at once for a deeper prefix.
// The panel closes when the sequence ends, and a lapsed `timeoutMs` cancels the
// sequence it shows.
export function startWhichKey(deps: WhichKeyDeps): void {
  const { timers, log } = deps;
  let isOpen = false;
  let delay: number | null = null;
  let timeout: number | null = null;

  const clearTimer = (handle: number | null) => {
    if (handle !== null) {
      timers.clear(handle);
    }
    return null;
  };

  const show = (model: WhichKeyModel) => {
    deps.view.show(model);
    log(`which-key shows ${model.title}`);
    timeout = clearTimer(timeout);
    const timeoutMs = deps.timeoutMs();
    if (timeoutMs !== null) {
      timeout = timers.set(() => {
        timeout = null;
        deps.cancelPending();
      }, timeoutMs);
    }
  };

  const close = () => {
    delay = clearTimer(delay);
    timeout = clearTimer(timeout);
    if (isOpen) {
      isOpen = false;
      deps.view.hide();
      log('which-key closed');
    }
  };

  deps.onPending((pending) => {
    const model = pending === null ? null : deps.model(pending);
    if (model === null) {
      close();
      return;
    }
    if (isOpen) {
      show(model);
      return;
    }
    delay = clearTimer(delay);
    delay = timers.set(() => {
      delay = null;
      deps.holdPending();
      isOpen = true;
      show(model);
    }, deps.delayMs());
  });
}
