import type { Keymap, ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import { pageKeysFor } from '../../../shared/key-notation';
import {
  type CommandLabel,
  type KeyHint,
  editorHints,
  pageHints,
  vimTokens,
} from '../../../shared/key-hints';

// The status bar's key list: the keys that fire where the user is now, in a
// text box or on the page, in `scope`, leaving out every sequence that starts
// with the leader, which which-key shows instead. Chords print for
// `platform`.
export function barHints(
  keymap: Keymap,
  scope: ViewScope,
  isInBox: boolean,
  label: CommandLabel,
  platform: Platform,
): KeyHint[] {
  const { leader } = keymap.editor;
  if (isInBox) {
    const binds = keymap.editor.binds.filter(
      (bind) =>
        (bind.scope === scope || bind.scope === 'any') &&
        vimTokens(bind.keys, leader)[0] !== leader,
    );
    return editorHints({ ...keymap.editor, binds }, label, platform);
  }
  const pageLeader = pageKeysFor(leader, leader)[0];
  return pageHints(
    keymap.page.filter((bind) => bind.keys[0] !== pageLeader),
    scope,
    label,
    platform,
  );
}
