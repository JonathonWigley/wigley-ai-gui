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
import type { ConfigProblem } from '../../contracts/settings';
import { element } from '../../shared/page/dom';
import {
  createBaseKit,
  type OwnerKitServices,
} from '../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../shared/page/layout-host/layout-parts';
import type { CompleteLayout, Layout, ShellKit } from './layouts/layout';

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
// `showMode` shows an added mode by id, and does nothing for an unknown one;
// `markMode` marks the shown mode's item, logging only when the
// marked mode changed; `setLayouts` draws every part again with new layouts.
export interface ShellChrome {
  showContext(context: ModeContext | null): void;
  showProblems(problems: readonly ConfigProblem[]): void;
  addMode(mode: Mode, handle: ModeHandle): Disposable;
  showMode(modeId: string): void;
  markMode(modeId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

// The shell kit of one drawing attempt. The shell owns no command, so only a
// plugin's qualified id names one; anchors take no scope.
function createShellKit(
  services: OwnerKitServices,
  rollback: Pick<RollbackDeps, 'recordAnchor'>,
): ShellKit {
  return createBaseKit({
    ...services,
    scope: null,
    commandNamed: () => null,
    recordAnchor: (anchor) => rollback.recordAnchor(anchor),
    recordMount: (mount) => rollback.recordAnchor(mount),
  });
}

// A part's place in its area: the app-owned `span.shell-part-slot`, which
// keeps its place in the track across redraws, its contribution to the area,
// and the dispose of the part drawn in it.
interface Slot {
  element: HTMLElement;
  contribution: Disposable;
  disposeDrawn(): void;
}

// A mode's activity item: its slot, and what draws the item and marks it.
interface ModeItem {
  slot: Slot;
  mode: Mode;
  handle: ModeHandle;
  root: HTMLElement | null;
}

const NO_DRAWN = () => undefined;

// Contributes one slot per part, once: the context at the title bar's
// centre, the Dev tag at its start in the dev app, the problems at its end,
// and each mode's item to the activity bar in add order. Every part draws
// with `default` until the first `setLayouts`. A redraw replaces only a slot's children, so the modes,
// plugin contributions and focus stay. The
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
  const items = new Map<string, ModeItem>();

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
    const { mode } = item;
    const input = { id: mode.id, title: mode.title, icon: mode.icon };
    const root = drawSlot(item.slot, 'activityItem', (builder, parent, kit) =>
      builder(parent, input, kit),
    );
    root.addEventListener('click', () =>
      services.commands.run(MODES_SHOW.id, mode.id),
    );
    item.root = root;
    applyMark(item);
  };

  const drawAll = () => {
    drawContext();
    drawDevTag();
    drawProblems();
    for (const item of items.values()) {
      drawItem(item);
    }
  };

  drawAll();

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
        slot: contributeSlot(areas.activityBar, 'start'),
        mode,
        handle,
        root: null,
      };
      items.set(mode.id, item);
      drawItem(item);
      return {
        dispose() {
          clearSlot(item.slot);
          item.slot.contribution.dispose();
          items.delete(mode.id);
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
    setLayouts(next) {
      parts.setLayouts(next);
      drawAll();
    },
  };
}

function contributeSlot(area: Area, align: Alignment): Slot {
  const slotElement = element('span', 'shell-part-slot');
  return {
    element: slotElement,
    contribution: area.contribute(slotElement, { align }),
    disposeDrawn: NO_DRAWN,
  };
}

// Disposes the part drawn in `slot` and empties it.
function clearSlot(slot: Slot): void {
  slot.disposeDrawn();
  slot.disposeDrawn = NO_DRAWN;
  slot.element.replaceChildren();
}
