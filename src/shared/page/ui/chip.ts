import './chip.css';
import { button, element } from '../dom';

// A session control's label and its value (none drawn when empty): a button
// that never takes focus when `onClick` is given, else a plain span. A chip
// whose picker is open shows with `is-active`.
export function chip(
  label: string,
  value: string,
  onClick: (() => void) | null,
): HTMLElement {
  const node =
    onClick === null
      ? element('span', 'ui-chip')
      : button('ui-chip', '', onClick);
  node.append(element('span', 'ui-chip-label', label));
  if (value !== '') {
    node.append(element('span', 'ui-chip-value', value));
  }
  return node;
}
