import { element } from './dom';
import './status-line.css';

export interface StatusLineContent {
  // The focused box's vim mode label.
  mode: string;
  save: string;
  // The save part's `data-state`; `unsaved` draws it in the warning colour.
  saveState: string;
}

export interface StatusLine {
  element: HTMLElement;
  update(isShown: boolean, content: StatusLineContent): void;
}

// A session form's status line in the status bar: the vim mode, then the
// form's save state, hidden while none of the form type's tabs is the visible
// tab.
export function createStatusLine(): StatusLine {
  const bar = element('footer', 'ui-status-line');
  const mode = element('span', 'ui-status-line-mode');
  const save = element('span', 'ui-status-line-save');
  bar.append(mode, save);
  return {
    element: bar,
    update(isShown, content) {
      bar.hidden = !isShown;
      mode.textContent = content.mode;
      save.textContent = content.save;
      save.dataset.state = content.saveState;
    },
  };
}
