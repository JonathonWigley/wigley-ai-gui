import type { Timers } from '../contracts/ambient';
import type { Disposable } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { PageCommandContext } from '../contracts/plugin';
import { type KeyCommands, runBound } from '../shared/command-router';
import { createListeners } from '../shared/listeners';
import type { BoxFocus } from './box-focus';
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
  // Hears the pending keys each time they change, `[]` once none are.
  report(keys: string[]): void;
}

function isSameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

// Feeds `key`, then each key a bind it ran left to replay, as vim feeds
// typeahead: each key reaches the scope and focus the commands before it left,
// so the keys still to feed when an editor takes focus are typed into it.
// Esc while keys are pending drops them and runs nothing; with none pending it
// is fed like any key. Reports the pending keys when feeding changed them.
// Returns whether the page consumed `key`.
export function feedPageKey(
  matcher: SequenceMatcher,
  key: string,
  now: number,
  target: PageKeyTarget,
): boolean {
  const before = matcher.pendingKeys();
  const isCancel = key === 'Escape' && before.length > 0;
  if (isCancel) {
    matcher.reset();
    target.report([]);
    return true;
  }
  const isConsumed = feedKeys(matcher, key, now, target);
  const after = matcher.pendingKeys();
  if (!isSameKeys(before, after)) {
    target.report(after);
  }
  return isConsumed;
}

// Feeds `key` and the keys its binds leave to replay, returning whether the
// page consumed `key`.
function feedKeys(
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
// pending sequence, since a chord cannot continue one, and reporting `[]`
// when that dropped keys. Returns whether a bind ran; with none, the pending
// sequence stays.
export function feedChordKey(
  chords: ChordMatcher,
  sequences: SequenceMatcher,
  press: ChordPress,
  target: Pick<PageKeyTarget, 'scope' | 'run' | 'report'>,
): boolean {
  const bind = chords.match(press, target.scope());
  if (!bind) {
    return false;
  }
  dropPendingKeys(sequences, target.report);
  target.run(bind);
  return true;
}

// Drops the pending keys, held ones included, reporting `[]` when there were
// any.
export function dropPendingKeys(
  matcher: SequenceMatcher,
  report: (keys: string[]) => void,
) {
  const hadPending = matcher.pendingKeys().length > 0;
  matcher.reset();
  if (hadPending) {
    report([]);
  }
}

// Drops a pending sequence once `timeoutMs` passes with no key, unless the
// matcher holds it. `arm` restarts the wait from now, and stops it while
// nothing is pending or the matcher holds the keys.
export function createPendingTimeout(
  matcher: SequenceMatcher,
  timers: Timers,
  timeoutMs: number,
  report: (keys: string[]) => void,
): { arm(): void } {
  let armed: number | undefined;
  const isWaiting = () => matcher.pendingKeys().length > 0 && !matcher.isHeld();
  const lapse = () => {
    armed = undefined;
    if (isWaiting()) {
      matcher.reset();
      report([]);
    }
  };
  return {
    arm() {
      if (armed !== undefined) {
        timers.clear(armed);
        armed = undefined;
      }
      if (isWaiting()) {
        armed = timers.set(lapse, timeoutMs);
      }
    },
  };
}

// Non-chord keys fire when no editor has focus; chord binds fire everywhere,
// inside an editor too, ahead of it, unless the editor takes the key itself. A page sequence never outlives the place
// it was typed: focus entering an editor, or the window losing focus, drops
// the pending page keys, held ones included. A bind fires only in the scope
// `currentScope` reads. It starts with no binds, so a key matches nothing until
// `setBinds`, which replaces the binds and the timeout, dropping any pending keys;
// binds it rejects, such as a key bound twice in one scope, throw and leave the
// current ones in force. `onPendingKeys` hears the pending page keys each time
// they change, `[]` once none are, with the scope in force as it reports. `hold`
// keeps the pending keys past the timeout until they end, and `cancel` drops
// them, running nothing.
export function installPageKeys(
  timeoutMs: number,
  currentScope: () => ViewScope,
  editors: EditorHost,
  commands: KeyCommands<PageCommandContext<any>>,
  log: Log,
  timers: Timers,
  boxFocus: BoxFocus,
): {
  hold(): void;
  cancel(): void;
  setBinds(binds: PageBind[], timeoutMs: number): void;
  onPendingKeys(
    listener: (keys: string[], scope: ViewScope) => void,
  ): Disposable;
} {
  const pendingKeys = createListeners<{ keys: string[]; scope: ViewScope }>();
  const reportKeys = (keys: string[]) =>
    pendingKeys.tell({ keys, scope: currentScope() });
  let chords = createChordMatcher([]);
  let matcher = createSequenceMatcher([], timeoutMs);
  let timeout = createPendingTimeout(matcher, timers, timeoutMs, reportKeys);
  const runBind = (bind: PageBind) => {
    const keys = bind.keys.join('');
    runBound(commands, bind, { keys, source: 'page', log, logsRun: true }, {});
  };
  const dropPending = () => {
    dropPendingKeys(matcher, reportKeys);
    timeout.arm();
  };
  document.addEventListener('focusin', (event) => {
    if (editors.contains(event.target as Element)) {
      dropPending();
    }
  });
  window.addEventListener('blur', dropPending);
  document.addEventListener(
    'keydown',
    (event) => {
      if (editors.takesChordKey(event)) {
        return;
      }
      const isConsumed = feedChordKey(chords, matcher, event, {
        scope: currentScope,
        run: runBind,
        report: reportKeys,
      });
      if (isConsumed) {
        timeout.arm();
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );
  document.addEventListener('keydown', (event) => {
    if (editors.contains(event.target as Element)) {
      dropPending();
      return;
    }
    if (!isPageKey(event)) {
      return;
    }
    const isConsumed = feedPageKey(matcher, event.key, event.timeStamp, {
      scope: currentScope,
      editorHasFocus: () => boxFocus.where() === 'box',
      run: runBind,
      typeIntoEditor: (keys) => {
        log('page', `typed ${keys.join('')} into the editor`);
        editors.typeInto(document.activeElement!, keys);
      },
      report: reportKeys,
    });
    timeout.arm();
    if (isConsumed) {
      event.preventDefault();
    }
  });
  return {
    onPendingKeys: (listener) =>
      pendingKeys.add(({ keys, scope }) => listener(keys, scope)),
    hold() {
      matcher.hold();
      timeout.arm();
    },
    cancel() {
      matcher.reset();
      timeout.arm();
      reportKeys([]);
    },
    setBinds(nextBinds, nextTimeoutMs) {
      const nextChords = createChordMatcher(nextBinds);
      const nextMatcher = createSequenceMatcher(nextBinds, nextTimeoutMs);
      dropPendingKeys(matcher, reportKeys);
      // Stops the old wait: with nothing pending, arming sets no new one.
      timeout.arm();
      chords = nextChords;
      matcher = nextMatcher;
      timeout = createPendingTimeout(
        matcher,
        timers,
        nextTimeoutMs,
        reportKeys,
      );
    },
  };
}
