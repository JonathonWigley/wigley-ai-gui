import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { PageCommandContext } from '../contracts/plugin';
import type { CommandRegistry } from '../shared/command-registry';
import {
  type ChordMatcher,
  type ChordPress,
  createChordMatcher,
  createSequenceMatcher,
  type SequenceMatcher,
} from './key-sequences';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

// A key holding Control, Alt or Meta is a chord: chord binds take it ahead of
// this check, and the rest belong to the app and intercept keymaps.
function isPageKey(event: KeyboardEvent): boolean {
  const isModifierAlone = MODIFIER_KEYS.has(event.key);
  const isChord = event.ctrlKey || event.altKey || event.metaKey;
  return !isModifierAlone && !isChord;
}

// The page a key is fed to, read afresh before each key.
export interface PageKeyTarget {
  scope(): ViewScope;
  editorHasFocus(): boolean;
  run(bind: PageBind): void;
  // Types keys into the editor that has focus.
  typeIntoEditor(keys: string[]): void;
}

// Feeds `key`, then each key a bind it ran left to replay, as vim feeds
// typeahead: each key reaches the scope and focus the commands before it left,
// so the keys still to feed when an editor takes focus are typed into it.
// Returns whether the page consumed `key`.
export function feedPageKey(
  matcher: SequenceMatcher,
  key: string,
  now: number,
  target: PageKeyTarget,
): boolean {
  const queue = [key];
  let isConsumed = false;
  while (queue.length > 0) {
    const result = matcher.feed(queue.shift()!, target.scope(), now);
    isConsumed ||= result.pending || result.ran !== undefined;
    if (!result.ran) {
      continue;
    }
    target.run(result.ran);
    queue.unshift(...result.replay);
    const isLeftForEditor = queue.length > 0 && target.editorHasFocus();
    if (isLeftForEditor) {
      matcher.reset();
      target.typeIntoEditor(queue);
      return isConsumed;
    }
  }
  return isConsumed;
}

// Runs the chord bind `press` matches in the target's scope, dropping any
// pending sequence, since a chord cannot continue one. Returns whether a bind
// ran; with none, the pending sequence stays.
export function feedChordKey(
  chords: ChordMatcher,
  sequences: SequenceMatcher,
  press: ChordPress,
  target: Pick<PageKeyTarget, 'scope' | 'run'>,
): boolean {
  const bind = chords.match(press, target.scope());
  if (!bind) {
    return false;
  }
  sequences.reset();
  target.run(bind);
  return true;
}

// Non-chord keys fire when no editor has focus; chord binds fire everywhere,
// inside an editor too, ahead of it. A bind fires only in the scope
// `currentScope` reads.
export function installPageKeys(
  binds: PageBind[],
  timeoutMs: number,
  currentScope: () => ViewScope,
  editors: EditorHost,
  commands: CommandRegistry<PageCommandContext>,
  log: Log,
) {
  const chords = createChordMatcher(binds);
  const matcher = createSequenceMatcher(binds, timeoutMs);
  const runBind = (bind: PageBind) => {
    log('page', `${bind.keys.join('')} ran ${bind.command}`);
    commands.run(bind.command, {});
  };
  document.addEventListener(
    'keydown',
    (event) => {
      const isConsumed = feedChordKey(chords, matcher, event, {
        scope: currentScope,
        run: runBind,
      });
      if (isConsumed) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );
  document.addEventListener('keydown', (event) => {
    if (editors.contains(event.target as Element)) {
      matcher.reset();
      return;
    }
    if (!isPageKey(event)) {
      return;
    }
    const isConsumed = feedPageKey(matcher, event.key, event.timeStamp, {
      scope: currentScope,
      editorHasFocus: () =>
        document.activeElement !== null &&
        editors.contains(document.activeElement),
      run: runBind,
      typeIntoEditor: (keys) => {
        log('page', `typed ${keys.join('')} into the editor`);
        editors.typeInto(document.activeElement!, keys);
      },
    });
    if (isConsumed) {
      event.preventDefault();
    }
  });
}
