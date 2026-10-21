import type { EditorBind, ViewScope } from '../contracts/keymap';
import { firesIn } from '../shared/keymap-checks';

// What a fired editor key sequence runs: the bind in force, or nothing, with
// the message naming the keys and the scope that left them unbound.
export type EditorBindChoice =
  | { kind: 'run'; bind: EditorBind }
  | { kind: 'none'; message: string };

// The first of `binds`, all on one key sequence, that fires in `scope`.
export function editorBindInForce(
  binds: EditorBind[],
  scope: ViewScope,
): EditorBindChoice {
  const bind = binds.find((candidate) => firesIn(candidate, scope));
  if (bind) {
    return { kind: 'run', bind };
  }
  return { kind: 'none', message: `${binds[0].keys} has no bind in ${scope}` };
}
