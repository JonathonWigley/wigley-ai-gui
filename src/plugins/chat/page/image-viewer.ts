import type { ChatImage } from '../../../contracts/agent';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import '../../../shared/page/ui/dialog.css';
import { imageUrl } from './attachments';
import type { ImageViewerInput } from '../layouts/layout';
import { createImageViewerPart, type DialogPartDeps } from './dialog-kits';

// The full-size image viewer over a message's images: `open` shows the image
// at `index` and pushes the viewer's scope; `next` and `previous` step
// through the images and stop at the ends; `close`, and the pushed scope's
// base changing, hide it and pop the scope. Each does nothing while the
// viewer is closed.
export interface ImageViewer {
  open(images: readonly ChatImage[], index: number): void;
  next(): void;
  previous(): void;
  close(): void;
}

export interface ImageViewerDeps extends DialogPartDeps {
  overlay: PluginAreas['overlay'];
  // Pushes the viewer's own scope.
  pushScope(): PushedScope;
}

interface OpenImages {
  images: readonly ChatImage[];
  index: number;
  scope: PushedScope;
}

// A dialog-layer surface in the overlay: the `imageViewer` part on the dim
// backdrop, the image fitted inside the window and `<n> of <count>` under it
// when there is more than one in the default layout; it draws again on a
// layout change, keeping its index.
export function createImageViewer(deps: ImageViewerDeps): ImageViewer {
  const { log } = deps;
  const backdrop = element('div', 'ui-scrim chat-image-viewer');
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  deps.overlay.contribute(backdrop);
  const part = createImageViewerPart(deps, backdrop);
  deps.layouts.onChange(() => part.redraw());

  let open: OpenImages | null = null;
  // Draws the open image with `draw` (the part's `draw` or `update`).
  const show = (shown: OpenImages, draw: (input: ImageViewerInput) => void) => {
    const input = inputOf(shown);
    draw(input);
    log(`image viewer showing ${input.index + 1} of ${input.count}`);
  };
  const step = (direction: 1 | -1) => {
    if (open === null) {
      return;
    }
    const index = open.index + direction;
    if (index < 0 || index >= open.images.length) {
      log(direction > 0 ? 'no next image' : 'no previous image');
      return;
    }
    open.index = index;
    show(open, part.update);
  };
  const viewer: ImageViewer = {
    open(images, index) {
      viewer.close();
      blurFocusedElement();
      const scope = deps.pushScope();
      const opened: OpenImages = { images, index, scope };
      scope.onBaseChanged(() => {
        if (open === opened) {
          viewer.close();
        }
      });
      open = opened;
      backdrop.hidden = false;
      show(opened, part.draw);
    },
    next: () => step(1),
    previous: () => step(-1),
    close() {
      const held = open;
      if (held === null) {
        return;
      }
      open = null;
      backdrop.hidden = true;
      part.clear();
      held.scope.pop();
      log('image viewer closed');
    },
  };
  return viewer;
}

function inputOf(
  shown: Pick<OpenImages, 'images' | 'index'>,
): ImageViewerInput {
  return {
    src: imageUrl(shown.images[shown.index]),
    index: shown.index,
    count: shown.images.length,
  };
}
