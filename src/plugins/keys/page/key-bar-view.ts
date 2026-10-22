import type { ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import type { Area } from '../../../contracts/plugin';
import type { KeyHint } from '../../../shared/key-hints';
import { element } from '../../../shared/page/dom';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { kbd } from '../../../shared/page/ui/kbd';

export interface KeyBarDeps {
  // The hints for the scope keys fire in now, in a text box or on the page.
  hints(isInBox: boolean): KeyHint[];
  isInBox(element: Element): boolean;
  onScopeChanged(listener: (scope: ViewScope) => void): void;
  openHelp(): void;
  platform: Platform;
}

// The status bar's key list, its keys printed for `platform`, and its `Keys`
// icon button, contributed to `statusBar`; it redraws each time the scope
// changes, focus moves into or out of a text box, or `render` runs.
export function mountKeyBarView(
  statusBar: Area,
  deps: KeyBarDeps,
): { render(): void } {
  const bar = element('div', 'keys-bar');
  const helpButton = iconButton('record-keys', 'Keys', deps.openHelp, 'sm');
  const render = () => {
    const active = document.activeElement;
    const isInBox = active !== null && deps.isInBox(active);
    bar.replaceChildren(
      ...deps.hints(isInBox).map((hint) => renderHint(hint, deps.platform)),
      helpButton,
    );
  };
  render();
  statusBar.contribute(bar);
  deps.onScopeChanged(render);
  document.addEventListener('focusin', render);
  document.addEventListener('focusout', render);
  return { render };
}

function renderHint(hint: KeyHint, platform: Platform): HTMLElement {
  const entry = element('span', 'keys-bar-hint');
  entry.append(
    kbd(hint.keys, platform),
    element('span', 'keys-bar-label', hint.label),
  );
  return entry;
}
