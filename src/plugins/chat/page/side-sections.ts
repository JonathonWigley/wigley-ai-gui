import type { Timers } from '../../../contracts/ambient';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { ResizeTarget } from '../../../contracts/panes';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import {
  type ContributedPart,
  type ContributedPartsPlace,
  type PartStore,
  placeContributedPart,
} from '../../../shared/page/contributed-parts';
import {
  appended,
  blurFocusedElement,
  element,
} from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import {
  createSplitDivider,
  type SplitDivider,
} from '../../../shared/page/ui/split';
import type { SplitLimits } from '../../../shared/page/ui/split-width';
import { textLineHeightPx } from '../../../shared/page/text-line';
import type { ChatSidePart, ChatSideSection } from '../contract';
import type {
  PartView,
  SideSectionInput,
  SideSectionKit,
} from '../layouts/layout';
import {
  type ChatLayouts,
  chatPartDraws,
  surfaceBaseKit,
  type SurfaceKitDeps,
} from './chat-layouts';

const COLLAPSED_KEY = 'collapsed-sections';
const HUB_HIDDEN_KEY = 'hub-hidden';
const HUB_WIDTH_KEY = 'hub-width';

// `endMin` is what the hub leaves `.chat-main`; the hub hides below a 640 px tab,
// so the two limits always fit.
const HUB_WIDTH: SplitLimits = { initial: 264, min: 200, endMin: 320 };

const WIDTH_HANDLE_CLASSES = 'ui-split-handle chat-side-handle';

const SIDE_PARTS: ContributedPartsPlace = {
  noun: 'side part',
  holderClass: 'chat-side-parts',
  wrapperClass: 'chat-side-part',
};

export interface SideSectionsDeps {
  layouts: ChatLayouts;
  kit: SurfaceKitDeps;
  parts: Pick<PartStore<ChatSidePart>, 'parts'>;
  uiState: UiState;
  timers: Timers;
  log: PluginLog;
}

// The keyboard cursor on one Chat tab's hub, walking the section heads that
// show (a head drawn, with a layout box), in hub order. The cursor is kept by
// part id: a section that no longer shows moves it to the first shown head at
// the next call. `isReachable` is true while the hub is not hidden, its holder
// has a layout box and at least one head shows. `enter` focuses the holder and
// keeps the cursor when its section still shows, else puts it on the first
// shown head; `leave` takes the DOM focus off the holder or the element in it
// that holds it. `move` steps
// one head, stopping at either end, and `toEdge` goes to the first or last.
// `toggle` folds or unfolds the cursor's section, as a click on its head does,
// and `scrollBy` scrolls its body. Each returns the cursor section's title, or
// null, changing nothing, when no head shows. The cursor's head carries
// `is-cursor`, a redrawn head included.
export interface SectionCursor {
  isReachable(): boolean;
  enter(): string | null;
  leave(): void;
  move(by: 1 | -1): string | null;
  toEdge(edge: 'first' | 'last'): string | null;
  toggle(): string | null;
  scrollBy(
    step: ScrollStep,
    direction: 1 | -1,
  ): { title: string; scroll: ContentScroll } | null;
}

// One Chat tab's hub. `divider` is the hub's width divider, `cursor` its
// keyboard cursor.
export interface SideTab {
  divider: ResizeTarget;
  cursor: SectionCursor;
  // Removes the parts no longer held and builds those the tab has not built, at
  // their place by `order`; built parts and their wrappers stay as they are. A
  // part whose build threw stays unbuilt until it is added again or `rebuild`
  // runs.
  sync(): void;
  // Disposes every build once, then builds every held part again.
  rebuild(): void;
  // Disposes every build; the toggles no longer reach the tab.
  close(): void;
}

// The session hub of every Chat tab: each side part in a section frame drawn
// through the chat layout's `sideSection` part, the sections sorted by `order`
// (equal orders keep add order). A section's collapse, the hub's hide and its
// width, which a drag on its start edge or a nudge of a tab's `divider` sets,
// apply to every tab and session and are kept in `uiState`; a frame change
// updates the frame in place and never rebuilds the part.
export interface SideSections {
  // Appends the hub's holder to `root`, which takes `is-side-hidden` while the
  // hub is hidden. Builds no part: the caller runs `sync`.
  openTab(root: HTMLElement, sessionId: string): SideTab;
  toggleHidden(): void;
}

