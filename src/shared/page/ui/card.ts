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
  open?: boolean;
  body(): HTMLElement;
}

export interface CollapsibleCard {
  element: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

// A card, or a plain row, whose head toggles its body. Each opening builds the
// body afresh from `body()`; closing drops it.
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
  const head = button('ui-collapsible-head', '', () =>
    collapsible.setOpen(!open),
  );
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
  root.append(head);
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
