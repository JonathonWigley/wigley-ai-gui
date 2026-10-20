import type { EditorBind, ViewScope } from '../contracts/keymap';
import { vimTokens, withLeader } from '../shared/key-hints';
import { firesIn, scopesOverlap } from './key-sequences';

// What a fired editor key sequence runs: the bind in force, or nothing, with
// the message naming the keys and the scope that left them unbound.
export type EditorBindChoice =
  | { kind: 'run'; bind: EditorBind }
  | { kind: 'none'; message: string };

function describeScopedBind(bind: EditorBind): string {
  return `"${bind.keys}" [${bind.scope}] ${bind.command}`;
}

function describeBind(bind: EditorBind): string {
  return `"${bind.keys}" ${bind.command}`;
}

function beginsLonger(shorter: string[], longer: string[]): boolean {
  return (
    shorter.length < longer.length &&
    shorter.every((token, index) => longer[index] === token)
  );
}

// Throws on two binds with the same keys, `<Leader>` spelled as `leader`, in
// overlapping scopes; and on a bind whose keys begin another's longer keys in
// any scopes, since vim maps are global to every editor and vim runs a
// complete map at once instead of waiting for a longer one.
export function requireUnambiguousEditorBinds(
  binds: EditorBind[],
  leader: string,
): void {
  const tokens = binds.map((bind) => vimTokens(bind.keys, leader));
  binds.forEach((bind, index) => {
    binds.forEach((other, otherIndex) => {
      const isLaterBind = otherIndex > index;
      const sameKeys =
        withLeader(bind.keys, leader) === withLeader(other.keys, leader);
      if (isLaterBind && sameKeys && scopesOverlap(bind.scope, other.scope)) {
        throw new Error(
          `Editor binds ${describeScopedBind(bind)} and ${describeScopedBind(other)} share a scope`,
        );
      }
      if (beginsLonger(tokens[index], tokens[otherIndex])) {
        throw new Error(
          `Editor bind ${describeBind(bind)} begins ${describeBind(other)}; vim runs the shorter at once`,
        );
      }
    });
  });
}

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
