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
  if (options.onClick !== undefined) {
    rowAction(node, options.onClick);
  }
  return node;
}

// Makes `root` clickable the way a row with `onClick` is: `ui-row--action`,
// a mousedown that takes no focus, and a click that runs `onClick` unless the
// root is `is-disabled`.
export function rowAction(root: HTMLElement, onClick: () => void): void {
  root.classList.add('ui-row--action');
  root.addEventListener('mousedown', (event) => event.preventDefault());
  root.addEventListener('click', () => {
    if (!root.classList.contains('is-disabled')) {
      onClick();
    }
  });
}
