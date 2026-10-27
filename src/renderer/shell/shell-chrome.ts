import type { AppInstance } from '../../contracts/app-instance';
import type { Log } from '../../contracts/log';
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
import { drawPart } from '../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../shared/page/layout-host/kit';
import { pickLayout } from '../../shared/page/layout-host/pick';
import { icon } from '../../shared/page/ui/icon';
import type { CompleteLayout, Layout, ShellKit } from './layouts/layout';

export interface ShellChromeDeps {
  areas: Pick<Record<AreaName, Area>, 'titleBar' | 'activityBar'>;
  defaultLayout: CompleteLayout;
  kit: ShellKit;
  instance: AppInstance;
  log: Log;
}

// The chrome the core draws through the shell layout. `showContext` and
// `showProblems` draw the title bar's context and config problems again for
// a new value; `addMode` adds the mode's activity item, which shows the mode
// on a click; `markMode` marks the shown mode's item, logging only when the
// marked mode changed; `setLayouts` draws every part again with new layouts.
export interface ShellChrome {
  showContext(context: ModeContext | null): void;
  showProblems(problems: readonly ConfigProblem[]): void;
  addMode(mode: Mode, handle: ModeHandle): void;
  markMode(modeId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

// The shell kit over `base`: the base kit's parts and the Codicon.
export function createShellKit(base: BaseKit): ShellKit {
  return {
    ...base,
    icon(parent, name) {
      const node = icon(name);
      parent.append(node);
      return node;
    },
  };
}

// A part's place in its area: the app-owned `span.shell-part-slot`, which
// keeps its place in the track across redraws, and the dispose of the part
// drawn in it.
interface Slot {
  element: HTMLElement;
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
// with `default` until the first `setLayouts`. A redraw replaces only a
// slot's children, so the modes, plugin contributions and focus stay. The
// context slot hides while the context is null, and the problems slot while
// the list is empty; neither draws a part then.
export function mountShellChrome(deps: ShellChromeDeps): ShellChrome {
  const { areas, defaultLayout, kit, log } = deps;
  let shown: ShownLayouts<Layout> = {
    layouts: new Map([['default', defaultLayout]]),
    user: 'default',
  };
  let context: ModeContext | null = null;
  let problems: readonly ConfigProblem[] = [];
  let markedId: string | null = null;
  const items = new Map<string, ModeItem>();

  // Draws the part `partName` into `slot`, its children replaced, with the
  // first layout that defines it among the user's and `default`.
  const drawSlot = <K extends keyof Layout>(
    slot: Slot,
    partName: K,
    build: (
      builder: NonNullable<Layout[K]>,
      parent: HTMLElement,
    ) => HTMLElement,
  ): HTMLElement => {
    clearSlot(slot);
    const pick = pickLayout(
      [shown.user],
      shown.layouts,
      (layout) => layout[partName] !== undefined,
    );
    const drawn = drawPart({
      owner: 'shell',
      parent: slot.element,
      pick,
      defaultLayout,
      part: (layout: Layout) =>
        layout[partName] as NonNullable<Layout[K]> | undefined,
      build: (builder, parent) => ({ element: build(builder, parent) }),
      log,
      logSource: 'shell',
      partName,
    });
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
    drawSlot(contextSlot, 'titleContext', (builder, parent) =>
      builder(parent, input, kit),
    );
  };

  const devSlot = deps.instance.isDev
    ? contributeSlot(areas.titleBar, 'start')
    : null;
  const drawDevTag = () => {
    if (devSlot !== null) {
      drawSlot(devSlot, 'devTag', (builder, parent) => builder(parent, kit));
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
    drawSlot(problemsSlot, 'configProblems', (builder, parent) =>
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
    const root = drawSlot(item.slot, 'activityItem', (builder, parent) =>
      builder(parent, input, kit),
    );
    root.addEventListener('click', () => item.handle.show());
    item.root = root;
    applyMark(item);
  };

  drawContext();
  drawDevTag();
  drawProblems();

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
      shown = next;
      drawContext();
      drawDevTag();
      drawProblems();
      for (const item of items.values()) {
        drawItem(item);
      }
    },
  };
}

function contributeSlot(area: Area, align: Alignment): Slot {
  const slot: Slot = {
    element: element('span', 'shell-part-slot'),
    disposeDrawn: NO_DRAWN,
  };
  area.contribute(slot.element, { align });
  return slot;
}

// Disposes the part drawn in `slot` and empties it.
function clearSlot(slot: Slot): void {
  slot.disposeDrawn();
  slot.disposeDrawn = NO_DRAWN;
  slot.element.replaceChildren();
}