interface BuiltFrame {
  element: HTMLElement;
  view: PartView<SideSectionInput>;
}

// One built part's frame in `tab`. `body` is what the part draws in, moved into
// each new draw; `head` is the last draw's head, null when it drew none;
// `drawn` is null when even the default frame failed, and `body` then sits bare
// in `wrapper`.
interface Frame {
  part: ChatSidePart;
  tab: OpenTab;
  wrapper: HTMLElement;
  body: HTMLElement;
  head: HTMLElement | null;
  summary: string | null;
  drawn: DrawnPart<BuiltFrame> | null;
}

// `wrapper` is null for a part whose build threw.
interface SideBuild {
  wrapper: HTMLElement | null;
  remove(): void;
}

// `cursor` is the part id of the section the hub's cursor is on, null before
// the first `enter`.
interface OpenTab {
  root: HTMLElement;
  frames: Map<string, Frame>;
  widthDivider: SplitDivider;
  cursor: string | null;
}

export function createSideSections(deps: SideSectionsDeps): SideSections {
  const { log, uiState } = deps;
  const draws = chatPartDraws(deps.layouts, 'sideSection', log);
  const openTabs = new Set<OpenTab>();

  // Every tab's divider writes through this, so one drag moves every tab's hub.
  const sharedWidthState: UiState = {
    get: (key) => uiState.get(key),
    set(key, value) {
      uiState.set(key, value);
      log(`session hub width ${String(value)}`);
      for (const tab of openTabs) {
        tab.widthDivider.reloadWidth();
      }
    },
  };

  const inputOf = (frame: Frame): SideSectionInput => ({
    title: frame.part.title,
    summary: frame.summary,
    collapsed: readCollapsed(uiState).includes(frame.part.id),
  });

  const toggleCollapsed = (part: ChatSidePart) => {
    const collapsed = readCollapsed(uiState);
    const isCollapsing = !collapsed.includes(part.id);
    uiState.set(
      COLLAPSED_KEY,
      isCollapsing
        ? [...collapsed, part.id]
        : collapsed.filter((id) => id !== part.id),
    );
    log(`section ${part.title} ${isCollapsing ? 'collapsed' : 'expanded'}`);
    for (const tab of openTabs) {
      const frame = tab.frames.get(part.id);
      if (frame !== undefined) {
        showFrame(frame);
      }
    }
  };

  // Draws the frame in place of its last draw, the body moving into the new one.
  const drawFrame = (frame: Frame) => {
    frame.drawn?.dispose();
    frame.drawn?.built.element.remove();
    frame.drawn = null;
    frame.head = null;
    const input = inputOf(frame);
    try {
      frame.drawn = draws.draw(frame.wrapper, (builder, at, rollback) => {
        const body = appSlot(frame.body, 'body', rollback);
        const kit: SideSectionKit = {
          ...surfaceBaseKit(deps.kit, 'chat', rollback),
          head: (parent) => {
            const head = appended(
              parent,
              sectionHead(() => toggleCollapsed(frame.part)),
            );
            head.classList.toggle(
              'is-cursor',
              frame.tab.cursor === frame.part.id,
            );
            frame.head = head;
            return head;
          },
          body: (parent) => body.place(parent),
        };
        const view = builder(at, input, kit);
        const root = requireElementIn(at, view.element, 'sideSection');
        body.placeIfLeftOut(root);
        return { element: root, view };
      });
    } catch (error) {
      log(`section ${frame.part.title} frame failed: ${errorText(error)}`);
      frame.wrapper.append(frame.body);
    }
  };

  // Runs the drawn frame's update, or draws it again when it has none or the
  // update threw. A section with no frame changes nothing.
  const showFrame = (frame: Frame) => {
    if (
      frame.drawn !== null &&
      draws.update(frame.drawn, inputOf(frame)) !== 'ran'
    ) {
      drawFrame(frame);
    }
  };

  // `part` as `placeContributedPart` builds it: the frame into the wrapper, then
  // the part into the frame's body.
  const framedPart = (part: ChatSidePart, tab: OpenTab): ContributedPart => ({
    id: part.id,
    build(wrapper, sessionId) {
      const { frames } = tab;
      const frame: Frame = {
        part,
        tab,
        wrapper,
        body: element('div', 'chat-side-section-body'),
        head: null,
        summary: null,
        drawn: null,
      };
      frames.set(part.id, frame);
      drawFrame(frame);
      const closeFrame = () => {
        frames.delete(part.id);
        frame.drawn?.dispose();
        frame.drawn = null;
      };
      const section: ChatSideSection = {
        setSummary(text) {
          if (frames.get(part.id) === frame) {
            frame.summary = text;
            showFrame(frame);
          }
        },
      };
      try {
        const built = part.build(frame.body, sessionId, section);
        return {
          dispose() {
            try {
              built.dispose?.();
            } finally {
              closeFrame();
            }
          },
        };
      } catch (error) {
        closeFrame();
        throw error;
      }
    },
  });

  return {
    openTab(root, sessionId) {
      const holder = appended(root, element('div', SIDE_PARTS.holderClass));
      root.classList.toggle(
        'is-side-hidden',
        uiState.get(HUB_HIDDEN_KEY) === true,
      );
      holder.style.setProperty('--chat-side-end-min', String(HUB_WIDTH.endMin));
      const widthDivider = createSplitDivider({
        ...HUB_WIDTH,
        uiState: sharedWidthState,
        stateKey: HUB_WIDTH_KEY,
        sizedPane: 'end',
        handle: appended(holder, element('div', WIDTH_HANDLE_CLASSES)),
        measure() {
          const { left, width } = root.getBoundingClientRect();
          return { left, span: width };
        },
        show: (width) =>
          holder.style.setProperty('--chat-side-width', String(width)),
        anchor: deps.kit.keys.anchor,
        timers: deps.timers,
      });
      holder.tabIndex = -1;
      const opened: OpenTab = {
        root,
        frames: new Map(),
        widthDivider,
        cursor: null,
      };
      openTabs.add(opened);
      const builds = new Map<string, SideBuild>();

      const buildPart = (part: ChatSidePart): SideBuild => {
        const disposes: (() => void)[] = [];
        const wrapper = placeContributedPart(
          holder,
          sessionId,
          framedPart(part, opened),
          SIDE_PARTS,
          log,
          { recordBox: (dispose) => disposes.push(dispose) },
        );
        return {
          wrapper,
          remove() {
            for (const dispose of disposes) {
              dispose();
            }
            wrapper?.remove();
          },
        };
      };
      const sync = () => {
        const parts = inOrder(deps.parts.parts());
        const heldIds = new Set(parts.map((part) => part.id));
        for (const [id, build] of builds) {
          if (!heldIds.has(id)) {
            builds.delete(id);
            build.remove();
          }
        }
        for (const part of parts) {
          if (!builds.has(part.id)) {
            builds.set(part.id, buildPart(part));
          }
        }
        moveNewWrappersIntoOrder(holder, parts, builds);
      };
      const disposeBuilds = () => {
        for (const build of builds.values()) {
          build.remove();
        }
        builds.clear();
      };
      return {
        divider: widthDivider,
        cursor: sectionCursor(opened, holder, {
          parts: deps.parts,
          uiState,
          toggleCollapsed,
        }),
        sync,
        rebuild() {
          disposeBuilds();
          sync();
        },
        close() {
          disposeBuilds();
          widthDivider.dispose();
          openTabs.delete(opened);
        },
      };
    },
    toggleHidden() {
      const isHidden = uiState.get(HUB_HIDDEN_KEY) !== true;
      uiState.set(HUB_HIDDEN_KEY, isHidden);
      for (const tab of openTabs) {
        tab.root.classList.toggle('is-side-hidden', isHidden);
      }
      log(`session hub ${isHidden ? 'hidden' : 'shown'}`);
    },
  };
}

