import './icon-button.css';
import { button } from '../dom';
import { icon } from './icon';

export type IconButtonSize = 'sm' | 'md';

// A square button showing the Codicon `iconName`, never taking focus;
// `label` is its accessible name and tooltip.
export function iconButton(
  iconName: string,
  label: string,
  onClick: () => void,
  size: IconButtonSize = 'md',
): HTMLButtonElement {
  const className =
    size === 'sm' ? 'ui-icon-button ui-icon-button--sm' : 'ui-icon-button';
  const node = button(className, '', onClick);
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(icon(iconName));
  return node;
}
