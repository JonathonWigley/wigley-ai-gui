import type { TextEditor } from '../contracts/editor';
import type { EditorBind, ViewScope } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import { editorBindMode } from '../shared/key-hints';
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

// Runs the bind in force and returns whether `run` ran it: a key whose command
// has no handler types as it would unbound. A miss returns false and logs only
// for a normal-mode bind: an insert-mode key with no bind in force types as it
// would unbound.
export function runEditorBind(
  binds: EditorBind[],
  fired: TextEditor,
  deps: {
    scope(): ViewScope;
    run(bind: EditorBind, fired: TextEditor): boolean;
    log: Log;
  },
): boolean {
  const choice = editorBindInForce(binds, deps.scope());
  if (choice.kind === 'run') {
    return deps.run(choice.bind, fired);
  }
  if (editorBindMode(binds[0]) === 'normal') {
    deps.log('page', choice.message);
  }
  return false;
}
