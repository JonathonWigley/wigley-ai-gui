import { describe, expect, it } from 'vitest';
import type {
  DetailMessage,
  WorkCard,
  WorkColumnSetting,
  WorkItem,
  WorkJob,
} from '../contract';
import {
  jiraCard,
  localCard,
  ticketDetail,
  workItem,
} from '../contract.test-support';
import {
  type ActionResult,
  acceptSuggestion,
  addToBoard,
  clearStaleMarks,
  comment,
  deleteTask,
  dismiss,
  expireSnoozes,
  type JobEnd,
  jobEnded,
  LOST_JOB_NOTE,
  moveCard,
  nextSnoozeEnd,
  notYet,
  type Refusal,
  restore,
  send,
  snooze,
} from './actions';
import {
  type DetailCaps,
  EMPTY_WORK_FILE,
  type SavedSuggestion,
  type WorkFile,
} from './store';

const NOW = Date.parse('2026-11-23T12:00:00.123Z');
const NOW_ISO = '2026-11-23T12:00:00.123Z';
const CAPS: DetailCaps = { comments: 2, replies: 3 };
const COMMENT_LOST_NOTE = `Comment failed: ${LOST_JOB_NOTE}`;

const COLUMNS: WorkColumnSetting[] = [
  { name: 'Backlog', jiraStatuses: ['Backlog'] },
  { name: 'Todo', jiraStatuses: ['To Do'] },
  { name: 'In Progress', jiraStatuses: ['In Progress'] },
  { name: 'In QA', jiraStatuses: ['In QA', 'In Review'] },
  { name: 'Blocked', jiraStatuses: [] },
];

function fileWith(parts: Partial<WorkFile> = {}): WorkFile {
  return { ...EMPTY_WORK_FILE, ...parts };
}

const ofItems = (...items: WorkItem[]) => fileWith({ items });
const ofCards = (...cards: WorkCard[]) => fileWith({ cards });

const result = (
  file: WorkFile,
  job: WorkJob | null,
  log: string,
): ActionResult => ({ file, job, log });
const refused = (text: string): Refusal => ({ refused: text });

function suggestion(
  cardId: string,
  overrides: Partial<SavedSuggestion> = {},
): SavedSuggestion {
  return {
    cardId,
    signal: 'branch',
    column: 'In Progress',
    reason: `Branch ${cardId.toLowerCase()}-fix in repo`,
    at: '2026-11-23T09:00:00.000Z',
    state: 'suggested',
    rowId: null,
    ...overrides,
  };
}

// An open Needs you item `p1` with `overrides` laid over it.
const p1 = (overrides: Partial<WorkItem> = {}) => workItem('p1', overrides);

describe('dismiss', () => {
  it.each<{
    name: string;
    item: WorkItem;
    id?: string;
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'open',
      item: p1(),
      expected: result(
        ofItems(p1({ state: 'dismissed' })),
        null,
        'dismissed p1',
      ),
    },
    {
      name: 'snoozed',
      item: p1({ state: 'snoozed', snoozedUntil: '2026-11-24T00:00:00.000Z' }),
      expected: result(
        ofItems(p1({ state: 'dismissed' })),
        null,
        'dismissed p1',
      ),
    },
    {
      name: 'cleared',
      item: p1({ state: 'cleared' }),
      expected: result(
        ofItems(p1({ state: 'dismissed' })),
        null,
        'dismissed p1',
      ),
    },
    {
      name: 'dismissed',
      item: p1({ state: 'dismissed' }),
      expected: refused('p1 is already dismissed'),
    },
    {
      name: 'sending',
      item: p1({ sending: 'On it' }),
      expected: refused('p1 is sending'),
    },
    {
      name: 'unknown id',
      item: p1(),
      id: 'p9',
      expected: refused('No item p9'),
    },
  ])('dismiss ($name)', ({ item, id, expected }) => {
    expect(dismiss(ofItems(item), id ?? 'p1')).toEqual(expected);
  });
});

