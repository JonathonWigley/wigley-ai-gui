import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import {
  boxDescription,
  boxKey,
  boxText,
  focusActionFor,
  type PrimerBox,
  primerViewBoxes,
  shownBoxes,
} from './boxes';
import { apply, initialState, type PrimerAction } from './primer-state';
import {
  presentedPrimer,
  primerEntry,
  primerFeature,
  primerItem,
} from './test-primers';

// Tasks column rows: the feature (0), then `extra-1` with two items and a
// third the user added (1).
function setup() {
  return initialState(
    [
      presentedPrimer('p1', {
        feature: primerFeature({ slug: 'the-slug' }),
        entries: [
          primerEntry('extra-1', 'extra', {
            items: [
              primerItem('First'),
              primerItem('Second', { comment: 'why' }),
              primerItem('Third', { added: true }),
            ],
          }),
        ],
      }),
    ],
    'p1-session',
  );
}

describe('primer boxes', () => {
  it('shows the five feature fields in order on the Feature row', () => {
    expect(shownBoxes(setup()).map(boxKey)).toEqual([
      'p1/feature/name',
      'p1/feature/slug',
      'p1/feature/spec',
      'p1/feature/summary',
      'p1/feature/notes',
    ]);
  });

  it("shows an extra task's name, add-item and comment boxes on its task row", () => {
    const state = apply(setup(), { type: 'nextRow' });

    expect(shownBoxes(state).map(boxKey)).toEqual([
      'p1/task/extra-1/name',
      'p1/task/extra-1/new-item',
      'p1/task/extra-1/comment',
    ]);
  });

  it.each([
    {
      name: "an agent's item",
      item: 2,
      keys: ['p1/task/extra-1/item/2/comment'],
    },
    {
      name: 'an item the user added',
      item: 3,
      keys: ['p1/task/extra-1/item/3/text', 'p1/task/extra-1/item/3/comment'],
    },
  ])('shows the item card boxes of $name', ({ item, keys }) => {
    const state = apply(apply(setup(), { type: 'nextRow' }), {
      type: 'selectItem',
      item,
    });

    expect(shownBoxes(state).map(boxKey)).toEqual(keys);
  });

  it('shows no box in the review', () => {
    expect(shownBoxes(apply(setup(), { type: 'openReview' }))).toEqual([]);
  });

  it.each<{ name: string; actions: PrimerAction[]; keys: string[] }>([
    {
      name: 'a primer whose pane lost focus to a Chat pane',
      actions: [{ type: 'sessionActivated', sessionId: 'chat-session' }],
      keys: ['p1/task/extra-1/item/2/comment'],
    },
    {
      name: 'the focused primer in the review',
      actions: [{ type: 'openReview' }],
      keys: [],
    },
    {
      name: 'the focused primer under the cancel prompt',
      actions: [{ type: 'openReview' }, { type: 'askCancel' }],
      keys: [],
    },
  ])('draws the boxes of $name', ({ actions, keys }) => {
    const onItem = apply(apply(setup(), { type: 'nextRow' }), {
      type: 'selectItem',
      item: 2,
    });

    const state = actions.reduce(apply, onItem);

    expect(primerViewBoxes(state, 'p1').map(boxKey)).toEqual(keys);
  });

  it('keys and describes one box of each field', () => {
    const boxes: PrimerBox[] = [
      { primerId: 'p1', target: { field: 'feature', name: 'slug' } },
      { primerId: 'p1', target: { field: 'feature', name: 'notes' } },
      { primerId: 'p1', target: { field: 'taskName', entryId: '3' } },
      { primerId: 'p1', target: { field: 'itemText', entryId: '3', item: 2 } },
      {
        primerId: 'p1',
        target: { field: 'itemComment', entryId: '3', item: 2 },
      },
      { primerId: 'p1', target: { field: 'newItem', entryId: '3' } },
      { primerId: 'p1', target: { field: 'taskComment', entryId: '3' } },
    ];

    expect(boxes.map((box) => [boxKey(box), boxDescription(box)])).toEqual([
      ['p1/feature/slug', 'slug of the feature'],
      ['p1/feature/notes', 'notes on the feature'],
      ['p1/task/3/name', 'name of task 3'],
      ['p1/task/3/item/2/text', 'text of item 2 of task 3'],
      ['p1/task/3/item/2/comment', 'comment on item 2 of task 3'],
      ['p1/task/3/new-item', 'new item on task 3'],
      ['p1/task/3/comment', 'comment on task 3'],
    ]);
  });

  it('mounts a box with the text its target holds', () => {
    const primer = activeForm(setup());
    if (primer === null) {
      throw new Error('No primer is active');
    }

    expect(boxText(primer, { field: 'feature', name: 'slug' })).toBe(
      'the-slug',
    );
    expect(
      boxText(primer, { field: 'itemComment', entryId: 'extra-1', item: 2 }),
    ).toBe('why');
    expect(
      boxText(primer, { field: 'itemText', entryId: 'extra-1', item: 3 }),
    ).toBe('Third');
    expect(boxText(primer, { field: 'newItem', entryId: 'extra-1' })).toBe('');
  });

  it('shows the target of an active box only in view primer', () => {
    const box: PrimerBox = {
      primerId: 'p1',
      target: { field: 'taskComment', entryId: 'extra-1' },
    };
    const state = setup();

    expect(focusActionFor(state, box)).toEqual({
      type: 'showTarget',
      formId: 'p1',
      target: box.target,
    });
    expect(
      focusActionFor(apply(state, { type: 'openReview' }), box),
    ).toBeNull();
    expect(focusActionFor(state, { ...box, primerId: 'p2' })).toBeNull();
  });
});
