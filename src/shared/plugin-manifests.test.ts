import { describe, expect, it } from 'vitest';
import type { DefaultKeymap, KeyBind, Keymap } from '../contracts/keymap';
import type { CommandInfo, PluginManifest } from '../contracts/plugin';
import {
  commandInfos,
  defaultBindLines,
  defaultBindStanding,
  dependencyOrder,
  disabledDependencyProblem,
  expandBind,
  mergeKeymap,
  overrideSettings,
  pluginOptionalSettings,
  pluginSettingInfo,
  pluginSettings,
  pluginThemeTokens,
  requireListed,
  scopeInfos,
  withoutPluginBinds,
} from './plugin-manifests';

function manifest(
  id: string,
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id,
    dependsOn: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
    ...overrides,
  };
}

function defaultKeymap(overrides: Partial<DefaultKeymap> = {}): DefaultKeymap {
  return {
    leader: '<Space>',
    groups: {},
    binds: [
      { keys: '<Leader>s', scope: 'any', command: 'core.save' },
      { keys: 'q', scope: 'any', command: 'core.quit' },
    ],
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    app: [{ accelerator: 'CommandOrControl+W', command: 'core.close' }],
    intercept: [{ key: 'Tab', control: true, command: 'core.next' }],
    global: [{ accelerator: 'Alt+Space', command: 'window.summon' }],
    ...overrides,
  };
}

// A default keymap holding only `binds`.
function bindsOnly(...binds: KeyBind[]): DefaultKeymap {
  return defaultKeymap({ binds });
}

const p = manifest('p', {
  commands: { go: { label: 'Go', group: 'Moves', runsIn: 'page' } },
  scopes: { view: 'In the view' },
  keys: {
    binds: [
      { keys: 'g', scope: 'view', command: 'go' },
      { keys: 'x', scope: 'any', command: 'go' },
      { keys: '<Leader>g', scope: 'view', command: 'go', where: 'box' },
    ],
    app: [{ accelerator: 'CommandOrControl+G', command: 'go' }],
    global: [{ accelerator: 'Alt+G', command: 'go' }],
    intercept: [{ key: 'g', meta: true, command: 'go' }],
  },
});

