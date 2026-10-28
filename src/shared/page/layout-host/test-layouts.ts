// Test doubles for an owner's layout tests: a shown set holding a user layout,
// and keys that record every anchor named.
import type { CommandId } from '../../../contracts/commands';
import type { ViewScope } from '../../../contracts/keymap';
import type { ShownLayouts } from '../../../contracts/plugin';
import type { BaseKitDeps } from './base-kit';

// The name `withUser` gives the user's layout when the test names none.
export const USER_LAYOUT = 'mine';

// `default` and the user's `layout` under `name`, the user's picked.
export function withUser<L>(
  defaultLayout: L,
  layout: L,
  name = USER_LAYOUT,
): ShownLayouts<L> {
  return {
    layouts: new Map<string, L>([
      ['default', defaultLayout],
      [name, layout],
    ]),
    user: name,
  };
}

// One anchor the recording keys named, and whether it was disposed.
export interface RecordedAnchor {
  element: HTMLElement;
  command: CommandId;
  scope: ViewScope | undefined;
  label: boolean | string | undefined;
  isDisposed: boolean;
}

// Base-kit keys whose `anchor` records each anchor in `anchors` and whose
// `keysFor` reads null.
export function recordingAnchors(): {
  anchors: RecordedAnchor[];
  keys: BaseKitDeps['keys'];
} {
  const anchors: RecordedAnchor[] = [];
  return {
    anchors,
    keys: {
      anchor(element, command, options) {
        const made: RecordedAnchor = {
          element,
          command,
          scope: options?.scope,
          label: options?.label,
          isDisposed: false,
        };
        anchors.push(made);
        return {
          dispose() {
            made.isDisposed = true;
          },
        };
      },
      keysFor: () => null,
    },
  };
}
