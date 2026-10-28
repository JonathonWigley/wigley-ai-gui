import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { PrimerEntry } from '../contract';
import {
  apply,
  cardRow,
  initialState,
  type OpenPrimer,
  type PrimerAction,
  type PrimerColumn,
  type PrimerPane,
  type PrimerRow,
  type PrimerState,
  type RowPrompt,
  rowPrompt,
  scopeOf,
  selectedEntry,
  sessionTitle,
  submitProblems,
  type TaskRow,
  taskRows,
  type TextTarget,
} from './primer-state';
import {
  presentedPrimer,
  primerEntries,
  primerEntry,
  primerFeature,
  primerItem,
} from './test-primers';

// One primer, `p1`, active in view 'primer' on the Feature row; tasks column
// rows: the feature (0), `1` with two items (1), `s1` (2), `extra-1` (3)
// unless `entries` says otherwise.
function stateWith(entries: PrimerEntry[] = primerEntries()): PrimerState {
  return initialState([presentedPrimer('p1', { entries })], 'p1-session');
}

function primerOf(state: PrimerState): OpenPrimer {
  const primer = activeForm(state);
  if (primer === null) {
    throw new Error('No primer is active');
  }
  return primer;
}

function applyAll(state: PrimerState, actions: PrimerAction[]): PrimerState {
  return actions.reduce(apply, state);
}

// Clicks tasks column row `row` of the active primer.
function onTask(state: PrimerState, row: number): PrimerState {
  return apply(state, { type: 'selectTask', row });
}

// Clicks item `item` (1-based) of the selected task.
function onItem(state: PrimerState, item: number): PrimerState {
  return apply(state, { type: 'selectItem', item });
}

// Clicks task `1`'s row, then its item `item`.
function onItemOf1(state: PrimerState, item: number): PrimerState {
  return onItem(onTask(state, 1), item);
}

function focus(state: PrimerState, pane: PrimerPane): PrimerState {
  return apply(state, { type: 'focusPane', pane });
}

// The selection a primer holds.
function selectionOf(state: PrimerState) {
  const { selectedTask, selectedItem } = primerOf(state);
  return { selectedTask, selectedItem };
}

const TASK_1: TaskRow = { kind: 'task', entryId: '1' };

function setNewItemText(
  state: PrimerState,
  entryId: string,
  value: string,
): PrimerState {
  return apply(state, {
    type: 'setText',
    formId: 'p1',
    target: { field: 'newItem', entryId },
    value,
  });
}

