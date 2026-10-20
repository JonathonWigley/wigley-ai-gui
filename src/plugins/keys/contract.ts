import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';

// The page part's exports.

// `keysFor` reads the page keys that run the qualified `command`, as the user
// reads them: the first such bind in the merged keymap firing in the qualified
// `scope` (an `any` bind included), or in any scope when `scope` is left out;
// null when none is bound.
export interface KeysPageExports {
  keysFor(command: CommandId, scope?: ViewScope): string | null;
}
