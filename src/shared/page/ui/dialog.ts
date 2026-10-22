import './dialog.css';
import { element } from '../dom';
import { floatingPanel } from './floating-panel';

export interface Dialog {
  element: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  isShown(): boolean;
}

// A modal dialog over the scrim, hidden until `show`. A click on the scrim
// does nothing: the caller owns the dialog's keys, which close it.
export function createDialog(title: string): Dialog {
  const scrim = element('div', 'ui-scrim');
  scrim.hidden = true;
  const panel = floatingPanel();
  panel.classList.add('ui-dialog');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const heading = element('h2', 'ui-dialog-title');
  const body = element('div', 'ui-dialog-body');
  const actions = element('div', 'ui-dialog-actions');
  panel.append(heading, body, actions);
  scrim.append(panel);

  const setTitle = (next: string) => {
    heading.textContent = next;
    panel.setAttribute('aria-label', next);
  };
  setTitle(title);
  return {
    element: scrim,
    body,
    actions,
    setTitle,
    show() {
      scrim.hidden = false;
    },
    hide() {
      scrim.hidden = true;
    },
    isShown: () => !scrim.hidden,
  };
}