describe('mergeKeymap', () => {
  it('qualifies plugin commands and scopes and keeps the default binds', () => {
    const defaults = defaultKeymap();

    const merged = mergeKeymap(defaults, [p], {});

    expect(merged.page).toEqual([
      { keys: [' ', 's'], scope: 'any', command: 'core.save' },
      { keys: ['q'], scope: 'any', command: 'core.quit' },
      { keys: ['g'], scope: 'p.view', command: 'p.go' },
      { keys: ['x'], scope: 'any', command: 'p.go' },
    ]);
    expect(merged.editor).toEqual({
      leader: '<Space>',
      remaps: defaults.remaps,
      binds: [
        { keys: '<Leader>s', scope: 'any', command: 'core.save' },
        { keys: '<Leader>g', scope: 'p.view', command: 'p.go' },
      ],
    });
    expect(merged.app).toEqual([
      ...defaults.app,
      { accelerator: 'CommandOrControl+G', command: 'p.go' },
    ]);
    expect(merged.global).toEqual([
      ...defaults.global,
      { accelerator: 'Alt+G', command: 'p.go' },
    ]);
    expect(merged.intercept).toEqual([
      ...defaults.intercept,
      { key: 'g', meta: true, command: 'p.go' },
    ]);
  });

  it("keeps an editor bind's any scope unqualified", () => {
    const h = manifest('p', {
      commands: { go: { label: 'Go', group: 'Moves', runsIn: 'page' } },
      keys: {
        binds: [{ keys: '<Leader>h', scope: 'any', command: 'go' }],
      },
    });

    const merged = mergeKeymap(defaultKeymap(), [h], {});

    expect(merged.editor.binds).toContainEqual({
      keys: '<Leader>h',
      scope: 'any',
      command: 'p.go',
    });
  });

  it("puts the default binds first, then each plugin's in list order", () => {
    const q = manifest('q', {
      commands: { stop: { label: 'Stop', group: 'Moves', runsIn: 'page' } },
      keys: { binds: [{ keys: 's', scope: 'any', command: 'stop' }] },
    });

    const merged = mergeKeymap(defaultKeymap(), [q, p], {});

    expect(merged.page.map((bind) => bind.command)).toEqual([
      'core.save',
      'core.quit',
      'q.stop',
      'p.go',
      'p.go',
    ]);
  });

  it("a later plugin layer replaces an earlier one's bind", () => {
    const binding = (id: string, main: string[]) =>
      manifest(id, {
        dependsOn: { main, page: [] },
        commands: { go: { label: 'Go', group: 'Moves', runsIn: 'page' } },
        keys: { binds: [{ keys: 'x', scope: 'any', command: 'go' }] },
      });

    const merged = mergeKeymap(
      defaultKeymap(),
      [binding('a', ['b']), binding('b', [])],
      {},
    );

    expect(merged.page.filter((bind) => bind.keys.join(' ') === 'x')).toEqual([
      { keys: ['x'], scope: 'any', command: 'a.go' },
    ]);
  });

  it('mergeKeymap_LeaderBind_FiresOnPageAndInBox', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Leader>ks', scope: 'any', command: 'c' }),
      [],
      {},
    );

    expect(merged.page).toEqual([
      { keys: [' ', 'k', 's'], scope: 'any', command: 'c' },
    ]);
    expect(merged.editor.binds).toEqual([
      { keys: '<Leader>ks', scope: 'any', command: 'c' },
    ]);
  });

  it('mergeKeymap_RawKeys_FirePageOnly', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: 'gg', scope: 'any', command: 'c' }),
      [],
      {},
    );

    expect(merged.page).toEqual([
      { keys: ['g', 'g'], scope: 'any', command: 'c' },
    ]);
    expect(merged.editor.binds).toEqual([]);
  });

  it('mergeKeymap_NamedKey_ConvertsToPageKeyName', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Esc>', scope: 'x', command: 'c' }),
      [],
      {},
    );

    expect(merged.page).toEqual([
      { keys: ['Escape'], scope: 'x', command: 'c' },
    ]);
  });

  it('mergeKeymap_WhereBox_FiresInBoxOnly', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<CR>', scope: 'x', command: 'c', where: 'box' }),
      [],
      {},
    );

    expect(merged.page).toEqual([]);
    expect(merged.editor.binds).toEqual([
      { keys: '<CR>', scope: 'x', command: 'c' },
    ]);
  });

  it('mergeKeymap_InsertMode_IsEditorOnly', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<CR>', scope: 'x', command: 'c', mode: 'insert' }),
      [],
      {},
    );

    expect(merged.page).toEqual([]);
    expect(merged.editor.binds).toEqual([
      { keys: '<CR>', scope: 'x', command: 'c', mode: 'insert' },
    ]);
  });

  it('mergeKeymap_Chord_IsPageBindOnly', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<A-o>', scope: 'any', command: 'c' }),
      [],
      {},
    );

    expect(merged.page).toEqual([
      { keys: ['<A-o>'], scope: 'any', command: 'c' },
    ]);
    expect(merged.editor.binds).toEqual([]);
  });

  it('mergeKeymap_UserLeader_RespellsPageLeader', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Leader>ks', scope: 'any', command: 'c' }),
      [],
      { leader: ',' },
    );

    expect(merged.page).toEqual([
      { keys: [',', 'k', 's'], scope: 'any', command: 'c' },
    ]);
    expect(merged.editor.leader).toBe(',');
  });

  it('mergeKeymap_UserBind_ReplacesBothHalves', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Leader>ks', scope: 'any', command: 'c' }),
      [],
      { binds: [{ keys: '<Leader>ks', scope: 'any', command: 'user' }] },
    );

    expect(merged.page).toEqual([
      { keys: [' ', 'k', 's'], scope: 'any', command: 'user' },
    ]);
    expect(merged.editor.binds).toEqual([
      { keys: '<Leader>ks', scope: 'any', command: 'user' },
    ]);
  });

  it('mergeKeymap_UserBindOfADefaultCommand_ComesBeforeItsDefaultBinds', () => {
    const merged = mergeKeymap(
      bindsOnly(
        { keys: 'q', scope: 'any', command: 'other' },
        { keys: '<A-o>', scope: 'any', command: 'next' },
        { keys: '<Leader>n', scope: 'any', command: 'next' },
      ),
      [],
      {
        binds: [
          { keys: '<A-u>', scope: 'any', command: 'next' },
          { keys: '<Leader>u', scope: 'any', command: 'next' },
        ],
      },
    );

    expect(merged.page).toEqual([
      { keys: ['q'], scope: 'any', command: 'other' },
      { keys: ['<A-u>'], scope: 'any', command: 'next' },
      { keys: [' ', 'u'], scope: 'any', command: 'next' },
      { keys: ['<A-o>'], scope: 'any', command: 'next' },
      { keys: [' ', 'n'], scope: 'any', command: 'next' },
    ]);
    expect(merged.editor.binds).toEqual([
      { keys: '<Leader>u', scope: 'any', command: 'next' },
      { keys: '<Leader>n', scope: 'any', command: 'next' },
    ]);
  });

  it('mergeKeymap_Unbind_RemovesBothHalves', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Leader>ks', scope: 'any', command: 'c' }),
      [],
      { unbind: [{ keys: '<Leader>ks', scope: 'any' }] },
    );

    expect(merged.page).toEqual([]);
    expect(merged.editor.binds).toEqual([]);
  });

  it('mergeKeymap_UnbindWhereBox_KeepsPageHalf', () => {
    const merged = mergeKeymap(
      bindsOnly({ keys: '<Leader>ks', scope: 'any', command: 'c' }),
      [],
      { unbind: [{ keys: '<Leader>ks', scope: 'any', where: 'box' }] },
    );

    expect(merged.page).toEqual([
      { keys: [' ', 'k', 's'], scope: 'any', command: 'c' },
    ]);
    expect(merged.editor.binds).toEqual([]);
  });

  it('mergeKeymap_UserGroup_ReplacesDefaultName', () => {
    const merged = mergeKeymap(
      defaultKeymap({
        groups: { '<Leader>k': 'windows', '<Leader>z': 'debug' },
      }),
      [],
      { groups: { '<Leader>k': 'panes' } },
    );

    expect(merged.groups).toEqual({
      '<Leader>k': 'panes',
      '<Leader>z': 'debug',
    });
  });

  it('mergeKeymap_ManifestGroup_LayersBetweenDefaultAndUser', () => {
    const plugin = manifest('p', {
      keys: { groups: { '<Leader>k': 'panes', '<Leader>m': 'moves' } },
    });

    const merged = mergeKeymap(
      defaultKeymap({
        groups: { '<Leader>k': 'windows', '<Leader>z': 'debug' },
      }),
      [plugin],
      { groups: { '<Leader>m': 'motions' } },
    );

    expect(merged.groups).toEqual({
      '<Leader>k': 'panes',
      '<Leader>z': 'debug',
      '<Leader>m': 'motions',
    });
  });
});

