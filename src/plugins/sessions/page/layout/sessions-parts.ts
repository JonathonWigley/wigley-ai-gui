import type { PluginLog } from '../../../../contracts/log';
import {
  PANE_FOCUS_COMMANDS,
  type PaneDirection,
} from '../../../../contracts/panes';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { errorText } from '../../../../shared/error-text';
import {
  type ContributedPartsPlace,
  type PartStore,
  placeContributedPart,
  placeContributedParts,
} from '../../../../shared/page/contributed-parts';
import { element } from '../../../../shared/page/dom';
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
  GroupInput,
  GroupKit,
  GroupPane,
  Layout,
  PaneInput,
  PaneKit,
  PopupBarInput,
  PopupBarKit,
  PopupBarPart,
  PopupInput,
  PopupPart,
  RenameDialogInput,
  RenameDialogKit,
  RowKit,
  SectionInput,
  SectionKit,
  SectionPane,
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
import type { SectionPart, SessionPart } from '../../contract';

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

// A drawn group and the star its kit placed, null when the layout placed none.
export interface DrawnGroup extends GroupPane {
  favoriteToggle: HTMLElement | null;
}

// A drawn pane: its root and body, and `update`, which applies a new input in
// place, false when the layout has no `update` or it threw.
export interface DrawnPanePart {
  element: HTMLElement;
  body: HTMLElement;
  update(input: PaneInput): boolean;
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
  // Its element carries `is-empty` while `input.isEmpty`. `header` is the
  // plugin section's header part, which `kit.headerPart` builds; null for none.
  section(
    parent: HTMLElement,
    input: SectionInput,
    header: SectionPart | null,
  ): DrawnPart<SectionPane>;
  group(parent: HTMLElement, input: GroupInput): DrawnPart<DrawnGroup>;
  row(parent: HTMLElement, input: SessionRowInput): DrawnPart<SessionsPart>;
  pane(parent: HTMLElement, input: PaneInput): DrawnPart<DrawnPanePart>;
  // `sessionId` is the session whose frame the bar tops.
  tabBar(parent: HTMLElement, sessionId: string): DrawnPart<DrawnTabBar>;
  tab(parent: HTMLElement, input: SessionTabInput): DrawnPart<SessionsPart>;
  popup(parent: HTMLElement, input: PopupInput): DrawnPart<PopupPart>;
  popupBar(parent: HTMLElement, input: PopupBarInput): DrawnPart<PopupBarPart>;
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
    section: (parent, input, header) =>
      parts.draw('section', parent, (builder, into, rollback) => {
        let isPlaced = false;
        const kit: SectionKit = {
          ...sessionsKit(rollback),
          headerPart(partParent) {
            if (isPlaced) {
              throw new Error('headerPart placed twice');
            }
            isPlaced = true;
            if (header === null) {
              const empty = element('div', SECTION_PART.wrapperClass);
              empty.dataset.part = input.id;
              partParent.append(empty);
              return empty;
            }
            const placed = placeContributedPart(
              partParent,
              input.id,
              { id: input.id, build: (wrapper) => header.build(wrapper) },
              SECTION_PART,
              deps.log,
              rollback,
            );
            // A build that threw left no div in `partParent`.
            return placed ?? element('div', SECTION_PART.wrapperClass);
          },
        };
        const pane = builder(into, input, kit);
        requireElementIn(pane.element, pane.groups, 'section groups');
        pane.element.classList.toggle('is-empty', input.isEmpty);
        return { element: pane.element, groups: pane.groups };
      }),
    group: (parent, input) =>
      parts.draw('group', parent, (builder, into, rollback) => {
        let favoriteToggle: HTMLElement | null = null;
        let grip: HTMLElement | null = null;
        const base = sessionsKit(rollback);
        const kit: GroupKit = {
          ...base,
          favoriteToggle(toggleParent) {
            if (favoriteToggle !== null) {
              throw new Error('favoriteToggle placed twice');
            }
            favoriteToggle = iconButton(
              input.isFavorite ? 'star-full' : 'star-empty',
              input.isFavorite ? 'Unfavorite' : 'Favorite',
              () => undefined,
              'sm',
            );
            favoriteToggle.classList.add('session-group-star');
            favoriteToggle.classList.toggle('is-active', input.isFavorite);
            toggleParent.append(favoriteToggle);
            return favoriteToggle;
          },
          dragHandle(gripParent) {
            if (grip !== null) {
              throw new Error('dragHandle placed twice');
            }
            grip = base.el(gripParent, 'span', 'session-group-grip');
            base.icon(grip, 'gripper');
            return grip;
          },
        };
        const pane = builder(into, input, kit);
        requireElementIn(pane.element, pane.header, 'group header');
        requireElementIn(pane.element, pane.rows, 'group rows');
        return {
          element: pane.element,
          header: pane.header,
          rows: pane.rows,
          favoriteToggle,
        };
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
        return {
          element: pane.element,
          body: pane.body,
          update(next) {
            if (pane.update === undefined) {
              return false;
            }
            try {
              pane.update(next);
              return true;
            } catch (error) {
              deps.log(`pane update failed: ${errorText(error)}`);
              return false;
            }
          },
        };
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
        // A split prompt: the command's key alone, faint, its action in the
        // tooltip.
        const splitHint = (
          hintParent: HTMLElement,
          command: SessionsCommand,
          label: string,
        ) => {
          const hint = base.keyHint(hintParent, command, {
            className: 'session-split-hint',
          });
          hint.title = label;
          return hint;
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
            placed.splitRight = splitHint(
              hintParent,
              'splitRight',
              'Split right',
            );
            return placed.splitRight;
          },
          splitDownHint(hintParent) {
            placed.splitDown = splitHint(hintParent, 'splitDown', 'Split down');
            return placed.splitDown;
          },
          closePaneHint(hintParent) {
            const { control, key } = paneControl(
              hintParent,
              'chrome-close',
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
    popup: (parent, input) =>
      parts.draw('popup', parent, (builder, into, rollback) => {
        const popup = builder(into, input, sessionsKit(rollback));
        requireElementIn(popup.element, popup.body, 'popup body');
        return { element: popup.element, body: popup.body };
      }),
    popupBar: (parent, input) =>
      parts.draw('popupBar', parent, (builder, into, rollback) => {
        const base = sessionsKit(rollback);
        const kit: PopupBarKit = {
          ...base,
          toggleHint(hintParent) {
            base.keyHint(hintParent, 'togglePopup');
          },
        };
        const bar = builder(into, input, kit);
        if (bar.entries.length !== input.entries.length) {
          throw new Error(
            `popupBar drew ${bar.entries.length} entries for ${input.entries.length} popups`,
          );
        }
        for (const entry of bar.entries) {
          requireElementIn(bar.element, entry, 'popupBar entry');
        }
        return { element: bar.element, entries: [...bar.entries] };
      }),
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

// The one part a plugin section draws at its header's end.
const SECTION_PART: ContributedPartsPlace = {
  noun: 'section part',
  holderClass: 'session-section-parts',
  wrapperClass: 'session-section-part',
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
