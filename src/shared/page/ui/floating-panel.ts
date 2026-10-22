import './floating-panel.css';
import { element } from '../dom';

const OPENING = 'is-opening';

// A glass panel above the content; the caller places it, opens it with
// `openFloatingPanel` and hides it with `hidden`.
export function floatingPanel(): HTMLElement {
  return element('div', 'ui-floating material-floating');
}

// Clears `hidden` on `shown` (the panel, or an ancestor that hides it) and,
// when that opened it, fades the panel in once. The fade keys on `is-opening`,
// which leaves when the fade ends or is cancelled, so the panel does not fade
// again when an ancestor that hid it is shown.
export function openFloatingPanel(
  panel: HTMLElement,
  shown: HTMLElement = panel,
): void {
  const wasHidden = shown.hidden;
  shown.hidden = false;
  if (!wasHidden || panel.classList.contains(OPENING)) {
    return;
  }
  panel.classList.add(OPENING);
  const settle = (event: Event) => {
    if (event.target !== panel) {
      return;
    }
    panel.classList.remove(OPENING);
    panel.removeEventListener('transitionend', settle);
    panel.removeEventListener('transitioncancel', settle);
  };
  panel.addEventListener('transitionend', settle);
  panel.addEventListener('transitioncancel', settle);
}
