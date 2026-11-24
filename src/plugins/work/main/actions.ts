import {
  cardColumn,
  comparableName,
  namedColumn,
  OTHER_COLUMN,
  type WorkCard,
  type WorkColumnSetting,
  type WorkCommentArg,
  type WorkItem,
  type WorkJiraCard,
  type WorkJob,
  type WorkMoveArg,
  type WorkSendArg,
} from '../contract';
import {
  type DetailCaps,
  newestMessages,
  type SavedSuggestion,
  type WorkFile,
} from './store';

// A press the store applies: the new file, the job it queues (null for none) and the line logged under `[work]`.
export interface ActionResult {
  file: WorkFile;
  job: WorkJob | null;
  log: string;
}

// A press refused, `file` left as it was; `refused` is the text the page toasts.
export interface Refusal {
  refused: string;
}

// How a job ended: `note` is the failure's reason, null for none.
export interface JobEnd {
  ok: boolean;
  note: string | null;
}

export const LOST_JOB_NOTE = 'Its job was lost in a restart.';
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
// The column a local task starts in, matched case-insensitively; the first column when no column has the name.
export const LOCAL_START_COLUMN = 'Todo';

export function isRefusal(result: ActionResult | Refusal): result is Refusal {
  return 'refused' in result;
}

const refuse = (refused: string): Refusal => ({ refused });

const done = (
  file: WorkFile,
  job: WorkJob | null,
  log: string,
): ActionResult => ({ file, job, log });

const isoAt = (epochMs: number) => new Date(epochMs).toISOString();

function withItem(file: WorkFile, changed: WorkItem): WorkFile {
  return {
    ...file,
    items: file.items.map((item) => (item.id === changed.id ? changed : item)),
  };
}

function withCard(file: WorkFile, changed: WorkCard): WorkFile {
  return {
    ...file,
    cards: file.cards.map((card) => (card.id === changed.id ? changed : card)),
  };
}

function withoutSuggestionsOf(file: WorkFile, cardId: string): WorkFile {
  return {
    ...file,
    suggestions: file.suggestions.filter((entry) => entry.cardId !== cardId),
  };
}

// The item `itemId`, or the refusal for it: unknown, or sending (`dismiss`, `snooze` and `send` take no press on a
// sending item).
function pressableItem(file: WorkFile, itemId: string): WorkItem | Refusal {
  const item = file.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return refuse(`No item ${itemId}`);
  }
  if (item.sending !== null) {
    return refuse(`${itemId} is sending`);
  }
  return item;
}

export function dismiss(
  file: WorkFile,
  itemId: string,
): ActionResult | Refusal {
  const item = pressableItem(file, itemId);
  if ('refused' in item) {
    return item;
  }
  if (item.state === 'dismissed') {
    return refuse(`${itemId} is already dismissed`);
  }
  const dismissed: WorkItem = {
    ...item,
    state: 'dismissed',
    snoozedUntil: null,
  };
  return done(withItem(file, dismissed), null, `dismissed ${itemId}`);
}

export function restore(
  file: WorkFile,
  itemId: string,
): ActionResult | Refusal {
  const item = file.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return refuse(`No item ${itemId}`);
  }
  if (item.state === 'open') {
    return refuse(`${itemId} is already open`);
  }
  const restored: WorkItem = { ...item, state: 'open', snoozedUntil: null };
  return done(withItem(file, restored), null, `restored ${itemId}`);
}

// Snoozes an open item until `now` (epoch ms) plus `SNOOZE_MS`.
export function snooze(
  file: WorkFile,
  itemId: string,
  now: number,
): ActionResult | Refusal {
  const item = pressableItem(file, itemId);
  if ('refused' in item) {
    return item;
  }
  if (item.state !== 'open') {
    return refuse('Only an open item snoozes');
  }
  const snoozed: WorkItem = {
    ...item,
    state: 'snoozed',
    snoozedUntil: isoAt(now + SNOOZE_MS),
  };
  return done(withItem(file, snoozed), null, `snoozed ${itemId} for 1 day`);
}

const isSnoozeOver = (item: WorkItem, now: number) =>
  item.state === 'snoozed' &&
  item.snoozedUntil !== null &&
  Date.parse(item.snoozedUntil) <= now;

// Opens each snoozed item whose `snoozedUntil` is at or before `now` (epoch ms); the same object when none is.
export function expireSnoozes(file: WorkFile, now: number): WorkFile {
  if (!file.items.some((item) => isSnoozeOver(item, now))) {
    return file;
  }
  return {
    ...file,
    items: file.items.map((item) =>
      isSnoozeOver(item, now)
        ? { ...item, state: 'open', snoozedUntil: null }
        : item,
    ),
  };
}

