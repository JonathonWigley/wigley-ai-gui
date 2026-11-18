import { describe, expect, it, vi } from 'vitest';
import type { PageKind } from '../../contract';
import { createPageKinds } from './page-kinds';
import { pollPageKind } from './plugin-page-kind.test-support';

describe('createPageKinds', () => {
  it.each([
    {
      case: 'an id already added',
      kind: () => pollPageKind('poll'),
      message: 'page kind poll is already added',
    },
    {
      case: 'the notices stop id',
      kind: () => pollPageKind('notices'),
      message: 'page kind id notices is reserved for the notices stop',
    },
    {
      case: 'a null rail order on a kind but notice',
      kind: (): PageKind => ({ ...pollPageKind('vote'), railOrder: null }),
      message:
        'page kind vote has no rail order: only notice draws on the notices stop',
    },
    {
      case: 'an answerable kind with no pick',
      kind: (): PageKind => {
        const kind = pollPageKind('vote');
        return { ...kind, reduce: { ...kind.reduce, pick: undefined } };
      },
      message:
        'page kind vote: reduce.pick is given exactly when spec.answerable is true',
    },
    {
      case: 'a pick on a kind that takes no answer',
      kind: (): PageKind => {
        const kind = pollPageKind('vote');
        return { ...kind, spec: { ...kind.spec, answerable: false } };
      },
      message:
        'page kind vote: reduce.pick is given exactly when spec.answerable is true',
    },
  ])('register_RejectsEachBadKind: $case', ({ kind, message }) => {
    const kinds = createPageKinds();
    kinds.register(pollPageKind('poll'));
    const listener = vi.fn();
    kinds.onChanged(listener);
    const before = kinds.table();

    expect(() => kinds.register(kind())).toThrow(message);
    expect(kinds.table()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('register_ListenerThrows_RegistersNothingAndRethrows', () => {
    const kinds = createPageKinds();
    const before = kinds.table();
    kinds.onChanged(() => {
      throw new Error('listener broke');
    });

    expect(() => kinds.register(pollPageKind('poll'))).toThrow(
      'listener broke',
    );
    expect(kinds.table()).toBe(before);
    expect(kinds.table().get('poll')).toBeUndefined();
  });

  it('register_Dispose_RemovesOnceAndNotifiesOnce', () => {
    const kinds = createPageKinds();
    const registration = kinds.register(pollPageKind('poll'));
    const listener = vi.fn();
    kinds.onChanged(listener);

    registration.dispose();
    registration.dispose();

    expect(kinds.table().get('poll')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('railKinds_ByRailOrderThenRegistrationOrder', () => {
    const kinds = createPageKinds();
    for (const [id, railOrder] of [
      ['a', 20],
      ['b', 10],
      ['c', 15],
      ['d', 15],
    ] as const) {
      kinds.register(pollPageKind(id, { railOrder }));
    }

    const table = kinds.table();

    expect(table.railKinds.map((kind) => kind.spec.id)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
    expect(table.kinds().map((kind) => kind.spec.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});
