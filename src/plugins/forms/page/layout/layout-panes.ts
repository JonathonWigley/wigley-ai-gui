import type { CommandId } from '../../../../contracts/commands';
import type { Disposable } from '../../../../contracts/disposable';
import type { PluginLog } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { OsName } from '../../../../contracts/platform';
import type { LayoutState } from '../../../../contracts/state';
import { errorText } from '../../../../shared/error-text';
import { button, element } from '../../../../shared/page/dom';
import type { KitCommands } from '../../../../shared/page/layout-host/base-kit';
import {
  createMarkdownMount,
  type MarkdownMount,
} from '../../../../shared/page/markdown-mount';
import {
  drawPart,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import {
  type ButtonVariant,
  textButton,
} from '../../../../shared/page/ui/button';
import {
  type CollapsibleCard,
  createCollapsibleCard,
} from '../../../../shared/page/ui/card';
import { row as rowPart } from '../../../../shared/page/ui/row';
import { setDotStatus, statusDot } from '../../../../shared/page/ui/status-dot';
import { tag } from '../../../../shared/page/ui/tag';
import type { KeyHints } from '../../../../contracts/plugin';
import type { FormsItemRef, FormsView } from '../../contract';
import { type FormsCommandName, formsCommand, formsScope } from '../../ids';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  FormsBaseKit,
  LayoutPane,
  NoticesInput,
  NoticesKit,
  RailInput,
  RailKit,
  ReviewInput,
  ReviewKit,
} from '../../layouts/layout';
import {
  answerableItems,
  answerStatus,
  progress,
  type RailItem,
  railItems,
  type RoundState,
  type TextTarget,
} from '../form-state';
import {
  appendBoxKeys,
  buildField,
  roundInfo,
  statusLabel,
} from '../kinds/card-parts';
import { FORMATS, itemLabel } from '../kinds/formats';
import type { CardDeps, ItemCard } from '../kinds/item-format';
import {
  progressText,
  railDotStatus,
  railEntryLabel,
  railEntryTitle,
  type ReviewRow,
  reviewRows,
  reviewRowsChanged,
  reviewSummaryText,
} from '../view-model';
import type { FormsContributions } from '../contributions';
import {
  baseKitDepsFor,
  createFormsBaseKit,
  type ScopedAnchor,
  scopedAnchor,
} from './card-kit';
import { buildLayoutCard, recordingDeps } from './layout-cards';
import type { LayoutPick } from './layout-resolver';

// What a pane reaches outside itself: the markdown renderer, the platform key
// hints are drawn for, the log, the keys bound in a forms scope and the
// anchors that show them, a forms command, the round's text boxes, the
// registered commands `kit.command` checks and runs, which the rail entries
// and review rows run through, the review columns other plugins added, the
// slots `kit.state` reads, where each anchor the kit names and each slot
// subscription a pane makes is recorded, and where each markdown mount it
// makes is recorded for disposal.
export interface PaneDeps {
  markdown: MarkdownRenderer;
  platform: OsName;
  log: PluginLog;
  keys: Pick<KeyHints, 'keysFor' | 'anchor'>;
  run(command: CommandId): void;
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  destroyBox(target: TextTarget): void;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'reviewColumns'>;
  state: LayoutState;
  recordAnchor(anchor: Disposable): void;
  recordMount(mount: MarkdownMount): void;
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
// scrolls into view on a redraw and when `isNewlyShown`.
export interface ReviewPane {
  element: HTMLElement;
  update(round: RoundState, isNewlyShown: boolean): void;
}

type Updater = (round: RoundState) => void;

// The round's rail, drawn into `parent` by drawPart with the picked layout's
// `rail`, or with `default`'s when the pick lacks it or its rail throws. The
// boxes the rail mounts and the anchors it names are recorded for drawPart's
// rollback.
export function buildRailPane(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): RailPane {
  return drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => layout.rail,
    build: (rail, paneParent, rollback) =>
      drawRail(rail, paneParent, round, recordingDeps(deps, rollback)),
    log: deps.log,
    partName: 'rail',
  }).built;
}

