import type { CommandId } from '../../../../contracts/commands';
import type { Log } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import { errorText } from '../../../../shared/error-text';
import { button, element, markdownElement } from '../../../../shared/page/dom';
import {
  type ButtonVariant,
  textButton,
} from '../../../../shared/page/ui/button';
import { row as rowPart } from '../../../../shared/page/ui/row';
import { setDotStatus, statusDot } from '../../../../shared/page/ui/status-dot';
import { tag } from '../../../../shared/page/ui/tag';
import type { KeysPageExports } from '../../../keys/contract';
import type { FormsItemRef, FormsView } from '../../contract';
import { type FormsCommandName, formsCommand, formsScope } from '../../ids';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  RailInput,
  RailKit,
  ReviewInput,
  ReviewKit,
} from '../../layouts/layout';
import {
  answerableItems,
  answerStatus,
  type FormsAction,
  type FormsState,
  progress,
  type RailItem,
  railItems,
  railPosition,
  type RoundState,
  type TextTarget,
} from '../form-state';
import {
  appendKeyHint,
  buildField,
  keyHint,
  roundInfo,
  statusLabel,
} from '../kinds/card-parts';
import { FORMATS, itemLabel } from '../kinds/formats';
import {
  pickRailItem,
  progressText,
  railDotStatus,
  type ReviewRow,
  reviewRows,
  reviewRowsChanged,
  reviewSummaryText,
} from '../view-model';
import type { FormsContributions } from '../contributions';
import { createUpdatingHeadKit, type HeadKitDeps } from './card-kit';
import type { KitCommands } from './kit-commands';
import { drawRollingBack, requireElementIn } from './layout-cards';
import type { LayoutPick } from './layout-resolver';

// What a pane reaches outside itself: the markdown renderer, the platform key
// hints are drawn for, the log, the keys bound in a forms scope, the forms
// state and its actions, a forms command, the round's text boxes, the view
// last shown, which decides what a rail click does, the registered commands
// `kit.command` checks and runs, and the review columns other plugins added.
export interface PaneDeps {
  markdown: MarkdownRenderer;
  platform: Platform;
  log: Log;
  keys: Pick<KeysPageExports, 'keysFor'>;
  dispatch(action: FormsAction): void;
  getState(): FormsState;
  run(command: CommandId): void;
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  destroyBox(target: TextTarget): void;
  shownView(): FormsView;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'reviewColumns'>;
}

// `update` runs every rail part's updater with the round and the view shown;
// `showEntry` scrolls the entry drawn for rail `position` into view, nothing
// when the rail drew none.
export interface RailPane {
  element: HTMLElement;
  update(round: RoundState, view: FormsView): void;
  showEntry(position: number): void;
}

// `update` runs every review part's updater; the rows redraw only when
// reviewRowsChanged says they differ from the last draw, and the cursor row
// scrolls into view on a redraw and when `isNewlyShown`. `forgetRows` makes
// the next `update` redraw the rows.
export interface ReviewPane {
  element: HTMLElement;
  update(round: RoundState, isNewlyShown: boolean): void;
  forgetRows(): void;
}

type PanePart = 'rail' | 'review';
type Updater = (round: RoundState) => void;

const DEFAULT_NAME = 'default';

// The round's rail, built into `parent` by the picked layout's `rail`; see
// hostPane for the fallback.
export function buildRailPane(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): RailPane {
  return hostPane(
    'rail',
    pick,
    pick.layout.rail,
    defaultLayout.rail,
    parent,
    deps,
    (rail, paneDeps) => drawRail(rail, parent, round, paneDeps),
  );
}

// The round's review, built into `parent` by the picked layout's `review`;
// see hostPane for the fallback.
export function buildReviewPane(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): ReviewPane {
  return hostPane(
    'review',
    pick,
    pick.layout.review,
    defaultLayout.review,
    parent,
    deps,
    (review, paneDeps) => drawReview(review, parent, round, paneDeps),
  );
}

