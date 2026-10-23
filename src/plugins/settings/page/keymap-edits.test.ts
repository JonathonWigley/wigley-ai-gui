import { describe, expect, it } from 'vitest';
import type { KeyBind, UserKeymap } from '../../../contracts/keymap';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  withAddedBind,
  withAdvanced,
  withCommandReset,
  withRemovedBind,
} from './keymap-edits';

function schema(defaultBinds: KeyBind[] = []): UserConfigSchema {
  return {
    sections: [],
    commands: {},
    scopes: [],
    defaultBinds,
    defaultAccelerators: { app: [], global: [], intercept: [] },
    defaultLeader: '<Space>',
  };
}

describe('withAddedBind', () => {
  it('withAddedBind_ReplacesUserBindOnSameKeys', () => {
    const layer = { binds: [{ keys: 'x', scope: 'p.s', command: 'p.a' }] };
    const added = { keys: 'x', scope: 'p.s', command: 'p.b' };

    expect(withAddedBind(layer, added, schema())).toEqual({ binds: [added] });
  });

  it('withAddedBind_NoLayerLeader_ReplacesDefaultLeaderSpelling', () => {
    const layer = {
      binds: [{ keys: '<Leader>x', scope: 'p.s', command: 'p.a' }],
    };
    const added = { keys: '<Space>x', scope: 'p.s', command: 'p.b' };

    expect(withAddedBind(layer, added, schema())).toEqual({ binds: [added] });
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

    expect(withRemovedBind(null, line, schema())).toEqual({
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

    expect(withRemovedBind({ binds: [bind] }, line, schema())).toEqual({});
  });

  it('withRemovedBind_NoLayerLeader_LeavesDefaultLeaderSpelling', () => {
    const user = { keys: '<Leader>x', scope: 'p.s', command: 'p.a' };
    const line = {
      bind: { ...user, keys: '<Space>x' },
      origin: 'user' as const,
      state: 'active' as const,
      replacedBy: null,
    };

    expect(withRemovedBind({ binds: [user] }, line, schema())).toEqual({});
  });
});

describe('withCommandReset', () => {
  it('withCommandReset_RemovesUserBindsAndUnbinds', () => {
    const other = { keys: 'y', scope: 'p.s', command: 'p.b' };
    const layer: UserKeymap = {
      binds: [{ keys: 'z', scope: 'p.s', command: 'p.a' }, other],
      unbind: [{ keys: 'x', scope: 'p.s' }, { app: 'CommandOrControl+Q' }],
    };

    const given = schema([{ keys: 'x', scope: 'p.s', command: 'p.a' }]);

    expect(withCommandReset(layer, 'p.a', given)).toEqual({
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

  it('withAdvanced_KeepsKeysUnbinds', () => {
    const keysEntry = { keys: 'x', scope: 'p.s' };
    const layer: UserKeymap = {
      unbind: [keysEntry, { app: 'CommandOrControl+Q' }],
    };

    expect(
      withAdvanced(layer, '{"unbind":[{"app":"CommandOrControl+W"}]}'),
    ).toEqual({
      type: 'layer',
      layer: { unbind: [keysEntry, { app: 'CommandOrControl+W' }] },
    });
  });
});
