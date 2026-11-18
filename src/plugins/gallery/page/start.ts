import type { Disposable } from '../../../contracts/disposable';
import type { ScrollStep } from '../../../contracts/editor';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import {
  edgeText,
  type ScrollEdge,
  scrollContent,
  scrollText,
  scrollToEdge,
} from '../../../shared/content-scroll';
import { blurFocusedElement } from '../../../shared/page/dom';
import { textLineHeightPx } from '../../../shared/page/text-line';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { galleryManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { createGalleryView } from './gallery-view';
import { readGalleryLayout } from './layout/read-gallery-layout';
import { testShellLayout } from './test-shell-layout';
import { nextTransparency } from './transparency-toggle';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

// The gallery's main part only registers its layouts, so its channel carries
// nothing.
type GalleryApi = PageApi<
  typeof galleryManifest,
  { invoke: Record<never, never>; messages: Record<never, never> }
>;

// Adds Gallery mode, drawn through the `gallery.layout` layout, which sets the
// `gallery` scope when it shows, with the split sample as the resize keys'
// target; each new layout set redraws it. `t` there switches the page's
// transparency override between reduced and full, which lasts until the page
// loads again and writes no settings; `g g` and `G` scroll the gallery's sheet
// to its top and end, and `j`/`k` and the line and half-page scrolls step it, logging
// whether they reached the end or the top. `Space z s` swaps the whole shell to
// the test layout and, pressed again, back; leaving the gallery keeps the swap.
// Registers the `gallery.mode` demo step, which shares that swap.
export const galleryPagePart: PagePart<typeof galleryManifest> = {
  manifest: galleryManifest,
  start(api: GalleryApi) {
    const { log } = api.services;
    const view = createGalleryView(
      {
        platform: api.platform.os,
        state: api.state.forLayouts,
        uiState: api.services.uiState,
        timers: api.services.timers,
        markdown: api.services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        log,
      },
      api.transparency.overridden(),
    );
    // While the mode shows, the split sample is the resize keys' target; each
    // layout set draws a new sample, so the target is set again after it.
    let isShown = false;
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readGalleryLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        view.setLayouts(shown);
        if (isShown) {
          api.panes.setResizeTarget(view.resizeTarget());
        }
      },
    });
    const takeKeys = () => {
      api.keys.setScope('gallery');
      api.panes.setResizeTarget(view.resizeTarget());
    };
    const mode = api.modes.add({
      id: 'gallery',
      title: 'Gallery',
      icon: 'symbol-color',
      element: view.element,
      shown() {
        isShown = true;
        takeKeys();
      },
      hidden() {
        isShown = false;
      },
      focusMain() {
        takeKeys();
        blurFocusedElement();
      },
    });
    mode.setContext({
      title: 'Gallery',
      detail: 'Every primitive in every state',
    });
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
      }
    };

    // The swap in force, null while the default layout is mounted.
    let swappedLayout: Disposable | null = null;
    const swap = () => {
      swappedLayout = api.shell.setLayout(testShellLayout);
      log('shell layout swapped');
    };
    const restore = () => {
      swappedLayout?.dispose();
      swappedLayout = null;
      log('shell layout restored');
    };
    const setTransparency = (value: 'full' | 'reduced' | null) => {
      api.transparency.override(value);
      view.showTransparency(value);
    };
    registerDemoSteps(api.services, { showMode });
    const scrollSheetTo = (edge: ScrollEdge) => {
      scrollToEdge(view.sheet, edge);
      log(edgeText('the gallery', edge));
    };
    const scrollSheet = (step: ScrollStep, direction: 1 | -1) => {
      const scroll = scrollContent(
        view.sheet,
        step,
        direction,
        textLineHeightPx(view.sheet),
      );
      log(scrollText('the gallery', step, direction, scroll));
    };

    return {
      dispose: () => view.dispose(),
      commands: {
        showMode,
        toggleTransparency() {
          const next = nextTransparency(api.transparency.overridden());
          setTransparency(next);
          log(`transparency ${next}`);
        },
        swapShellLayout() {
          if (swappedLayout === null) {
            swap();
            return;
          }
          restore();
        },
        scrollTop: () => scrollSheetTo('top'),
        scrollEnd: () => scrollSheetTo('end'),
        lineDown: () => scrollSheet('line', 1),
        lineUp: () => scrollSheet('line', -1),
        halfPageDown: () => scrollSheet('halfPage', 1),
        halfPageUp: () => scrollSheet('halfPage', -1),
      },
    };
  },
};
