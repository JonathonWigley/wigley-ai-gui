import type { Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import {
  type ContributedPart,
  type ContributedPartsPlace,
  type PartStore,
  placeContributedPart,
} from '../../../shared/page/contributed-parts';
import { appended, element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import { NO_ANCHOR } from '../../../shared/page/ui/key-anchors';
import {
  createSplitDivider,
  type SplitDivider,
} from '../../../shared/page/ui/split';
import type { SplitLimits } from '../../../shared/page/ui/split-width';
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
  owner: 'chat',
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
  log: Log;
}

// One Chat tab's hub.
export interface SideTab {
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
// width, which a drag on its start edge sets, apply to every tab and session and
// are kept in `uiState`; a frame change updates the frame in place and never
// rebuilds the part.
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

// One built part's frame. `body` is what the part draws in, moved into each
// new draw; `drawn` is null when even the default frame failed, and `body` then
// sits bare in `wrapper`.
interface Frame {
  part: ChatSidePart;
  wrapper: HTMLElement;
  body: HTMLElement;
  summary: string | null;
  drawn: DrawnPart<BuiltFrame> | null;
}

// `wrapper` is null for a part whose build threw.
interface SideBuild {
  wrapper: HTMLElement | null;
  remove(): void;
}

interface OpenTab {
  root: HTMLElement;
  frames: Map<string, Frame>;
  widthDivider: SplitDivider;
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
      log('chat', `session hub width ${String(value)}`);
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
    log(
      'chat',
      `section ${part.title} ${isCollapsing ? 'collapsed' : 'expanded'}`,
    );
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
    const input = inputOf(frame);
    try {
      frame.drawn = draws.draw(frame.wrapper, (builder, at, rollback) => {
        const body = appSlot(frame.body, 'body', rollback);
        const kit: SideSectionKit = {
          ...surfaceBaseKit(deps.kit, 'chat', rollback),
          head: (parent) =>
            appended(
              parent,
              sectionHead(() => toggleCollapsed(frame.part)),
            ),
          body: (parent) => body.place(parent),
        };
        const view = builder(at, input, kit);
        const root = requireElementIn(at, view.element, 'sideSection');
        body.placeIfLeftOut(root);
        return { element: root, view };
      });
    } catch (error) {
      log(
        'chat',
        `section ${frame.part.title} frame failed: ${errorText(error)}`,
      );
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
  const framedPart = (
    part: ChatSidePart,
    frames: Map<string, Frame>,
  ): ContributedPart => ({
    id: part.id,
    build(wrapper, sessionId) {
      const frame: Frame = {
        part,
        wrapper,
        body: element('div', 'chat-side-section-body'),
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
        anchor: NO_ANCHOR,
        timers: deps.timers,
      });
      const opened: OpenTab = { root, frames: new Map(), widthDivider };
      openTabs.add(opened);
      const builds = new Map<string, SideBuild>();

      const buildPart = (part: ChatSidePart): SideBuild => {
        const disposes: (() => void)[] = [];
        const wrapper = placeContributedPart(
          holder,
          sessionId,
          framedPart(part, opened.frames),
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
      log('chat', `session hub ${isHidden ? 'hidden' : 'shown'}`);
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

// Takes no key and no focus, so a click leaves the focus where it was.
function sectionHead(toggle: () => void): HTMLButtonElement {
  const head = element('button', 'chat-side-section-head');
  head.type = 'button';
  head.tabIndex = -1;
  head.addEventListener('mousedown', (event) => event.preventDefault());
  head.addEventListener('click', toggle);
  return head;
}
