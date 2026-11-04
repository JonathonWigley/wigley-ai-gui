import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
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

// Where one surface's contributed parts go: the plugin its log lines name,
// the noun they name a part by, and the holder's and each wrapper's class.
export interface ContributedPartsPlace {
  owner: string;
  noun: string;
  holderClass: string;
  wrapperClass: string;
}

// A `div` of `place.holderClass` at the end of `parent`, holding one wrapper per
// part from `placeContributedPart`, in add order; a part whose build throws
// leaves none, and the rest still draw.
export function placeContributedParts(
  parent: HTMLElement,
  sessionId: string,
  parts: readonly ContributedPart[],
  place: ContributedPartsPlace,
  log: Log,
  rollback: PartRollback,
): HTMLElement {
  const holder = element('div', place.holderClass);
  parent.append(holder);
  for (const part of parts) {
    placeContributedPart(holder, sessionId, part, place, log, rollback);
  }
  return holder;
}

// A `div` of `place.wrapperClass` (`data-part="<id>"`) at the end of `parent`,
// with `part` built into it for `sessionId`. The part's dispose is recorded on
// `rollback`, so it runs before the surface draws again; a dispose that throws
// is logged and the rest still run. A part whose build throws is logged and its
// wrapper removed, and the result is null.
export function placeContributedPart(
  parent: HTMLElement,
  sessionId: string,
  part: ContributedPart,
  place: ContributedPartsPlace,
  log: Log,
  rollback: PartRollback,
): HTMLElement | null {
  const wrapper = element('div', place.wrapperClass);
  wrapper.dataset.part = part.id;
  parent.append(wrapper);
  try {
    const built = part.build(wrapper, sessionId);
    rollback.recordBox(() => {
      try {
        built.dispose?.();
      } catch (error) {
        log(
          place.owner,
          `${place.noun} ${part.id} dispose failed: ${errorText(error)}`,
        );
      }
    });
    return wrapper;
  } catch (error) {
    wrapper.remove();
    log(place.owner, `${place.noun} ${part.id} failed: ${errorText(error)}`);
    return null;
  }
}