describe('primer state', () => {
  it('restores a primer from its draft, and shows the same formId once', () => {
    const draftEntries = [primerEntry('1', 'primer', { need: 'no' })];
    const draftFeature = primerFeature({ name: 'Drafted' });
    const presented = presentedPrimer('p1', {
      draft: { feature: draftFeature, entries: draftEntries },
    });
    const state = initialState([presented], 'p1-session');

    const primer = primerOf(state);
    expect(primer.feature).toEqual(draftFeature);
    expect(primer.entries).toEqual(draftEntries);
    expect(primer.primer).toEqual(presented.form);
    expect(primer).toMatchObject({
      selectedTask: { kind: 'feature' },
      selectedItem: null,
      pane: 'tasks',
      cardColumn: 'tasks',
    });
    expect(state.view).toBe('primer');
    expect(apply(state, { type: 'formShown', form: presented })).toBe(state);
  });

  it('keeps a primer for another session in the background', () => {
    const state = initialState([presentedPrimer('p1')], 'other-session');

    expect(state.forms).toHaveLength(1);
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('orders the tasks column rows feature, primer, standing, extra', () => {
    const state = stateWith([
      primerEntry('x', 'extra'),
      primerEntry('s1', 'standing', { items: [primerItem('Standing')] }),
      primerEntry('1', 'primer', {
        items: [primerItem('Read'), primerItem('Write')],
      }),
    ]);

    expect(taskRows(primerOf(onTask(state, 1)))).toEqual([
      { kind: 'feature' },
      { kind: 'task', entryId: '1' },
      { kind: 'task', entryId: 's1' },
      { kind: 'task', entryId: 'x' },
    ]);
  });

  it.each<
    [
      string,
      PrimerColumn,
      (state: PrimerState) => PrimerState,
      RowPrompt | null,
    ]
  >([
    ['the Feature row', 'tasks', (state) => state, null],
    [
      'a task row',
      'tasks',
      (state) => onTask(state, 1),
      { need: true, include: false, remove: false },
    ],
    [
      'an extra task row',
      'tasks',
      (state) => onTask(state, 3),
      { need: true, include: false, remove: true },
    ],
    [
      'an item row of task 1',
      'items',
      (state) => onItemOf1(state, 2),
      { need: true, include: true, remove: false },
    ],
    [
      "an extra task's item row",
      'items',
      (state) => onItem(onTask(state, 3), 1),
      { need: true, include: true, remove: false },
    ],
    ['the Feature row', 'items', (state) => focus(state, 'items'), null],
    [
      'a task with no items',
      'items',
      (state) => focus(onTask(state, 2), 'items'),
      null,
    ],
  ])(
    'gives the row prompt on %s in the %s column',
    (_name, column, select, expected) => {
      const entries = [
        ...primerEntries().slice(0, 2),
        primerEntry('extra-1', 'extra', { items: [primerItem('Extra item')] }),
      ];

      expect(rowPrompt(primerOf(select(stateWith(entries))), column)).toEqual(
        expected,
      );
    },
  );

  // Tasks column rows: the feature (0), `1` with two items (1), `s1` with
  // none (2), `extra-1` with one (3).
  it.each<{
    from: string;
    start: (state: PrimerState) => PrimerState;
    action: 'nextRow' | 'prevRow';
    expected: { selectedTask: TaskRow; selectedItem: number | null } | 'same';
  }>([
    {
      from: 'tasks, Feature row',
      start: (state) => state,
      action: 'nextRow',
      expected: { selectedTask: TASK_1, selectedItem: 1 },
    },
    {
      from: 'tasks, Feature row',
      start: (state) => state,
      action: 'prevRow',
      expected: 'same',
    },
    {
      from: 'tasks, last task',
      start: (state) => onTask(state, 3),
      action: 'nextRow',
      expected: 'same',
    },
    {
      from: 'tasks, task 1',
      start: (state) => onTask(state, 1),
      action: 'nextRow',
      expected: {
        selectedTask: { kind: 'task', entryId: 's1' },
        selectedItem: null,
      },
    },
    {
      from: 'items, task 1 item 1',
      start: (state) => onItemOf1(state, 1),
      action: 'nextRow',
      expected: { selectedTask: TASK_1, selectedItem: 2 },
    },
    {
      from: 'items, task 1 last item',
      start: (state) => onItemOf1(state, 2),
      action: 'nextRow',
      expected: 'same',
    },
    {
      from: 'items, task 1 item 1',
      start: (state) => onItemOf1(state, 1),
      action: 'prevRow',
      expected: 'same',
    },
    {
      from: 'items, Feature row',
      start: (state) => focus(state, 'items'),
      action: 'nextRow',
      expected: 'same',
    },
    {
      from: 'card from tasks, task s1',
      start: (state) => focus(onTask(state, 2), 'card'),
      action: 'nextRow',
      expected: {
        selectedTask: { kind: 'task', entryId: 'extra-1' },
        selectedItem: 1,
      },
    },
    {
      from: 'card from items, task 1 item 1',
      start: (state) => focus(onItemOf1(state, 1), 'card'),
      action: 'nextRow',
      expected: { selectedTask: TASK_1, selectedItem: 2 },
    },
  ])(
    "steps the stepped column's rows: $from, $action",
    ({ start, action, expected }) => {
      const entries = [
        ...primerEntries().slice(0, 2),
        primerEntry('extra-1', 'extra', { items: [primerItem('Extra item')] }),
      ];
      const state = start(stateWith(entries));

      const next = apply(state, { type: action });

      if (expected === 'same') {
        expect(next).toBe(state);
      } else {
        expect(selectionOf(next)).toEqual(expected);
      }
    },
  );

  it.each<[string, (state: PrimerState) => PrimerState, PrimerRow]>([
    ['tasks on the Feature row', (state) => state, { kind: 'feature' }],
    ['tasks on task 1', (state) => onTask(state, 1), TASK_1],
    [
      'items on item 2',
      (state) => onItemOf1(state, 2),
      { kind: 'item', entryId: '1', item: 2 },
    ],
    [
      'items on a task with no items',
      (state) => focus(onTask(state, 2), 'items'),
      { kind: 'task', entryId: 's1' },
    ],
    [
      'items on the Feature row',
      (state) => focus(state, 'items'),
      { kind: 'feature' },
    ],
    [
      'card from tasks on task 1',
      (state) => focus(onTask(state, 1), 'card'),
      TASK_1,
    ],
    [
      'card from items on item 2',
      (state) => focus(onItemOf1(state, 2), 'card'),
      { kind: 'item', entryId: '1', item: 2 },
    ],
  ])(
    'chooses the card row for the focused column: %s',
    (_name, select, expected) => {
      expect(cardRow(primerOf(select(stateWith())))).toEqual(expected);
    },
  );

  it.each<{
    from: string;
    start: (state: PrimerState) => PrimerState;
    pane: PrimerPane;
    cardColumn: PrimerColumn;
  }>([
    {
      from: 'items',
      start: (state) => onItemOf1(state, 1),
      pane: 'tasks',
      cardColumn: 'tasks',
    },
    {
      from: 'tasks',
      start: (state) => onTask(state, 1),
      pane: 'items',
      cardColumn: 'items',
    },
    {
      from: 'items',
      start: (state) => onItemOf1(state, 1),
      pane: 'card',
      cardColumn: 'items',
    },
    {
      from: 'tasks',
      start: (state) => onTask(state, 1),
      pane: 'card',
      cardColumn: 'tasks',
    },
  ])(
    "moves focus and keeps the card's column on focusCard: $from to $pane",
    ({ start, pane, cardColumn }) => {
      const primer = primerOf(focus(start(stateWith()), pane));

      expect({ pane: primer.pane, cardColumn: primer.cardColumn }).toEqual({
        pane,
        cardColumn,
      });
    },
  );

  it.each<{
    name: string;
    start: (state: PrimerState) => PrimerState;
    action: PrimerAction;
    expected: Partial<OpenPrimer> | 'same';
  }>([
    {
      name: 'a task row from the card',
      start: (state) => focus(state, 'card'),
      action: { type: 'selectTask', row: 1 },
      expected: {
        selectedTask: TASK_1,
        selectedItem: 1,
        pane: 'tasks',
        cardColumn: 'tasks',
      },
    },
    {
      name: 'a task row with no items from the items column',
      start: (state) => onItemOf1(state, 1),
      action: { type: 'selectTask', row: 2 },
      expected: {
        selectedTask: { kind: 'task', entryId: 's1' },
        selectedItem: null,
        pane: 'tasks',
        cardColumn: 'tasks',
      },
    },
    {
      name: 'an item row from the tasks column',
      start: (state) => onTask(state, 1),
      action: { type: 'selectItem', item: 2 },
      expected: {
        selectedTask: TASK_1,
        selectedItem: 2,
        pane: 'items',
        cardColumn: 'items',
      },
    },
    {
      name: 'a task row past the last',
      start: (state) => state,
      action: { type: 'selectTask', row: 4 },
      expected: 'same',
    },
    {
      name: 'an item past the last',
      start: (state) => onTask(state, 1),
      action: { type: 'selectItem', item: 3 },
      expected: 'same',
    },
    {
      name: 'item 0',
      start: (state) => onTask(state, 1),
      action: { type: 'selectItem', item: 0 },
      expected: 'same',
    },
  ])(
    'selects a clicked row and focuses its column: $name',
    ({ start, action, expected }) => {
      const state = start(stateWith());

      const next = apply(state, action);

      if (expected === 'same') {
        expect(next).toBe(state);
      } else {
        expect(primerOf(next)).toMatchObject(expected);
      }
    },
  );

  it('changes nothing when setNeed applies on the Feature row', () => {
    const state = stateWith();

    expect(apply(state, { type: 'setNeed', need: 'yes' })).toBe(state);
  });

  it.each([
    ['its task row', (state: PrimerState) => onTask(state, 1)],
    ['an item row', (state: PrimerState) => onItemOf1(state, 2)],
  ])(
    'sets the need on the selected task from %s and grows the revision by one',
    (_name, select) => {
      const state = select(stateWith());

      const next = apply(state, { type: 'setNeed', need: 'yes' });

      expect(primerOf(next).entries[0].need).toBe('yes');
      expect(primerOf(next).revision).toBe(primerOf(state).revision + 1);
    },
  );

  it.each<{
    name: string;
    select: (state: PrimerState) => PrimerState;
    entryId: string;
    selectedItem: number | null;
  }>([
    {
      name: 'onto the selected task on item 2, keeping item 2',
      select: (state) => onItemOf1(state, 2),
      entryId: '1',
      selectedItem: 2,
    },
    {
      name: 'onto the selected task with no items, selecting the new item',
      select: (state) => onTask(state, 2),
      entryId: 's1',
      selectedItem: 1,
    },
    {
      name: 'onto another task with no items, keeping no item',
      select: (state) => state,
      entryId: 's1',
      selectedItem: null,
    },
  ])(
    'adds the trimmed add-item text as an item and clears the text: $name',
    ({ select, entryId, selectedItem }) => {
      const state = setNewItemText(
        select(stateWith()),
        entryId,
        '  Write the store ',
      );

      const next = apply(state, { type: 'addItem', formId: 'p1', entryId });

      const primer = primerOf(next);
      const entry = primer.entries.find(
        (candidate) => candidate.id === entryId,
      );
      expect(entry?.items.at(-1)).toEqual({
        text: 'Write the store',
        include: true,
        comment: '',
        added: true,
      });
      expect(primer.newItemTexts[entryId]).toBe('');
      expect(primer.selectedTask).toEqual(primerOf(state).selectedTask);
      expect(primer.selectedItem).toBe(selectedItem);
      expect(primer.revision).toBe(primerOf(state).revision + 1);
    },
  );

  it('adds no item from blank text or onto a task holding 20 items', () => {
    const blank = setNewItemText(onTask(stateWith(), 1), '1', '   ');
    const fullEntries = [
      primerEntry('1', 'primer', {
        items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
      }),
    ];
    const full = setNewItemText(onTask(stateWith(fullEntries), 1), '1', 'More');

    expect(apply(blank, { type: 'addItem', formId: 'p1', entryId: '1' })).toBe(
      blank,
    );
    expect(apply(full, { type: 'addItem', formId: 'p1', entryId: '1' })).toBe(
      full,
    );
  });

  it('changes nothing when addExtraTask applies at 60 entries', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      primerEntry(`${i + 1}`, 'primer'),
    );
    const state = stateWith(entries);

    expect(apply(state, { type: 'addExtraTask' })).toBe(state);
  });

  it('gives a new extra task the smallest free id and selects it in the card', () => {
    const state = stateWith([
      primerEntry('extra-1', 'extra'),
      primerEntry('extra-3', 'extra'),
    ]);

    const primer = primerOf(apply(state, { type: 'addExtraTask' }));

    expect(primer.entries.at(-1)).toEqual({
      id: 'extra-2',
      group: 'extra',
      number: null,
      area: '',
      question: '',
      task: '',
      need: 'yes',
      evidence: '',
      probes: '',
      pointer: '',
      comment: '',
      items: [],
    });
    expect(selectedEntry(primer)?.id).toBe('extra-2');
    expect(primer.pane).toBe('card');
  });

  it('refuses to remove a standing task', () => {
    const state = onTask(stateWith(), 2);

    expect(apply(state, { type: 'removeExtraTask' })).toBe(state);
  });

  it.each([
    ['its task row', (state: PrimerState) => onTask(state, 3)],
    ['its item row', (state: PrimerState) => onItem(onTask(state, 3), 2)],
  ])(
    'removes the last extra task from %s and clamps the selection to the last row',
    (_name, select) => {
      const entries = [
        primerEntry('s1', 'standing', {
          items: [primerItem('One'), primerItem('Two')],
        }),
        primerEntry('extra-1', 'extra', {
          items: [primerItem('Three'), primerItem('Four')],
        }),
        primerEntry('extra-2', 'extra', {
          items: [primerItem('Five'), primerItem('Six')],
        }),
      ];
      // Tasks column rows: the feature (0), `s1` (1), `extra-1` (2),
      // `extra-2` (3), so a selection kept at the removed task's position
      // lands past the last row.
      const state = select(
        setNewItemText(stateWith(entries), 'extra-2', 'draft'),
      );

      const primer = primerOf(apply(state, { type: 'removeExtraTask' }));

      expect(primer.entries.map((entry) => entry.id)).toEqual([
        's1',
        'extra-1',
      ]);
      expect(primer.selectedTask).toEqual({
        kind: 'task',
        entryId: 'extra-1',
      });
      expect(primer.selectedItem).toBe(1);
      expect(primer.newItemTexts).toEqual({});
    },
  );

  it('changes nothing when toggleInclude applies on the Feature row', () => {
    const state = stateWith();

    expect(apply(state, { type: 'toggleInclude' })).toBe(state);
  });

  it("toggles the include mark of the card's item only", () => {
    const state = onItemOf1(stateWith(), 2);
    const onTaskCard = focus(onTask(stateWith(), 1), 'card');

    const primer = primerOf(apply(state, { type: 'toggleInclude' }));

    expect(selectedEntry(primer)?.items.map((item) => item.include)).toEqual([
      true,
      false,
    ]);
    expect(apply(onTaskCard, { type: 'toggleInclude' })).toBe(onTaskCard);
  });

  it('leaves the revision when setText changes add-item text', () => {
    const state = stateWith();

    const next = setNewItemText(state, '1', 'Some text');

    expect(primerOf(next).newItemTexts['1']).toBe('Some text');
    expect(primerOf(next).revision).toBe(primerOf(state).revision);
  });

  it('grows the revision when setText changes a body field', () => {
    const state = stateWith();

    const next = apply(state, {
      type: 'setText',
      formId: 'p1',
      target: { field: 'itemComment', entryId: '1', item: 2 },
      value: 'Why',
    });

    expect(primerOf(next).entries[0].items[1].comment).toBe('Why');
    expect(primerOf(next).revision).toBe(primerOf(state).revision + 1);
  });

  it.each<[TextTarget, Partial<OpenPrimer>]>([
    [
      { field: 'itemComment', entryId: '1', item: 2 },
      { selectedTask: TASK_1, selectedItem: 2, cardColumn: 'items' },
    ],
    [
      { field: 'newItem', entryId: '1' },
      { selectedTask: TASK_1, selectedItem: 1, cardColumn: 'tasks' },
    ],
    [
      { field: 'taskComment', entryId: '1' },
      { selectedTask: TASK_1, selectedItem: 1, cardColumn: 'tasks' },
    ],
    [
      { field: 'taskName', entryId: 'extra-1' },
      {
        selectedTask: { kind: 'task', entryId: 'extra-1' },
        selectedItem: null,
        cardColumn: 'tasks',
      },
    ],
    [
      { field: 'feature', name: 'slug' },
      {
        selectedTask: { kind: 'feature' },
        selectedItem: null,
        cardColumn: 'tasks',
      },
    ],
  ])(
    'shows the %o target by selecting its row and focusing the card',
    (target, selection) => {
      // From item 1 of `1` in the items column, so every target moves the
      // selection, the card's column or the pane.
      const state = onItemOf1(stateWith(), 1);

      const primer = primerOf(
        apply(state, { type: 'showTarget', formId: 'p1', target }),
      );

      expect(primer).toMatchObject({ ...selection, pane: 'card' });
    },
  );

  it('applies only the sending actions while the active primer sends', () => {
    const sending = applyAll(onTask(stateWith(), 1), [
      { type: 'openReview' },
      { type: 'sendStarted', formId: 'p1', kind: 'submitted' },
    ]);
    const blocked: PrimerAction[] = [
      { type: 'closeReview' },
      { type: 'askCancel' },
      { type: 'addItem', formId: 'p1', entryId: '1' },
      { type: 'askClose', sessionId: 'p1-session' },
    ];

    for (const action of blocked) {
      expect(apply(sending, action)).toBe(sending);
    }
    const edited = apply(sending, {
      type: 'setText',
      formId: 'p1',
      target: { field: 'taskComment', entryId: '1' },
      value: 'note',
    });
    expect(edited).not.toBe(sending);
    expect(
      primerOf(apply(sending, { type: 'sendFailed', formId: 'p1' })).sending,
    ).toBeNull();
  });

  it('returns to the primer when the cancel prompt closing the session asked is kept', () => {
    const asked = apply(stateWith(), {
      type: 'askClose',
      sessionId: 'p1-session',
    });
    expect(asked.view).toBe('confirm');

    const kept = apply(asked, { type: 'dismissConfirm' });

    expect(kept.view).toBe('primer');
    expect(kept.confirmClosesSession).toBe(false);
  });

  it("drops an open cancel prompt and shows the newly active session's primer", () => {
    const two = initialState(
      [presentedPrimer('p1'), presentedPrimer('p2')],
      'p1-session',
    );

    const state = applyAll(two, [
      { type: 'askClose', sessionId: 'p1-session' },
      { type: 'sessionActivated', sessionId: 'p2-session' },
    ]);

    expect(state.view).toBe('primer');
    expect(state.activeFormId).toBe('p2');
    expect(state.confirmClosesSession).toBe(false);
  });

  it('shows the idle view once the active primer closes', () => {
    const asked = applyAll(stateWith(), [
      { type: 'openReview' },
      { type: 'askCancel' },
    ]);

    const state = apply(asked, { type: 'formClosed', formId: 'p1' });

    expect(state.forms).toEqual([]);
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
    expect(state.confirmClosesSession).toBe(false);
  });

  it('applies row actions only in view primer', () => {
    const review = apply(stateWith(), { type: 'openReview' });

    expect(review.view).toBe('review');
    expect(apply(review, { type: 'nextRow' })).toBe(review);
  });

  it('lists the slug problem, then each unnamed extra task', () => {
    const state = initialState(
      [
        presentedPrimer('p1', {
          feature: primerFeature({ slug: 'Bad Slug' }),
          entries: [primerEntry('extra-1', 'extra', { task: '  ' })],
        }),
      ],
      'p1-session',
    );

    expect(submitProblems(primerOf(state))).toEqual([
      expect.stringContaining('slug'),
      expect.stringContaining('Extra task 1'),
    ]);
  });

  it('titles the session with the feature name and the decided tasks', () => {
    const state = stateWith([
      primerEntry('1', 'primer', { need: 'yes' }),
      primerEntry('2', 'primer', { need: 'no' }),
      primerEntry('3', 'primer', { need: 'unclear' }),
    ]);

    expect(sessionTitle(primerOf(state))).toMatch(/port.*2\/3/);
  });

  it.each<PrimerPane>(['tasks', 'items', 'card'])(
    'gives the %s scope in view primer with that pane focused',
    (pane) => {
      const state = focus(onTask(stateWith(), 1), pane);

      expect(scopeOf(state)).toBe(pane);
      expect(scopeOf(apply(state, { type: 'openReview' }))).toBe('review');
    },
  );
});
