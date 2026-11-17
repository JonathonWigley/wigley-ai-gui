import type {
  DrawnPickerRow,
  ListPickerService,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';
import type {
  PickerItemInput,
  PickerRowInput,
  PickerRowKit,
} from '../layouts/layout';
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
  // The row's name when its label also holds a path: a filter's match on it
  // outranks any match on a label.
  name?(item: T): string;
  // The item index highlighted on open; 0 when left out or out of range.
  selected?: number;
  // True, while the picker is open in the same scope, keeps its typed filter
  // and the filter box's focus (`ListPickerRequest.keepFilter`); false when
  // left out.
  keepFilter?: boolean;
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
  // The section the item sits under, its heading drawn through the
  // `pickerHeading` part; null for none. Items of a section stay together.
  section?(item: T): string | null;
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
// the filter kept. The header ends in `/ filter`, then `. archived` in
// `resume`, and in `resume` the cursor row ends in
// `x archive` or `x restore` by its item's archive state. Each row draws
// through the chat layout's `pickerRow` part and each section heading through
// `pickerHeading`, their keys in the open scope, and the open list draws again
// on each layout change.
export interface Picker {
  open<T>(request: PickerRequest<T>): PickerHandle;
  isOpen(): boolean;
  // The open request's item index under the cursor; null when closed or
  // nothing is visible.
  cursorIndex(): number | null;
  down(): void;
  up(): void;
  top(): void;
  bottom(): void;
  pick(): void;
  close(): void;
  closeSessionBound(): void;
  focusFilter(): void;
  leaveFilter(): void;
  // Draws the open list's rows again; nothing when closed.
  redraw(): void;
}

export interface PickerDeps extends SurfaceKitDeps {
  picker: ListPickerService;
  layouts: ChatLayouts;
  log: PluginLog;
}

type PickerScope = NonNullable<PickerRequest<unknown>['scope']>;

export function createPicker(deps: PickerDeps): Picker {
  // The scope of the request being opened, then of the open one.
  let scope: ChatScopeName = 'picker';
  const list = deps.picker.create({ scope: () => scope, filter: true });
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
  // The shared picker draws `/ filter` ahead of these.
  const headers: Record<PickerScope, HTMLElement | null> = {
    picker: null,
    resume: anchored('showArchived', 'resume', 'archived'),
  };

  let isSessionBound = false;
  // The open request's handle; null once it is picked or closed.
  let shown: PickerHandle | null = null;

  return {
    open(next) {
      const nextScope = next.scope ?? 'picker';
      const isSameScope = nextScope === scope;
      const keepsFilter =
        next.keepFilter === true && list.isOpen() && isSameScope;
      if (!keepsFilter) {
        blurFocusedElement();
      }
      isSessionBound = next.sessionBound ?? false;
      if (list.isOpen() && !isSameScope) {
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
        name: next.name,
        selected: next.selected,
        keepFilter: next.keepFilter,
        headerEnd: headers[nextScope],
        chosen: (item) => {
          shown = null;
          next.picked(item);
        },
        cancelled: () => {
          shown = null;
          deps.log(`picker closed: ${next.title}`);
        },
        drawRow: (parent, item, row) =>
          drawPickerRow(
            deps,
            nextScope,
            parent,
            {
              item: next.rowInput(item),
              label: row.label,
              prompt: cursorPrompt(
                nextScope,
                row.isCursor,
                next.archiveState?.(item) ?? null,
              ),
            },
          ),
        section: next.section,
        drawHeading: (parent, title) =>
          drawPickerHeading(deps, nextScope, parent, title),
      });
      return handle;
    },
    isOpen: () => list.isOpen(),
    cursorIndex: () => list.cursorIndex(),
    down: () => list.down(),
    up: () => list.up(),
    top: () => list.top(),
    bottom: () => list.bottom(),
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

// The actions the cursor row of the `resume` list shows: archive or restore by
// the item's archive state; none on any other row, in any other scope, or for
// an item with no archive state.
function cursorPrompt(
  scope: PickerScope,
  isCursor: boolean,
  state: ArchiveState | null,
): readonly PromptActionInput[] {
  if (!isCursor || scope !== 'resume' || state === null) {
    return [];
  }
  return [
    {
      command: chatCommand('toggleArchive'),
      label: state === 'live' ? 'archive' : 'restore',
    },
  ];
}

// One row drawn through the `pickerRow` part into the list, its kit's anchors
// in `scope`; the list picker disposes the draw.
function drawPickerRow(
  deps: PickerDeps,
  scope: PickerScope,
  parent: HTMLElement,
  input: PickerRowInput,
): DrawnPickerRow {
  const drawn = deps.layouts.draw(
    'pickerRow',
    parent,
    (builder, at, rollback) => {
      const kit: PickerRowKit = surfaceBaseKit(deps, scope, rollback);
      const view = builder(at, input, kit);
      return { element: view.element };
    },
  );
  return { element: drawn.built.element, dispose: drawn.dispose };
}

// One section heading drawn through the `pickerHeading` part into its `li`,
// its kit's anchors in `scope`; the list picker disposes the draw.
function drawPickerHeading(
  deps: PickerDeps,
  scope: PickerScope,
  parent: HTMLElement,
  title: string,
): DrawnPickerRow {
  const drawn = deps.layouts.draw(
    'pickerHeading',
    parent,
    (builder, at, rollback) => {
      const kit = surfaceBaseKit(deps, scope, rollback);
      const view = builder(at, { title }, kit);
      return { element: view.element };
    },
  );
  return { element: drawn.built.element, dispose: drawn.dispose };
}
