import './button.css';
import { button, element } from '../dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface TextButtonOptions {
  variant?: ButtonVariant;
  hint?: HTMLElement | null;
}

// A labelled button that never takes focus, the hint (an element, such as a
// key prompt's anchor) after its label; a toggle shows on with `is-selected`.
export function textButton(
  label: string,
  onClick: () => void,
  options: TextButtonOptions = {},
): HTMLButtonElement {
  const { variant = 'secondary', hint = null } = options;
  const node = button(`ui-button ui-button--${variant}`, '', onClick);
  node.append(element('span', 'ui-button-label', label));
  if (hint !== null) {
    node.append(hint);
  }
  return node;
}