// The earliest `snoozedUntil` of a snoozed item, in epoch ms; null when none is snoozed.
export function nextSnoozeEnd(file: WorkFile): number | null {
  let earliest: number | null = null;
  for (const item of file.items) {
    if (item.state !== 'snoozed' || item.snoozedUntil === null) {
      continue;
    }
    const end = Date.parse(item.snoozedUntil);
    if (earliest === null || end < earliest) {
      earliest = end;
    }
  }
  return earliest;
}

// Marks an open item sending `arg.text` and queues its send, or its nudge for a Waiting on others item.
export function send(file: WorkFile, arg: WorkSendArg): ActionResult | Refusal {
  const item = pressableItem(file, arg.itemId);
  if ('refused' in item) {
    return item;
  }
  if (item.state !== 'open') {
    return refuse(`${arg.itemId} is not open`);
  }
  if (arg.text.trim() === '') {
    return refuse('Nothing to send');
  }
  const sending: WorkItem = {
    ...item,
    draft: arg.text,
    sending: arg.text,
    note: null,
  };
  const kind = item.section === 'waiting' ? 'nudge' : 'send';
  return done(
    withItem(file, sending),
    { kind, itemId: item.id, text: arg.text },
    `${kind} queued ${item.id}`,
  );
}

// Adds item `itemId` to the Board as local task `newId`, in the `LOCAL_START_COLUMN` column, else the first.
export function addToBoard(
  file: WorkFile,
  itemId: string,
  newId: string,
  columns: readonly WorkColumnSetting[],
): ActionResult | Refusal {
  const item = file.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return refuse(`No item ${itemId}`);
  }
  const keys = new Set(item.ticketKeys.map((key) => key.toUpperCase()));
  const jiraCard = file.cards.find(
    (card): card is WorkJiraCard =>
      card.kind === 'jira' && keys.has(card.key.toUpperCase()),
  );
  if (jiraCard !== undefined) {
    return refuse(`Already on the board as ${jiraCard.key}`);
  }
  const isAlreadyATask = file.cards.some(
    (card) => card.kind === 'local' && card.sourceItemId === itemId,
  );
  if (isAlreadyATask) {
    return refuse('Already on the board');
  }
  const column = namedColumn(LOCAL_START_COLUMN, columns) ?? columns.at(0);
  if (column === undefined) {
    return refuse('The Board has no columns');
  }
  const task: WorkCard = {
    kind: 'local',
    id: newId,
    title: item.title,
    url: item.url,
    column: column.name,
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt: null,
    sourceItemId: itemId,
  };
  return done(
    { ...file, cards: [...file.cards, task] },
    null,
    `added ${itemId} to the board`,
  );
}

// The refusal of a Jira card's move to `column`, by the first rule it breaks; else the column it moves to.
function jiraMoveTarget(
  card: WorkJiraCard,
  column: string,
  columns: readonly WorkColumnSetting[],
): WorkColumnSetting | Refusal {
  if (comparableName(column) === comparableName(OTHER_COLUMN)) {
    return refuse(`${OTHER_COLUMN} has no Jira status`);
  }
  const target = namedColumn(column, columns);
  if (target === undefined) {
    return refuse(`No column ${column}`);
  }
  if (target.jiraStatuses.length === 0) {
    return refuse(`No Jira status in ${target.name}`);
  }
  if (card.movingTo !== null) {
    return refuse(`Already moving to ${card.movingTo}`);
  }
  if (cardColumn(card, columns) === target.name) {
    return refuse(`Already in ${target.name}`);
  }
  return target;
}

// Moves a local task to `arg.column` at once; marks a Jira card moving there and queues its move job.
export function moveCard(
  file: WorkFile,
  arg: WorkMoveArg,
  columns: readonly WorkColumnSetting[],
  now: number,
): ActionResult | Refusal {
  const card = file.cards.find((candidate) => candidate.id === arg.cardId);
  if (card === undefined) {
    return refuse(`No card ${arg.cardId}`);
  }
  if (card.kind === 'jira') {
    const target = jiraMoveTarget(card, arg.column, columns);
    if ('refused' in target) {
      return target;
    }
    return done(
      withCard(file, { ...card, movingTo: target.name, note: null }),
      { kind: 'move', key: card.key, column: target.name },
      `moving ${card.key} to ${target.name}`,
    );
  }
  const target = namedColumn(arg.column, columns);
  if (target === undefined) {
    return refuse(`No column ${arg.column}`);
  }
  if (comparableName(card.column) === comparableName(target.name)) {
    return refuse(`Already in ${target.name}`);
  }
  return done(
    withCard(file, { ...card, column: target.name, movedAt: isoAt(now) }),
    null,
    `moved ${card.id} to ${target.name}`,
  );
}

const COMMENT_FAILED = 'Comment failed';

