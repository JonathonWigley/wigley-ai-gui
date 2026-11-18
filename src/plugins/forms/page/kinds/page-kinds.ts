import type { Disposable } from '../../../../contracts/disposable';
import { createListeners } from '../../../../shared/listeners';
import type { ItemKind, PageKind } from '../../contract';

// The id of the notices stop, which no kind may take.
const NOTICES_STOP_ID = 'notices';

// The one kind that draws on the notices stop, with no rail order.
const NOTICE_KIND_ID = 'notice';

// The page's registered kinds at one moment.
export interface PageKindTable {
  get(id: ItemKind): PageKind | undefined;
  // The registered kinds, in registration order.
  kinds(): readonly PageKind[];
  // The registered kinds with a rail order, by rail order, ties in
  // registration order.
  readonly railKinds: readonly PageKind[];
}

// `register` throws, registering nothing, on a kind `requireRegistrable`
// rejects or when an `onChanged` listener throws; its `Disposable` removes
// the kind and notifies once, a second dispose doing nothing. `table()` is the
// same object until the next change. `onChanged` hears each register and each
// removal.
export interface PageKinds {
  register(kind: PageKind): Disposable;
  table(): PageKindTable;
  onChanged(listener: () => void): Disposable;
}

export function createPageKinds(): PageKinds {
  let registered: PageKind[] = [];
  let table = pageKindTable(registered);
  const listeners = createListeners<void>();
  const changed = (next: PageKind[]) => {
    registered = next;
    table = pageKindTable(registered);
    listeners.tell();
  };
  return {
    register(kind) {
      requireRegistrable(registered, kind);
      const before = { registered, table };
      try {
        changed([...registered, kind]);
      } catch (error) {
        ({ registered, table } = before);
        throw error;
      }
      let isRemoved = false;
      return {
        dispose() {
          if (isRemoved) {
            return;
          }
          isRemoved = true;
          changed(registered.filter((each) => each !== kind));
        },
      };
    },
    table: () => table,
    onChanged: (listener) => listeners.add(listener),
  };
}

function requireRegistrable(
  registered: readonly PageKind[],
  kind: PageKind,
): void {
  const { id, answerable } = kind.spec;
  if (registered.some((each) => each.spec.id === id)) {
    throw new Error(`page kind ${id} is already added`);
  }
  if (id === NOTICES_STOP_ID) {
    throw new Error(
      `page kind id ${NOTICES_STOP_ID} is reserved for the notices stop`,
    );
  }
  if (kind.railOrder === null && id !== NOTICE_KIND_ID) {
    throw new Error(
      `page kind ${id} has no rail order: only ${NOTICE_KIND_ID} draws on the notices stop`,
    );
  }
  const hasPick = kind.reduce.pick !== undefined;
  if (hasPick !== answerable) {
    throw new Error(
      `page kind ${id}: reduce.pick is given exactly when spec.answerable is true`,
    );
  }
}

// The table over `kinds`, in registration order.
export function pageKindTable(kinds: readonly PageKind[]): PageKindTable {
  const byId = new Map(kinds.map((kind) => [kind.spec.id, kind]));
  const railKinds = kinds
    .filter((kind) => kind.railOrder !== null)
    .toSorted((a, b) => (a.railOrder ?? 0) - (b.railOrder ?? 0));
  return {
    get: (id) => byId.get(id),
    kinds: () => kinds,
    railKinds,
  };
}