describe('restore', () => {
  it.each<{ name: string; item: WorkItem; expected: ActionResult | Refusal }>([
    {
      name: 'cleared',
      item: p1({ state: 'cleared' }),
      expected: result(ofItems(p1()), null, 'restored p1'),
    },
    {
      name: 'dismissed',
      item: p1({ state: 'dismissed' }),
      expected: result(ofItems(p1()), null, 'restored p1'),
    },
    {
      name: 'snoozed',
      item: p1({ state: 'snoozed', snoozedUntil: '2026-11-24T00:00:00.000Z' }),
      expected: result(ofItems(p1()), null, 'restored p1'),
    },
    { name: 'open', item: p1(), expected: refused('p1 is already open') },
    {
      name: 'sending',
      item: p1({ sending: 'On it' }),
      expected: refused('p1 is already open'),
    },
  ])('restore ($name)', ({ item, expected }) => {
    expect(restore(ofItems(item), 'p1')).toEqual(expected);
  });
});

describe('snooze', () => {
  it.each<{ name: string; item: WorkItem; expected: ActionResult | Refusal }>([
    {
      name: 'open',
      item: p1(),
      expected: result(
        ofItems(
          p1({ state: 'snoozed', snoozedUntil: '2026-11-24T12:00:00.123Z' }),
        ),
        null,
        'snoozed p1 for 1 day',
      ),
    },
    {
      name: 'cleared',
      item: p1({ state: 'cleared' }),
      expected: refused('Only an open item snoozes'),
    },
    {
      name: 'snoozed',
      item: p1({ state: 'snoozed', snoozedUntil: '2026-11-24T00:00:00.000Z' }),
      expected: refused('Only an open item snoozes'),
    },
    {
      name: 'sending',
      item: p1({ sending: 'On it' }),
      expected: refused('p1 is sending'),
    },
  ])('snooze ($name)', ({ item, expected }) => {
    expect(snooze(ofItems(item), 'p1', NOW)).toEqual(expected);
  });
});

describe('expireSnoozes', () => {
  const snoozedUntil = (id: string, at: string) =>
    workItem(id, { state: 'snoozed', snoozedUntil: at });

  it('opens each snooze at or before now', () => {
    const before = snoozedUntil('a', '2026-11-23T12:00:00.124Z');
    const file = ofItems(
      before,
      snoozedUntil('b', NOW_ISO),
      snoozedUntil('c', '2026-11-23T12:00:00.122Z'),
    );

    expect(expireSnoozes(file, NOW)).toEqual(
      ofItems(before, workItem('b'), workItem('c')),
    );
  });

  it('gives the same object back when none expired', () => {
    const file = ofItems(
      snoozedUntil('a', '2026-11-23T12:00:00.124Z'),
      workItem('b'),
    );

    expect(expireSnoozes(file, NOW)).toBe(file);
  });

  it.each<{ name: string; items: WorkItem[]; end: number | null }>([
    {
      name: 'the earliest snooze',
      items: [
        snoozedUntil('a', '2026-11-25T00:00:00.000Z'),
        snoozedUntil('b', '2026-11-24T00:00:00.000Z'),
        workItem('c'),
      ],
      end: Date.parse('2026-11-24T00:00:00.000Z'),
    },
    { name: 'none snoozed', items: [workItem('c')], end: null },
  ])('nextSnoozeEnd ($name)', ({ items, end }) => {
    expect(nextSnoozeEnd(ofItems(...items))).toBe(end);
  });
});

describe('send', () => {
  it.each<{
    name: string;
    item: WorkItem;
    text: string;
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a needs_you item queues a send',
      item: p1({ note: 'Send failed: x' }),
      text: '  On it',
      expected: result(
        ofItems(p1({ draft: '  On it', sending: '  On it' })),
        { kind: 'send', itemId: 'p1', text: '  On it' },
        'send queued p1',
      ),
    },
    {
      name: 'a waiting item queues a nudge',
      item: p1({ section: 'waiting', draft: 'Any news?' }),
      text: 'Any news on this?',
      expected: result(
        ofItems(
          p1({
            section: 'waiting',
            draft: 'Any news on this?',
            sending: 'Any news on this?',
          }),
        ),
        { kind: 'nudge', itemId: 'p1', text: 'Any news on this?' },
        'nudge queued p1',
      ),
    },
    {
      name: 'blank text',
      item: p1(),
      text: ' \n ',
      expected: refused('Nothing to send'),
    },
    {
      name: 'a cleared item',
      item: p1({ state: 'cleared' }),
      text: 'On it',
      expected: refused('p1 is not open'),
    },
    {
      name: 'a sending item',
      item: p1({ sending: 'On it' }),
      text: 'Again',
      expected: refused('p1 is sending'),
    },
  ])('send ($name)', ({ item, text, expected }) => {
    expect(send(ofItems(item), { itemId: 'p1', text })).toEqual(expected);
  });
});