// The card's note once the comment flow moves on: a note the comment flow wrote goes, another (a move's) stays.
const noteAfterComment = (card: WorkJiraCard): string | null =>
  card.note?.startsWith(COMMENT_FAILED) === true ? null : card.note;

// Marks a Jira card commenting `arg.text` and queues its comment job; a card in Other or moving takes one too. A text
// equal, trimmed, to one the card is already posting is refused.
export function comment(
  file: WorkFile,
  arg: WorkCommentArg,
): ActionResult | Refusal {
  const card = file.cards.find((candidate) => candidate.id === arg.cardId);
  if (card === undefined) {
    return refuse(`No card ${arg.cardId}`);
  }
  if (card.kind !== 'jira') {
    return refuse('Only a Jira ticket takes a comment');
  }
  const trimmed = arg.text.trim();
  if (trimmed === '') {
    return refuse('Nothing to post');
  }
  if (card.commenting.some((text) => text.trim() === trimmed)) {
    return refuse('Already posting that comment');
  }
  const marked: WorkJiraCard = {
    ...card,
    commenting: [...card.commenting, arg.text],
    note: noteAfterComment(card),
  };
  return done(
    withCard(file, marked),
    { kind: 'comment', key: card.key, text: arg.text },
    `comment queued ${card.key}`,
  );
}

// The card's entry in `file.suggestions` that a press may act on, or its refusal: none, or a `done` entry.
function actionableSuggestion(
  file: WorkFile,
  cardId: string,
): SavedSuggestion | Refusal {
  const entry = file.suggestions.find(
    (candidate) => candidate.cardId === cardId,
  );
  if (entry === undefined) {
    return refuse(`No suggestion for ${cardId}`);
  }
  if (entry.state === 'done') {
    return refuse(`Already in ${entry.column}`);
  }
  return entry;
}

// Moves the card to its suggested column, as `moveCard` does, and drops its suggestion.
export function acceptSuggestion(
  file: WorkFile,
  cardId: string,
  columns: readonly WorkColumnSetting[],
  now: number,
): ActionResult | Refusal {
  const entry = actionableSuggestion(file, cardId);
  if ('refused' in entry) {
    return entry;
  }
  const moved = moveCard(file, { cardId, column: entry.column }, columns, now);
  if (isRefusal(moved)) {
    return moved;
  }
  return { ...moved, file: withoutSuggestionsOf(moved.file, cardId) };
}

// Hides the card's suggestion until a newer signal, or for a session's suggestion until a newer signal of another
// session, replacing any earlier mark of the card.
export function notYet(file: WorkFile, cardId: string): ActionResult | Refusal {
  const entry = actionableSuggestion(file, cardId);
  if ('refused' in entry) {
    return entry;
  }
  const marked: WorkFile = {
    ...file,
    notYet: [
      ...file.notYet.filter((mark) => mark.cardId !== cardId),
      { cardId, signal: entry.signal, at: entry.at, rowId: entry.rowId },
    ],
  };
  return done(withoutSuggestionsOf(marked, cardId), null, `not yet ${cardId}`);
}

// Removes a local task with its Not yet marks and its suggestions.
export function deleteTask(
  file: WorkFile,
  cardId: string,
): ActionResult | Refusal {
  const card = file.cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    return refuse(`No card ${cardId}`);
  }
  if (card.kind === 'jira') {
    return refuse('Only a local task can be deleted');
  }
  const removed: WorkFile = {
    ...file,
    cards: file.cards.filter((candidate) => candidate.id !== cardId),
    notYet: file.notYet.filter((mark) => mark.cardId !== cardId),
  };
  return done(withoutSuggestionsOf(removed, cardId), null, `deleted ${cardId}`);
}

function sendEnded(file: WorkFile, itemId: string, end: JobEnd): WorkFile {
  const item = file.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return file;
  }
  if (end.ok) {
    const state = item.state === 'open' ? 'cleared' : item.state;
    return withItem(file, { ...item, state, sending: null, note: null });
  }
  const note = end.note === null ? 'Send failed' : `Send failed: ${end.note}`;
  return withItem(file, { ...item, sending: null, note });
}

function moveEnded(file: WorkFile, key: string, end: JobEnd): WorkFile {
  const card = file.cards.find(
    (candidate): candidate is WorkJiraCard =>
      candidate.kind === 'jira' && candidate.key === key,
  );
  if (card === undefined) {
    return file;
  }
  const note = end.ok ? null : (end.note ?? 'Move failed');
  return withCard(file, { ...card, movingTo: null, note });
}

type WorkCommentJob = Extract<WorkJob, { kind: 'comment' }>;

