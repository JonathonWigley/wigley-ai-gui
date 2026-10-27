import { describe, expect, it, vi } from 'vitest';
import type { FormsCardPart, FormsReviewColumn, ItemKind } from '../contract';
import { createFormsContributions } from './contributions';

function part(id: string, kinds: ItemKind[]): FormsCardPart {
  return { id, kinds, build: () => ({}) };
}

function column(id: string): FormsReviewColumn {
  return { id, title: id, cell: () => '' };
}

describe('createFormsContributions', () => {
  it('addCardPart_TakenId_Throws', () => {
    const contributions = createFormsContributions();
    contributions.addCardPart(part('p1', ['finding']));

    expect(() => contributions.addCardPart(part('p1', ['question']))).toThrow(
      'p1',
    );
  });

  it('cardParts_Kind_ListsMatchingPartsInAddOrder', () => {
    const contributions = createFormsContributions();
    contributions.addCardPart(part('p1', ['finding']));
    contributions.addCardPart(part('q1', ['question']));
    contributions.addCardPart(part('p2', ['finding']));

    const ids = contributions.cardParts('finding').map((each) => each.id);

    expect(ids).toEqual(['p1', 'p2']);
  });

  it('addCardPart_Dispose_RemovesPartAndNotifies', () => {
    const contributions = createFormsContributions();
    const added = contributions.addCardPart(part('p1', ['finding']));
    const listener = vi.fn();
    contributions.onChanged(listener);

    added.dispose();

    expect(contributions.cardParts('finding')).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('addCardPart_DisposeTwice_SecondDoesNothing', () => {
    const contributions = createFormsContributions();
    const added = contributions.addCardPart(part('p1', ['finding']));
    contributions.addCardPart(part('p2', ['finding']));
    const listener = vi.fn();
    contributions.onChanged(listener);

    added.dispose();
    added.dispose();

    const ids = contributions.cardParts('finding').map((each) => each.id);
    expect(ids).toEqual(['p2']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('addCardPart_OldHandleAfterReAdd_LeavesReAddedPart', () => {
    const contributions = createFormsContributions();
    const added = part('p1', ['finding']);
    const first = contributions.addCardPart(added);
    first.dispose();
    contributions.addCardPart(added);
    const listener = vi.fn();
    contributions.onChanged(listener);

    first.dispose();

    expect(contributions.cardParts('finding')).toEqual([added]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('onChanged_OldHandleAfterReAdd_KeepsListener', () => {
    const contributions = createFormsContributions();
    const listener = vi.fn();
    const first = contributions.onChanged(listener);
    first.dispose();
    contributions.onChanged(listener);

    first.dispose();
    contributions.addCardPart(part('p1', ['finding']));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('addReviewColumn_Dispose_RemovesColumnAndNotifies', () => {
    const contributions = createFormsContributions();
    const added = contributions.addReviewColumn(column('c1'));
    const listener = vi.fn();
    contributions.onChanged(listener);

    added.dispose();

    expect(contributions.reviewColumns()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
