import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ViewScope } from '../../../contracts/keymap';
import type { OsName } from '../../../contracts/platform';
import { keyPrompt } from '../../../shared/page/ui/key-prompt';
import type { AnchorOptions, HintWhere } from '../contract';

const HIDDEN = 'is-hint-hidden';
const ANCHOR = 'ui-key-anchor';

export interface AnchorDeps {
  keysFor(
    command: CommandId,
    scope: ViewScope | undefined,
    where: HintWhere,
  ): string | null;
  label(id: CommandId): string;
  scope(): ViewScope;
  showHints(): boolean;
  platform: OsName;
}

// The anchor registry. `redraw` draws every live anchor's keys again, and none
// while hints are off, so the anchors take no space; `applyVisibility` hides
// each live anchor whose scope is not in force, keeping its space. `placedIn`
// is every command anchored in
// `scope` or with no scope during the page load, disposed anchors included,
// whose element was seen on the page: when it was drawn, hidden or shown,
// disposed, or at the `placedIn` call.
export interface Anchors {
  anchor(
    element: HTMLElement,
    command: CommandId,
    options?: AnchorOptions,
  ): Disposable;
  redraw(): void;
  applyVisibility(): void;
  placedIn(scope: ViewScope): ReadonlySet<CommandId>;
}

interface LiveAnchor {
  element: HTMLElement;
  command: CommandId;
  options: AnchorOptions;
  isPlaced: boolean;
}

// The text drawn after the keys: the command's label for `true`, the string
// itself for a string, none otherwise.
function labelText(
  label: AnchorOptions['label'],
  command: CommandId,
  deps: AnchorDeps,
): string | undefined {
  if (label === true) {
    return deps.label(command);
  }
  return typeof label === 'string' ? label : undefined;
}

export function createAnchors(deps: AnchorDeps): Anchors {
  const live = new Set<LiveAnchor>();
  const placedByScope = new Map<ViewScope, Set<CommandId>>();
  const placedUnscoped = new Set<CommandId>();

  const draw = (held: LiveAnchor) => {
    recordIfPlaced(held);
    const { scope, where = 'page', label } = held.options;
    const keys = deps.showHints()
      ? deps.keysFor(held.command, scope, where)
      : null;
    if (keys === null) {
      held.element.replaceChildren();
      return;
    }
    held.element.replaceChildren(
      keyPrompt(keys, deps.platform, labelText(label, held.command, deps)),
    );
  };

  const applyTo = (held: LiveAnchor) => {
    recordIfPlaced(held);
    const { scope } = held.options;
    const isOutOfScope = scope !== undefined && scope !== deps.scope();
    held.element.classList.toggle(HIDDEN, isOutOfScope);
  };

  // Records `held` as placed the first time its element is on the page.
  const recordIfPlaced = (held: LiveAnchor) => {
    if (held.isPlaced || !held.element.isConnected) {
      return;
    }
    held.isPlaced = true;
    const { scope } = held.options;
    if (scope === undefined) {
      placedUnscoped.add(held.command);
      return;
    }
    const placed = placedByScope.get(scope) ?? new Set<CommandId>();
    placed.add(held.command);
    placedByScope.set(scope, placed);
  };

  return {
    anchor(element, command, options = {}) {
      const held: LiveAnchor = {
        element,
        command,
        options,
        isPlaced: false,
      };
      live.add(held);
      element.classList.add(ANCHOR);
      draw(held);
      applyTo(held);
      return {
        dispose() {
          if (!live.delete(held)) {
            return;
          }
          recordIfPlaced(held);
          element.replaceChildren();
          element.classList.remove(HIDDEN, ANCHOR);
        },
      };
    },
    redraw() {
      live.forEach(draw);
    },
    applyVisibility() {
      live.forEach(applyTo);
    },
    placedIn(scope) {
      live.forEach(recordIfPlaced);
      return new Set([...(placedByScope.get(scope) ?? []), ...placedUnscoped]);
    },
  };
}