// The card's first `commenting` entry equal to the job's text goes; on success a note the comment flow wrote goes and
// the stored ticket detail, when there is one, gains the comment as the user's, kept to the newest `caps.comments`.
function commentEnded(
  file: WorkFile,
  job: WorkCommentJob,
  end: JobEnd,
  now: number,
  caps: DetailCaps,
): WorkFile {
  const card = file.cards.find(
    (candidate): candidate is WorkJiraCard =>
      candidate.kind === 'jira' && candidate.key === job.key,
  );
  if (card === undefined) {
    return file;
  }
  const index = card.commenting.indexOf(job.text);
  const commenting =
    index === -1
      ? card.commenting
      : card.commenting.filter((_, at) => at !== index);
  if (!end.ok) {
    const note =
      end.note === null ? COMMENT_FAILED : `${COMMENT_FAILED}: ${end.note}`;
    return withCard(file, { ...card, commenting, note });
  }
  const posted = withCard(file, {
    ...card,
    commenting,
    note: noteAfterComment(card),
  });
  const stored = file.details[job.key];
  if (stored?.kind !== 'ticket') {
    return posted;
  }
  const comments = newestMessages(
    [...stored.comments, { author: 'You', at: isoAt(now), text: job.text }],
    caps.comments,
  );
  return {
    ...posted,
    details: { ...posted.details, [job.key]: { ...stored, comments } },
  };
}

// The store side of a job's end, at `now` (epoch ms): a send or nudge clears its item's `sending` (clearing the item
// on success, noting the failure otherwise), a move clears its card's `movingTo`, a comment drops its text from its
// card's `commenting` (adding it to the stored ticket detail within `caps` on success, noting the failure otherwise),
// a sweep expires snoozes. The same object when its item or card is gone.
export function jobEnded(
  file: WorkFile,
  job: WorkJob,
  end: JobEnd,
  now: number,
  caps: DetailCaps,
): WorkFile {
  switch (job.kind) {
    case 'send':
    case 'nudge':
      return sendEnded(file, job.itemId, end);
    case 'move':
      return moveEnded(file, job.key, end);
    case 'comment':
      return commentEnded(file, job, end, now, caps);
    case 'sweep':
      return expireSnoozes(file, now);
  }
}

// The entries of `commenting` that each have a text of their own in `jobTexts`, in order; `commenting` itself when
// every entry has one.
function commentingWithJobs(
  commenting: readonly string[],
  jobTexts: readonly string[],
): readonly string[] {
  const unmatched = [...jobTexts];
  const kept = commenting.filter((text) => {
    const index = unmatched.indexOf(text);
    if (index === -1) {
      return false;
    }
    unmatched.splice(index, 1);
    return true;
  });
  return kept.length === commenting.length ? commenting : kept;
}

// Clears each `sending` and `movingTo` mark, and each `commenting` entry, that no job in `pending` (the runner's
// running job, then its queued ones) holds, noting the job lost; a comment's note wins over a move's on one card. Two
// equal comment texts need two jobs. The same object when every mark has its job.
export function clearStaleMarks(
  file: WorkFile,
  pending: readonly WorkJob[],
): WorkFile {
  const sendingIds = new Set<string>();
  const movingKeys = new Set<string>();
  const commentTexts = new Map<string, string[]>();
  for (const job of pending) {
    if (job.kind === 'send' || job.kind === 'nudge') {
      sendingIds.add(job.itemId);
    } else if (job.kind === 'move') {
      movingKeys.add(job.key);
    } else if (job.kind === 'comment') {
      commentTexts.set(job.key, [
        ...(commentTexts.get(job.key) ?? []),
        job.text,
      ]);
    }
  }
  const isStaleSend = (item: WorkItem) =>
    item.sending !== null && !sendingIds.has(item.id);
  const isStaleMove = (card: WorkCard) =>
    card.movingTo !== null &&
    !(card.kind === 'jira' && movingKeys.has(card.key));
  const clearedCard = (card: WorkCard): WorkCard => {
    const moved: WorkCard = isStaleMove(card)
      ? { ...card, movingTo: null, note: LOST_JOB_NOTE }
      : card;
    if (moved.kind !== 'jira') {
      return moved;
    }
    const commenting = commentingWithJobs(
      moved.commenting,
      commentTexts.get(moved.key) ?? [],
    );
    return commenting === moved.commenting
      ? moved
      : { ...moved, commenting, note: `${COMMENT_FAILED}: ${LOST_JOB_NOTE}` };
  };
  const items = file.items.map((item) =>
    isStaleSend(item)
      ? { ...item, sending: null, note: `Send failed: ${LOST_JOB_NOTE}` }
      : item,
  );
  const cards = file.cards.map(clearedCard);
  const isUnchanged =
    items.every((item, index) => item === file.items[index]) &&
    cards.every((card, index) => card === file.cards[index]);
  return isUnchanged ? file : { ...file, items, cards };
}
