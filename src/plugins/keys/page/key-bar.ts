import type { Keymap, ViewScope } from '../../../contracts/keymap';
import {
  type CommandLabel,
  type KeyHint,
  editorHints,
  pageHints,
  pageLeaderKey,
  vimTokens,
} from '../../../shared/key-hints';

// The status bar's key list: the keys that fire where the user is now, in a
// text box or on the page in `scope`, leaving out every sequence that starts
// with the leader, which which-key shows instead.
export function barHints(
  keymap: Keymap,
  scope: ViewScope,
  isInBox: boolean,
  label: CommandLabel,
): KeyHint[] {
  const { leader } = keymap.editor;
  if (isInBox) {
    const binds = keymap.editor.binds.filter(
      (bind) => vimTokens(bind.keys, leader)[0] !== leader,
    );
    return editorHints({ ...keymap.editor, binds }, label);
  }
  const leaderKey = pageLeaderKey(leader);
  return pageHints(
    keymap.page.filter((bind) => bind.keys[0] !== leaderKey),
    scope,
    label,
  );
}