describe('addToBoard', () => {
  const item = p1({ ticketKeys: ['abc-12'] });
  const task = (column: string) =>
    localCard('local-1', column, {
      title: item.title,
      url: item.url,
      sourceItemId: 'p1',
    });

  it.each<{
    name: string;
    cards: WorkCard[];
    columns: WorkColumnSetting[];
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a new local task in Todo',
      cards: [jiraCard('XYZ-1', 'To Do')],
      columns: COLUMNS,
      expected: result(
        fileWith({
          items: [item],
          cards: [jiraCard('XYZ-1', 'To Do'), task('Todo')],
        }),
        null,
        'added p1 to the board',
      ),
    },
    {
      name: 'a column named todo in another case',
      cards: [],
      columns: [
        { name: 'Later', jiraStatuses: [] },
        { name: ' TODO ', jiraStatuses: [] },
      ],
      expected: result(
        fileWith({ items: [item], cards: [task(' TODO ')] }),
        null,
        'added p1 to the board',
      ),
    },
    {
      name: 'the first column when no Todo exists',
      cards: [],
      columns: [
        { name: 'Doing', jiraStatuses: [] },
        { name: 'Done', jiraStatuses: [] },
      ],
      expected: result(
        fileWith({ items: [item], cards: [task('Doing')] }),
        null,
        'added p1 to the board',
      ),
    },
    {
      name: 'an existing Jira card',
      cards: [jiraCard('ABC-12', 'To Do')],
      columns: COLUMNS,
      expected: refused('Already on the board as ABC-12'),
    },
    {
      name: 'a second add',
      cards: [localCard('local-0', 'Backlog', { sourceItemId: 'p1' })],
      columns: COLUMNS,
      expected: refused('Already on the board'),
    },
    {
      name: 'no columns',
      cards: [],
      columns: [],
      expected: refused('The Board has no columns'),
    },
  ])('addToBoard ($name)', ({ cards, columns, expected }) => {
    expect(
      addToBoard(fileWith({ items: [item], cards }), 'p1', 'local-1', columns),
    ).toEqual(expected);
  });
});

describe('moveCard', () => {
  it.each<{
    name: string;
    card: WorkCard;
    id?: string;
    column: string;
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a local task moves at once',
      card: localCard('local-1', 'Todo'),
      column: 'In Progress',
      expected: result(
        ofCards(localCard('local-1', 'In Progress', { movedAt: NOW_ISO })),
        null,
        'moved local-1 to In Progress',
      ),
    },
    {
      name: 'a local task to a column named in another case',
      card: localCard('local-1', 'Todo'),
      column: ' in qa ',
      expected: result(
        ofCards(localCard('local-1', 'In QA', { movedAt: NOW_ISO })),
        null,
        'moved local-1 to In QA',
      ),
    },
    {
      name: 'a local task to an unknown column',
      card: localCard('local-1', 'Todo'),
      column: 'Nope',
      expected: refused('No column Nope'),
    },
    {
      name: 'a local task to its own column',
      card: localCard('local-1', 'Todo'),
      column: 'todo',
      expected: refused('Already in Todo'),
    },
    {
      name: 'a Jira card gives the move job',
      card: jiraCard('ABC-12', 'To Do', { note: 'Move failed' }),
      column: 'In QA',
      expected: result(
        ofCards(jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' })),
        { kind: 'move', key: 'ABC-12', column: 'In QA' },
        'moving ABC-12 to In QA',
      ),
    },
    {
      name: 'a Jira card to a column named in another case',
      card: jiraCard('ABC-12', 'To Do'),
      column: ' in qa ',
      expected: result(
        ofCards(jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' })),
        { kind: 'move', key: 'ABC-12', column: 'In QA' },
        'moving ABC-12 to In QA',
      ),
    },
    {
      name: 'Other',
      card: jiraCard('ABC-12', 'To Do'),
      column: 'Other',
      expected: refused('Other has no Jira status'),
    },
    {
      name: 'an unknown column',
      card: jiraCard('ABC-12', 'To Do'),
      column: 'Nope',
      expected: refused('No column Nope'),
    },
    {
      name: 'a column with no statuses',
      card: jiraCard('ABC-12', 'To Do'),
      column: 'Blocked',
      expected: refused('No Jira status in Blocked'),
    },
    {
      name: 'already moving',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      column: 'In Progress',
      expected: refused('Already moving to In QA'),
    },
    {
      name: 'the same column',
      card: jiraCard('ABC-12', 'In Review'),
      column: 'In QA',
      expected: refused('Already in In QA'),
    },
    {
      name: 'an unknown card',
      card: jiraCard('XYZ-1', 'To Do'),
      id: 'ABC-12',
      column: 'In QA',
      expected: refused('No card ABC-12'),
    },
  ])('moveCard ($name)', ({ card, id, column, expected }) => {
    expect(
      moveCard(ofCards(card), { cardId: id ?? card.id, column }, COLUMNS, NOW),
    ).toEqual(expected);
  });

  // Each row breaks two rules at once and expects the earlier rule's text.
  it.each<{ name: string; card: WorkCard; column: string; refusal: string }>([
    {
      name: 'Other while moving',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      column: 'Other',
      refusal: 'Other has no Jira status',
    },
    {
      name: 'Other for a card in Other',
      card: jiraCard('ABC-12', 'Won’t Do'),
      column: 'Other',
      refusal: 'Other has no Jira status',
    },
    {
      name: 'an unknown column while moving',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      column: 'Nope',
      refusal: 'No column Nope',
    },
    {
      name: 'a no-status column while moving',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      column: 'Blocked',
      refusal: 'No Jira status in Blocked',
    },
    {
      name: 'a no-status column that is the card’s stored column',
      card: jiraCard('ABC-12', 'To Do', { column: 'Blocked' }),
      column: 'Blocked',
      refusal: 'No Jira status in Blocked',
    },
    {
      name: 'its own column while moving',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      column: 'Todo',
      refusal: 'Already moving to In QA',
    },
  ])('moveCard refusal order ($name)', ({ card, column, refusal }) => {
    expect(
      moveCard(ofCards(card), { cardId: 'ABC-12', column }, COLUMNS, NOW),
    ).toEqual(refused(refusal));
  });
});

