import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import { createSequenceMatcher, type SequenceMatcher } from './key-sequences';
import type { RendererCommands } from './renderer-commands';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

// Chords holding Control, Alt or Meta belong to the app and intercept keymaps.
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
}

// Feeds `key`, then each key a bind it ran left to replay, as vim feeds
// typeahead: each key reaches the scope and focus the commands before it left.
// The keys still to feed when an editor takes focus are returned for it.
export function feedPageKey(
  matcher: SequenceMatcher,
  key: string,
  now: number,
  target: PageKeyTarget,
): { isConsumed: boolean; forEditor: string[] } {
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
      return { isConsumed, forEditor: queue };
    }
  }
  return { isConsumed, forEditor: [] };
}

// Keys for when no editor has focus; a bind fires only in its view's scope.
export function installPageKeys(
  binds: PageBind[],
  timeoutMs: number,
  currentScope: () => ViewScope,
  editors: EditorHost,
  commands: RendererCommands,
  log: Log,
) {
  const matcher = createSequenceMatcher(binds, timeoutMs);
  document.addEventListener('keydown', (event) => {
    if (editors.contains(event.target as Element)) {
      matcher.reset();
      return;
    }
    if (!isPageKey(event)) {
      return;
    }
    const { isConsumed, forEditor } = feedPageKey(
      matcher,
      event.key,
      event.timeStamp,
      {
        scope: currentScope,
        editorHasFocus: () =>
          document.activeElement !== null &&
          editors.contains(document.activeElement),
        run: (bind) => {
          log('page', `${bind.keys.join('')} ran ${bind.command}`);
          commands.run(bind.command, {});
        },
      },
    );
    if (!isConsumed) {
      return;
    }
    event.preventDefault();
    // EditorHost has no way to type keys into an editor yet.
    if (forEditor.length > 0) {
      log('page', `dropped ${forEditor.join('')}: an editor took focus`);
    }
  });
}
