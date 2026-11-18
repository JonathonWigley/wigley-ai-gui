import type { ChatImage } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import '../../../shared/page/ui/dialog.css';
import { imageUrl } from './attachments';
import type { ImageViewerInput } from '../layouts/layout';
import { createImageViewerPart, type DialogPartDeps } from './dialog-kits';

// Where a viewer's images came from, when they can be removed there: `remove`
// removes the image at `index` and returns the images left; `onChanged` hears
// each change of the images there until its handle is disposed.
export interface ImageRemoval {
  remove(index: number): readonly ChatImage[];
  onChanged(listener: () => void): Disposable;
}

// The full-size image viewer over a message's images, or the composer's
// attached ones: `open` shows the image at `index` and pushes the viewer's
// scope, holding the images it was given until a removal; `next` and
// `previous` step through the images and stop at the ends; `removeShown`
// removes the shown image through the `removal` the viewer was opened with,
// then shows the image now at its place, else the one before it, else closes;
// `close`, the pushed scope's base changing, and a change of the removal's
// images the viewer did not make, hide it and pop the scope.
// Each does nothing while the viewer is closed. `dispose` closes it and stops
// it drawing again on a layout change.
export interface ImageViewer {
  open(
    images: readonly ChatImage[],
    index: number,
    removal?: ImageRemoval,
  ): void;
  next(): void;
  previous(): void;
  removeShown(): void;
  close(): void;
  dispose(): void;
}

export interface ImageViewerDeps extends DialogPartDeps {
  overlay: PluginAreas['overlay'];
  // Pushes the viewer's own scope.
  pushScope(): PushedScope;
}

interface OpenImages {
  images: readonly ChatImage[];
  index: number;
  removal: ImageRemoval | null;
  scope: PushedScope;
  // Hears the removal's images change; null with no removal.
  removalWatch: Disposable | null;
  isRemoving: boolean;
}

// A dialog-layer surface in the overlay: the `imageViewer` part on the dim
// backdrop, the image fitted inside the window and `<n> of <count>` under it
// when there is more than one in the default layout, with the remove key's
// hint while the images can be removed; it draws again on a layout change,
// keeping its index.
export function createImageViewer(deps: ImageViewerDeps): ImageViewer {
  const { log } = deps;
  const backdrop = element('div', 'ui-scrim chat-image-viewer');
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  deps.overlay.contribute(backdrop);
  const part = createImageViewerPart(deps, () => backdrop);
  const layoutChanges = deps.layouts.onChange(() => part.redraw());

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
    open(images, index, removal) {
      viewer.close();
      blurFocusedElement();
      const scope = deps.pushScope();
      const opened: OpenImages = {
        images,
        index,
        removal: removal ?? null,
        scope,
        removalWatch: null,
        isRemoving: false,
      };
      const closeOpened = () => {
        if (open === opened) {
          viewer.close();
        }
      };
      scope.onBaseChanged(closeOpened);
      opened.removalWatch =
        removal?.onChanged(() => {
          if (!opened.isRemoving) {
            closeOpened();
          }
        }) ?? null;
      open = opened;
      backdrop.hidden = false;
      show(opened, part.draw);
    },
    next: () => step(1),
    previous: () => step(-1),
    removeShown() {
      const shown = open;
      if (shown === null) {
        return;
      }
      if (shown.removal === null) {
        log('sent images cannot be removed');
        return;
      }
      log(
        `removed attached image ${shown.index + 1} of ${shown.images.length}`,
      );
      shown.isRemoving = true;
      let left: readonly ChatImage[];
      try {
        left = shown.removal.remove(shown.index);
      } finally {
        shown.isRemoving = false;
      }
      if (left.length === 0) {
        viewer.close();
        return;
      }
      shown.images = left;
      shown.index = Math.min(shown.index, left.length - 1);
      show(shown, part.update);
    },
    close() {
      const held = open;
      if (held === null) {
        return;
      }
      open = null;
      held.removalWatch?.dispose();
      backdrop.hidden = true;
      part.clear();
      held.scope.pop();
      log('image viewer closed');
    },
    dispose() {
      callEach<() => void>(
        [() => viewer.close(), () => layoutChanges.dispose()],
        (step) => step(),
      );
    },
  };
  return viewer;
}

function inputOf(
  shown: Pick<OpenImages, 'images' | 'index' | 'removal'>,
): ImageViewerInput {
  return {
    src: imageUrl(shown.images[shown.index]),
    index: shown.index,
    count: shown.images.length,
    removable: shown.removal !== null,
  };
}
