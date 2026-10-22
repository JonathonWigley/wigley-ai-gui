import type { ViewScope } from '../../../contracts/keymap';
import type { Area } from '../../../contracts/plugin';
import type { KeyHint } from '../../../shared/key-hints';
import { button, element } from '../../../shared/page/dom';

export interface KeyBarDeps {
  // The hints for the scope keys fire in now, in a text box or on the page.
  hints(isInBox: boolean): KeyHint[];
  isInBox(element: Element): boolean;
  onScopeChanged(listener: (scope: ViewScope) => void): void;
  openHelp(): void;
}

// The status bar's key list and its `Keys` button, contributed to
// `statusBar`; it redraws each time the scope changes, focus moves into or
// out of a text box, or `render` runs.
export function mountKeyBarView(
  statusBar: Area,
  deps: KeyBarDeps,
): { render(): void } {
  const bar = element('div', 'keys-bar');
  const helpButton = button('keys-bar-help', 'Keys', deps.openHelp);
  const render = () => {
    const active = document.activeElement;
    const isInBox = active !== null && deps.isInBox(active);
    bar.replaceChildren(...deps.hints(isInBox).map(renderHint), helpButton);
  };
  render();
  statusBar.contribute(bar);
  deps.onScopeChanged(render);
  document.addEventListener('focusin', render);
  document.addEventListener('focusout', render);
  return { render };
}

function renderHint(hint: KeyHint): HTMLElement {
  const entry = element('span', 'key-hint');
  entry.append(element('kbd', '', hint.keys), ` ${hint.label}`);
  return entry;
}