describe('expandBind', () => {
  it('expandBind_ChordInBox_Throws', () => {
    expect(() =>
      expandBind(
        { keys: '<A-o>', scope: 'any', command: 'c', where: 'box' },
        '<Space>',
      ),
    ).toThrow('<A-o>');
  });

  it('throws on a bind with a mode and where page', () => {
    expect(() =>
      expandBind(
        {
          keys: 'x',
          scope: 'any',
          command: 'c',
          mode: 'normal',
          where: 'page',
        },
        '<Space>',
      ),
    ).toThrow('where "page"');
  });

  it("leaves a box-only bind's keys unconverted", () => {
    expect(
      expandBind(
        { keys: '<F5>', scope: 'any', command: 'c', where: 'box' },
        '<Space>',
      ),
    ).toEqual({
      page: null,
      editor: { keys: '<F5>', scope: 'any', command: 'c' },
    });
  });
});

describe('defaultBindStanding', () => {
  const leader = '<Space>';

  it('defaultBindStanding_EnterSpelledCR_IsReplaced', () => {
    const user = { keys: 'g<Enter>', scope: 's', command: 'b' };

    expect(
      defaultBindStanding(
        { keys: 'g<CR>', scope: 's', command: 'a' },
        { binds: [user] },
        leader,
      ),
    ).toEqual({ page: { state: 'replaced', by: user }, editor: null });
  });

  it('defaultBindStanding_SpaceInLowerCase_IsReplaced', () => {
    const user = { keys: '<space>x', scope: 's', command: 'b' };

    expect(
      defaultBindStanding(
        { keys: '<Space>x', scope: 's', command: 'a' },
        { binds: [user] },
        leader,
      ).page,
    ).toEqual({ state: 'replaced', by: user });
  });

  it('defaultBindStanding_PageUserBindOverBoxDefault_StaysActive', () => {
    expect(
      defaultBindStanding(
        { keys: 'x', scope: 's', command: 'a', where: 'box' },
        { binds: [{ keys: 'x', scope: 's', command: 'b' }] },
        leader,
      ),
    ).toEqual({ page: null, editor: { state: 'active' } });
  });

  it('defaultBindStanding_InsertUserBindOverPageDefault_StaysActive', () => {
    expect(
      defaultBindStanding(
        { keys: '<CR>', scope: 's', command: 'a' },
        { binds: [{ keys: '<CR>', scope: 's', command: 'b', mode: 'insert' }] },
        leader,
      ),
    ).toEqual({ page: { state: 'active' }, editor: null });
  });

  it('defaultBindStanding_ModeUnbindWithoutWhere_RemovesBoxModeDefault', () => {
    const entry = { keys: '<CR>', scope: 's', mode: 'insert' as const };

    expect(
      defaultBindStanding(
        {
          keys: '<CR>',
          scope: 's',
          command: 'a',
          mode: 'insert',
          where: 'box',
        },
        { unbind: [entry] },
        leader,
      ),
    ).toEqual({ page: null, editor: { state: 'removed', by: entry } });
  });

  it('defaultBindStanding_LeaderSpelledOut_FiresOnThePageOnly', () => {
    const entry = { keys: '<Space>x', scope: 's', where: 'page' as const };

    expect(
      defaultBindStanding(
        { keys: '<Space>x', scope: 's', command: 'a' },
        { unbind: [entry] },
        leader,
      ),
    ).toEqual({ page: { state: 'removed', by: entry }, editor: null });
  });

  it('defaultBindStanding_PageUnbindOverBothDefault_RemovesPageHalf', () => {
    const entry = { keys: 'x', scope: 's' };

    expect(
      defaultBindStanding(
        { keys: 'x', scope: 's', command: 'a', where: 'both' },
        { unbind: [entry] },
        leader,
      ),
    ).toEqual({
      page: { state: 'removed', by: entry },
      editor: { state: 'active' },
    });
  });

  it('defaultBindStanding_PageUserBindOverLeaderDefault_ReplacesPageHalf', () => {
    const user = {
      keys: '<Leader>x',
      scope: 's',
      command: 'b',
      where: 'page' as const,
    };

    expect(
      defaultBindStanding(
        { keys: '<Leader>x', scope: 's', command: 'a' },
        { binds: [user] },
        leader,
      ),
    ).toEqual({
      page: { state: 'replaced', by: user },
      editor: { state: 'active' },
    });
  });

  it('defaultBindStanding_UnbindAndUserBind_IsRemoved', () => {
    const entry = { keys: 'x', scope: 's' };

    expect(
      defaultBindStanding(
        { keys: 'x', scope: 's', command: 'a' },
        { unbind: [entry], binds: [{ keys: 'x', scope: 's', command: 'b' }] },
        leader,
      ).page,
    ).toEqual({ state: 'removed', by: entry });
  });

  it('defaultBindStanding_NormalModeUnbindOverBoxDefaultWithoutMode_RemovesEditorHalf', () => {
    const entry = { keys: 'x', scope: 's', mode: 'normal' as const };

    expect(
      defaultBindStanding(
        { keys: 'x', scope: 's', command: 'a', where: 'box' },
        { unbind: [entry] },
        leader,
      ),
    ).toEqual({ page: null, editor: { state: 'removed', by: entry } });
  });

  it('defaultBindStanding_OtherScope_StaysActive', () => {
    expect(
      defaultBindStanding(
        { keys: 'x', scope: 's', command: 'a' },
        { binds: [{ keys: 'x', scope: 't', command: 'b' }] },
        leader,
      ).page,
    ).toEqual({ state: 'active' });
  });
});

