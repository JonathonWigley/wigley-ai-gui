import { describe, expect, it } from 'vitest';
import { createStageList } from './stage-list';

interface FakeStage {
  id: string;
  order: number;
}

const stage = (id: string, order: number): FakeStage => ({ id, order });

describe('createStageList', () => {
  it.each([
    {
      case: 'adds out of order, sorted on order',
      run: (add: (s: FakeStage) => () => void) => {
        add(stage('c', 30));
        add(stage('a', 10));
        add(stage('b', 20));
      },
      ids: ['a', 'b', 'c'],
    },
    {
      case: 'a second stage of a held order goes after it',
      run: (add: (s: FakeStage) => () => void) => {
        add(stage('a', 10));
        add(stage('c', 30));
        add(stage('b1', 20));
        add(stage('b2', 20));
      },
      ids: ['a', 'b1', 'b2', 'c'],
    },
    {
      case: 'dispose removes only its own stage, twice doing nothing',
      run: (add: (s: FakeStage) => () => void) => {
        add(stage('a', 10));
        const disposeB = add(stage('b', 20));
        add(stage('c', 30));
        disposeB();
        disposeB();
      },
      ids: ['a', 'c'],
    },
    {
      case: 'an id disposed is added again, at its new order',
      run: (add: (s: FakeStage) => () => void) => {
        const disposeA = add(stage('a', 10));
        add(stage('b', 20));
        disposeA();
        add(stage('a', 30));
      },
      ids: ['b', 'a'],
    },
  ])('$case', ({ run, ids }) => {
    const list = createStageList<FakeStage>();

    run((added) => {
      const handle = list.add(added);
      return () => handle.dispose();
    });

    expect(list.all().map((held) => held.id)).toEqual(ids);
  });

  it('add_HeldId_ThrowsNamingTheIdAndKeepsTheList', () => {
    const list = createStageList<FakeStage>();
    list.add(stage('build', 10));

    expect(() => list.add(stage('build', 20))).toThrow(
      /^build is already added$/,
    );
    expect(list.all()).toEqual([stage('build', 10)]);
  });
});
