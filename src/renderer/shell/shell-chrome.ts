import type { AppInstance } from '../../contracts/app-instance';
import { MODES_SHOW } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { Log, PluginLog } from '../../contracts/log';
import type {
  Alignment,
  Area,
  AreaName,
  Mode,
  ModeContext,
  ModeHandle,
  ShownLayouts,
} from '../../contracts/plugin';
import type {
  ActivityBarSetting,
  ConfigProblem,
} from '../../contracts/settings';
import { appended, element } from '../../shared/page/dom';
import {
  createBaseKit,
  type OwnerKitServices,
} from '../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../shared/page/layout-host/layout-parts';
import { floatingPanel } from '../../shared/page/ui/floating-panel';
import { type ActivityModeEntry, arrangeActivityItems } from './activity-order';
import type {
  ActivityItemInput,
  CompleteLayout,
  Layout,
  ShellKit,
  ToastInput,
} from './layouts/layout';
import { keepPeekOnClick } from './shell';

// `services` are what the shell kit reads, the keys fixed for the mount.
export interface ShellChromeDeps {
  areas: Pick<Record<AreaName, Area>, 'titleBar' | 'activityBar'>;
  defaultLayout: CompleteLayout;
  services: OwnerKitServices;
  instance: AppInstance;
  log: Log;
}

// The chrome the core draws through the shell layout. `showContext` and
// `showProblems` draw the title bar's context and config problems again for
// a new value; `addMode` adds the mode's activity item, whose click runs
// `modes.show` with the mode's id, until the returned handle's `dispose`;
// `showMode` shows an added mode by id, hidden from the bar or not, and does
// nothing for an unknown one; `markMode` marks the shown mode's item, logging
// only when the marked mode changed; `setCount` sets an added mode's count on
// its item, and does nothing for an unknown id; `setActivityBar` arranges the
// bar by a new `shell.activityBar` setting; `setActivityPinned` draws the Pin
// button for the bar's pinned state; `setLayouts` draws every part again with
// new layouts. `drawToast` draws one toast into `parent` with the current
// layouts and returns its root and the dispose of what it drew; `setLayouts`
// leaves a drawn toast as it is.
export interface ShellChrome {
  showContext(context: ModeContext | null): void;
  showProblems(problems: readonly ConfigProblem[]): void;
  addMode(mode: Mode, handle: ModeHandle): Disposable;
  showMode(modeId: string): void;
  markMode(modeId: string): void;
  setCount(modeId: string, count: number | null): void;
  setActivityBar(setting: ActivityBarSetting): void;
  setActivityPinned(pinned: boolean): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  drawToast(
    parent: HTMLElement,
    input: ToastInput,
  ): { element: HTMLElement; dispose(): void };
}

// The shell kit of one drawing attempt. The shell owns no command, so only a
// plugin's qualified id names one; anchors take no scope.
function createShellKit(
  services: OwnerKitServices,
  rollback: Pick<RollbackDeps, 'recordAnchor'>,
): ShellKit {
  return {
    ...createBaseKit({
      ...services,
      scope: null,
      commandNamed: () => null,
      recordAnchor: (anchor) => rollback.recordAnchor(anchor),
      recordMount: (mount) => rollback.recordAnchor(mount),
    }),
    floatingPanel: (parent) => appended(parent, floatingPanel()),
  };
}

// A part's place in its area: the app-owned `span.shell-part-slot`, which
// keeps its place in the track across redraws, its contribution to the area,
// null while it is out of the area, and the dispose of the part drawn in it.
interface Slot {
  element: HTMLElement;
  contribution: Disposable | null;
  disposeDrawn(): void;
}

// A mode's activity item: its slot, what draws the item and marks it, the
// count its handle set last, and the drawn item, null while none is drawn.
interface ModeItem {
  slot: Slot;
  mode: Mode;
  handle: ModeHandle;
  count: number | null;
  root: HTMLElement | null;
}

const NO_DRAWN = () => undefined;

// The setting until the first `setActivityBar`: every mode in its suggested
// place.
const SUGGESTED_PLACES: ActivityBarSetting = { groups: [], hidden: [] };

