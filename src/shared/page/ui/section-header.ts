import './section-header.css';
import { element } from '../dom';

// A section's heading, in the caller's sentence-case text, with `trailing`
// at its right.
export function sectionHeader(
  text: string,
  trailing?: HTMLElement | null,
): HTMLElement {
  const node = element('h3', 'ui-section-header');
  node.append(element('span', 'ui-section-header-text', text));
  if (trailing) {
    node.append(trailing);
  }
  return node;
}
