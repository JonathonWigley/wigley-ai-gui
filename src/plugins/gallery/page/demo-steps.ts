import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { nextTransparency } from './transparency-toggle';

type Transparency = 'full' | 'reduced' | null;

// `transparency` is the page's override in force and `setTransparency` sets it
// and shows it in the gallery; `swap` and `restore` are the two halves of
// `gallery.swapShellLayout`, sharing its swap with the command.
export interface GalleryDemoDeps {
  showMode(): void;
  transparency(): Transparency;
  setTransparency(value: Transparency): void;
  isSwapped(): boolean;
  swap(): void;
  restore(): void;
}

// The Gallery step: Gallery mode, then its transparency switch, then the
// shell swapped to the test layout. Leaving it puts back the transparency
// found at enter and undoes only a swap the stage made.
export function registerDemoSteps(
  services: PageServices,
  deps: GalleryDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'gallery.mode',
    section: 'shell',
    order: 2,
    title: 'Gallery',
    caption: 'Gallery mode shows every design primitive in every state.',
    files: [
      'src/plugins/gallery/page/start.ts',
      'src/plugins/gallery/page/gallery-view.ts',
      'src/plugins/gallery/page/test-shell-layout.ts',
      'src/plugins/gallery/layouts/default/layout.js',
    ],
    enter: async () => galleryStage(deps),
  });
}

function galleryStage(deps: GalleryDemoDeps): DemoStage {
  const found = deps.transparency();
  // Whether the swap in force is the stage's own; cleared each time the stage
  // undoes it, so a swap the user makes after that stays the user's.
  let didSwap = false;
  const undoSwap = () => {
    if (didSwap && deps.isSwapped()) {
      deps.restore();
    }
    didSwap = false;
  };
  return {
    beats: [
      {
        name: 'Every primitive',
        show() {
          deps.showMode();
          deps.setTransparency(found);
          undoSwap();
        },
      },
      {
        name: 'Transparency',
        show() {
          deps.showMode();
          undoSwap();
          deps.setTransparency(nextTransparency(found));
        },
      },
      {
        name: 'Shell layout swap',
        show() {
          deps.showMode();
          deps.setTransparency(found);
          if (!deps.isSwapped()) {
            deps.swap();
            didSwap = true;
          }
        },
      },
    ],
    dispose() {
      deps.setTransparency(found);
      undoSwap();
    },
  };
}
