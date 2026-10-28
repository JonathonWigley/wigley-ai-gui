import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import '../../../../shared/page/ui/tabs.css';
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

// What every sessions kit reads: the page services and the keys export.
export interface SessionsPartsDeps extends OwnerKitServices {
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
  const parts = createLayoutParts<Layout, CompleteLayout>({
    owner: sessionsManifest.id,
    defaultLayout,
    log: deps.log,
  });
  // The kit one part draw builds with. Every sessions prompt has no scope, so
  // it shows in every scope.
  const sessionsKit = (rollback: RollbackDeps): SessionsKit =>
    createBaseKit(ownerBaseKitDeps(sessionsManifest, deps, null, rollback));

  return {
    setLayouts: (shown) => parts.setLayouts(shown),
    sideBar: (parent) =>
      parts.draw('sideBar', parent, (builder, into, rollback) => {
        let sessionEdge: HTMLElement | null = null;
        const base = sessionsKit(rollback);
        const kit: SideBarKit = {
          ...base,
          sessionEdge(edgeParent) {
            sessionEdge = base.el(
              edgeParent,
              'span',
              'ui-key-edge session-edge',
            );
            base.keyHint(sessionEdge, 'prevSession');
            base.chevron(sessionEdge, '▲');
            base.chevron(sessionEdge, '▼');
            base.keyHint(sessionEdge, 'nextSession');
            return sessionEdge;
          },
        };
        const pane = builder(into, kit);
        requireElementIn(pane.element, pane.rows, 'sideBar rows');
        return { element: pane.element, rows: pane.rows, sessionEdge };
      }),
    row: (parent, input) =>
      parts.draw('row', parent, (builder, into, rollback) =>
        builder(into, input, sessionsKit(rollback)),
      ),
    tabBar: (parent) =>
      parts.draw('tabBar', parent, (builder, into, rollback) => {
        const placed: Omit<DrawnTabBar, keyof TabBarPane> = {
          previous: null,
          next: null,
          close: null,
        };
        const base = sessionsKit(rollback);
        const kit: TabBarKit = {
          ...base,
          prevTabEdge(edgeParent) {
            const edge = base.edge(edgeParent, 'prevTab', {
              side: 'end',
              chevron: '‹',
            });
            edge.classList.add('session-tabs-edge');
            placed.previous = edge;
            return edge;
          },
          nextTabEdge(edgeParent) {
            const edge = base.edge(edgeParent, 'nextTab', {
              side: 'start',
              chevron: '›',
            });
            edge.classList.add('session-tabs-edge');
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
      parts.draw('tab', parent, (builder, into, rollback) =>
        builder(into, input, sessionsKit(rollback)),
      ),
    emptyText: (parent, input, pickHint) =>
      parts.draw('emptyText', parent, (builder, into, rollback) => {
        const slot = appSlot(pickHint, 'pickHint', rollback);
        const kit: EmptyTextKit = {
          ...sessionsKit(rollback),
          pickHint: (hintParent) => slot.place(hintParent),
        };
        return builder(into, input, kit);
      }),
  };
}
