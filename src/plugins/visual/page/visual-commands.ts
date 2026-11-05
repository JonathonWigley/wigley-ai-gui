import type { PluginLog } from '../../../contracts/log';
import type { ChatPageExports } from '../../chat/contract';
import type { VisualOverlay } from './visual-overlay';
import type { VisualRegistry } from './visual-registry';

export interface VisualCommandsDeps {
  chat: Pick<ChatPageExports, 'focusedEntry' | 'focusedBlock'>;
  registry: VisualRegistry;
  overlay: VisualOverlay;
  log: PluginLog;
}

// The visual plugin's page commands: `openVisuals` opens the overlay on the
// focused chat entry's visuals, at the first one in the cursor's block, else at
// the entry's first, logging `no focused entry` or
// `no visuals in the focused entry` when there is none; the rest step and
// close the overlay.
export function createVisualCommands(
  deps: VisualCommandsDeps,
): Record<
  'openVisuals' | 'nextVisual' | 'prevVisual' | 'closeVisual',
  () => void
> {
  return {
    openVisuals() {
      const entry = deps.chat.focusedEntry();
      if (entry === null) {
        deps.log('no focused entry');
        return;
      }
      const sources = deps.registry.sourcesIn(entry);
      if (sources.length === 0) {
        deps.log('no visuals in the focused entry');
        return;
      }
      const block = deps.chat.focusedBlock();
      const [inBlock] = block === null ? [] : deps.registry.sourcesIn(block);
      deps.overlay.open(
        sources,
        inBlock === undefined ? 0 : sources.indexOf(inBlock),
      );
    },
    nextVisual: () => deps.overlay.next(),
    prevVisual: () => deps.overlay.previous(),
    closeVisual: () => deps.overlay.close(),
  };
}
