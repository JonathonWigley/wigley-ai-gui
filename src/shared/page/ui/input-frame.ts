import './input-frame.css';
import { element } from '../dom';

// The frame around a text box: the parent to hand `EditorHost.create`. It
// shows as the keyboard cursor while focused, or with `is-cursor`. A plain
// `<input>` appended to the frame takes the frame's reset.
export function inputFrame(): HTMLElement {
  return element('div', 'ui-input');
}
