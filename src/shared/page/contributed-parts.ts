import type { Disposable } from '../../contracts/disposable';
import type { PluginLog } from '../../contracts/log';
import { errorText } from '../error-text';
import { element } from './dom';

// What a plugin draws for every session on another plugin's surface: the
// owner hands it a wrapper and the session id.
export interface ContributedPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
}

// The parts other plugins added to one surface, in add order. `add` throws on
// an id already held, and its `Disposable` removes the part; `onChanged` hears
// each add and each removal.
export interface PartStore<P extends ContributedPart> {
  add(part: P): Disposable;
  parts(): P[];
  onChanged(listener: () => void): Disposable;
}

export function createPartStore<P extends ContributedPart>(): PartStore<P> {
  const held: P[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    add(part) {
      if (held.some((each) => each.id === part.id)) {
        throw new Error(`part ${part.id} is already added`);
      }
      held.push(part);
      notify();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          held.splice(held.indexOf(part), 1);
          notify();
        },
      };
    },
    parts: () => [...held],
    onChanged(listener) {
      // A wrapper per add, so each handle removes only its own add.
      const wrapped = () => listener();
      listeners.add(wrapped);
      return { dispose: () => listeners.delete(wrapped) };
    },
  };
}

// The part of a draw's `RollbackDeps` that records a built part's dispose.
export interface PartRollback {
  recordBox(destroy: () => void): void;
}

// Where one surface's contributed parts go: the noun its log lines name a part
// by, and the holder's and each wrapper's class.
export interface ContributedPartsPlace {
  noun: string;
  holderClass: string;
  wrapperClass: string;
}

// A `div` of `place.holderClass` at the end of `parent`, holding one `div` of
// `place.wrapperClass` (`data-part="<id>"`) per part, in add order, each built
// into its wrapper for `sessionId`. Each built part's dispose is recorded on
// `rollback`, so it runs before the surface draws again; a dispose that throws
// is logged and the rest still run. A part whose build throws is logged and
// its wrapper removed; the rest still draw.
export function placeContributedParts(
  parent: HTMLElement,
  sessionId: string,
  parts: readonly ContributedPart[],
  place: ContributedPartsPlace,
  log: PluginLog,
  rollback: PartRollback,
): HTMLElement {
  const holder = element('div', place.holderClass);
  parent.append(holder);
  for (const part of parts) {
    const wrapper = element('div', place.wrapperClass);
    wrapper.dataset.part = part.id;
    holder.append(wrapper);
    try {
      const built = part.build(wrapper, sessionId);
      rollback.recordBox(() => {
        try {
          built.dispose?.();
        } catch (error) {
          log(`${place.noun} ${part.id} dispose failed: ${errorText(error)}`);
        }
      });
    } catch (error) {
      wrapper.remove();
      log(`${place.noun} ${part.id} failed: ${errorText(error)}`);
    }
  }
  return holder;
}