describe('comment', () => {
  const job = (text: string): WorkJob => ({
    kind: 'comment',
    key: 'ABC-12',
    text,
  });

  it.each<{
    name: string;
    card: WorkCard;
    id?: string;
    text: string;
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a Jira card queues the comment as given',
      card: jiraCard('ABC-12', 'To Do', {
        commenting: ['First'],
        note: 'Comment failed',
      }),
      text: '  Looks good\n',
      expected: result(
        ofCards(
          jiraCard('ABC-12', 'To Do', {
            commenting: ['First', '  Looks good\n'],
          }),
        ),
        job('  Looks good\n'),
        'comment queued ABC-12',
      ),
    },
    {
      name: 'a card in Other',
      card: jiraCard('ABC-12', 'Won’t Do'),
      text: 'Hi',
      expected: result(
        ofCards(jiraCard('ABC-12', 'Won’t Do', { commenting: ['Hi'] })),
        job('Hi'),
        'comment queued ABC-12',
      ),
    },
    {
      name: 'a moving card',
      card: jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
      text: 'Hi',
      expected: result(
        ofCards(
          jiraCard('ABC-12', 'To Do', {
            movingTo: 'In QA',
            commenting: ['Hi'],
          }),
        ),
        job('Hi'),
        'comment queued ABC-12',
      ),
    },
    {
      name: 'an unknown card',
      card: jiraCard('XYZ-1', 'To Do'),
      id: 'ABC-12',
      text: 'Hi',
      expected: refused('No card ABC-12'),
    },
    {
      name: 'a local task, before its blank text',
      card: localCard('ABC-12', 'Todo'),
      text: '  \n',
      expected: refused('Only a Jira ticket takes a comment'),
    },
    {
      name: 'blank text',
      card: jiraCard('ABC-12', 'To Do'),
      text: '  \n',
      expected: refused('Nothing to post'),
    },
  ])('comment ($name)', ({ card, id, text, expected }) => {
    expect(comment(ofCards(card), { cardId: id ?? card.id, text })).toEqual(
      expected,
    );
  });
});

