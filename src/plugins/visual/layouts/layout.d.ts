// The visual layout contract: the parts a visual layout draws for an agent's html block, the card while the block is
// still streaming, the visual once it closes and the full-size overlay over one, and the kit each part gets. The app
// keeps the frame (its document, sandbox and theme), its height and focus, and every key.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The kit the `visual` part gets.
export interface VisualKit extends BaseKit {
  // Appends the app's frame element to `parent` and returns it. A part that never calls it gets the frame at its
  // root's end; a second call throws `frame placed twice`. `parent` must already be in the document under its final
  // parent: a frame placed in a detached element, or moved after, reloads on each layouts change, its scripts
  // starting again.
  frame(parent: HTMLElement): HTMLElement;
  // Appends the expand control to `parent` and returns it: a small icon button that never takes focus, whose click
  // opens the overlay on this visual. A part that never calls it gets the button at its root's end, after the frame;
  // a second call throws `expand placed twice`. Its key hint is the layout's own `keyHint(button, 'openVisuals')`;
  // `openVisuals` opens a chat entry's visuals from its first, so a hint given the class `visual-open-hint` shows
  // on a chat entry's first visual only.
  expand(parent: HTMLElement): HTMLButtonElement;
}

// The overlay's place among the visuals it steps through: `index` from 0, of `count`.
export interface OverlayInput {
  index: number;
  count: number;
}

// The kit the `overlay` part gets.
export interface OverlayKit extends BaseKit {
  // Appends the overlay's own frame element to `parent` and returns it, as `VisualKit.frame` does: `parent` must
  // already be in the document under its final parent, or the frame reloads on each layouts change.
  frame(parent: HTMLElement): HTMLElement;
}

// Each part comes from the first layout that defines it among the `visual.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// Every part appends one element to `parent` and returns it. `card` draws an html block whose closing fence has not
// arrived, `visual` a closed block around its frame, and `overlay` one visual full size over the window.
export interface Layout {
  card?(parent: HTMLElement, kit: BaseKit): HTMLElement;
  visual?(parent: HTMLElement, kit: VisualKit): HTMLElement;
  overlay?(
    parent: HTMLElement,
    input: OverlayInput,
    kit: OverlayKit,
  ): HTMLElement;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
