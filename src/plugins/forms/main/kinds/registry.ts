import type { Disposable } from '../../../../contracts/disposable';
import type { ItemKindSpec, MainItemKind } from '../../contract';
import { BUILT_IN_KIND_SPECS } from '../../item-kinds';

export interface KindRegistry {
  // Throws, registering nothing, on a kind that breaks a registration rule;
  // the handle's first `dispose` removes the kind, and a second does nothing.
  register(kind: MainItemKind): Disposable;
  // The registered kinds in registration order.
  kinds(): readonly MainItemKind[];
  // Fires once per register and once per first dispose.
  onChanged(listener: () => void): Disposable;
}

type WireKey = 'argsKey' | 'bodyKey' | 'resultKey';

const WIRE_KEYS: readonly WireKey[] = ['argsKey', 'bodyKey', 'resultKey'];

// The keys a round's own fields hold beside the kinds' lists: the ask_round
// call's, the saved body's and the tool result's.
const RESERVED_KEYS: Readonly<Record<WireKey, readonly string[]>> = {
  argsKey: ['heading', 'overview', 'layout'],
  bodyKey: ['note'],
  resultKey: ['outcome', 'summary', 'next', 'note', 'earlier_heading'],
};

function isBuiltInId(id: string): boolean {
  return Object.hasOwn(BUILT_IN_KIND_SPECS, id);
}

// What is wrong with registering `kind` beside `registered`, or null.
function registrationProblem(
  kind: MainItemKind,
  registered: readonly MainItemKind[],
): string | null {
  const { spec } = kind;
  const clash = registered.find((other) => other.spec.id === spec.id);
  if (clash !== undefined) {
    return 'another registered kind holds the id';
  }
  for (const key of WIRE_KEYS) {
    const problem = wireKeyProblem(spec, key, registered);
    if (problem !== null) {
      return problem;
    }
  }
  const hasStatus = kind.status !== undefined;
  if (spec.answerable && !hasStatus) {
    return 'an answerable kind needs status';
  }
  if (!spec.answerable && hasStatus) {
    return 'a kind that takes no answer has no status';
  }
  if (spec.fingerprintJoinsWhenEmpty && !isBuiltInId(spec.id)) {
    return (
      'only a built-in kind joins the fingerprint when empty; a registered ' +
      "one would change every saved round's fingerprint"
    );
  }
  return null;
}

function wireKeyProblem(
  spec: ItemKindSpec,
  key: WireKey,
  registered: readonly MainItemKind[],
): string | null {
  const value = spec[key];
  if (RESERVED_KEYS[key].includes(value)) {
    return `${key} '${value}' is a round field`;
  }
  const holder = registered.find((other) => other.spec[key] === value);
  if (holder !== undefined) {
    return `${key} '${value}' is held by kind "${holder.spec.id}"`;
  }
  return null;
}

// The item kinds forms' main reads, in registration order.
export function createKindRegistry(): KindRegistry {
  let kinds: readonly MainItemKind[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    register(kind) {
      const problem = registrationProblem(kind, kinds);
      if (problem !== null) {
        throw new Error(`Item kind "${kind.spec.id}": ${problem}.`);
      }
      kinds = [...kinds, kind];
      changed();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          kinds = kinds.filter((each) => each !== kind);
          changed();
        },
      };
    },
    kinds: () => kinds,
    onChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
