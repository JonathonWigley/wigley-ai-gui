import './toggle-mark.css';
import { button } from '../dom';
import { icon } from './icon';

export interface ToggleMarkOptions {
  isOn: boolean;
  // The accessible name and tooltip, e.g. `Include the item`.
  label: string;
  onToggle: () => void;
}

// A small square on/off mark that never takes focus: on, it carries
// `is-selected` and shows a check. A click calls `onToggle` and changes nothing
// itself; the view sets the new state with `setToggleMark`. A disabled mark
// (the button's `disabled` attribute) drops its clicks.
export function toggleMark(options: ToggleMarkOptions): HTMLButtonElement {
  const node = button('ui-toggle-mark', '', options.onToggle);
  node.setAttribute('aria-label', options.label);
  node.title = options.label;
  node.append(icon('check'));
  setToggleMark(node, options.isOn);
  return node;
}

export function setToggleMark(mark: HTMLElement, isOn: boolean): void {
  mark.classList.toggle('is-selected', isOn);
  mark.setAttribute('aria-pressed', isOn ? 'true' : 'false');
}
