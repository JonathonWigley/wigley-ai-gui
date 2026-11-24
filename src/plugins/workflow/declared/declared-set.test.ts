import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import type { KeyedSlotWriter } from '../../../contracts/state';
import type { DeclaredWorkflow } from '../contract';
import {
  createDeclaredRegistry,
  mergeDeclared,
  publishDeclared,
} from './declared-set';
import { sampleDeclared } from './sample-workflows';

function labelled(label: string): DeclaredWorkflow {
  const entry = sampleDeclared('small');
  entry.decl.label = label;
  return entry;
}

describe('mergeDeclared', () => {
  it('AnAddedIdAlreadyContributed_LeavesTheContributedEntry', () => {
    const contributed = labelled('contributed');
    const merged = mergeDeclared(
      [contributed],
      [labelled('added'), sampleDeclared('large')],
    );

    expect(merged.map((entry) => [entry.id, entry.decl.label])).toEqual([
      ['wigley:small', 'contributed'],
      ['wigley:large', sampleDeclared('large').decl.label],
    ]);
  });
});

describe('publishDeclared', () => {
  function fakeSlot() {
    const held = new Map<string, DeclaredWorkflow>();
    const writes: string[] = [];
    const slot = {
      get: (key) => held.get(key),
      all: () => new Map(held),
      set(key, value) {
        writes.push(`set ${key}`);
        held.set(key, value);
      },
      delete(key) {
        writes.push(`delete ${key}`);
        held.delete(key);
      },
      dispose: () => undefined,
    } satisfies KeyedSlotWriter<DeclaredWorkflow>;
    return { slot, writes };
  }

  it('AnUnchangedList_WritesNothingAgain', () => {
    const { slot, writes } = fakeSlot();
    publishDeclared(slot, [sampleDeclared('small')]);
    writes.length = 0;

    publishDeclared(slot, [sampleDeclared('small')]);

    expect(writes).toEqual([]);
  });

  it('AReorderedList_EmptiesTheSlotBeforeSettingInOrder', () => {
    const { slot } = fakeSlot();
    publishDeclared(slot, [sampleDeclared('small'), sampleDeclared('large')]);

    publishDeclared(slot, [sampleDeclared('large'), sampleDeclared('small')]);

    expect([...slot.all().keys()]).toEqual(['wigley:large', 'wigley:small']);
  });
});

describe('createDeclaredRegistry', () => {
  function registry() {
    const log: string[] = [];
    const created = createDeclaredRegistry((entry): Disposable => {
      log.push(`build ${entry.id} ${entry.decl.label}`);
      return { dispose: () => log.push(`dispose ${entry.id}`) };
    });
    return { created, log };
  }

  it('AChangedEntry_DisposesTheOldAndBuildsTheNew', () => {
    const { created, log } = registry();
    created.syncList([labelled('a')]);

    created.syncList([labelled('a')]);
    created.syncList([labelled('b')]);

    expect(log).toEqual([
      'build wigley:small a',
      'dispose wigley:small',
      'build wigley:small b',
    ]);
  });

  it('AnIdLeavingTheList_IsDisposed', () => {
    const { created, log } = registry();
    created.syncList([sampleDeclared('small'), sampleDeclared('large')]);

    created.syncList([sampleDeclared('large')]);

    expect(log.at(-1)).toBe('dispose wigley:small');
  });

  it('AnUndefinedEntry_IsDisposed', () => {
    const { created, log } = registry();
    created.sync('wigley:small', sampleDeclared('small'));

    created.sync('wigley:small', undefined);

    expect(log.at(-1)).toBe('dispose wigley:small');
  });
});