// The round's review, drawn into `parent` as buildRailPane draws the rail,
// with the layout's `review`.
export function buildReviewPane(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): ReviewPane {
  return drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => layout.review,
    build: (review, paneParent, rollback) =>
      drawReview(review, paneParent, round, recordingDeps(deps, rollback)),
    log: deps.log,
    partName: 'review',
  }).built;
}

// The round's notices page at rail `position`, drawn into `parent` as
// buildRailPane draws the rail, with the layout's `notices`. Each line's body is
// its notice's card, drawn by buildLayoutCard with `bodyPicks[index - 1]` and
// `cardDeps`; a pane that throws destroys each body it drew through the body's
// own dispose, and `default` draws the pane and its bodies again. `update`
// opens the open lines, marks the cursor line, moves the toggle prompt to it
// and updates each body; it scrolls the cursor line into view when it moved
// since the last update.
export function buildNoticesPane(
  pick: LayoutPick,
  bodyPicks: readonly LayoutPick[],
  parent: HTMLElement,
  round: RoundState,
  position: number,
  deps: PaneDeps,
  cardDeps: CardDeps,
): ItemCard {
  return drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => layout.notices,
    build: (notices, paneParent, rollback) =>
      drawNotices(notices, paneParent, {
        round,
        position,
        bodyPicks,
        deps: recordingDeps(deps, rollback),
        cardDeps,
        rollback,
      }),
    log: deps.log,
    partName: 'notices',
  }).built;
}

// Throws `message` unless `index` is a whole number in [0, `length`).
function requireIndexIn(index: number, length: number, message: string) {
  const isInRange = Number.isInteger(index) && index >= 0 && index < length;
  if (!isInRange) {
    throw new Error(message);
  }
}

// What one draw of the notices pane draws its lines and bodies with: `deps`
// records into the draw's `rollback`, and each body records its dispose there.
interface NoticesDraw {
  round: RoundState;
  position: number;
  bodyPicks: readonly LayoutPick[];
  deps: PaneDeps;
  cardDeps: CardDeps;
  rollback: RollbackDeps;
}

// One notice's line: its collapsible root, the head the layout draws into, and
// the notice card drawn as its body.
interface NoticeLine {
  line: CollapsibleCard;
  head: HTMLElement;
  body: ItemCard;
}

function drawNotices(
  notices: CompleteLayout['notices'],
  parent: HTMLElement,
  draw: NoticesDraw,
): ItemCard {
  const { round, deps } = draw;
  const count = round.round.notices.length;
  const lines = new Map<number, NoticeLine>();
  // The cursor line's prompt, which each update moves to that line's head.
  const togglePrompt = element('span', 'notice-line-prompt');
  scopedAnchor(deps.keys, formsScope('forms'))(
    togglePrompt,
    formsCommand('toggleNotice'),
    { label: 'toggle' },
  );
  const base = createFormsBaseKit(baseKitDepsFor(deps, formsScope('forms')));
  const kit: NoticesKit = {
    ...base,
    line(lineParent, index) {
      requireIndexIn(index - 1, count, `notices pane has no line ${index}`);
      if (lines.has(index)) {
        throw new Error(`notices pane drew line ${index} twice`);
      }
      return drawNoticeLine(lineParent, index, lines, draw, base);
    },
  };
  const input: NoticesInput = {
    round: roundInfo(round.round),
    notices: round.round.notices.map((notice, i) => ({
      index: i + 1,
      label: itemLabel({ kind: 'notice', index: i + 1 }),
      title: notice.title,
      badge: notice.badge,
    })),
  };
  const paneElement = requireElementIn(
    parent,
    (notices(parent, input, kit) as LayoutPane | undefined)?.element,
    'notices',
  );
  for (const notice of input.notices) {
    if (!lines.has(notice.index)) {
      const head = drawNoticeLine(paneElement, notice.index, lines, draw, base);
      const title = element('span', 'notice-line-title', notice.title);
      title.title = notice.title;
      head.append(title);
    }
  }
  let shownLine = round.noticeLine;
  return {
    element: paneElement,
    update(current) {
      for (const [index, { line, body }] of lines) {
        line.setOpen(current.openNotices[index - 1]);
        line.element.classList.toggle(
          'is-cursor',
          current.noticeLine === index,
        );
        body.update(current);
      }
      const cursorLine = lines.get(current.noticeLine);
      cursorLine?.head.append(togglePrompt);
      if (current.noticeLine !== shownLine) {
        shownLine = current.noticeLine;
        cursorLine?.line.element.scrollIntoView({ block: 'nearest' });
      }
    },
  };
}

