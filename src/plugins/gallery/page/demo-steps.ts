import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';

export interface GalleryDemoDeps {
  showMode(): void;
}

// The Gallery step: Gallery mode over every primitive.
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
      'src/plugins/gallery/layouts/default/layout.js',
    ],
    enter: async () => galleryStage(deps),
  });
}

function galleryStage(deps: GalleryDemoDeps): DemoStage {
  return {
    beats: [{ name: 'Every primitive', show: () => deps.showMode() }],
    dispose() {},
  };
}
