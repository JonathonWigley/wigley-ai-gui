import { element } from './dom';
import './status-line.css';

export interface StatusLineContent {
  save: string;
  // The save part's `data-state`; `unsaved` draws it in the warning colour.
  saveState: string;
}

export interface StatusLine {
  element: HTMLElement;
  update(isShown: boolean, content: StatusLineContent): void;
}

// A session form's save state, for the form to place in its rail header
// (`DESIGN.md` § Surfaces); `update` hides it while `isShown` is false.
export function createStatusLine(): StatusLine {
  const line = element('span', 'ui-status-line');
  const save = element('span', 'ui-status-line-save');
  line.append(save);
  return {
    element: line,
    update(isShown, content) {
      line.hidden = !isShown;
      save.textContent = content.save;
      save.dataset.state = content.saveState;
    },
  };
}
