import type { PluginLog } from '../../../contracts/log';
import type { ChatPageExports } from '../../chat/contract';
import type { VisualOverlay } from './visual-overlay';
import type { VisualRegistry } from './visual-registry';
import { toggleWidth } from './visual-width';

export interface VisualCommandsDeps {
  chat: Pick<ChatPageExports, 'focusedEntry' | 'focusedBlock'>;
  registry: VisualRegistry;
  overlay: VisualOverlay;
  log: PluginLog;
}

// The visual plugin's page commands: `openVisuals` opens the overlay on the
// focused chat entry's visuals, at the first one in the cursor's block, else at
// the entry's first; `toggleWidth` flips that same visual between the reading
// width and wide. Both log `no focused entry` or
// `no visuals in the focused entry` when there is none; the rest step and
// close the overlay.
export function createVisualCommands(
  deps: VisualCommandsDeps,
): Record<
  'openVisuals' | 'toggleWidth' | 'nextVisual' | 'prevVisual' | 'closeVisual',
  () => void
> {
  // The focused entry, its held hosts and the index of the first in the
  // cursor's block, else 0; null, logged, when there is no entry or no visual
  // in it.
  const focusedVisuals = (): {
    entry: HTMLElement;
    hosts: HTMLElement[];
    index: number;
  } | null => {
    const entry = deps.chat.focusedEntry();
    if (entry === null) {
      deps.log('no focused entry');
      return null;
    }
    const hosts = deps.registry.hostsIn(entry);
    if (hosts.length === 0) {
      deps.log('no visuals in the focused entry');
      return null;
    }
    const block = deps.chat.focusedBlock();
    const [inBlock] = block === null ? [] : deps.registry.hostsIn(block);
    return {
      entry,
      hosts,
      index: inBlock === undefined ? 0 : hosts.indexOf(inBlock),
    };
  };

  return {
    openVisuals() {
      const focused = focusedVisuals();
      if (focused !== null) {
        deps.overlay.open(
          deps.registry.sourcesIn(focused.entry),
          focused.index,
        );
      }
    },
    toggleWidth() {
      const focused = focusedVisuals();
      if (focused !== null) {
        toggleWidth(focused.hosts[focused.index], deps.log);
      }
    },
    nextVisual: () => deps.overlay.next(),
    prevVisual: () => deps.overlay.previous(),
    closeVisual: () => deps.overlay.close(),
  };
}