describe('acceptSuggestion', () => {
  const kept = suggestion('XYZ-1');

  it.each<{
    name: string;
    card: WorkCard;
    suggestions: SavedSuggestion[];
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a Jira card forward',
      card: jiraCard('ABC-12', 'To Do'),
      suggestions: [suggestion('ABC-12'), kept],
      expected: result(
        fileWith({
          cards: [jiraCard('ABC-12', 'To Do', { movingTo: 'In Progress' })],
          suggestions: [kept],
        }),
        { kind: 'move', key: 'ABC-12', column: 'In Progress' },
        'moving ABC-12 to In Progress',
      ),
    },
    {
      name: 'a local task moves at once',
      card: localCard('ABC-12', 'Todo'),
      suggestions: [
        kept,
        suggestion('ABC-12', { signal: 'session', rowId: 'row-3' }),
      ],
      expected: result(
        fileWith({
          cards: [localCard('ABC-12', 'In Progress', { movedAt: NOW_ISO })],
          suggestions: [kept],
        }),
        null,
        'moved ABC-12 to In Progress',
      ),
    },
    {
      name: 'a done entry',
      card: jiraCard('ABC-12', 'Done'),
      suggestions: [suggestion('ABC-12', { column: 'Done', state: 'done' })],
      expected: refused('Already in Done'),
    },
    {
      name: 'none',
      card: jiraCard('ABC-12', 'To Do'),
      suggestions: [kept],
      expected: refused('No suggestion for ABC-12'),
    },
  ])('acceptSuggestion ($name)', ({ card, suggestions, expected }) => {
    expect(
      acceptSuggestion(
        fileWith({ cards: [card], suggestions }),
        'ABC-12',
        COLUMNS,
        NOW,
      ),
    ).toEqual(expected);
  });
});

describe('notYet', () => {
  const card = jiraCard('ABC-12', 'To Do');
  const otherMark = {
    cardId: 'XYZ-1',
    signal: 'commit' as const,
    at: '2026-11-22T08:00:00.000Z',
    rowId: null,
  };
  const kept = suggestion('XYZ-1');

  it.each<{
    name: string;
    suggestions: SavedSuggestion[];
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'the mark replaces an older one',
      suggestions: [
        suggestion('ABC-12', {
          signal: 'pr_opened',
          at: '2026-11-23T10:30:00.000Z',
        }),
        kept,
      ],
      expected: result(
        fileWith({
          cards: [card],
          suggestions: [kept],
          notYet: [
            otherMark,
            {
              cardId: 'ABC-12',
              signal: 'pr_opened',
              at: '2026-11-23T10:30:00.000Z',
              rowId: null,
            },
          ],
        }),
        null,
        'not yet ABC-12',
      ),
    },
    {
      name: "a session's mark records its row",
      suggestions: [
        suggestion('ABC-12', { signal: 'session', rowId: 'row-3' }),
      ],
      expected: result(
        fileWith({
          cards: [card],
          notYet: [
            otherMark,
            {
              cardId: 'ABC-12',
              signal: 'session',
              at: '2026-11-23T09:00:00.000Z',
              rowId: 'row-3',
            },
          ],
        }),
        null,
        'not yet ABC-12',
      ),
    },
    {
      name: 'a done entry',
      suggestions: [suggestion('ABC-12', { column: 'Done', state: 'done' })],
      expected: refused('Already in Done'),
    },
    {
      name: 'none',
      suggestions: [kept],
      expected: refused('No suggestion for ABC-12'),
    },
  ])('notYet ($name)', ({ suggestions, expected }) => {
    const file = fileWith({
      cards: [card],
      suggestions,
      notYet: [
        {
          cardId: 'ABC-12',
          signal: 'branch',
          at: '2026-11-21T08:00:00.000Z',
          rowId: null,
        },
        otherMark,
      ],
    });

    expect(notYet(file, 'ABC-12')).toEqual(expected);
  });
});