describe('defaultBindLines', () => {
  const leader = '<Space>';

  it('defaultBindLines_PluginDefaultOnCoreDefaultsKeys_DropsCoreDefault', () => {
    const core = { keys: 'x', scope: 's', command: 'a' };
    const plugin = { keys: 'x', scope: 's', command: 'p.b' };

    expect(defaultBindLines([[core], [plugin]], {}, leader)).toEqual([
      { bind: plugin, page: { state: 'active' }, editor: null },
    ]);
  });

  it('defaultBindLines_PluginPageDefaultOverCoreLeaderDefault_KeepsEditorHalf', () => {
    const core = { keys: '<Leader>x', scope: 's', command: 'a' };
    const plugin = {
      keys: '<Leader>x',
      scope: 's',
      command: 'p.b',
      where: 'page' as const,
    };

    expect(defaultBindLines([[core], [plugin]], {}, leader)).toEqual([
      { bind: core, page: null, editor: { state: 'active' } },
      { bind: plugin, page: { state: 'active' }, editor: null },
    ]);
  });

  it('defaultBindLines_UserLeaderSpellsCoreKeys_DropsCoreDefault', () => {
    const core = { keys: ',x', scope: 's', command: 'a' };
    const plugin = {
      keys: '<Leader>x',
      scope: 's',
      command: 'p.b',
      where: 'page' as const,
    };

    expect(defaultBindLines([[core], [plugin]], {}, ',')).toEqual([
      { bind: plugin, page: { state: 'active' }, editor: null },
    ]);
  });

  it('defaultBindLines_SameLayer_KeepsBoth', () => {
    const first = { keys: 'x', scope: 's', command: 'a' };
    const second = { keys: 'x', scope: 's', command: 'b' };

    expect(
      defaultBindLines([[first, second]], {}, leader).map((line) => line.bind),
    ).toEqual([first, second]);
  });

  it('defaultBindLines_UserBindOverPluginDefault_ReplacesPluginDefaultOnly', () => {
    const core = { keys: 'x', scope: 's', command: 'a' };
    const plugin = { keys: 'x', scope: 's', command: 'p.b' };
    const user = { keys: 'x', scope: 's', command: 'c' };

    expect(
      defaultBindLines([[core], [plugin]], { binds: [user] }, leader),
    ).toEqual([
      { bind: plugin, page: { state: 'replaced', by: user }, editor: null },
    ]);
  });
});

