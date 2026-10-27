import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { PrimerEntry } from '../contract';
import {
  apply,
  initialState,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  type RailRow,
  railRows,
  type RowPrompt,
  rowPrompt,
  scopeOf,
  selectedEntry,
  selectedRow,
  sessionTitle,
  submitProblems,
  type TextTarget,
} from './primer-state';
import {
  presentedPrimer,
  primerEntries,
  primerEntry,
  primerFeature,
  primerItem,
} from './test-primers';

// One primer, `p1`, active in view 'primer'; with the Feature row selected,
// rows: the feature (0), `1` (1), `s1` (2), `extra-1` (3) unless `entries`
// says otherwise. Selecting `1` draws its two items as rows 2 and 3.
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

// Selects row `row` of the active primer, a position in the rows drawn now.
function onRow(state: PrimerState, row: number): PrimerState {
  return apply(state, { type: 'selectRow', row });
}

// Selects item `item` of task `1`: its task row, then its item row.
function onItemOf1(state: PrimerState, item: number): PrimerState {
  return onRow(onRow(state, 1), 1 + item);
}

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
    expect(primer.selected).toEqual({ kind: 'feature' });
    expect(state.view).toBe('primer');
    expect(apply(state, { type: 'formShown', form: presented })).toBe(state);
  });

  it('keeps a primer for another session in the background', () => {
    const state = initialState([presentedPrimer('p1')], 'other-session');

    expect(state.forms).toHaveLength(1);
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('orders the rail rows feature, primer, standing, extra', () => {
    const state = stateWith([
      primerEntry('x', 'extra'),
      primerEntry('s1', 'standing', { items: [primerItem('Standing')] }),
      primerEntry('1', 'primer', {
        items: [primerItem('Read'), primerItem('Write')],
      }),
    ]);

    expect(railRows(primerOf(onRow(state, 1)))).toEqual([
      { kind: 'feature' },
      { kind: 'task', entryId: '1' },
      { kind: 'item', entryId: '1', item: 1 },
      { kind: 'item', entryId: '1', item: 2 },
      { kind: 'task', entryId: 's1' },
      { kind: 'task', entryId: 'x' },
    ]);
  });

  it.each<[string, (state: PrimerState) => PrimerState, RowPrompt | null]>([
    ['the Feature row', (state) => state, null],
    [
      'a task row',
      (state) => onRow(state, 1),
      { need: true, include: false, remove: false },
    ],
    [
      'an extra task row',
      (state) => onRow(state, 3),
      { need: true, include: false, remove: true },
    ],
    [
      'an item row of task 1',
      (state) => onItemOf1(state, 1),
      { need: true, include: true, remove: false },
    ],
    [
      "an extra task's item row",
      (state) => onRow(onRow(state, 3), 4),
      { need: true, include: true, remove: true },
    ],
  ])('gives the row prompt on %s', (_name, select, expected) => {
    const entries = [
      ...primerEntries().slice(0, 2),
      primerEntry('extra-1', 'extra', { items: [primerItem('Extra item')] }),
    ];

    expect(rowPrompt(primerOf(select(stateWith(entries))))).toEqual(expected);
  });

  it('walks the rail rows and expands only the selected task', () => {
    const selected = (state: PrimerState) => selectedRow(primerOf(state));
    let state = stateWith();
    const walked: RailRow[] = [];
    for (let i = 0; i < 4; i++) {
      state = apply(state, { type: 'nextRow' });
      walked.push(selected(state));
    }

    expect(walked).toEqual([
      { kind: 'task', entryId: '1' },
      { kind: 'item', entryId: '1', item: 1 },
      { kind: 'item', entryId: '1', item: 2 },
      { kind: 'task', entryId: 's1' },
    ]);
    expect(railRows(primerOf(state))).toHaveLength(4);
    state = apply(state, { type: 'prevRow' });
    expect(selected(state)).toEqual({ kind: 'task', entryId: '1' });
    const first = stateWith();
    expect(apply(first, { type: 'prevRow' })).toBe(first);
    const last = onRow(first, 3);
    expect(apply(last, { type: 'nextRow' })).toBe(last);
  });

  it('changes nothing when setNeed applies on the Feature row', () => {
    const state = stateWith();

    expect(apply(state, { type: 'setNeed', need: 'yes' })).toBe(state);
  });

  it.each([
    ['its task row', (state: PrimerState) => onRow(state, 1)],
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

  it('adds the trimmed add-item text as an item and clears the text', () => {
    const state = setNewItemText(
      onRow(stateWith(), 1),
      '1',
      '  Write the store ',
    );

    const next = apply(state, {
      type: 'addItem',
      formId: 'p1',
      entryId: '1',
    });

    const primer = primerOf(next);
    expect(selectedEntry(primer)?.items.at(-1)).toEqual({
      text: 'Write the store',
      include: true,
      comment: '',
      added: true,
    });
    expect(primer.newItemTexts['1']).toBe('');
    expect(primer.selected).toEqual({ kind: 'task', entryId: '1' });
    expect(primer.revision).toBe(primerOf(state).revision + 1);
  });

  it('adds no item from blank text or onto a task holding 20 items', () => {
    const blank = setNewItemText(onRow(stateWith(), 1), '1', '   ');
    const fullEntries = [
      primerEntry('1', 'primer', {
        items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
      }),
    ];
    const full = setNewItemText(onRow(stateWith(fullEntries), 1), '1', 'More');

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
    const state = onRow(stateWith(), 2);

    expect(apply(state, { type: 'removeExtraTask' })).toBe(state);
  });

  it.each([
    ['its task row', (state: PrimerState) => onRow(state, 3)],
    ['an item row', (state: PrimerState) => onRow(onRow(state, 3), 5)],
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
      // Rows: the feature (0), `s1` (1), `extra-1` (2), `extra-2` (3); on
      // `extra-2`, its items at 4 and 5, so a selection kept at an item row's
      // position, or one counting the removed task's item rows, lands past
      // the last row.
      const state = select(
        setNewItemText(stateWith(entries), 'extra-2', 'draft'),
      );

      const primer = primerOf(apply(state, { type: 'removeExtraTask' }));

      expect(primer.entries.map((entry) => entry.id)).toEqual([
        's1',
        'extra-1',
      ]);
      expect(primer.selected).toEqual({ kind: 'task', entryId: 'extra-1' });
      expect(primer.newItemTexts).toEqual({});
    },
  );

  it('changes nothing when toggleInclude applies on the Feature row', () => {
    const state = stateWith();

    expect(apply(state, { type: 'toggleInclude' })).toBe(state);
  });

  it('toggles the include mark on the selected item row only', () => {
    const state = onItemOf1(stateWith(), 2);
    const onTask = onRow(stateWith(), 1);

    const primer = primerOf(apply(state, { type: 'toggleInclude' }));

    expect(selectedEntry(primer)?.items.map((item) => item.include)).toEqual([
      true,
      false,
    ]);
    expect(apply(onTask, { type: 'toggleInclude' })).toBe(onTask);
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

  it.each<[TextTarget, RailRow]>([
    [
      { field: 'itemComment', entryId: '1', item: 2 },
      { kind: 'item', entryId: '1', item: 2 },
    ],
    [
      { field: 'newItem', entryId: '1' },
      { kind: 'task', entryId: '1' },
    ],
    [
      { field: 'taskComment', entryId: '1' },
      { kind: 'task', entryId: '1' },
    ],
    [
      { field: 'taskName', entryId: 'extra-1' },
      { kind: 'task', entryId: 'extra-1' },
    ],
    [{ field: 'feature', name: 'slug' }, { kind: 'feature' }],
  ])(
    'shows the %o target by selecting its row and focusing the card',
    (target, row) => {
      // From item 1 of `1`, so every target moves the selection or the pane.
      const state = onItemOf1(stateWith(), 1);

      const primer = primerOf(
        apply(state, { type: 'showTarget', formId: 'p1', target }),
      );

      expect(primer.selected).toEqual(row);
      expect(primer.pane).toBe('card');
    },
  );

  it('applies only the sending actions while the active primer sends', () => {
    const sending = applyAll(onRow(stateWith(), 1), [
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

  it('gives the card scope in view primer with the card pane focused', () => {
    const state = apply(stateWith(), { type: 'focusPane', pane: 'card' });

    expect(scopeOf(state)).toBe('card');
    expect(scopeOf(apply(state, { type: 'openReview' }))).toBe('review');
  });
});
