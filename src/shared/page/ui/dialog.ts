import './dialog.css';
import { element } from '../dom';
import { floatingPanel, openFloatingPanel } from './floating-panel';

// `panel` is the `.ui-dialog` element inside the scrim `element`. `actions`
// is detached from the panel when the dialog was made without an actions row.
export interface Dialog {
  element: HTMLElement;
  panel: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  isShown(): boolean;
}

// `hasActions: false` leaves the actions row out of the panel; true when left
// out.
export interface DialogOptions {
  hasActions?: boolean;
}

// A modal dialog over the scrim, hidden until `show`. A click on the scrim
// does nothing: the caller owns the dialog's keys, which close it.
export function createDialog(
  title: string,
  options: DialogOptions = {},
): Dialog {
  const scrim = element('div', 'ui-scrim');
  scrim.hidden = true;
  const panel = floatingPanel();
  panel.classList.add('ui-dialog');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const heading = element('h2', 'ui-dialog-title');
  const body = element('div', 'ui-dialog-body');
  const actions = element('div', 'ui-dialog-actions');
  if (options.hasActions ?? true) {
    panel.append(heading, body, actions);
  } else {
    panel.append(heading, body);
  }
  scrim.append(panel);

  const setTitle = (next: string) => {
    heading.textContent = next;
    panel.setAttribute('aria-label', next);
  };
  setTitle(title);
  return {
    element: scrim,
    panel,
    body,
    actions,
    setTitle,
    show() {
      openFloatingPanel(panel, scrim);
    },
    hide() {
      scrim.hidden = true;
    },
    isShown: () => !scrim.hidden,
  };
}

// Focus left on the closed `dialog`, or on nothing, goes back to
// `focusedBefore`, what held it as the dialog opened; focus that moved
// elsewhere meanwhile stays.
export function restoreFocusAfterDialog(
  dialog: Dialog,
  focusedBefore: Element | null,
): void {
  const active = document.activeElement;
  const isFocusLost =
    active === null ||
    active === document.body ||
    dialog.element.contains(active);
  if (
    isFocusLost &&
    focusedBefore instanceof HTMLElement &&
    focusedBefore.isConnected
  ) {
    focusedBefore.focus();
  }
}
