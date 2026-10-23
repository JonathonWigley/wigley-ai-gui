import { describe, expect, it } from 'vitest';
import type { UserKeymap } from '../../../contracts/keymap';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  withAddedBind,
  withAdvanced,
  withCommandReset,
  withRemovedBind,
} from './keymap-edits';

describe('withAddedBind', () => {
  it('withAddedBind_ReplacesUserBindOnSameKeys', () => {
    const layer = { binds: [{ keys: 'x', scope: 'p.s', command: 'p.a' }] };
    const added = { keys: 'x', scope: 'p.s', command: 'p.b' };

    expect(withAddedBind(layer, added)).toEqual({ binds: [added] });
  });
});

describe('withRemovedBind', () => {
  const bind = {
    keys: 'x',
    scope: 'p.s',
    command: 'p.a',
    where: 'box' as const,
  };

  it('withRemovedBind_Default_AddsUnbind', () => {
    const line = {
      bind,
      origin: 'default' as const,
      state: 'active' as const,
      replacedBy: null,
    };

    expect(withRemovedBind(null, line)).toEqual({
      unbind: [{ keys: 'x', scope: 'p.s', where: 'box' }],
    });
  });

  it('withRemovedBind_User_LeavesBinds', () => {
    const line = {
      bind,
      origin: 'user' as const,
      state: 'active' as const,
      replacedBy: null,
    };

    expect(withRemovedBind({ binds: [bind] }, line)).toEqual({});
  });
});

describe('withCommandReset', () => {
  it('withCommandReset_RemovesUserBindsAndUnbinds', () => {
    const schema: UserConfigSchema = {
      sections: [],
      commands: {},
      scopes: [],
      defaultBinds: [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
      defaultAccelerators: { app: [], global: [], intercept: [] },
      defaultLeader: '<Space>',
    };
    const other = { keys: 'y', scope: 'p.s', command: 'p.b' };
    const layer: UserKeymap = {
      binds: [{ keys: 'z', scope: 'p.s', command: 'p.a' }, other],
      unbind: [{ keys: 'x', scope: 'p.s' }, { app: 'CommandOrControl+Q' }],
    };

    expect(withCommandReset(layer, 'p.a', schema)).toEqual({
      binds: [other],
      unbind: [{ app: 'CommandOrControl+Q' }],
    });
  });
});

describe('withAdvanced', () => {
  it('withAdvanced_RejectsBinds', () => {
    expect(withAdvanced(null, '{"binds": []}')).toEqual({
      type: 'problem',
      problem: '"binds" belongs in the command rows',
    });
  });

  it('withAdvanced_KeepsRowSections', () => {
    const bind = { keys: 'x', scope: 'p.s', command: 'p.a' };
    const layer: UserKeymap = { leader: ',', binds: [bind] };

    expect(withAdvanced(layer, '{"groups":{"<Leader>q":"quit"}}')).toEqual({
      type: 'layer',
      layer: { leader: ',', binds: [bind], groups: { '<Leader>q': 'quit' } },
    });
  });
});
