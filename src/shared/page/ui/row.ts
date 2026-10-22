import './row.css';
import { element } from '../dom';

export type RowDensity = 'list' | 'tree';

export interface RowOptions {
  density: RowDensity;
  label: string;
  detail?: string | null;
  leading?: HTMLElement | null;
  trailing?: HTMLElement | null;
  depth?: number;
  tag?: 'div' | 'li';
  onClick?: () => void;
}

// A list or tree row: leading, label, detail and trailing on one line, the
// label and detail ending in an ellipsis. The caller toggles `is-selected`,
// `is-cursor` and `is-disabled`; a disabled row drops its clicks.
export function row(options: RowOptions): HTMLElement {
  const node = element(
    options.tag ?? 'div',
    `ui-row ui-row--${options.density}`,
  );
  node.style.setProperty('--ui-row-depth', String(options.depth ?? 0));
  if (options.leading) {
    node.append(options.leading);
  }
  node.append(element('span', 'ui-row-label', options.label));
  if (options.detail) {
    node.append(element('span', 'ui-row-detail', options.detail));
  }
  if (options.trailing) {
    const trailing = element('span', 'ui-row-trailing');
    trailing.append(options.trailing);
    node.append(trailing);
  }
  const onClick = options.onClick;
  if (onClick !== undefined) {
    node.classList.add('ui-row--action');
    node.addEventListener('mousedown', (event) => event.preventDefault());
    node.addEventListener('click', () => {
      if (!node.classList.contains('is-disabled')) {
        onClick();
      }
    });
  }
  return node;
}