// Draws a pane through `picked`, or through `fallback` when the pick lacks
// the part. When the pane throws, or returns no element appended to `parent`,
// what it appended and the boxes it mounted are removed, the failure is
// logged, and `fallback` draws it in its place. The pane's element carries
// `data-layout` naming the layout that drew it.
function hostPane<F, P extends { element: HTMLElement }>(
  part: PanePart,
  pick: LayoutPick,
  picked: F | undefined,
  fallback: F,
  parent: HTMLElement,
  deps: PaneDeps,
  draw: (pane: F, deps: PaneDeps) => P,
): P {
  const definesPart = typeof picked === 'function';
  let name = definesPart ? pick.name : DEFAULT_NAME;
  let built: P;
  try {
    built = drawRollingBack(parent, deps, (recording) =>
      draw(definesPart ? picked : fallback, recording),
    );
  } catch (error) {
    deps.log('forms', `layout ${name} ${part} failed: ${errorText(error)}`);
    name = DEFAULT_NAME;
    built = drawRollingBack(parent, deps, (recording) =>
      draw(fallback, recording),
    );
  }
  built.element.dataset.layout = name;
  return built;
}

// Throws `message` unless `index` is a whole number in [0, `length`).
function requireIndexIn(index: number, length: number, message: string) {
  const isInRange = Number.isInteger(index) && index >= 0 && index < length;
  if (!isInRange) {
    throw new Error(message);
  }
}

// The head kit's deps over the forms view's keys.
function headDepsOf(deps: PaneDeps): HeadKitDeps {
  return {
    markdown: deps.markdown,
    platform: deps.platform,
    keysFor: (command: CommandId) =>
      deps.keys.keysFor(command, formsScope('forms')),
    commands: deps.commands,
  };
}

function drawRail(
  rail: CompleteLayout['rail'],
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): RailPane {
  const items = railItems(round.round);
  const reviewRowAt = reviewRowsByRailPosition(round);
  const updaters: Updater[] = [];
  const entries = new Map<number, HTMLElement>();
  let shownView: FormsView = 'forms';
  const kit: RailKit = {
    ...createUpdatingHeadKit(headDepsOf(deps), updaters),
    entry(entryParent, position) {
      requireIndexIn(
        position,
        items.length,
        `rail has no item at position ${position}`,
      );
      const item = items[position];
      const entry = buildRailEntry(entryParent, round, item, () =>
        pickRailItem(
          deps,
          deps.shownView(),
          item,
          position,
          reviewRowAt[position],
        ),
      );
      entries.set(position, entry.element);
      updaters.push((current) =>
        updateRailEntry(entry, current, item, position, shownView),
      );
      return entry.element;
    },
  };
  const input: RailInput = {
    round: roundInfo(round.round),
    items: items.map((item, position) => ({
      position,
      kind: item.kind,
      label: itemLabel(item),
      title: FORMATS[item.kind].title(round.round, item.index),
    })),
  };
  const paneElement = requireElementIn(
    rail(parent, input, kit),
    'rail pane',
    parent,
  );
  return {
    element: paneElement,
    update(current, view) {
      shownView = view;
      for (const updater of updaters) {
        updater(current);
      }
    },
    showEntry(position) {
      entries.get(position)?.scrollIntoView({ block: 'nearest' });
    },
  };
}

// Each rail position's review row; undefined at a notice, which has none.
function reviewRowsByRailPosition(round: RoundState): (number | undefined)[] {
  const rows: (number | undefined)[] = [];
  answerableItems(round.round).forEach((item, row) => {
    rows[railPosition(round.round, item)] = row;
  });
  return rows;
}

// An item's row in the rail, and the status dot it leads with.
interface RailEntry {
  element: HTMLElement;
  dot: HTMLElement;
}

