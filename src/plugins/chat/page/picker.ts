import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { createListPicker } from '../../../shared/page/list-picker';
import { blurFocusedElement } from './chat-dialogs';

export interface PickerRequest<T> {
  // The dialog's heading and the name its log lines carry.
  title: string;
  items: readonly T[];
  // The line drawn and filtered on.
  label(item: T): string;
  // The item index highlighted on open; 0 when left out or out of range.
  selected?: number;
  // True when the list acts on the shown Chat tab's session, so
  // `closeSessionBound` closes it; false when left out.
  sessionBound?: boolean;
  // Runs once the picker has closed.
  picked(item: T): void;
}

// The shared list picker with a filter box, in the window's overlay, holding
// one request at a time: `open` replaces the open request, if any. `pick`
// with nothing visible does nothing; `close` and the pushed scope's base
// changing close it unpicked and log `picker closed: <title>`.
// `closeSessionBound` closes it only while its request is session-bound.
// `focusFilter` types into the filter box, and `leaveFilter` leaves it with
// the filter kept.
export interface Picker {
  open<T>(request: PickerRequest<T>): void;
  isOpen(): boolean;
  down(): void;
  up(): void;
  pick(): void;
  close(): void;
  closeSessionBound(): void;
  focusFilter(): void;
  leaveFilter(): void;
}

export interface PickerDeps {
  overlay: PluginAreas['overlay'];
  editor: EditorHost;
  // Pushes `chat.picker`.
  pushScope(): PushedScope;
  log: Log;
}

export function createPicker(deps: PickerDeps): Picker {
  const list = createListPicker({
    pushScope: deps.pushScope,
    log: deps.log,
    logSource: 'chat',
    overlayClass: 'overlay',
    dialogClass: 'chat-picker',
    filterEditor: deps.editor,
  });
  deps.overlay.contribute(list.element);

  let isSessionBound = false;

  return {
    open(next) {
      blurFocusedElement();
      isSessionBound = next.sessionBound ?? false;
      list.open({
        title: next.title,
        items: next.items,
        label: next.label,
        selected: next.selected,
        chosen: next.picked,
        cancelled: () => deps.log('chat', `picker closed: ${next.title}`),
      });
    },
    isOpen: () => list.isOpen(),
    down: () => list.down(),
    up: () => list.up(),
    pick: () => list.choose(),
    close: () => list.cancel(),
    closeSessionBound() {
      if (isSessionBound) {
        list.cancel();
      }
    },
    focusFilter: () => list.focusFilter(),
    leaveFilter: () => list.leaveFilter(),
  };
}
