import type { EditorHost } from '../contracts/editor';
import type { PendingKeys, ViewScope } from '../contracts/keymap';

// Where pending keys come from: the page's key engine, which can hold its keys
// past its timeout, and the editor host, whose vim has no timeout to hold.
export interface PendingSources {
  page: { hold(): void; cancel(): void };
  editor: Pick<EditorHost, 'onPendingKeys' | 'cancelPendingKeys'>;
}

// One report of pending keys over the page and the editors. `reportPage` takes
// the page engine's report; `onPending` hears every source's, `null` once none
// are pending. `hold` and `cancel` reach the source whose keys are pending, and
// do nothing while none are.
export interface PendingKeysHub {
  reportPage(keys: string[], scope: ViewScope): void;
  onPending(listener: (pending: PendingKeys | null) => void): void;
  hold(): void;
  cancel(): void;
}

export function createPendingKeys(sources: PendingSources): PendingKeysHub {
  let pending: PendingKeys | null = null;
  const listeners: ((pending: PendingKeys | null) => void)[] = [];
  const tell = (reported: PendingKeys | null) => {
    pending = reported;
    for (const listener of listeners) {
      listener(reported);
    }
  };
  sources.editor.onPendingKeys((keys) =>
    tell(keys.length > 0 ? { where: 'editor', keys } : null),
  );

  return {
    reportPage(keys, scope) {
      tell(keys.length > 0 ? { where: 'page', keys, scope } : null);
    },
    onPending(listener) {
      listeners.push(listener);
    },
    hold() {
      if (pending?.where === 'page') {
        sources.page.hold();
      }
    },
    cancel() {
      if (pending?.where === 'page') {
        sources.page.cancel();
      } else if (pending?.where === 'editor') {
        sources.editor.cancelPendingKeys();
      }
    },
  };
}