// Contributes one slot per part: the context at the title bar's centre, the
// Dev tag at its start in the dev app, the problems at its end, and the
// activity bar's slots, arranged by `arrangeActivityItems` from each added
// mode's `place` and the order of its id's first add, kept across its
// disposal, so a mode added again (its plugin restarted or switched back on)
// takes its item's earlier place. The bar's top groups fill its `start` track
// and its bottom groups its `end` track, a divider between neighbouring groups
// of one track, and the Pin button last in the `end` track, its slot marked
// by `keepPeekOnClick` so a click on it leaves a peek open. An add, a
// dispose, a setting and a layout change contribute every bar slot again in
// one pass, each slot's `order` its index in its track; a hidden mode's item
// is out of the bar, undrawn. Every part draws with `default` until the first
// `setLayouts`. A redraw replaces only a slot's children, so the modes,
// plugin contributions and focus stay; a count redraws only its item. The
// context slot hides while the context is null, and the problems slot while
// the list is empty; neither draws a part then.
export function mountShellChrome(deps: ShellChromeDeps): ShellChrome {
  const { areas, defaultLayout, services, log } = deps;
  const shellLog: PluginLog = (message) => log('shell', message);
  const parts = createLayoutParts<Layout, CompleteLayout>({
    owner: 'shell',
    defaultLayout,
    log: shellLog,
  });
  let context: ModeContext | null = null;
  let problems: readonly ConfigProblem[] = [];
  let markedId: string | null = null;
  let setting = SUGGESTED_PLACES;
  let isPinned = false;
  const items = new Map<string, ModeItem>();
  // Each mode id ever added, by the order of its first add.
  const itemOrders = new Map<string, number>();
  // The divider slots, each drawn once; a pass that needs fewer takes the
  // rest out of the bar.
  const dividers: Slot[] = [];

  // Draws the part `partName` into `slot`, its children replaced, with the
  // first layout that defines it among the user's and `default`.
  const drawSlot = <K extends keyof CompleteLayout & string>(
    slot: Slot,
    partName: K,
    build: (
      builder: CompleteLayout[K],
      parent: HTMLElement,
      kit: ShellKit,
    ) => HTMLElement,
  ): HTMLElement => {
    clearSlot(slot);
    const drawn = parts.draw(
      partName,
      slot.element,
      (builder, parent, rollback) => ({
        element: build(
          builder,
          parent,
          createShellKit({ ...services, log: shellLog }, rollback),
        ),
      }),
    );
    slot.disposeDrawn = drawn.dispose;
    return drawn.built.element;
  };

  const contextSlot = contributeSlot(areas.titleBar, 'center');
  const drawContext = () => {
    contextSlot.element.hidden = context === null;
    if (context === null) {
      clearSlot(contextSlot);
      return;
    }
    const input = { title: context.title, detail: context.detail };
    drawSlot(contextSlot, 'titleContext', (builder, parent, kit) =>
      builder(parent, input, kit),
    );
  };

  const devSlot = deps.instance.isDev
    ? contributeSlot(areas.titleBar, 'start')
    : null;
  const drawDevTag = () => {
    if (devSlot !== null) {
      drawSlot(devSlot, 'devTag', (builder, parent, kit) =>
        builder(parent, kit),
      );
    }
  };

  const problemsSlot = contributeSlot(areas.titleBar, 'end');
  const drawProblems = () => {
    problemsSlot.element.hidden = problems.length === 0;
    if (problems.length === 0) {
      clearSlot(problemsSlot);
      return;
    }
    const input = { problems };
    drawSlot(problemsSlot, 'configProblems', (builder, parent, kit) =>
      builder(parent, input, kit),
    );
  };

  const applyMark = (item: ModeItem) => {
    const isMarked = item.mode.id === markedId;
    item.root?.classList.toggle('is-shown', isMarked);
    if (isMarked) {
      item.root?.setAttribute('aria-current', 'true');
    } else {
      item.root?.removeAttribute('aria-current');
    }
  };

  const drawItem = (item: ModeItem) => {
    const input = itemInput(item.mode, item.count);
    const root = drawSlot(item.slot, 'activityItem', (builder, parent, kit) =>
      builder(parent, input, kit),
    );
    root.addEventListener('click', () =>
      services.commands.run(MODES_SHOW.id, item.mode.id),
    );
    item.root = root;
    applyMark(item);
  };

  const drawDivider = (slot: Slot) => {
    drawSlot(slot, 'activityDivider', (builder, parent, kit) =>
      builder(parent, kit),
    );
  };

  // A click on the Pin button keeps a peek, so `Pin open` in a narrow window,
  // where the pin does not apply, leaves the bar open.
  const pinSlot = emptySlot();
  keepPeekOnClick(pinSlot.element);
  const drawPin = () => {
    const input = { pinned: isPinned };
    drawSlot(pinSlot, 'activityPin', (builder, parent, kit) =>
      builder(parent, input, kit),
    );
  };

  // The order of the mode id's first add, kept across its disposal.
  const itemOrder = (modeId: string): number => {
    const known = itemOrders.get(modeId);
    if (known !== undefined) {
      return known;
    }
    const order = itemOrders.size;
    itemOrders.set(modeId, order);
    return order;
  };

  // The `end` track's dividers take the pool after the `start` track's.
  let dividersUsed = 0;
  const nextDivider = (): Slot => {
    let slot = dividers[dividersUsed];
    if (slot === undefined) {
      slot = emptySlot();
      dividers.push(slot);
      drawDivider(slot);
    }
    dividersUsed += 1;
    return slot;
  };

  // The slots of one track in order: each group's items, a divider between
  // neighbouring groups.
  const trackSlots = (groups: readonly string[][]): Slot[] => {
    const slots: Slot[] = [];
    for (const [index, ids] of groups.entries()) {
      if (index > 0) {
        slots.push(nextDivider());
      }
      for (const id of ids) {
        slots.push((items.get(id) as ModeItem).slot);
      }
    }
    return slots;
  };

  // Contributes every bar slot again in its track's order, takes the hidden
  // modes' items and the unused dividers out, and draws an item placed with
  // none drawn.
  const arrangeBar = () => {
    const entries: ActivityModeEntry[] = [...items.values()].map((item) => ({
      id: item.mode.id,
      place: item.mode.place,
      firstAdd: itemOrder(item.mode.id),
    }));
    const groups = arrangeActivityItems(entries, setting);
    dividersUsed = 0;
    const start = trackSlots(groups.top);
    const end = [...trackSlots(groups.bottom), pinSlot];
    const placed = new Set([...start, ...end]);
    for (const slot of [...items.values()].map((item) => item.slot)) {
      uncontribute(slot);
    }
    for (const slot of [...dividers, pinSlot]) {
      uncontribute(slot);
    }
    for (const [align, slots] of [
      ['start', start],
      ['end', end],
    ] as const) {
      for (const [order, slot] of slots.entries()) {
        slot.contribution = areas.activityBar.contribute(slot.element, {
          align,
          order,
        });
      }
    }
    for (const item of items.values()) {
      if (!placed.has(item.slot)) {
        clearSlot(item.slot);
        item.root = null;
      } else if (item.root === null) {
        drawItem(item);
      }
    }
  };

  const drawAll = () => {
    drawContext();
    drawDevTag();
    drawProblems();
    for (const item of items.values()) {
      if (item.root !== null) {
        drawItem(item);
      }
    }
    for (const slot of dividers) {
      drawDivider(slot);
    }
    drawPin();
  };

  drawAll();
  arrangeBar();

  return {
    showContext(next) {
      context = next;
      drawContext();
    },
    showProblems(next) {
      problems = next;
      drawProblems();
    },
    addMode(mode, handle) {
      const item: ModeItem = {
        slot: emptySlot(),
        mode,
        handle,
        count: null,
        root: null,
      };
      itemOrder(mode.id);
      items.set(mode.id, item);
      arrangeBar();
      return {
        dispose() {
          if (items.get(mode.id) !== item) {
            return;
          }
          clearSlot(item.slot);
          uncontribute(item.slot);
          items.delete(mode.id);
          arrangeBar();
        },
      };
    },
    showMode(modeId) {
      items.get(modeId)?.handle.show();
    },
    markMode(modeId) {
      const isChanged = markedId !== modeId;
      markedId = modeId;
      for (const item of items.values()) {
        applyMark(item);
      }
      if (isChanged) {
        const title = items.get(modeId)?.mode.title ?? modeId;
        log('page', `marked ${title} in the activity bar`);
      }
    },
    setCount(modeId, count) {
      const item = items.get(modeId);
      if (item === undefined) {
        return;
      }
      item.count = count;
      if (item.root !== null) {
        drawItem(item);
      }
    },
    setActivityBar(next) {
      setting = next;
      arrangeBar();
    },
    setActivityPinned(pinned) {
      isPinned = pinned;
      drawPin();
    },
    setLayouts(next) {
      parts.setLayouts(next);
      drawAll();
      arrangeBar();
    },
    drawToast(parent, input) {
      const drawn = parts.draw(
        'toast',
        parent,
        (builder, toastParent, rollback) => ({
          element: builder(
            toastParent,
            input,
            createShellKit({ ...services, log: shellLog }, rollback),
          ),
        }),
      );
      return { element: drawn.built.element, dispose: drawn.dispose };
    },
  };
}

// The input of a mode's item: a count above 0, else null; the qualified show
// command, else null.
function itemInput(mode: Mode, count: number | null): ActivityItemInput {
  return {
    id: mode.id,
    title: mode.title,
    icon: mode.icon,
    count: count !== null && count > 0 ? count : null,
    showCommand: mode.showCommand ?? null,
  };
}

// A slot out of every area, with nothing drawn.
function emptySlot(): Slot {
  return {
    element: element('span', 'shell-part-slot'),
    contribution: null,
    disposeDrawn: NO_DRAWN,
  };
}

function contributeSlot(area: Area, align: Alignment): Slot {
  const slot = emptySlot();
  slot.contribution = area.contribute(slot.element, { align });
  return slot;
}

// Takes `slot` out of its area, keeping what is drawn in it.
function uncontribute(slot: Slot): void {
  slot.contribution?.dispose();
  slot.contribution = null;
}

// Disposes the part drawn in `slot` and empties it.
function clearSlot(slot: Slot): void {
  slot.disposeDrawn();
  slot.disposeDrawn = NO_DRAWN;
  slot.element.replaceChildren();
}
