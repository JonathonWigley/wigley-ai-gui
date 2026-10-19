import type { PagePart } from '../../../contracts/plugin';
import { sessionsManifest } from '../manifest';

// Starts nothing on the page yet: it is listed so the plugins that depend on
// sessions can start their page parts.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start: () => ({ commands: {} }),
};
