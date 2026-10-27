import type { Log } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  type BaseKitDeps,
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import { pickLayout } from '../../../../shared/page/layout-host/pick';
import { keyChevron, keyEdge } from '../../../../shared/page/ui/key-anchors';
import '../../../../shared/page/ui/tabs.css';
import { qualify } from '../../../../shared/plugin-manifests';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  EmptyTextInput,
  EmptyTextKit,
  Layout,
  SessionRowInput,
  SessionsKit,
  SessionsPart,
  SessionTabInput,
  SideBarKit,
  SideBarPane,
  TabBarKit,
  TabBarPane,
} from '../../layouts/layout';
import { sessionsManifest } from '../../manifest';

const OWNER = 'sessions';
const DEFAULT_LAYOUT = 'default';

// What every sessions kit reads: the page services and the keys export.
export interface SessionsPartsDeps {
  markdown: MarkdownRenderer;
  keys: BaseKitDeps['keys'];
  commands: KitCommands;
  platform: Platform;
  log: Log;
}

// A drawn side bar and the session prompt its kit placed, null when the
// layout placed none.
export interface DrawnSideBar extends SideBarPane {
  sessionEdge: HTMLElement | null;
}

// A drawn tab bar and the prompts its kit placed, each null when the layout
// placed none.
export interface DrawnTabBar extends TabBarPane {
  previous: HTMLElement | null;
  next: HTMLElement | null;
  close: HTMLElement | null;
}

// Draws each sessions part into `parent` with the user's layout when it
// defines the part, else with `default`, through the layout host. Until the
// first `setLayouts` every part draws with `default`.
export interface SessionsParts {
  setLayouts(shown: ShownLayouts<Layout>): void;
  sideBar(parent: HTMLElement): DrawnPart<DrawnSideBar>;
  row(parent: HTMLElement, input: SessionRowInput): DrawnPart<SessionsPart>;
  tabBar(parent: HTMLElement): DrawnPart<DrawnTabBar>;
  tab(parent: HTMLElement, input: SessionTabInput): DrawnPart<SessionsPart>;
  // `pickHint` is the view's own element, which `kit.pickHint` moves in.
  emptyText(
    parent: HTMLElement,
    input: EmptyTextInput,
    pickHint: HTMLElement,
  ): DrawnPart<SessionsPart>;
}

export function createSessionsParts(deps: SessionsPartsDeps): SessionsParts {
  let shown: ShownLayouts<Layout> = {
    layouts: new Map([[DEFAULT_LAYOUT, defaultLayout]]),
    user: DEFAULT_LAYOUT,
  };

  const draw = <P extends keyof CompleteLayout, R extends SessionsPart>(
    part: P,
    parent: HTMLElement,
    build: (
      builder: CompleteLayout[P],
      into: HTMLElement,
      rollback: RollbackDeps,
    ) => R,
  ): DrawnPart<R> =>
    drawPart<Layout, CompleteLayout[P], R>({
      owner: OWNER,
      parent,
      pick: pickLayout(
        [shown.user, DEFAULT_LAYOUT],
        shown.layouts,
        (layout) => layout[part] !== undefined,
      ),
      defaultLayout,
      // TypeScript cannot relate a `Partial` layout's part to the complete one's.
      part: (layout) => layout[part] as CompleteLayout[P] | undefined,
      build,
      log: deps.log,
      logSource: OWNER,
      partName: part,
    });

  return {
    setLayouts(next) {
      shown = next;
    },
    sideBar: (parent) =>
      draw('sideBar', parent, (builder, into, rollback) => {
        let sessionEdge: HTMLElement | null = null;
        const base = sessionsKit(deps, rollback);
        const kit: SideBarKit = {
          ...base,
          sessionEdge(edgeParent) {
            sessionEdge = appended(edgeParent, keyEdge('session-edge', []));
            base.keyHint(sessionEdge, 'prevSession');
            sessionEdge.append(keyChevron('▲'), keyChevron('▼'));
            base.keyHint(sessionEdge, 'nextSession');
            return sessionEdge;
          },
        };
        const pane = builder(into, kit);
        requireElementIn(pane.element, pane.rows, 'sideBar rows');
        return { element: pane.element, rows: pane.rows, sessionEdge };
      }),
    row: (parent, input) =>
      draw('row', parent, (builder, into, rollback) =>
        builder(into, input, sessionsKit(deps, rollback)),
      ),
    tabBar: (parent) =>
      draw('tabBar', parent, (builder, into, rollback) => {
        const placed: Omit<DrawnTabBar, keyof TabBarPane> = {
          previous: null,
          next: null,
          close: null,
        };
        const base = sessionsKit(deps, rollback);
        const kit: TabBarKit = {
          ...base,
          prevTabEdge(edgeParent) {
            const edge = appended(edgeParent, keyEdge('session-tabs-edge', []));
            base.keyHint(edge, 'prevTab');
            edge.append(keyChevron('‹'));
            placed.previous = edge;
            return edge;
          },
          nextTabEdge(edgeParent) {
            const edge = appended(edgeParent, keyEdge('session-tabs-edge', []));
            edge.append(keyChevron('›'));
            base.keyHint(edge, 'nextTab');
            placed.next = edge;
            return edge;
          },
          closeHint(hintParent) {
            placed.close = base.keyHint(hintParent, 'closeSession', {
              className: 'session-tabs-close',
              label: 'close',
            });
            return placed.close;
          },
        };
        const pane = builder(into, kit);
        requireElementIn(pane.element, pane.strip, 'tabBar strip');
        return { element: pane.element, strip: pane.strip, ...placed };
      }),
    tab: (parent, input) =>
      draw('tab', parent, (builder, into, rollback) =>
        builder(into, input, sessionsKit(deps, rollback)),
      ),
    emptyText: (parent, input, pickHint) =>
      draw('emptyText', parent, (builder, into, rollback) => {
        const kit: EmptyTextKit = {
          ...sessionsKit(deps, rollback),
          pickHint: (hintParent) => appended(hintParent, pickHint),
        };
        return builder(into, input, kit);
      }),
  };
}

// Makes a part's root run `onClick` on a click without taking focus, as a
// clickable `.ui-row` or a `.ui-tab` does.
export function onPartClick(root: HTMLElement, onClick: () => void): void {
  root.addEventListener('mousedown', (event) => event.preventDefault());
  root.addEventListener('click', onClick);
}

// The kit one part draw builds with. Every sessions prompt has no scope, so it
// shows in every scope; each key anchor it names is recorded through
// `rollback`, so the draw's dispose disposes it.
function sessionsKit(
  deps: SessionsPartsDeps,
  rollback: RollbackDeps,
): SessionsKit {
  return createBaseKit({
    markdown: deps.markdown,
    keys: {
      anchor(target, command, options) {
        const anchor = deps.keys.anchor(target, command, options);
        rollback.recordAnchor(anchor);
        return anchor;
      },
      keysFor: (command, scope) => deps.keys.keysFor(command, scope),
    },
    commands: deps.commands,
    scope: null,
    commandNamed: (short) =>
      Object.hasOwn(sessionsManifest.commands, short)
        ? qualify(OWNER, short)
        : null,
    platform: deps.platform,
  });
}

function appended<E extends HTMLElement>(parent: HTMLElement, node: E): E {
  parent.append(node);
  return node;
}
