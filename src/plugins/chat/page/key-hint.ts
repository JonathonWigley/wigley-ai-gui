import type { Platform } from '../../../contracts/platform';
import { kbd } from '../../../shared/page/ui/kbd';
import type { HintWhere, KeysPageExports } from '../../keys/contract';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';

// The keys `scope` binds to `command` on the page, or in a text box for
// `where` `box`, drawn for `platform`, read now; null when the command is
// unbound there.
export function keyHint(
  keys: Pick<KeysPageExports, 'keysFor'>,
  platform: Platform,
  command: ChatCommandName,
  scope: ChatScopeName,
  where: HintWhere = 'page',
): HTMLElement | null {
  const bound = keys.keysFor(chatCommand(command), chatScope(scope), where);
  return bound === null ? null : kbd(bound, platform);
}