describe('mergeKeymap accelerators', () => {
  it('replaces the default app and global binds on one chord spelled another way', () => {
    const merged = mergeKeymap(defaultKeymap(), [], {
      app: [{ accelerator: 'cmdorctrl+w', command: 'user.close' }],
      global: [{ accelerator: 'Option+space', command: 'user.summon' }],
    });

    expect(merged.app).toEqual([
      { accelerator: 'cmdorctrl+w', command: 'user.close' },
    ]);
    expect(merged.global).toEqual([
      { accelerator: 'Option+space', command: 'user.summon' },
    ]);
  });

  it('removes app and global binds an unbind spells another way', () => {
    const merged = mergeKeymap(defaultKeymap(), [], {
      unbind: [{ app: 'CmdOrCtrl+w' }, { global: 'option+Space' }],
    });

    expect(merged.app).toEqual([]);
    expect(merged.global).toEqual([]);
  });

  it('keeps a bind on a chord that differs by OS', () => {
    const merged = mergeKeymap(defaultKeymap(), [], {
      app: [{ accelerator: 'Command+W', command: 'user.close' }],
    });

    expect(merged.app).toEqual([
      { accelerator: 'CommandOrControl+W', command: 'core.close' },
      { accelerator: 'Command+W', command: 'user.close' },
    ]);
  });
});