// The frames of `tab` whose head shows, in hub order: `parts` sorted as the
// holder places their wrappers.
function shownFrames(tab: OpenTab, parts: readonly ChatSidePart[]): Frame[] {
  return inOrder(parts).flatMap((part) => {
    const frame = tab.frames.get(part.id);
    const head = frame?.head ?? null;
    const isShown =
      frame !== undefined && head !== null && head.getClientRects().length > 0;
    return isShown ? [frame] : [];
  });
}

function sectionCursor(
  tab: OpenTab,
  holder: HTMLElement,
  deps: {
    parts: Pick<PartStore<ChatSidePart>, 'parts'>;
    uiState: UiState;
    toggleCollapsed(part: ChatSidePart): void;
  },
): SectionCursor {
  const shown = () => shownFrames(tab, deps.parts.parts());
  // Moves the cursor's mark to `frame` and returns its title.
  const putOn = (frame: Frame): string => {
    if (tab.cursor !== null) {
      tab.frames.get(tab.cursor)?.head?.classList.remove('is-cursor');
    }
    tab.cursor = frame.part.id;
    frame.head?.classList.add('is-cursor');
    return frame.part.title;
  };
  // The shown frames and the cursor's index among them, -1 when its section
  // no longer shows; null when none shows.
  const at = (): { frames: Frame[]; index: number } | null => {
    const frames = shown();
    if (frames.length === 0) {
      return null;
    }
    const index = frames.findIndex((frame) => frame.part.id === tab.cursor);
    return { frames, index };
  };
  // The cursor's frame, put on the first shown head when its section no
  // longer shows; null when none shows.
  const cursorFrame = (): Frame | null => {
    const found = at();
    if (found === null) {
      return null;
    }
    const frame = found.frames[Math.max(found.index, 0)];
    putOn(frame);
    return frame;
  };
  return {
    isReachable() {
      const isHidden = deps.uiState.get(HUB_HIDDEN_KEY) === true;
      const holderHasLayoutBox = holder.getClientRects().length > 0;
      return !isHidden && holderHasLayoutBox && shown().length > 0;
    },
    enter() {
      const frame = cursorFrame();
      if (frame === null) {
        return null;
      }
      holder.focus();
      return frame.part.title;
    },
    leave() {
      if (holder.contains(document.activeElement)) {
        blurFocusedElement();
      }
    },
    move(by) {
      const found = at();
      if (found === null) {
        return null;
      }
      const { frames, index } = found;
      const next =
        index < 0 ? 0 : Math.min(Math.max(index + by, 0), frames.length - 1);
      return putOn(frames[next]);
    },
    toEdge(edge) {
      const frames = shown();
      if (frames.length === 0) {
        return null;
      }
      return putOn(edge === 'first' ? frames[0] : frames[frames.length - 1]);
    },
    toggle() {
      const frame = cursorFrame();
      if (frame === null) {
        return null;
      }
      deps.toggleCollapsed(frame.part);
      return frame.part.title;
    },
    scrollBy(step, direction) {
      const frame = cursorFrame();
      if (frame === null) {
        return null;
      }
      const { body } = frame;
      const scroll = scrollContent(
        body,
        step,
        direction,
        textLineHeightPx(body),
      );
      return { title: frame.part.title, scroll };
    },
  };
}

