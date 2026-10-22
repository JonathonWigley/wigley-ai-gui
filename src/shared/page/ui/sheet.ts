import './sheet.css';
import { element } from '../dom';

// A solid content sheet inset by the sheet gutter; the surface inside pads
// its own content.
export function sheet(): HTMLElement {
  return element('div', 'ui-sheet');
}
