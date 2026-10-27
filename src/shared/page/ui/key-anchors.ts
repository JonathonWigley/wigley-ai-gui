// The parts a view builds around the anchors the keys plugin fills: chevrons,
// edge prompts, box hints and stacks, and the anchors' disposal.
import './key-anchors.css';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import { element } from '../dom';

// Names an anchor for `command` in `element`; the keys plugin's page `anchor`
// fits.
export type AnchorNamer<Options> = (
  element: HTMLElement,
  command: CommandId,
  options?: Options,
) => Disposable;

// `anchor`, keeping each Disposable it returns in `anchors`, so their owner
// disposes them together.
export function recordingAnchor<Options>(
  anchor: AnchorNamer<Options>,
  anchors: Disposable[],
): AnchorNamer<Options> {
  return (node, command, options) => {
    const named = anchor(node, command, options);
    anchors.push(named);
    return named;
  };
}

// Disposes every anchor in `anchors` and empties it.
export function disposeAnchors(anchors: Disposable[]): void {
  for (const anchor of anchors) {
    anchor.dispose();
  }
  anchors.length = 0;
}

// A `span.ui-key-chevron` reading `text` (`‹ › ▲ ▼ ◂ ▸`, with words after or
// before it), placed beside an anchor element; it hides and shows with that
// anchor.
export function keyChevron(text: string): HTMLElement {
  return element('span', 'ui-key-chevron', text);
}

// An edge prompt, `span.ui-key-edge` of `className` holding `parts` (its
// anchors and chevrons) in a row. The view sets `is-no-target` on it while
// there is nothing to move to, which hides it and keeps its space.
export function keyEdge(
  className: string,
  parts: readonly Node[],
): HTMLElement {
  const edge = element('span', `ui-key-edge ${className}`);
  edge.append(...parts);
  return edge;
}

// A box hint, `span.ui-box-hint` of `className` holding `anchors` side by
// side, which the view places on the box's frame; it takes no space while
// every anchor is empty or it is `hidden`, and paints nothing while every
// prompt in it is hidden.
export function boxHint(
  className: string,
  anchors: readonly HTMLElement[],
): HTMLElement {
  const hint = element('span', `ui-box-hint ${className}`);
  hint.append(...anchors);
  return hint;
}

// `span.ui-key-stack` of `className`: `anchors` for one command in several
// scopes, stacked in one cell, so only the one in force shows and the cell
// keeps the widest one's size; it takes no space while every anchor is empty.
export function keyStack(
  className: string,
  anchors: readonly HTMLElement[],
): HTMLElement {
  const stack = element('span', `ui-key-stack ${className}`);
  stack.append(...anchors);
  return stack;
}
