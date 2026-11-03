import type { PluginLog } from '../../../../contracts/log';
import {
  PANE_FOCUS_COMMANDS,
  type PaneDirection,
} from '../../../../contracts/panes';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  type ContributedPartsPlace,
  type PartStore,
  placeContributedParts,
} from '../../../../shared/page/contributed-parts';
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
import { iconButton } from '../../../../shared/page/ui/icon-button';
import { keyChevron, keyEdge } from '../../../../shared/page/ui/key-anchors';
import '../../../../shared/page/ui/tabs.css';
import { qualify } from '../../../../shared/plugin-manifests';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  EmptyTextInput,
  EmptyTextKit,
  Layout,
  PaneInput,
  PaneKit,
  PanePart,
  RenameDialogInput,
  RenameDialogKit,
  RowKit,
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
import type { SessionPart } from '../../contract';

type SessionsCommand = keyof typeof sessionsManifest.commands & string;

// What every sessions kit reads: the page services and the keys export;
// `rowParts` holds the parts each row draws, `barParts` the parts each tab bar
// draws.
export interface SessionsPartsDeps extends OwnerKitServices {
  log: PluginLog;
  rowParts: Pick<PartStore<SessionPart>, 'parts'>;
  barParts: Pick<PartStore<SessionPart>, 'parts'>;
}

// A drawn side bar and the session prompt its kit placed, null when the
// layout placed none.
export interface DrawnSideBar extends SideBarPane {
  sessionEdge: HTMLElement | null;
}

// A drawn tab bar and the prompts its kit placed, each null when the layout
// placed none: the tab and close prompts, and the key inside each pane
// control.
export interface DrawnTabBar extends TabBarPane {
  previous: HTMLElement | null;
  next: HTMLElement | null;
  close: HTMLElement | null;
  splitRight: HTMLElement | null;
  splitDown: HTMLElement | null;
  closePane: HTMLElement | null;
}