// Appends notice `index`'s line to `parent`, draws the notice's card into its
// body, records the line in `lines` and returns its head. A head click runs
// `forms.toggleNoticeAt` on the notice through `base`.
function drawNoticeLine(
  parent: HTMLElement,
  index: number,
  lines: Map<number, NoticeLine>,
  draw: NoticesDraw,
  base: FormsBaseKit,
): HTMLElement {
  const { round } = draw;
  const head = element('span', 'notice-line-head');
  // `keepBody` builds the body once, at creation.
  const holder = element('div', 'notice-line-body');
  const line = createCollapsibleCard({
    summary: '',
    plain: true,
    leading: head,
    keepBody: true,
    open: round.openNotices[index - 1],
    onToggle: base.command(formsCommand('toggleNoticeAt'), index),
    body: () => holder,
  });
  line.element.classList.add('notice-line');
  parent.append(line.element);
  const body = buildLayoutCard(
    draw.bodyPicks[index - 1],
    holder,
    round,
    { kind: 'notice', index },
    draw.position,
    draw.cardDeps,
    draw.rollback,
  );
  lines.set(index, { line, head, body });
  return head;
}

function drawRail(
  rail: CompleteLayout['rail'],
  parent: HTMLElement,
  round: RoundState,
  deps: PaneDeps,
): RailPane {
  const items = railItems(round.round);
  const updaters: Updater[] = [];
  const entries = new Map<number, HTMLElement>();
  let shownView: FormsView = 'forms';
  const base = createFormsBaseKit(baseKitDepsFor(deps, formsScope('forms')));
  const kit: RailKit = {
    ...base,
    entry(entryParent, position) {
      requireIndexIn(
        position,
        items.length,
        `rail has no item at position ${position}`,
      );
      const item = items[position];
      const entry = buildRailEntry(
        entryParent,
        round,
        item,
        base.command(formsCommand('pickRailItem'), position),
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
      label: railEntryLabel(item),
      title: railEntryTitle(round.round, item),
    })),
  };
  const paneElement = requireElementIn(
    parent,
    (rail(parent, input, kit) as LayoutPane | undefined)?.element,
    'rail',
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

// An item's row in the rail, and the status dot it leads with.
interface RailEntry {
  element: HTMLElement;
  dot: HTMLElement;
}

// The stop's rail label and title as a list row, its title also the tooltip
// for the ellipsis.
function buildRailEntry(
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  onClick: () => void,
): RailEntry {
  const title = railEntryTitle(round.round, item);
  const dot = statusDot('idle');
  const leading = element('span', 'rail-lead');
  leading.append(dot, element('span', 'rail-number', railEntryLabel(item)));
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

// The focused item's row is selected; while the review shows, untouched
// items are flagged.
function updateRailEntry(
  entry: RailEntry,
  round: RoundState,
  item: RailItem,
  position: number,
  view: FormsView,
) {
  const status =
    item.kind === 'notices'
      ? 'notices'
      : answerStatus(round, { kind: item.kind, index: item.index });
  const isReview = view === 'review';
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
  const anchor = scopedAnchor(deps.keys, formsScope('review'));
  const mount = createMarkdownMount(deps.markdown, deps.log);
  deps.recordMount(mount);
  // The cursor row's prompt, which each draw of the rows moves to that row.
  const jumpPrompt = element('span', 'review-jump-prompt');
  anchor(jumpPrompt, formsCommand('reviewJump'), { label: true });
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
  const base = createFormsBaseKit(baseKitDepsFor(deps, formsScope('review')));
  const kit: ReviewKit = {
    ...base,
    row(rowParent, row) {
      requireIndexIn(row, input.rows.length, `review has no row ${row}`);
      const entry = element('li', 'review-row');
      rowParent.append(entry);
      rowElements.set(row, entry);
      const jump = base.command(formsCommand('reviewJumpAt'), row);
      updaters.push(() => {
        const rows = changedRows;
        if (rows !== null) {
          drawReviewRow(entry, rows[row], {
            roundId: round.formId,
            jump,
            deps,
            mount,
            jumpPrompt,
          });
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
        { command: formsCommand('editNote'), anchor },
      );
      deps.mountBox(note.box, { field: 'note' }, round.note);
      appendBoxKeys(note, anchor);
      return note.element;
    },
    sendButton: (buttonParent) =>
      appendReviewButton(
        buttonParent,
        'Send answers',
        'submit',
        'primary',
        deps,
        anchor,
      ),
    cancelButton: (buttonParent) =>
      appendReviewButton(
        buttonParent,
        'Cancel round',
        'askCancel',
        'secondary',
        deps,
        anchor,
      ),
  };
  const paneElement = requireElementIn(
    parent,
    (review(parent, input, kit) as LayoutPane | undefined)?.element,
    'review',
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
  };
}

// A button running forms `command`, with its anchor in the review scope.
function appendReviewButton(
  parent: HTMLElement,
  label: string,
  command: FormsCommandName,
  variant: ButtonVariant,
  deps: PaneDeps,
  anchor: ScopedAnchor,
): HTMLButtonElement {
  const control = textButton(label, () => deps.run(formsCommand(command)), {
    variant,
  });
  const keys = element('span');
  control.append(keys);
  anchor(keys, formsCommand(command));
  parent.append(control);
  return control;
}

// What a review row draws with besides its row: its round, `jump`, the
// runner of the row's `forms.reviewJumpAt`, the pane's deps, the review's
// markdown mount and the cursor row's jump prompt.
interface ReviewRowDraw {
  roundId: string;
  jump: () => void;
  deps: PaneDeps;
  mount: MarkdownMount;
  jumpPrompt: HTMLElement;
}

// Redraws `entry`'s contents from `row`. A finding's pick reads as its action,
// then its choice, drawn through `mount`, under the number the card gives
// it; a header pick reads as its action alone, and a row with no pick as its
// status. A click on the pick runs `jump`. The cursor's row takes
// `jumpPrompt`, the keys that jump to its item, as clicking it does. The row
// ends with each contributed column's cell.
function drawReviewRow(
  entry: HTMLElement,
  row: ReviewRow,
  { roundId, jump, deps, mount, jumpPrompt }: ReviewRowDraw,
) {
  entry.dataset.status = row.status;
  entry.classList.toggle('is-cursor', row.isCursor);
  const pick = button('review-pick', '', jump);
  const answer = element('span', 'review-answer');
  if (row.actionLabel !== '') {
    answer.append(element('span', 'review-action', row.actionLabel));
    if (row.choice > 0) {
      answer.append(element('span', 'review-separator', '—'));
    }
  }
  if (row.choice > 0) {
    const choiceText = element('span', 'choice-text');
    answer.append(
      element('span', 'choice-number', String(row.entry)),
      choiceText,
    );
    mount.draw(choiceText, deps.markdown.inline(row.choiceText));
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
  if (row.isCursor) {
    pick.append(jumpPrompt);
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
// order, holding its text, with the column's title as its tooltip; a column
// that throws is logged and draws nothing.
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
      cell.title = column.title;
      cells.push(cell);
    } catch (error) {
      deps.log(`review column ${column.id} failed: ${errorText(error)}`);
    }
  }
  return cells;
}