describe('deleteTask', () => {
  const other = jiraCard('XYZ-1', 'To Do');
  const otherMark = {
    cardId: 'XYZ-1',
    signal: 'branch' as const,
    at: '2026-11-22T08:00:00.000Z',
    rowId: null,
  };

  it.each<{
    name: string;
    card: WorkCard;
    id?: string;
    expected: ActionResult | Refusal;
  }>([
    {
      name: 'a local task, its marks and entries',
      card: localCard('local-1', 'Todo'),
      expected: result(
        fileWith({
          cards: [other],
          suggestions: [suggestion('XYZ-1')],
          notYet: [otherMark],
        }),
        null,
        'deleted local-1',
      ),
    },
    {
      name: 'a Jira card',
      card: jiraCard('local-1', 'To Do'),
      expected: refused('Only a local task can be deleted'),
    },
    {
      name: 'an unknown card',
      card: localCard('local-1', 'Todo'),
      id: 'local-9',
      expected: refused('No card local-9'),
    },
  ])('deleteTask ($name)', ({ card, id, expected }) => {
    const file = fileWith({
      cards: [card, other],
      suggestions: [suggestion('local-1'), suggestion('XYZ-1')],
      notYet: [
        {
          cardId: 'local-1',
          signal: 'session',
          at: '2026-11-22T09:00:00.000Z',
          rowId: 'row-1',
        },
        otherMark,
      ],
    });

    expect(deleteTask(file, id ?? 'local-1')).toEqual(expected);
  });
});

describe('jobEnded', () => {
  const sendJob: WorkJob = { kind: 'send', itemId: 'p1', text: 'On it' };
  const nudgeJob: WorkJob = { kind: 'nudge', itemId: 'p1', text: 'Any news?' };
  const moveJob: WorkJob = { kind: 'move', key: 'ABC-12', column: 'In QA' };
  const sending = p1({ draft: 'On it', sending: 'On it' });
  const moving = jiraCard('ABC-12', 'In QA', {
    movingTo: 'In QA',
    note: 'Move failed',
  });
  const commentJob = (text: string): WorkJob => ({
    kind: 'comment',
    key: 'ABC-12',
    text,
  });
  const commenting = (...texts: string[]) =>
    jiraCard('ABC-12', 'To Do', { commenting: texts, note: 'Comment failed' });
  const message = (at: string, text: string): DetailMessage => ({
    author: 'Bo',
    at,
    text,
  });
  const older = message('2026-11-23T09:00:00.000Z', 'Seen it.');
  const newer = message('2026-11-23T10:00:00.000Z', 'On it.');
  const detailOf = (...comments: DetailMessage[]) => ({
    'ABC-12': ticketDetail('ABC-12', { comments }),
  });

  it.each<{
    name: string;
    file: WorkFile;
    job: WorkJob;
    end: JobEnd;
    expected: WorkFile;
  }>([
    {
      name: 'send ok clears an open item',
      file: ofItems(sending),
      job: sendJob,
      end: { ok: true, note: null },
      expected: ofItems(p1({ draft: 'On it', state: 'cleared' })),
    },
    {
      name: 'send ok on an item a sweep cleared',
      file: ofItems({ ...sending, state: 'cleared' }),
      job: sendJob,
      end: { ok: true, note: null },
      expected: ofItems(p1({ draft: 'On it', state: 'cleared' })),
    },
    {
      name: 'send failed keeps state and draft',
      file: ofItems(sending),
      job: sendJob,
      end: { ok: false, note: 'x' },
      expected: ofItems(p1({ draft: 'On it', note: 'Send failed: x' })),
    },
    {
      name: 'nudge failed with a null note',
      file: ofItems({ ...sending, section: 'waiting' }),
      job: nudgeJob,
      end: { ok: false, note: null },
      expected: ofItems(
        p1({ section: 'waiting', draft: 'On it', note: 'Send failed' }),
      ),
    },
    {
      name: 'a press never queued',
      file: ofItems(sending),
      job: sendJob,
      end: { ok: false, note: 'Not queued: x' },
      expected: ofItems(
        p1({ draft: 'On it', note: 'Send failed: Not queued: x' }),
      ),
    },
    {
      name: 'move ok',
      file: ofCards(moving),
      job: moveJob,
      end: { ok: true, note: null },
      expected: ofCards(jiraCard('ABC-12', 'In QA')),
    },
    {
      name: 'move failed',
      file: ofCards(moving),
      job: moveJob,
      end: { ok: false, note: 'No transition to In QA' },
      expected: ofCards(
        jiraCard('ABC-12', 'In QA', { note: 'No transition to In QA' }),
      ),
    },
    {
      name: 'move failed with a null note',
      file: ofCards({ ...moving, note: null }),
      job: moveJob,
      end: { ok: false, note: null },
      expected: ofCards(jiraCard('ABC-12', 'In QA', { note: 'Move failed' })),
    },
    {
      name: 'comment ok adds the comment to the stored detail, newest within the cap',
      file: fileWith({
        cards: [commenting('A')],
        details: detailOf(newer, older),
      }),
      job: commentJob('A'),
      end: { ok: true, note: null },
      expected: fileWith({
        cards: [jiraCard('ABC-12', 'To Do')],
        details: detailOf(newer, { author: 'You', at: NOW_ISO, text: 'A' }),
      }),
    },
    {
      name: 'comment ok with no stored detail leaves details',
      file: fileWith({
        cards: [commenting('A')],
        details: { 'XYZ-1': ticketDetail('XYZ-1') },
      }),
      job: commentJob('A'),
      end: { ok: true, note: null },
      expected: fileWith({
        cards: [jiraCard('ABC-12', 'To Do')],
        details: { 'XYZ-1': ticketDetail('XYZ-1') },
      }),
    },
    {
      name: 'comment ok removes its own text only',
      file: ofCards(commenting('A', 'B')),
      job: commentJob('B'),
      end: { ok: true, note: null },
      expected: ofCards(jiraCard('ABC-12', 'To Do', { commenting: ['A'] })),
    },
    {
      name: 'comment failed keeps the stored detail',
      file: fileWith({ cards: [commenting('A')], details: detailOf(older) }),
      job: commentJob('A'),
      end: { ok: false, note: 'No such ticket' },
      expected: fileWith({
        cards: [
          jiraCard('ABC-12', 'To Do', {
            note: 'Comment failed: No such ticket',
          }),
        ],
        details: detailOf(older),
      }),
    },
    {
      name: 'comment failed with a null note',
      file: ofCards({ ...commenting('A'), note: null }),
      job: commentJob('A'),
      end: { ok: false, note: null },
      expected: ofCards(
        jiraCard('ABC-12', 'To Do', { note: 'Comment failed' }),
      ),
    },
    {
      name: 'sweep expires a snooze',
      file: ofItems(p1({ state: 'snoozed', snoozedUntil: NOW_ISO })),
      job: { kind: 'sweep' },
      end: { ok: true, note: null },
      expected: ofItems(p1()),
    },
  ])('jobEnded ($name)', ({ file, job, end, expected }) => {
    expect(jobEnded(file, job, end, NOW, CAPS)).toEqual(expected);
  });

  it.each<{ name: string; job: WorkJob }>([
    { name: 'a gone item', job: { kind: 'send', itemId: 'p9', text: 'On it' } },
    {
      name: 'a gone card',
      job: { kind: 'move', key: 'ABC-99', column: 'In QA' },
    },
    {
      name: 'a gone ticket',
      job: { kind: 'comment', key: 'ABC-99', text: 'A' },
    },
  ])('jobEnded gives the same object for $name', ({ job }) => {
    const file = fileWith({ items: [sending], cards: [moving] });

    expect(jobEnded(file, job, { ok: false, note: 'x' }, NOW, CAPS)).toBe(file);
  });
});

