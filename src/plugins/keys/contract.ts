import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';

// The page part's exports.

// Which keys a hint reads: the page's, or those inside a text box.
export type HintWhere = 'page' | 'box';

// `keysFor` reads the keys that run the qualified `command`, as the user reads
// them: the first such bind in the merged keymap firing in the qualified
// `scope` (an `any` bind included), or in any scope when `scope` is left out,
// on the page or, for `where` `box`, inside a text box; null when none is
// bound. `onChanged` hears each change to the merged keymap, after which
// `keysFor` reads the new keys, until its `dispose`; a view that shows keys
// beside its controls reads them again there.
export interface KeysPageExports {
  keysFor(
    command: CommandId,
    scope?: ViewScope,
    where?: HintWhere,
  ): string | null;
  onChanged(listener: () => void): Disposable;
}