// Draws each sessions part into `parent` with the user's layout when it
// defines the part, else with `default`, through the layout host. Until the
// first `setLayouts` every part draws with `default`.
export interface SessionsParts {
  setLayouts(shown: ShownLayouts<Layout>): void;
  sideBar(parent: HTMLElement): DrawnPart<DrawnSideBar>;
  row(parent: HTMLElement, input: SessionRowInput): DrawnPart<SessionsPart>;
  pane(parent: HTMLElement, input: PaneInput): DrawnPart<PanePart>;
  // `sessionId` is the session whose frame the bar tops.
  tabBar(parent: HTMLElement, sessionId: string): DrawnPart<DrawnTabBar>;
  tab(parent: HTMLElement, input: SessionTabInput): DrawnPart<SessionsPart>;
  // `pickHint` is the view's own element, which `kit.pickHint` moves in.
  emptyText(
    parent: HTMLElement,
    input: EmptyTextInput,
    pickHint: HTMLElement,
  ): DrawnPart<SessionsPart>;
  // `textBox` is the dialog's own input frame, which `kit.textBox` moves in;
  // the part's element starts with it when the layout leaves it out.
  renameDialog(
    parent: HTMLElement,
    input: RenameDialogInput,
    textBox: HTMLElement,
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
      parts.draw('row', parent, (builder, into, rollback) => {
        let isPlaced = false;
        const kit: RowKit = {
          ...sessionsKit(rollback),
          contributedParts(partsParent) {
            if (isPlaced) {
              throw new Error('row placed contributed parts twice');
            }
            isPlaced = true;
            return placeContributedParts(
              partsParent,
              input.sessionId,
              deps.rowParts.parts(),
              ROW_PARTS,
              deps.log,
              rollback,
            );
          },
        };
        const row = builder(into, input, kit);
        if (!isPlaced && deps.rowParts.parts().length > 0) {
          kit.contributedParts(requireElementIn(into, row.element, 'row'));
        }
        return row;
      }),
    pane: (parent, input) =>
      parts.draw('pane', parent, (builder, into, rollback) => {
        const base = sessionsKit(rollback);
        const kit: PaneKit = {
          ...base,
          focusEdge(edgeParent, direction) {
            const edge = keyEdge(`session-pane-edge is-${direction}`, []);
            edgeParent.append(edge);
            const chevron = keyChevron(PANE_EDGE_CHEVRONS[direction]);
            if (direction === 'left' || direction === 'up') {
              edge.append(chevron);
            }
            base.keyHint(edge, PANE_FOCUS_COMMANDS[direction]);
            base.keyHint(edge, PANE_SWAP_COMMANDS[direction], {
              label: 'swap',
            });
            if (direction === 'right' || direction === 'down') {
              edge.append(chevron);
            }
            return edge;
          },
        };
        const pane = builder(into, input, kit);
        requireElementIn(pane.element, pane.body, 'pane body');
        return { element: pane.element, body: pane.body };
      }),
    tabBar: (parent, sessionId) =>
      parts.draw('tabBar', parent, (builder, into, rollback) => {
        let isPlaced = false;
        const placed: Omit<DrawnTabBar, keyof TabBarPane> = {
          previous: null,
          next: null,
          close: null,
          splitRight: null,
          splitDown: null,
          closePane: null,
        };
        const base = sessionsKit(rollback);
        // A pane control: an icon button running `command` on a click,
        // holding its key; returns the button and the key's element.
        const paneControl = (
          controlParent: HTMLElement,
          iconName: string,
          label: string,
          command: SessionsCommand,
        ) => {
          const control = iconButton(
            iconName,
            label,
            base.command(qualify(sessionsManifest.id, command)),
            'sm',
          );
          control.classList.add('session-pane-control');
          controlParent.append(control);
          return { control, key: base.keyHint(control, command) };
        };
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
            });
            return placed.close;
          },
          splitRightHint(hintParent) {
            const { control, key } = paneControl(
              hintParent,
              'split-horizontal',
              'Split right',
              'splitRight',
            );
            placed.splitRight = key;
            return control;
          },
          splitDownHint(hintParent) {
            const { control, key } = paneControl(
              hintParent,
              'split-vertical',
              'Split down',
              'splitDown',
            );
            placed.splitDown = key;
            return control;
          },
          closePaneHint(hintParent) {
            const { control, key } = paneControl(
              hintParent,
              'close',
              'Close the pane',
              'closePane',
            );
            placed.closePane = key;
            return control;
          },
          contributedParts(partsParent) {
            if (isPlaced) {
              throw new Error('tabBar placed contributed parts twice');
            }
            isPlaced = true;
            return placeContributedParts(
              partsParent,
              sessionId,
              deps.barParts.parts(),
              BAR_PARTS,
              deps.log,
              rollback,
            );
          },
        };
        const pane = builder(into, kit);
        if (!isPlaced && deps.barParts.parts().length > 0) {
          kit.contributedParts(requireElementIn(into, pane.element, 'tabBar'));
        }
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
    renameDialog: (parent, input, textBox) =>
      parts.draw('renameDialog', parent, (builder, into, rollback) => {
        const slot = appSlot(textBox, 'textBox', rollback);
        const kit: RenameDialogKit = {
          ...sessionsKit(rollback),
          textBox: (boxParent) => slot.place(boxParent),
        };
        const body = builder(into, input, kit);
        slot.placeIfLeftOut(
          requireElementIn(into, body.element, 'renameDialog'),
          'start',
        );
        return body;
      }),
  };
}

const ROW_PARTS: ContributedPartsPlace = {
  noun: 'row part',
  holderClass: 'session-row-parts',
  wrapperClass: 'session-row-part',
};

const BAR_PARTS: ContributedPartsPlace = {
  noun: 'bar part',
  holderClass: 'session-bar-parts',
  wrapperClass: 'session-bar-part',
};

// The chevron each pane edge points with.
const PANE_EDGE_CHEVRONS: Record<PaneDirection, string> = {
  left: '‹',
  right: '›',
  up: '▲',
  down: '▼',
};

// The sessions command that swaps the focused pane with the pane each way.
const PANE_SWAP_COMMANDS: Record<PaneDirection, SessionsCommand> = {
  left: 'swapPaneLeft',
  right: 'swapPaneRight',
  up: 'swapPaneUp',
  down: 'swapPaneDown',
};
