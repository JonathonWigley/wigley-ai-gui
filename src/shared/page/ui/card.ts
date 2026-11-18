import './card.css';
import { button, element } from '../dom';
import { icon } from './icon';

// A status edge on a card's leading side: `attention` for a prompt that needs
// the user, `error` for a failure.
export type CardEdge = 'attention' | 'error';

// A solid block of content on a sheet; the caller toggles `is-cursor`.
export function card(edge?: CardEdge | null): HTMLElement {
  const node = element('div', 'ui-card');
  if (edge) {
    node.classList.add(`ui-card--${edge}`);
  }
  return node;
}

export interface CollapsibleCardOptions {
  summary: string;
  mono?: boolean;
  // A one-line row with no card chrome in place of a card.
  plain?: boolean;
  leading?: HTMLElement | null;
  // Sits in the head after the summary.
  trailing?: HTMLElement | null;
  open?: boolean;
  // Build the body once, at creation, and hide it while closed.
  keepBody?: boolean;
  // A head click calls this in place of toggling; the caller calls `setOpen`.
  onToggle?(): void;
  body(): HTMLElement;
}

export interface CollapsibleCard {
  element: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

// A card, or a plain row, whose head toggles its body. By default each opening
// builds the body afresh from `body()` and closing drops it; with `keepBody` the
// body is built once and hidden while closed; with `onToggle` the head click
// goes to the caller.
export function createCollapsibleCard(
  options: CollapsibleCardOptions,
): CollapsibleCard {
  let open = false;
  let shownBody: HTMLElement | null = null;
  const root = options.plain === true ? element('div') : card();
  root.classList.add('ui-collapsible');
  if (options.plain === true) {
    root.classList.add('ui-collapsible--plain');
  }
  const head = button('ui-collapsible-head', '', () => {
    if (options.onToggle) {
      options.onToggle();
    } else {
      collapsible.setOpen(!open);
    }
  });
  let chevron = icon('chevron-right');
  head.append(chevron);
  if (options.leading) {
    root.classList.add('ui-collapsible--leading');
    head.append(options.leading);
  }
  const summary = element('span', 'ui-collapsible-summary', options.summary);
  if (options.mono === true) {
    summary.classList.add('ui-collapsible-summary--mono');
  }
  head.append(summary);
  if (options.trailing) {
    head.append(options.trailing);
  }
  root.append(head);
  const keptBody =
    options.keepBody === true ? element('div', 'ui-collapsible-body') : null;
  if (keptBody) {
    keptBody.append(options.body());
    keptBody.hidden = true;
    root.append(keptBody);
  }
  const collapsible: CollapsibleCard = {
    element: root,
    isOpen: () => open,
    setOpen(next) {
      if (next === open) {
        return;
      }
      open = next;
      root.classList.toggle('is-open', open);
      const nextChevron = icon(open ? 'chevron-down' : 'chevron-right');
      chevron.replaceWith(nextChevron);
      chevron = nextChevron;
      if (keptBody) {
        keptBody.hidden = !open;
        return;
      }
      shownBody?.remove();
      shownBody = null;
      if (open) {
        shownBody = element('div', 'ui-collapsible-body');
        shownBody.append(options.body());
        root.append(shownBody);
      }
    },
  };
  if (options.open === true) {
    collapsible.setOpen(true);
  }
  return collapsible;
}
