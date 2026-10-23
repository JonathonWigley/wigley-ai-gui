import type { ChatImage } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { imageUrl } from './attachments';
import { blurFocusedElement } from './chat-dialogs';

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

export interface ImageViewerDeps {
  overlay: PluginAreas['overlay'];
  // Pushes the viewer's own scope.
  pushScope(): PushedScope;
  log: Log;
}

interface OpenImages {
  images: readonly ChatImage[];
  index: number;
  scope: PushedScope;
}

// A dialog-layer surface in the overlay: the image fitted inside the window
// on the dim backdrop, and `<n> of <count>` under it when there is more than
// one.
export function createImageViewer(deps: ImageViewerDeps): ImageViewer {
  const { log } = deps;
  const backdrop = element('div', 'chat-image-viewer');
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  const picture = element('img', 'chat-image-viewer-image');
  const counter = element('div', 'chat-image-viewer-count');
  backdrop.append(picture, counter);
  deps.overlay.contribute(backdrop);

  let open: OpenImages | null = null;
  const draw = (shown: OpenImages) => {
    const count = shown.images.length;
    picture.src = imageUrl(shown.images[shown.index]);
    const place = `${shown.index + 1} of ${count}`;
    picture.alt = `Image ${place}`;
    counter.textContent = place;
    counter.hidden = count < 2;
    log('chat', `image viewer showing ${place}`);
  };
  const step = (direction: 1 | -1) => {
    if (open === null) {
      return;
    }
    const index = open.index + direction;
    if (index < 0 || index >= open.images.length) {
      log('chat', direction > 0 ? 'no next image' : 'no previous image');
      return;
    }
    open.index = index;
    draw(open);
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
      draw(opened);
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
      picture.removeAttribute('src');
      held.scope.pop();
      log('chat', 'image viewer closed');
    },
  };
  return viewer;
}
