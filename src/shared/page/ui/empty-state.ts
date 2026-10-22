import './empty-state.css';
import { element } from '../dom';

// One line saying what to do, then `hint`, the key or action that does it.
export function emptyState(
  text: string,
  hint?: HTMLElement | null,
): HTMLElement {
  const node = element('p', 'ui-empty', text);
  if (hint) {
    node.append(hint);
  }
  return node;
}
