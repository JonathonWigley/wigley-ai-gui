import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { createListPicker } from '../../../shared/page/list-picker';
import type { ChatScopeName } from '../ids';
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
  // The scope pushed while it is open; `picker` when left out.
  scope?: 'picker' | 'resume';
  // Runs once the picker has closed.
  picked(item: T): void;
}

// One opened request's place in the picker.
export interface PickerHandle {
  // True until the request is picked, closed, or replaced by another `open`.
  isOpen(): boolean;
}

// The shared list picker with a filter box, in the window's overlay, holding
// one request at a time: `open` replaces the open request, if any, keeping
// the pushed scope when the new request names the same one. `pick`
// with nothing visible does nothing; `close` and the pushed scope's base
// changing close it unpicked and log `picker closed: <title>`.
// `closeSessionBound` closes it only while its request is session-bound.
// `open` returns the request's handle, so its opener can tell whether its
// own request is still the open one.
// `focusFilter` types into the filter box, and `leaveFilter` leaves it with
// the filter kept.
export interface Picker {
  open<T>(request: PickerRequest<T>): PickerHandle;
  isOpen(): boolean;
  // The open request's item index under the cursor; null when closed or
  // nothing is visible.
  cursorIndex(): number | null;
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
  // Pushes the named chat scope.
  pushScope(scope: ChatScopeName): PushedScope;
  log: Log;
}

export function createPicker(deps: PickerDeps): Picker {
  // The scope of the request being opened, then of the open one.
  let scope: ChatScopeName = 'picker';
  const list = createListPicker({
    pushScope: () => deps.pushScope(scope),
    log: deps.log,
    logSource: 'chat',
    filterEditor: deps.editor,
  });
  deps.overlay.contribute(list.element);

  let isSessionBound = false;
  // The open request's handle; null once it is picked or closed.
  let shown: PickerHandle | null = null;

  return {
    open(next) {
      blurFocusedElement();
      isSessionBound = next.sessionBound ?? false;
      const nextScope = next.scope ?? 'picker';
      if (list.isOpen() && nextScope !== scope) {
        list.close();
      }
      scope = nextScope;
      const handle: PickerHandle = {
        isOpen: () => shown === handle && list.isOpen(),
      };
      shown = handle;
      list.open({
        title: next.title,
        items: next.items,
        label: next.label,
        selected: next.selected,
        chosen: (item) => {
          shown = null;
          next.picked(item);
        },
        cancelled: () => {
          shown = null;
          deps.log('chat', `picker closed: ${next.title}`);
        },
      });
      return handle;
    },
    isOpen: () => list.isOpen(),
    cursorIndex: () => list.cursorIndex(),
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
