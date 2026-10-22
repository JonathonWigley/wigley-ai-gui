import './tabs.css';
import { button, element } from '../dom';

// The strip of tabs that sits on its sheet's top edge; the caller may append
// more tabs later.
export function tabStrip(tabs: readonly HTMLElement[]): HTMLElement {
  const strip = element('nav', 'ui-tabs');
  strip.append(...tabs);
  return strip;
}

// One tab; the caller toggles `is-active` on the tab that shows.
export function tab(label: string, onSelect: () => void): HTMLButtonElement {
  const node = button('ui-tab', '', onSelect);
  node.append(element('span', 'ui-tab-label', label));
  return node;
}