// The item's number and title as a list row, its title also the tooltip for
// the ellipsis.
function buildRailEntry(
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  onClick: () => void,
): RailEntry {
  const title = FORMATS[item.kind].title(round.round, item.index);
  const dot = statusDot('idle');
  const leading = element('span', 'rail-lead');
  leading.append(dot, element('span', 'rail-number', itemLabel(item)));
  const entry = rowPart({
    density: 'list',
    tag: 'li',
    label: title,
    leading,
    onClick,
  });
  entry.classList.add('rail-entry');
  entry.title = title;
  parent.append(entry);
  return { element: entry, dot };
}

// The focused item's row is selected; while the review or the cancel prompt
// shows, untouched items are flagged.
function updateRailEntry(
  entry: RailEntry,
  round: RoundState,
  item: RailItem,
  position: number,
  view: FormsView,
) {
  const status =
    item.kind === 'notice'
      ? 'notice'
      : answerStatus(round, { kind: item.kind, index: item.index });
  const isReview = view === 'review' || view === 'confirm';
  const isFlagged = isReview && status === 'untouched';
  entry.element.dataset.status = status;
  entry.element.classList.toggle('is-selected', position === round.focus);
  entry.element.classList.toggle('is-flagged', isFlagged);
  setDotStatus(entry.dot, railDotStatus(status, isFlagged));
}

function drawReview(
  review: CompleteLayout['review'],
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): ReviewPane {
  const updaters: Updater[] = [];
  const rowElements = new Map<number, HTMLElement>();
  let drawn: RoundState | null = null;
  // The rows the latest update redraws; null when they were unchanged.
  let changedRows: ReviewRow[] | null = null;
  let isNoteMounted = false;
  const input: ReviewInput = {
    round: roundInfo(round.round),
    rows: answerableItems(round.round).map((item, row) => ({
      row,
      kind: item.kind,
      label: itemLabel(item),
      title: FORMATS[item.kind].title(round.round, item.index),
    })),
  };
  const kit: ReviewKit = {
    ...createUpdatingHeadKit(headDepsOf(deps), updaters),
    keysFor: (qualifiedId) =>
      deps.keys.keysFor(qualifiedId, formsScope('review')),
    row(rowParent, row) {
      requireIndexIn(row, input.rows.length, `review has no row ${row}`);
      const entry = element('li', 'review-row');
      rowParent.append(entry);
      rowElements.set(row, entry);
      updaters.push(() => {
        const rows = changedRows;
        if (rows !== null) {
          drawReviewRow(entry, rows[row], round.roundId, deps);
        }
      });
      return entry;
    },
    progress(lineParent) {
      const line = element('p', 'round-progress');
      lineParent.append(line);
      updaters.push((current) => {
        line.textContent = progressText(progress(current));
      });
      return line;
    },
    summary(lineParent) {
      const line = element('p', 'review-summary');
      lineParent.append(line);
      updaters.push((current) => {
        line.textContent = reviewSummaryText(progress(current));
      });
      return line;
    },
    roundNote(noteParent) {
      if (isNoteMounted) {
        throw new Error('review pane mounted note twice');
      }
      isNoteMounted = true;
      const note = buildField(
        noteParent,
        'field-note',
        'Round note',
        'Optional. Anything about the round as a whole.',
      );
      deps.mountBox(note.box, { field: 'note' }, round.note);
      return note.element;
    },
    sendButton: (buttonParent) =>
      appendReviewButton(
        buttonParent,
        'Send answers',
        'submit',
        'primary',
        deps,
        updaters,
      ),
    cancelButton: (buttonParent) =>
      appendReviewButton(
        buttonParent,
        'Cancel round',
        'askCancel',
        'secondary',
        deps,
        updaters,
      ),
  };
  const paneElement = requireElementIn(
    review(parent, input, kit),
    'review pane',
    parent,
  );
  if (!isNoteMounted) {
    kit.roundNote(paneElement);
  }
  return {
    element: paneElement,
    update(current, isNewlyShown) {
      const isRowsChanged = reviewRowsChanged(drawn, current);
      changedRows = isRowsChanged ? reviewRows(current) : null;
      if (isRowsChanged) {
        drawn = current;
      }
      for (const updater of updaters) {
        updater(current);
      }
      if (isRowsChanged || isNewlyShown) {
        rowElements
          .get(current.reviewRow)
          ?.scrollIntoView({ block: 'nearest' });
      }
    },
    forgetRows() {
      drawn = null;
    },
  };
}