function readCollapsed(uiState: UiState): string[] {
  const value = uiState.get(COLLAPSED_KEY);
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
}

function inOrder(parts: readonly ChatSidePart[]): ChatSidePart[] {
  return [...parts].sort((a, b) => a.order - b.order);
}

// The holder's built wrappers keep their order, so only a wrapper just appended
// differs from its sorted place; a built one never moves, and its scroll stays.
// The width handle ends up after every wrapper.
function moveNewWrappersIntoOrder(
  holder: HTMLElement,
  parts: readonly ChatSidePart[],
  builds: ReadonlyMap<string, SideBuild>,
) {
  const wrappers = parts.flatMap((part) => builds.get(part.id)?.wrapper ?? []);
  wrappers.forEach((wrapper, index) => {
    const placed = holder.children[index];
    if (placed !== wrapper) {
      holder.insertBefore(wrapper, placed);
    }
  });
}

// Takes no key and no focus, so a click in the focused pane leaves the focus
// where it was; a click in another pane moves it there by that pane's focus.
function sectionHead(toggle: () => void): HTMLButtonElement {
  const head = element('button', 'chat-side-section-head');
  head.type = 'button';
  head.tabIndex = -1;
  head.addEventListener('mousedown', (event) => event.preventDefault());
  head.addEventListener('click', toggle);
  return head;
}
