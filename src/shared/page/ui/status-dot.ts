import './status-dot.css';
import { element } from '../dom';

export type DotStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';

// A static dot showing `status`, named for assistive technology by its id.
export function statusDot(status: DotStatus): HTMLElement {
  const dot = element('span', 'ui-dot');
  dot.setAttribute('role', 'img');
  setDotStatus(dot, status);
  return dot;
}

export function setDotStatus(dot: HTMLElement, status: DotStatus): void {
  dot.dataset.status = status;
  dot.setAttribute('aria-label', status);
}
