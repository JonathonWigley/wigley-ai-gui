// The checks a keymap must pass before any key is installed. Main runs them on
// each merged keymap and the page runs them again as it installs its keys, so
// main never serves a keymap the page would throw on.
import type {
  EditorBind,
  Keymap,
  PageBind,
  ViewScope,
} from '../contracts/keymap';
import {
  CHORD_NOTATION_RULE,
  isChordToken,
  parseChord,
} from './chord-notation';
import { editorBindMode, vimTokens, withLeader } from './key-hints';

// Whether a page or editor bind fires while `scope` is in force.
export function firesIn(bind: { scope: ViewScope }, scope: ViewScope): boolean {
  return bind.scope === 'any' || bind.scope === scope;
}

// Whether some scope holds binds in both `a` and `b`.
export function scopesOverlap(a: ViewScope, b: ViewScope): boolean {
  return a === 'any' || b === 'any' || a === b;
}

// Whether `keys` begin with every key of `prefix`, in order.
export function startsWith(keys: string[], prefix: string[]): boolean {
  return (
    prefix.length <= keys.length &&
    prefix.every((key, index) => keys[index] === key)
  );
}

function describePageBind(bind: PageBind): string {
  return `"${bind.keys.join(' ')}" [${bind.scope}] ${bind.command}`;
}

// Throws on a bind with no keys, or on two binds sharing a scope where one's
// keys equal or begin the other's.
export function requireUnambiguousBinds(binds: PageBind[]): void {
  for (const bind of binds) {
    if (bind.keys.length === 0) {
      throw new Error(`Page bind for ${bind.command} has no keys`);
    }
  }
  binds.forEach((bind, index) => {
    for (const other of binds.slice(index + 1)) {
      const sharesAScope = scopesOverlap(bind.scope, other.scope);
      const keysCollide =
        startsWith(bind.keys, other.keys) || startsWith(other.keys, bind.keys);
      if (sharesAScope && keysCollide) {
        throw new Error(
          `Page binds ${describePageBind(bind)} and ${describePageBind(other)} share a scope, and one's keys begin the other's`,
        );
      }
    }
  });
}

// Throws on a page bind with a chord inside a longer sequence, or with a chord
// that does not fit the notation.
export function requireWellFormedChords(binds: PageBind[]): void {
  for (const bind of binds) {
    const tokens = bind.keys.filter(isChordToken);
    if (tokens.length > 0 && bind.keys.length > 1) {
      throw new Error(
        `Page bind for ${bind.command} has the chord ${tokens[0]} inside the sequence "${bind.keys.join(' ')}"; a chord must be the bind's only key`,
      );
    }
    if (tokens.length === 1 && parseChord(tokens[0]) === null) {
      throw new Error(
        `Page bind for ${bind.command} has a malformed chord ${tokens[0]}: ${CHORD_NOTATION_RULE}`,
      );
    }
  }
}

function describeScopedEditorBind(bind: EditorBind): string {
  return `"${bind.keys}" [${bind.scope}] ${bind.command}`;
}

function requireOneKeyInsertBind(bind: EditorBind, tokens: string[]): void {
  const isMultiKeyInsert =
    editorBindMode(bind) === 'insert' && tokens.length !== 1;
  if (isMultiKeyInsert) {
    throw new Error(
      `Insert-mode editor bind ${describeScopedEditorBind(bind)} must be one key; vim types the earlier keys of a sequence before it matches`,
    );
  }
}

function describeEditorBind(bind: EditorBind): string {
  return `"${bind.keys}" ${bind.command}`;
}

function beginsLonger(shorter: string[], longer: string[]): boolean {
  return (
    shorter.length < longer.length &&
    shorter.every((token, index) => longer[index] === token)
  );
}

// Throws on two binds in one mode with the same keys, `<Leader>` spelled as
// `leader`, in overlapping scopes; on a bind whose keys begin another's longer
// keys in the same mode in any scopes, since vim maps are global to every
// editor and vim runs a complete map at once instead of waiting for a longer
// one; and on an insert-mode bind of more than one key.
export function requireUnambiguousEditorBinds(
  binds: EditorBind[],
  leader: string,
): void {
  const tokens = binds.map((bind) => vimTokens(bind.keys, leader));
  binds.forEach((bind, index) => {
    requireOneKeyInsertBind(bind, tokens[index]);
    binds.forEach((other, otherIndex) => {
      const isLaterBind = otherIndex > index;
      const sameMode = editorBindMode(bind) === editorBindMode(other);
      const sameKeys =
        withLeader(bind.keys, leader) === withLeader(other.keys, leader);
      const sharesScope = scopesOverlap(bind.scope, other.scope);
      if (isLaterBind && sameMode && sameKeys && sharesScope) {
        throw new Error(
          `Editor binds ${describeScopedEditorBind(bind)} and ${describeScopedEditorBind(other)} share a scope`,
        );
      }
      if (sameMode && beginsLonger(tokens[index], tokens[otherIndex])) {
        throw new Error(
          `Editor bind ${describeEditorBind(bind)} begins ${describeEditorBind(other)}; vim runs the shorter at once`,
        );
      }
    });
  });
}

// Runs the page, chord and editor checks on `keymap`, throwing the first
// failure's text.
export function requireUnambiguousKeymap(keymap: Keymap): void {
  requireUnambiguousBinds(keymap.page);
  requireWellFormedChords(keymap.page);
  requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
}
