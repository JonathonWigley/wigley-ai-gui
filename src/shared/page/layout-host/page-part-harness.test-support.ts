import type { PagePart, PluginManifest } from '../../../contracts/plugin';
import {
  type HarnessLayoutShow,
  type PagePartHarness,
  type PagePartHarnessOptions,
  startPagePart,
} from '../../plugin-part-harness.test-support';
import { ownerKitServicesOf, ownerLayoutShow } from './owner-show';

const drawingLayoutShow: HarnessLayoutShow = (api, manifest, options, show) =>
  ownerLayoutShow({
    manifest,
    kit: ownerKitServicesOf(api),
    log: api.services.log,
    options,
    show,
  });

// `startPagePart` with a `layouts.show` that draws through the real owner show.
export function startDrawingPagePart<M extends PluginManifest>(
  part: PagePart<M>,
  options: Omit<PagePartHarnessOptions<M>, 'layoutShow'> = {},
): PagePartHarness<M> {
  return startPagePart(part, { ...options, layoutShow: drawingLayoutShow });
}
