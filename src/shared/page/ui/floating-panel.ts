import './floating-panel.css';
import { element } from '../dom';

// A glass panel above the content; the caller places it and shows or hides it
// with `hidden`.
export function floatingPanel(): HTMLElement {
  return element('div', 'ui-floating material-floating');
}
