import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import { keyPrompt } from '../../../shared/page/ui/key-prompt';
import type { AnchorOptions, HintWhere } from '../contract';

const HIDDEN = 'is-hint-hidden';

export interface AnchorDeps {
  keysFor(
    command: CommandId,
    scope: ViewScope | undefined,
    where: HintWhere,
  ): string | null;
  label(id: CommandId): string;
  scope(): ViewScope;
  showHints(): boolean;
  platform: Platform;
}

// The anchor registry. `redraw` draws every live anchor's keys again;
// `applyVisibility` hides each live anchor whose scope is not in force, or
// every one while hints are off. `placedIn` is every command anchored in
// `scope` or with no scope during the page load, disposed anchors included.
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
    const { scope, where = 'page', label } = held.options;
    const keys = deps.keysFor(held.command, scope, where);
    if (keys === null) {
      held.element.replaceChildren();
      return;
    }
    held.element.replaceChildren(
      keyPrompt(keys, deps.platform, labelText(label, held.command, deps)),
    );
  };

  const applyTo = (held: LiveAnchor) => {
    const { scope } = held.options;
    const isOutOfScope = scope !== undefined && scope !== deps.scope();
    held.element.classList.toggle(HIDDEN, !deps.showHints() || isOutOfScope);
  };

  const recordPlaced = (command: CommandId, scope: ViewScope | undefined) => {
    if (scope === undefined) {
      placedUnscoped.add(command);
      return;
    }
    const placed = placedByScope.get(scope) ?? new Set<CommandId>();
    placed.add(command);
    placedByScope.set(scope, placed);
  };

  return {
    anchor(element, command, options = {}) {
      const held: LiveAnchor = { element, command, options };
      live.add(held);
      recordPlaced(command, options.scope);
      draw(held);
      applyTo(held);
      return {
        dispose() {
          if (!live.delete(held)) {
            return;
          }
          element.replaceChildren();
          element.classList.remove(HIDDEN);
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
      return new Set([...(placedByScope.get(scope) ?? []), ...placedUnscoped]);
    },
  };
}
