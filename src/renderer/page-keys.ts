import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import { createSequenceMatcher } from './key-sequences';
import type { RendererCommands } from './renderer-commands';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

// Chords holding Control, Alt or Meta belong to the app and intercept keymaps.
function isPageKey(event: KeyboardEvent): boolean {
  const isModifierAlone = MODIFIER_KEYS.has(event.key);
  const isChord = event.ctrlKey || event.altKey || event.metaKey;
  return !isModifierAlone && !isChord;
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
    const result = matcher.feed(event.key, currentScope(), event.timeStamp);
    if (result.kind === 'none') {
      return;
    }
    event.preventDefault();
    if (result.kind === 'run') {
      log('page', `${event.key} ran ${result.command}`);
      commands.run(result.command, {});
    }
  });
}
