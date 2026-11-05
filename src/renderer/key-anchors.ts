import type { CommandArg, CommandId } from '../contracts/commands';
import type { Disposable } from '../contracts/disposable';
import type { AnchorOptions, HintWhere, ViewScope } from '../contracts/keymap';
import type { OsName } from '../contracts/platform';
import { commandTarget } from '../shared/command-args';
import { createLatestHold } from '../shared/latest-hold';
import { keyPrompt } from '../shared/page/ui/key-prompt';

const HIDDEN = 'is-hint-hidden';
const ANCHOR = 'ui-key-anchor';

export interface AnchorDeps {
  keysFor(
    command: CommandId,
    scope: ViewScope | undefined,
    where: HintWhere,
    arg?: CommandArg,
  ): string | null;
  label(id: CommandId): string;
  scope(): ViewScope;
  platform: OsName;
}

// The anchor registry. `redraw` draws every live anchor's keys again, and none
// while `holdShown` holds false, so the anchors take no space; `applyVisibility`
// hides, keeping its space, each live anchor before `reveal`, while `holdShown`
// holds false, or whose scope is not in force. `holdShown`'s latest handle's
// `dispose` shows them again, and an older handle's does nothing. `placedIn`
// is the `commandTarget` of every command and argument anchored in
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
  holdShown(shown: boolean): Disposable;
  reveal(): void;
  placedIn(scope: ViewScope): ReadonlySet<string>;
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
  const placedByScope = new Map<ViewScope, Set<string>>();
  const placedUnscoped = new Set<string>();
  let isRevealed = false;
  let isShown = true;

  const draw = (held: LiveAnchor) => {
    recordIfPlaced(held);
    const { scope, where = 'page', label, arg } = held.options;
    const keys = isShown ? deps.keysFor(held.command, scope, where, arg) : null;
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
    held.element.classList.toggle(
      HIDDEN,
      !isRevealed || !isShown || isOutOfScope,
    );
  };

  // Records `held` as placed the first time its element is on the page.
  const recordIfPlaced = (held: LiveAnchor) => {
    if (held.isPlaced || !held.element.isConnected) {
      return;
    }
    held.isPlaced = true;
    const { scope, arg } = held.options;
    const target = commandTarget(held.command, arg);
    if (scope === undefined) {
      placedUnscoped.add(target);
      return;
    }
    const placed = placedByScope.get(scope) ?? new Set<string>();
    placed.add(target);
    placedByScope.set(scope, placed);
  };

  const applyVisibility = () => live.forEach(applyTo);
  const shownHold = createLatestHold<boolean>(true, (shown) => {
    isShown = shown;
    live.forEach(draw);
    applyVisibility();
  });

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
    applyVisibility,
    holdShown: shownHold.hold,
    reveal() {
      isRevealed = true;
      applyVisibility();
    },
    placedIn(scope) {
      live.forEach(recordIfPlaced);
      return new Set([...(placedByScope.get(scope) ?? []), ...placedUnscoped]);
    },
  };
}