describe('dependencyOrder', () => {
  it('orders plugins by dependency, ties in list order', () => {
    const ordered = dependencyOrder([
      manifest('a', { dependsOn: { main: [], page: ['c'] } }),
      manifest('b'),
      manifest('c'),
    ]);

    expect(ordered.map((each) => each.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('disabledDependencyProblem', () => {
  const chain = [
    manifest('a'),
    manifest('b', { dependsOn: { main: ['a'], page: [] } }),
    manifest('c', { dependsOn: { main: [], page: ['b'] } }),
  ];

  it.each([
    { disabled: [], expected: null },
    {
      disabled: ['a'],
      expected: '"plugins.disabled" names "a", which "b" depends on.',
    },
    {
      disabled: ['a', 'b'],
      expected: '"plugins.disabled" names "b", which "c" depends on.',
    },
    { disabled: ['a', 'b', 'c'], expected: null },
    { disabled: ['c'], expected: null },
    { disabled: ['zzz'], expected: null },
  ])('disabled $disabled → $expected', ({ disabled, expected }) => {
    expect(disabledDependencyProblem(disabled, chain)).toBe(expected);
  });
});

describe('withoutPluginBinds', () => {
  function command(id: string, plugin: string): CommandInfo {
    return { id, label: id, group: 'Test', runsIn: 'page', plugin };
  }
  const commands = {
    'p.go': command('p.go', 'p'),
    'q.go': command('q.go', 'q'),
  };
  const pEditor = { keys: 'g', scope: 'any', command: 'p.go' };
  const pPage = { keys: ['g'], scope: 'any', command: 'p.go' };
  const qPage = { keys: ['h'], scope: 'any', command: 'q.go' };
  const unknownPage = { keys: ['u'], scope: 'any', command: 'gone.go' };
  const pApp = { accelerator: 'CommandOrControl+G', command: 'p.go' };
  const pIntercept = { key: 'g', meta: true, command: 'p.go' };
  const pGlobal = { accelerator: 'Alt+G', command: 'p.go' };
  const keymap: Keymap = {
    editor: { leader: '<Space>', remaps: [], binds: [pEditor] },
    page: [pPage, qPage, unknownPage],
    app: [pApp],
    intercept: [pIntercept],
    global: [pGlobal],
    groups: { '<Leader>g': 'Go' },
  };

  it.each([
    {
      side: 'page' as const,
      pluginIds: ['p'],
      expected: {
        ...keymap,
        editor: { ...keymap.editor, binds: [] },
        page: [qPage, unknownPage],
      },
    },
    {
      side: 'main' as const,
      pluginIds: ['p'],
      expected: { ...keymap, app: [], intercept: [], global: [] },
    },
    { side: 'page' as const, pluginIds: [], expected: keymap },
    { side: 'main' as const, pluginIds: [], expected: keymap },
  ])('$side without $pluginIds', ({ side, pluginIds, expected }) => {
    expect(withoutPluginBinds(keymap, commands, pluginIds, side)).toEqual(
      expected,
    );
  });
});

describe('commandInfos', () => {
  it('lists command infos with their plugin', () => {
    const q = manifest('q', {
      commands: { stop: { label: 'Stop', group: 'Halts', runsIn: 'main' } },
    });

    const infos = commandInfos(
      { 'window.summon': { label: 'Summon', group: 'Window', runsIn: 'main' } },
      [p, q],
    );

    expect(infos).toEqual({
      'window.summon': {
        id: 'window.summon',
        label: 'Summon',
        group: 'Window',
        runsIn: 'main',
        plugin: 'core',
      },
      'p.go': {
        id: 'p.go',
        label: 'Go',
        group: 'Moves',
        runsIn: 'page',
        plugin: 'p',
      },
      'q.stop': {
        id: 'q.stop',
        label: 'Stop',
        group: 'Halts',
        runsIn: 'main',
        plugin: 'q',
      },
    });
  });

  it('rejects a plugin command whose id a core command already has', () => {
    const windowPlugin = manifest('window', {
      commands: { summon: { label: 'Mine', group: 'Window', runsIn: 'page' } },
    });

    expect(() =>
      commandInfos(
        {
          'window.summon': { label: 'Summon', group: 'Window', runsIn: 'main' },
        },
        [windowPlugin],
      ),
    ).toThrow(/"window\.summon"/);
  });
});

describe('scopeInfos', () => {
  it('scopeInfos_ListsPluginScopesInOrder_ThenCoreScopes', () => {
    const a = manifest('a', { scopes: { x: 'In x', y: 'In y' } });
    const b = manifest('b', { scopes: { z: 'In z' } });

    const infos = scopeInfos(
      [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
      [a, b],
    );

    expect(infos).toEqual([
      { id: 'a.x', title: 'In x', plugin: 'a' },
      { id: 'a.y', title: 'In y', plugin: 'a' },
      { id: 'b.z', title: 'In z', plugin: 'b' },
      { id: 'any', title: 'Everywhere', plugin: 'core' },
    ]);
  });
});

describe('pluginSettings', () => {
  it("collects each plugin's settings by id", () => {
    const settings = pluginSettings([
      manifest('p', { settings: { a: 1 } }),
      manifest('q', { settings: {} }),
    ]);

    expect(settings).toEqual({ p: { a: 1 }, q: {} });
  });

  it('rejects a plugin id listed twice', () => {
    expect(() =>
      pluginSettings([
        manifest('p', { settings: { a: 1 } }),
        manifest('p', { settings: { a: 2 } }),
      ]),
    ).toThrow(/"p"/);
  });
});

describe('pluginOptionalSettings', () => {
  it("qualifies each plugin's declared kinds", () => {
    const kinds = pluginOptionalSettings([
      manifest('p', {
        settings: { timeout: null, profiles: [{ dir: null }] },
        optionalSettings: { timeout: 'number', 'profiles[].dir': 'string' },
      }),
    ]);

    expect(kinds).toEqual({
      'p.timeout': 'number',
      'p.profiles[].dir': 'string',
    });
  });

  it('rejects a null default with no declared kind', () => {
    expect(() =>
      pluginOptionalSettings([manifest('p', { settings: { timeout: null } })]),
    ).toThrow(/"p".*"timeout"/);
  });

  it('rejects a nested null default with no declared kind', () => {
    expect(() =>
      pluginOptionalSettings([
        manifest('p', {
          settings: { window: { size: null }, profiles: [{ dir: null }] },
          optionalSettings: { 'window.size': 'number' },
        }),
      ]),
    ).toThrow(/"p".*"profiles\[\]\.dir"/);
  });

  it('rejects a declared kind for a setting with a value default', () => {
    expect(() =>
      pluginOptionalSettings([
        manifest('p', {
          settings: { timeout: 5 },
          optionalSettings: { timeout: 'number' },
        }),
      ]),
    ).toThrow(/"p".*"timeout"/);
  });
});

describe('pluginSettingInfo', () => {
  const info = { label: 'A', description: 'The a setting.' };

  it('qualifies each declared path with the plugin id', () => {
    const infos = pluginSettingInfo([
      manifest('p', { settings: { a: 1 }, settingInfo: { a: info } }),
    ]);

    expect(infos).toEqual({ 'p.a': info });
  });

  it('rejects a leaf setting with no declaration, naming the plugin and the path', () => {
    expect(() =>
      pluginSettingInfo([manifest('p', { settings: { a: 1 } })]),
    ).toThrow(/"p".*"a"/);
  });

  it('rejects a declaration naming no leaf setting', () => {
    expect(() =>
      pluginSettingInfo([
        manifest('p', {
          settings: { a: 1 },
          settingInfo: { a: info, b: info },
        }),
      ]),
    ).toThrow('"b"');
  });

  it('takes an array setting as one leaf, with no element paths', () => {
    const infos = pluginSettingInfo([
      manifest('p', {
        settings: { list: [{ x: 1 }] },
        settingInfo: { list: info },
      }),
    ]);

    expect(Object.keys(infos)).toEqual(['p.list']);
  });

  it('takes nested and optional settings as leaves, not their parent object', () => {
    const infos = pluginSettingInfo([
      manifest('p', {
        settings: { window: { width: 1 }, fonts: {} },
        optionalSettings: { 'fonts.ui': 'string' },
        settingInfo: { 'window.width': info, 'fonts.ui': info },
      }),
    ]);

    expect(Object.keys(infos).sort()).toEqual(['p.fonts.ui', 'p.window.width']);
  });
});

describe('pluginThemeTokens', () => {
  it("qualifies each plugin's tokens", () => {
    const tokens = pluginThemeTokens({}, [
      manifest('forms', {
        themeTokens: {
          'origin-caused': { kind: 'color', default: '#ff0000' },
        },
      }),
    ]);

    expect(tokens).toEqual({
      'forms.origin-caused': { kind: 'color', default: '#ff0000' },
    });
  });

  it('rejects a key that is not a token name', () => {
    expect(() =>
      pluginThemeTokens({}, [
        manifest('forms', {
          themeTokens: {
            originCaused: { kind: 'color', default: '#ff0000' },
          },
        }),
      ]),
    ).toThrow(/"forms".*"originCaused"/);
  });

  it("rejects a token whose CSS variable is a core token's", () => {
    expect(() =>
      pluginThemeTokens({ 'status-error': 'color' }, [
        manifest('status', {
          themeTokens: { error: { kind: 'color', default: '#ff0000' } },
        }),
      ]),
    ).toThrow(/"status\.error".*"status-error".*--wg-status-error/);
  });

  it("rejects a token whose CSS variable is another plugin token's", () => {
    expect(() =>
      pluginThemeTokens({}, [
        manifest('a-b', {
          themeTokens: { c: { kind: 'color', default: '#ff0000' } },
        }),
        manifest('a', {
          themeTokens: { 'b-c': { kind: 'color', default: '#00ff00' } },
        }),
      ]),
    ).toThrow(/"a\.b-c".*"a-b\.c".*--wg-a-b-c/);
  });
});

describe('overrideSettings', () => {
  it("changes the named settings and keeps the plugin's others", () => {
    const settings = overrideSettings(
      { p: { a: 1, b: 2 }, q: { c: 3 } },
      { p: { b: 5 } },
    );

    expect(settings).toEqual({ p: { a: 1, b: 5 }, q: { c: 3 } });
  });

  it('rejects a plugin the settings do not hold', () => {
    expect(() => overrideSettings({ p: { a: 1 } }, { r: { a: 2 } })).toThrow(
      /"r"/,
    );
  });

  it('rejects a setting the plugin does not declare', () => {
    expect(() =>
      overrideSettings({ p: { a: 1 } }, { p: { a: 2, z: 3, y: 4 } }),
    ).toThrow(/"p".*z, y/);
  });

  it('treats an id an object inherits as a plugin it does not hold', () => {
    expect(() =>
      overrideSettings({ p: { a: 1 } }, { toString: { a: 2 } }),
    ).toThrow(/"toString"/);
  });
});

describe('requireListed', () => {
  it('accepts parts whose manifests are listed', () => {
    const listed = manifest('p');

    expect(() => requireListed([{ manifest: listed }], [listed])).not.toThrow();
  });

  it('names a part whose manifest is not listed', () => {
    const listed = manifest('p');

    expect(() =>
      requireListed(
        [{ manifest: listed }, { manifest: manifest('q') }],
        [listed],
      ),
    ).toThrow(/\bq\b/);
  });
});
