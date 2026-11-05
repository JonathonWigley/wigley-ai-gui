import { describe, expect, it } from 'vitest';
import type { KeyBind, UserKeymap } from '../../../contracts/keymap';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  advancedText,
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
    defaultBindLayers: [defaultBinds],
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

  it('withAddedBind_EnterSpellingOfCR_ReplacesUserBind', () => {
    const layer = { binds: [{ keys: 'g<CR>', scope: 'p.s', command: 'p.a' }] };
    const added = { keys: 'g<Enter>', scope: 'p.s', command: 'p.b' };

    expect(withAddedBind(layer, added, schema())).toEqual({ binds: [added] });
  });

  it('withAddedBind_InsertModeBind_KeepsPageBindOnSameKeys', () => {
    const page = { keys: '<CR>', scope: 'p.s', command: 'p.a' };
    const added = {
      keys: '<CR>',
      scope: 'p.s',
      command: 'p.b',
      mode: 'insert' as const,
    };

    expect(withAddedBind({ binds: [page] }, added, schema())).toEqual({
      binds: [page, added],
    });
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
      page: null,
      editor: { state: 'active' as const },
    };

    expect(withRemovedBind(null, line, schema())).toEqual({
      unbind: [{ keys: 'x', scope: 'p.s', where: 'box' }],
    });
  });

  it('withRemovedBind_DefaultWhosePageHalfALaterDefaultTook_UnbindsTheBoxHalf', () => {
    const line = {
      bind: { keys: '<Leader>x', scope: 'p.s', command: 'p.a' },
      origin: 'default' as const,
      page: null,
      editor: { state: 'active' as const },
    };

    expect(withRemovedBind(null, line, schema())).toEqual({
      unbind: [{ keys: '<Leader>x', scope: 'p.s', where: 'box' }],
    });
  });

  it('withRemovedBind_User_LeavesBinds', () => {
    const line = {
      bind,
      origin: 'user' as const,
      page: null,
      editor: { state: 'active' as const },
    };

    expect(withRemovedBind({ binds: [bind] }, line, schema())).toEqual({});
  });

  it('withRemovedBind_NoLayerLeader_LeavesDefaultLeaderSpelling', () => {
    const user = { keys: '<Leader>x', scope: 'p.s', command: 'p.a' };
    const line = {
      bind: { ...user, keys: '<Space>x' },
      origin: 'user' as const,
      page: { state: 'active' as const },
      editor: { state: 'active' as const },
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

  it('withCommandReset_RemovesOtherCommandsBindOnDefaultKeys', () => {
    const elsewhere = { keys: 'x', scope: 'p.t', command: 'p.b' };
    const layer: UserKeymap = {
      binds: [{ keys: 'x', scope: 'p.s', command: 'p.b' }, elsewhere],
    };

    const given = schema([{ keys: 'x', scope: 'p.s', command: 'p.a' }]);

    expect(withCommandReset(layer, 'p.a', given)).toEqual({
      binds: [elsewhere],
    });
  });

  it('withCommandReset_CoreDefaultAPluginDefaultTook_KeepsBindsOnItsKeys', () => {
    const layer: UserKeymap = {
      binds: [{ keys: 'x', scope: 'p.s', command: 'p.c' }],
      unbind: [{ keys: 'x', scope: 'p.s' }],
    };
    const given = {
      ...schema(),
      defaultBindLayers: [
        [{ keys: 'x', scope: 'p.s', command: 'core.a' }],
        [{ keys: 'x', scope: 'p.s', command: 'p.b' }],
      ],
    };

    expect(withCommandReset(layer, 'core.a', given)).toEqual(layer);
  });

  it('withCommandReset_RemovesWiderUnbind', () => {
    const layer: UserKeymap = { unbind: [{ keys: 'x', scope: 'p.s' }] };

    const given = schema([
      { keys: 'x', scope: 'p.s', command: 'p.a', where: 'both' },
    ]);

    expect(withCommandReset(layer, 'p.a', given)).toEqual({});
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

  it('withAdvanced_UneditedText_KeepsInterleavedUnbindOrder', () => {
    const layer: UserKeymap = {
      unbind: [
        { app: 'CommandOrControl+Q' },
        { keys: 'x', scope: 'p.s' },
        { global: 'CommandOrControl+Shift+Space' },
        { keys: 'y', scope: 'p.s' },
      ],
    };

    expect(withAdvanced(layer, advancedText(layer))).toEqual({
      type: 'layer',
      layer,
    });
  });
});

describe('withCommandReset with an argument', () => {
  it('withCommandReset_ArgGiven_ResetsOnlyThatArg', () => {
    const one = { keys: '1', scope: 'p.s', command: 'p.pick', arg: 1 };
    const two = { keys: '2', scope: 'p.s', command: 'p.pick', arg: 2 };
    const layer = {
      binds: [
        { keys: 'a', scope: 'p.s', command: 'p.pick', arg: 1 },
        { keys: 'b', scope: 'p.s', command: 'p.pick', arg: 2 },
      ],
      unbind: [
        { keys: '1', scope: 'p.s' },
        { keys: '2', scope: 'p.s' },
      ],
    };

    expect(withCommandReset(layer, 'p.pick', schema([one, two]), 1)).toEqual({
      binds: [layer.binds[1]],
      unbind: [layer.unbind[1]],
    });
  });
});
