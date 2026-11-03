// The visual layout contract: the parts a visual layout draws for an agent's html block, the card while the block is
// still streaming and the visual once it closes, and the kit each part gets. The app keeps the frame (its document,
// sandbox and theme), its height and focus, and every key.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The kit the `visual` part gets.
export interface VisualKit extends BaseKit {
  // Appends the app's frame element to `parent` and returns it. A part that never calls it gets the frame at its
  // root's end; a second call throws `frame placed twice`.
  frame(parent: HTMLElement): HTMLElement;
}

// Each part comes from the first layout that defines it among the `visual.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// Every part appends one element to `parent` and returns it. `card` draws an html block whose closing fence has not
// arrived, `visual` a closed block around its frame.
export interface Layout {
  card?(parent: HTMLElement, kit: BaseKit): HTMLElement;
  visual?(parent: HTMLElement, kit: VisualKit): HTMLElement;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
