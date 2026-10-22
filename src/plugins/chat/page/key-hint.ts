import type { Platform } from '../../../contracts/platform';
import { kbd } from '../../../shared/page/ui/kbd';
import type { KeysPageExports } from '../../keys/contract';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';

// The keys `scope` binds to `command`, drawn for `platform`, read now; null
// when the command is unbound there.
export function keyHint(
  keys: Pick<KeysPageExports, 'keysFor'>,
  platform: Platform,
  command: ChatCommandName,
  scope: ChatScopeName,
): HTMLElement | null {
  const bound = keys.keysFor(chatCommand(command), chatScope(scope));
  return bound === null ? null : kbd(bound, platform);
}
