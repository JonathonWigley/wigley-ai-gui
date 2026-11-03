import type { EditorHost } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import {
  createListPicker,
  type DrawnPickerRow,
  type DrawRowInput,
} from '../../../shared/page/list-picker';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';
import type { PickerItemInput, PickerRowKit } from '../layouts/layout';
import {
  type ChatLayouts,
  type SurfaceKitDeps,
  surfaceBaseKit,
} from './chat-layouts';
import type { ArchiveState } from './resume-items';

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
  // The archive state of the item, which the `resume` scope's cursor row
  // prompts to archive or restore; null for an item with none.
  archiveState?(item: T): ArchiveState | null;
  // The item as the chat layout's `pickerRow` part reads it.
  rowInput(item: T): PickerItemInput;
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
// the filter kept. The header ends in the open scope's keys (`/ filter`, and
// `. archived` in `resume`), and in `resume` the cursor row ends in
// `x archive` or `x restore` by its item's archive state. Each row draws
// through the chat layout's `pickerRow` part, its keys in the open scope, and
// the open list draws again on each layout change.
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
  // Draws the open list's rows again; nothing when closed.
  redraw(): void;
}

export interface PickerDeps extends SurfaceKitDeps {
  overlay: PluginAreas['overlay'];
  editor: EditorHost;
  // Pushes the named chat scope.
  pushScope(scope: ChatScopeName): PushedScope;
  layouts: ChatLayouts;
  log: PluginLog;
}

type PickerScope = NonNullable<PickerRequest<unknown>['scope']>;

export function createPicker(deps: PickerDeps): Picker {
  // The scope of the request being opened, then of the open one.
  let scope: ChatScopeName = 'picker';
  const list = createListPicker({
    pushScope: () => deps.pushScope(scope),
    log: deps.log,
    filterEditor: deps.editor,
  });
  deps.overlay.contribute(list.element);
  deps.layouts.onChange(() => list.redraw());
  // An empty span holding `command`'s keys in `scopeName`, then `label`.
  const anchored = (
    command: ChatCommandName,
    scopeName: PickerScope,
    label: string,
  ) => {
    const hint = element('span', 'chat-picker-key');
    deps.keys.anchor(hint, chatCommand(command), {
      scope: chatScope(scopeName),
      label,
    });
    return hint;
  };
  const resumeHeader = element('span', 'chat-picker-keys');
  resumeHeader.append(
    anchored('pickerFilter', 'resume', 'filter'),
    anchored('showArchived', 'resume', 'archived'),
  );
  const headers: Record<PickerScope, HTMLElement> = {
    picker: anchored('pickerFilter', 'picker', 'filter'),
    resume: resumeHeader,
  };
  const cursorPrompts: Record<ArchiveState, HTMLElement> = {
    live: anchored('toggleArchive', 'resume', 'archive'),
    archived: anchored('toggleArchive', 'resume', 'restore'),
  };

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
        headerEnd: headers[nextScope],
        cursorEnd:
          nextScope === 'resume'
            ? (item) => {
                const state = next.archiveState?.(item) ?? null;
                return state === null ? null : cursorPrompts[state];
              }
            : undefined,
        chosen: (item) => {
          shown = null;
          next.picked(item);
        },
        cancelled: () => {
          shown = null;
          deps.log(`picker closed: ${next.title}`);
        },
        drawRow: (parent, item, row) =>
          drawPickerRow(deps, nextScope, parent, next.rowInput(item), row),
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
    redraw: () => list.redraw(),
  };
}

// One row drawn through the `pickerRow` part into the list, its kit's anchors
// in `scope`; the list picker disposes the draw.
function drawPickerRow(
  deps: PickerDeps,
  scope: PickerScope,
  parent: HTMLElement,
  item: PickerItemInput,
  row: DrawRowInput,
): DrawnPickerRow {
  const drawn = deps.layouts.draw(
    'pickerRow',
    parent,
    (builder, at, rollback) => {
      const kit: PickerRowKit = {
        ...surfaceBaseKit(deps, scope, rollback),
        cursorEnd: () => row.trailing,
      };
      const view = builder(at, { item, label: row.label }, kit);
      return { element: view.element };
    },
  );
  return { element: drawn.built.element, dispose: drawn.dispose };
}