// The review scope's keys for a forms command; null when unbound there.
function reviewKeysFor(
  deps: PaneDeps,
  command: FormsCommandName,
): string | null {
  return deps.keys.keysFor(formsCommand(command), formsScope('review'));
}

// A button running forms `command`, with the review scope's keys for it,
// redrawn on each update.
function appendReviewButton(
  parent: HTMLElement,
  label: string,
  command: FormsCommandName,
  variant: ButtonVariant,
  deps: PaneDeps,
  updaters: Updater[],
): HTMLButtonElement {
  const control = textButton(label, () => deps.run(formsCommand(command)), {
    variant,
  });
  updaters.push(
    appendKeyHint(control, () => reviewKeysFor(deps, command), deps.platform),
  );
  parent.append(control);
  return control;
}

// Redraws `entry`'s contents from `row`. A finding's pick reads as its action,
// then its choice under the number the card gives it; a header pick reads as
// its action alone, and a row with no pick as its status. The cursor's row
// shows the keys that jump to its item, as clicking it does. The row ends
// with each contributed column's cell.
function drawReviewRow(
  entry: HTMLElement,
  row: ReviewRow,
  roundId: string,
  deps: PaneDeps,
) {
  entry.dataset.status = row.status;
  entry.classList.toggle('is-cursor', row.isCursor);
  const pick = button('review-pick', '', () =>
    deps.dispatch({ type: 'reviewJump', row: row.row }),
  );
  const answer = element('span', 'review-answer');
  if (row.actionLabel !== '') {
    answer.append(element('span', 'review-action', row.actionLabel));
    if (row.choice > 0) {
      answer.append(element('span', 'review-separator', '—'));
    }
  }
  if (row.choice > 0) {
    answer.append(
      element('span', 'choice-number', String(row.entry)),
      markdownElement(
        'span',
        'choice-text',
        deps.markdown.inline(row.choiceText),
      ),
    );
  }
  if (row.recommended) {
    answer.append(tag('Recommended', 'accent'));
  }
  const showsPick = row.actionLabel !== '' || row.choice > 0;
  if (!showsPick) {
    answer.textContent = statusLabel(row.status);
  }
  pick.append(
    element('span', 'review-number', row.label),
    element('span', 'review-question', row.title),
    answer,
  );
  const hint = row.isCursor
    ? keyHint(reviewKeysFor(deps, 'reviewJump'), deps.platform)
    : null;
  if (hint !== null) {
    pick.append(hint);
  }
  const details: HTMLElement[] = [];
  if (row.notes.trim() !== '') {
    details.push(element('p', 'review-detail', `Notes: ${row.notes}`));
  }
  if (row.dontAsk) {
    const reason = row.dontAskReason.trim();
    details.push(
      element(
        'p',
        'review-detail',
        reason === '' ? "Don't ask me this" : `Don't ask me this: ${reason}`,
      ),
    );
  }
  entry.replaceChildren(
    pick,
    ...details,
    ...reviewCells(roundId, { kind: row.kind, index: row.number }, deps),
  );
}

// One `span.review-cell` (`data-column="<id>"`) per contributed column, in add
// order, holding its text; a column that throws is logged and draws nothing.
function reviewCells(
  roundId: string,
  item: FormsItemRef,
  deps: PaneDeps,
): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (const column of deps.contributions.reviewColumns()) {
    try {
      const cell = element('span', 'review-cell', column.cell(roundId, item));
      cell.dataset.column = column.id;
      cells.push(cell);
    } catch (error) {
      deps.log(
        'forms',
        `review column ${column.id} failed: ${errorText(error)}`,
      );
    }
  }
  return cells;
}
