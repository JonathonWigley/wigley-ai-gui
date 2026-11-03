import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';
import type { DependencyKey } from '../../contracts/plugin';

// The page part's exports.

// Which keys a hint reads: the page's, or those inside a text box.
export type HintWhere = 'page' | 'box';

export interface AnchorOptions {
  // The qualified scope the hint shows in; left out, the hint shows in every scope.
  // The keys come from the first bind of `command` in this scope (`any` binds included) whose keys
  // are not vim's own keys; when every bind is a vim key, from the first bind.
  scope?: ViewScope;
  // 'page' (default) reads page binds; 'box' reads binds inside a text box.
  where?: HintWhere;
  // Draws the command's label after the keys (cursor prompts, edge prompts with words).
  // A string draws that text in place of the command's label.
  label?: boolean | string;
}

// `keysFor` reads the keys that run the qualified `command`, as the user reads
// them: the first such bind in the merged keymap firing in the qualified
// `scope` (an `any` bind included), or in any scope when `scope` is left out,
// on the page or, for `where` `box`, inside a text box; null when none is
// bound. `onChanged` hears each change to the merged keymap, after which
// `keysFor` reads the new keys, until its `dispose`; a view that shows keys
// beside its controls reads them again there. `anchor` draws the keys of
// `command` into `element`, which the view places and leaves empty, and keeps
// them drawn and shown or hidden by scope until its `dispose`.
export interface KeysPageExports {
  keysFor(
    command: CommandId,
    scope?: ViewScope,
    where?: HintWhere,
  ): string | null;
  onChanged(listener: () => void): Disposable;
  anchor(
    element: HTMLElement,
    command: CommandId,
    options?: AnchorOptions,
  ): Disposable;
}

export const keysPageKey: DependencyKey<KeysPageExports, 'page', 'keys'> = {
  id: 'keys',
  process: 'page',
};