describe('clearStaleMarks', () => {
  const sending = p1({ draft: 'On it', sending: 'On it' });
  const moving = jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' });

  it.each<{
    name: string;
    file: WorkFile;
    pending: WorkJob[];
    expected: WorkFile;
  }>([
    {
      name: 'a sending item with no pending send',
      file: ofItems(sending),
      pending: [
        { kind: 'send', itemId: 'p2', text: 'On it' },
        { kind: 'sweep' },
      ],
      expected: ofItems(
        p1({ draft: 'On it', note: `Send failed: ${LOST_JOB_NOTE}` }),
      ),
    },
    {
      name: 'a moving card with no pending move',
      file: ofCards(moving),
      pending: [{ kind: 'move', key: 'XYZ-1', column: 'In QA' }],
      expected: ofCards(jiraCard('ABC-12', 'To Do', { note: LOST_JOB_NOTE })),
    },
    {
      name: 'a comment with no pending comment',
      file: ofCards(jiraCard('ABC-12', 'To Do', { commenting: ['A', 'B'] })),
      pending: [
        { kind: 'comment', key: 'ABC-12', text: 'B' },
        { kind: 'comment', key: 'XYZ-1', text: 'A' },
      ],
      expected: ofCards(
        jiraCard('ABC-12', 'To Do', {
          commenting: ['B'],
          note: COMMENT_LOST_NOTE,
        }),
      ),
    },
    {
      name: 'one of two equal comments with one job',
      file: ofCards(jiraCard('ABC-12', 'To Do', { commenting: ['A', 'A'] })),
      pending: [{ kind: 'comment', key: 'ABC-12', text: 'A' }],
      expected: ofCards(
        jiraCard('ABC-12', 'To Do', {
          commenting: ['A'],
          note: COMMENT_LOST_NOTE,
        }),
      ),
    },
    {
      name: 'a stale move and a stale comment, the comment noted',
      file: ofCards(
        jiraCard('ABC-12', 'To Do', { movingTo: 'In QA', commenting: ['A'] }),
      ),
      pending: [],
      expected: ofCards(
        jiraCard('ABC-12', 'To Do', { note: COMMENT_LOST_NOTE }),
      ),
    },
  ])('clearStaleMarks clears $name', ({ file, pending, expected }) => {
    expect(clearStaleMarks(file, pending)).toEqual(expected);
  });

  it.each<{ name: string; file: WorkFile; pending: WorkJob[] }>([
    {
      name: 'a pending nudge for its id',
      file: ofItems(sending),
      pending: [{ kind: 'nudge', itemId: 'p1', text: 'x' }],
    },
    {
      name: 'a pending move for its key',
      file: ofCards(moving),
      pending: [{ kind: 'move', key: 'ABC-12', column: 'In QA' }],
    },
    {
      name: 'a pending comment for its key and text',
      file: ofCards(jiraCard('ABC-12', 'To Do', { commenting: ['A'] })),
      pending: [
        { kind: 'comment', key: 'XYZ-1', text: 'B' },
        { kind: 'comment', key: 'ABC-12', text: 'A' },
      ],
    },
    {
      name: 'no marks',
      file: fileWith({ items: [p1()], cards: [jiraCard('ABC-12', 'To Do')] }),
      pending: [],
    },
  ])(
    'clearStaleMarks keeps the same object with $name',
    ({ file, pending }) => {
      expect(clearStaleMarks(file, pending)).toBe(file);
    },
  );
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe('actions', () => {
  it('never mutates its input', () => {
    const build = () =>
      fileWith({
        items: [
          p1({ ticketKeys: ['XYZ-1'] }),
          workItem('p2', {
            state: 'snoozed',
            snoozedUntil: NOW_ISO,
            sending: null,
          }),
          workItem('p3', { sending: 'On it' }),
        ],
        cards: [
          jiraCard('ABC-12', 'To Do', { movingTo: 'In QA' }),
          jiraCard('XYZ-2', 'To Do', { commenting: ['A'] }),
          localCard('local-1', 'Todo'),
        ],
        details: { 'XYZ-2': ticketDetail('XYZ-2') },
        suggestions: [suggestion('XYZ-2'), suggestion('local-1')],
        notYet: [
          { cardId: 'local-1', signal: 'branch', at: NOW_ISO, rowId: null },
        ],
        job: { running: null, last: null },
      });
    const file = deepFreeze(build());
    const presses: (() => unknown)[] = [
      () => dismiss(file, 'p1'),
      () => restore(file, 'p2'),
      () => snooze(file, 'p1', NOW),
      () => expireSnoozes(file, NOW),
      () => send(file, { itemId: 'p1', text: 'On it' }),
      () => addToBoard(file, 'p2', 'local-2', COLUMNS),
      () => moveCard(file, { cardId: 'XYZ-2', column: 'In QA' }, COLUMNS, NOW),
      () =>
        moveCard(file, { cardId: 'local-1', column: 'In QA' }, COLUMNS, NOW),
      () => acceptSuggestion(file, 'XYZ-2', COLUMNS, NOW),
      () => comment(file, { cardId: 'XYZ-2', text: 'Hi' }),
      () => notYet(file, 'local-1'),
      () => deleteTask(file, 'local-1'),
      () =>
        jobEnded(
          file,
          { kind: 'send', itemId: 'p3', text: 'On it' },
          { ok: true, note: null },
          NOW,
          CAPS,
        ),
      () =>
        jobEnded(
          file,
          { kind: 'move', key: 'ABC-12', column: 'In QA' },
          { ok: false, note: null },
          NOW,
          CAPS,
        ),
      () =>
        jobEnded(
          file,
          { kind: 'comment', key: 'XYZ-2', text: 'A' },
          { ok: true, note: null },
          NOW,
          CAPS,
        ),
      () => clearStaleMarks(file, []),
    ];

    for (const press of presses) {
      expect(press).not.toThrow();
    }
    expect(file).toEqual(build());
  });
});
