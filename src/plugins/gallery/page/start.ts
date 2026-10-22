import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { galleryManifest } from '../manifest';
import { createGalleryView } from './gallery-view';
import { testShellLayout } from './test-shell-layout';
import { nextTransparency } from './transparency-toggle';

// The gallery plugin has no main part, so its channel carries nothing.
type GalleryApi = PageApi<
  typeof galleryManifest,
  { invoke: Record<never, never>; messages: Record<never, never> }
>;

// Adds Gallery mode, which sets the `gallery` scope when it shows. `t` there
// switches the page's transparency override between reduced and full, which
// lasts until the page loads again and writes no settings; `g g`, `G` and `d`
// scroll the gallery's sheet, `d` logging whether it reached the end. `Space
// z s` swaps the whole shell to the test layout and, pressed again, back;
// leaving the gallery keeps the swap.
export const galleryPagePart: PagePart<typeof galleryManifest> = {
  manifest: galleryManifest,
  start(api: GalleryApi) {
    const { log } = api.services;
    const view = createGalleryView({
      platform: api.platform,
      uiState: api.services.uiState,
    });
    view.showTransparency(api.transparency.overridden());
    const mode = api.modes.add({
      id: 'gallery',
      title: 'Gallery',
      icon: 'symbol-color',
      element: view.element,
      shown: () => api.keys.setScope('gallery'),
      hidden: () => undefined,
    });
    mode.setContext({
      title: 'Gallery',
      detail: 'Every primitive in every state',
    });

    // The swap in force, null while the default layout is mounted.
    let swappedLayout: Disposable | null = null;
    const scrollSheetTo = (top: number) =>
      view.sheet.scrollTo({ top, behavior: 'instant' });

    return {
      commands: {
        showMode() {
          if (!mode.isShown()) {
            mode.show();
          }
        },
        toggleTransparency() {
          const next = nextTransparency(api.transparency.overridden());
          api.transparency.override(next);
          view.showTransparency(next);
          log('gallery', `transparency ${next}`);
        },
        swapShellLayout() {
          if (swappedLayout === null) {
            swappedLayout = api.shell.setLayout(testShellLayout);
            log('gallery', 'shell layout swapped');
            return;
          }
          swappedLayout.dispose();
          swappedLayout = null;
          log('gallery', 'shell layout restored');
        },
        scrollTop() {
          scrollSheetTo(0);
          log('gallery', 'scrolled to the top');
        },
        scrollEnd() {
          scrollSheetTo(view.sheet.scrollHeight);
          log('gallery', 'scrolled to the end');
        },
        pageDown() {
          const { sheet } = view;
          scrollSheetTo(sheet.scrollTop + sheet.clientHeight);
          // scrollTop can be fractional while scrollHeight and clientHeight
          // are rounded to whole pixels.
          const isAtEnd =
            sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop < 1;
          log('gallery', isAtEnd ? 'reached the end' : 'paged down');
        },
      },
    };
  },
};
