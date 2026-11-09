import type { PluginLog } from '../../../contracts/log';
import type { ChatFocus } from '../../chat/contract';
import type { VisualOverlay } from './visual-overlay';
import type { VisualRegistry } from './visual-registry';
import { toggleWidth } from './visual-width';

export interface VisualCommandsDeps {
  focus(): ChatFocus | null;
  registry: VisualRegistry;
  overlay: VisualOverlay;
  log: PluginLog;
}

// The visual plugin's page commands: `openVisuals` opens the overlay on the
// visuals of the chat entry `focus` names, at the first one in its block, else
// at the entry's first; `toggleWidth` flips that same visual between the reading
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
  // focused block, else 0; null, logged, when there is no focus or no visual
  // in its entry.
  const focusedVisuals = (): {
    entry: HTMLElement;
    hosts: HTMLElement[];
    index: number;
  } | null => {
    const focus = deps.focus();
    if (focus === null) {
      deps.log('no focused entry');
      return null;
    }
    const entry = heldEntryOf(focus, deps.registry);
    if (entry === null) {
      deps.log('no visuals in the focused entry');
      return null;
    }
    const hosts = deps.registry.hostsIn(entry);
    const block =
      focus.block === null
        ? undefined
        : entry.querySelectorAll<HTMLElement>('[data-md-lines]')[focus.block];
    const [inBlock] = block === undefined ? [] : deps.registry.hostsIn(block);
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

// The slot of the entry `focus` names, found from a held host: the host's
// `[data-chat-entry]` slot whose id is the entry's, inside the
// `[data-chat-session]` tab of the focus's session. Null when no held host sits
// in that entry.
function heldEntryOf(
  focus: ChatFocus,
  registry: VisualRegistry,
): HTMLElement | null {
  for (const host of registry.hosts()) {
    const entry = host.closest<HTMLElement>('[data-chat-entry]');
    const tab = entry?.closest<HTMLElement>('[data-chat-session]');
    const isFocusedEntry = entry?.dataset.chatEntry === focus.entryId;
    const isFocusedSession = tab?.dataset.chatSession === focus.sessionId;
    if (entry !== null && isFocusedEntry && isFocusedSession) {
      return entry;
    }
  }
  return null;
}
