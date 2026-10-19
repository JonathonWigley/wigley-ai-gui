import { describe, expect, it } from 'vitest';
import type { Keymap } from '../contracts/keymap';
import type { PluginManifest } from '../contracts/plugin';
import {
  commandInfos,
  mergeKeymap,
  pluginSettings,
  requireListed,
  scopeInfos,
} from './plugin-manifests';

const NO_KEYS: PluginManifest['keys'] = {
  page: [],
  editor: [],
  app: [],
  global: [],
  intercept: [],
};

function manifest(
  id: string,
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id,
    dependsOn: [],
    commands: {},
    scopes: {},
    keys: NO_KEYS,
    settings: {},
    ...overrides,
  };
}

function coreKeymap(): Keymap {
  return {
    editor: {
      leader: ' ',
      remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
      binds: [{ keys: '<Leader>s', command: 'core.save' }],
    },
    page: [{ keys: ['q'], scope: 'any', command: 'core.quit' }],
    app: [{ accelerator: 'CommandOrControl+W', command: 'core.close' }],
    intercept: [{ key: 'Tab', control: true, command: 'core.next' }],
    global: [{ accelerator: 'Alt+Space', command: 'window.summon' }],
  };
}

const p = manifest('p', {
  commands: { go: { label: 'Go', group: 'Moves', runsIn: 'page' } },
  scopes: { view: 'In the view' },
  keys: {
    page: [
      { keys: ['g'], scope: 'view', command: 'go' },
      { keys: ['x'], scope: 'any', command: 'go' },
    ],
    editor: [{ keys: '<Leader>g', command: 'go' }],
    app: [{ accelerator: 'CommandOrControl+G', command: 'go' }],
    global: [{ accelerator: 'Alt+G', command: 'go' }],
    intercept: [{ key: 'g', meta: true, command: 'go' }],
  },
});

describe('mergeKeymap', () => {
  it("qualifies plugin commands and scopes and keeps the core's binds", () => {
    const core = coreKeymap();

    const merged = mergeKeymap(core, [p]);

    expect(merged.page).toContainEqual({
      keys: ['g'],
      scope: 'p.view',
      command: 'p.go',
    });
    expect(merged.editor).toEqual({
      leader: ' ',
      remaps: core.editor.remaps,
      binds: [...core.editor.binds, { keys: '<Leader>g', command: 'p.go' }],
    });
    expect(merged.app).toEqual([
      ...core.app,
      { accelerator: 'CommandOrControl+G', command: 'p.go' },
    ]);
    expect(merged.global).toEqual([
      ...core.global,
      { accelerator: 'Alt+G', command: 'p.go' },
    ]);
    expect(merged.intercept).toEqual([
      ...core.intercept,
      { key: 'g', meta: true, command: 'p.go' },
    ]);
  });

  it('keeps the any scope unqualified', () => {
    const merged = mergeKeymap(coreKeymap(), [p]);

    expect(merged.page).toContainEqual({
      keys: ['x'],
      scope: 'any',
      command: 'p.go',
    });
  });

  it("puts the core's binds first, then each plugin's in list order", () => {
    const q = manifest('q', {
      commands: { stop: { label: 'Stop', group: 'Moves', runsIn: 'page' } },
      keys: {
        ...NO_KEYS,
        page: [{ keys: ['s'], scope: 'any', command: 'stop' }],
      },
    });

    const merged = mergeKeymap(coreKeymap(), [q, p]);

    expect(merged.page.map((bind) => bind.command)).toEqual([
      'core.quit',
      'q.stop',
      'p.go',
      'p.go',
    ]);
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
    ).toThrow('Command "window.summon" is declared twice');
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
    ).toThrow('Plugin "p" is listed twice');
  });

  it('stores ids an object inherits or treats specially as plain ids', () => {
    const settings = pluginSettings([
      manifest('toString', { settings: { a: 1 } }),
      manifest('__proto__', { settings: { b: 2 } }),
    ]);

    expect(Object.hasOwn(settings, 'toString')).toBe(true);
    expect(Object.hasOwn(settings, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
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
    ).toThrow('built-in manifests list: q');
  });
});
