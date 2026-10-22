import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';

// The page part's exports.

// `keysFor` reads the page keys that run the qualified `command`, as the user
// reads them: the first such bind in the merged keymap firing in the qualified
// `scope` (an `any` bind included), or in any scope when `scope` is left out;
// null when none is bound. `onChanged` hears each change to the merged keymap,
// after which `keysFor` reads the new keys, until its `dispose`; a view that
// shows keys beside its controls reads them again there.
export interface KeysPageExports {
  keysFor(command: CommandId, scope?: ViewScope): string | null;
  onChanged(listener: () => void): Disposable;
}
