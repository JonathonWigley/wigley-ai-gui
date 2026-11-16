import { describe, expect, it, vi } from 'vitest';
import type { DefaultKeymap, KeyGroups } from '../../contracts/keymap';
import type { Settings } from '../../contracts/settings';
import type { SettingControl, UserConfig } from '../../contracts/user-config';
import { definePlugin } from '../../shared/define-plugin';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { EMPTY_RUNTIME_CATALOG } from '../../shared/runtime-commands';
import { fakePlatform } from '../../shared/platform.test-support';
import { resolveTheme } from '../themes/theme-loader';
import type { PluginManifest } from '../../contracts/plugin';
import {
  type ConfigStore,
  type ConfigStoreDeps,
  loadConfigStore,
} from './config-store';
import { createUserConfig, type UserConfigDeps } from './user-config';

const HOME = '/home';
const FOLDER = `${HOME}/.config/wigley-ai-gui`;

const DEFAULTS: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  shell: { layout: 'default' },
  plugins: { disabled: [] },
};

const DEFAULT_KEYMAP: DefaultKeymap = {
  leader: '<Space>',
  groups: {},
  binds: [{ keys: '<Leader>q', scope: 'any', command: 'app.close' }],
  remaps: [],
  app: [{ accelerator: 'CommandOrControl+Q', command: 'app.quit' }],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
};

const listPlugin = definePlugin({
  id: 'p',
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {
    down: { label: 'Down', group: 'Moves', runsIn: 'page' },
    up: { label: 'Up', group: 'Moves', runsIn: 'page' },
  },
  scopes: { list: 'In the list' },
  keys: {
    binds: [{ keys: 'j', scope: 'list', command: 'down' }],
  },
  settings: { list: ['a', 'b'], timeout: null as number | null },
  optionalSettings: { timeout: 'number' },
  settingInfo: {
    list: { label: 'List', description: 'The list.' },
    timeout: { label: 'Timeout', description: 'The timeout.' },
  },
  themeTokens: {},
});

const quietPlugin = definePlugin({
  id: 'quiet',
  label: 'quiet',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const dependentPlugin = definePlugin({
  id: 'q',
  label: 'q',
  description: 'A test plugin.',
  dependsOn: { main: ['p'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const MANIFESTS = [listPlugin, quietPlugin];

const CHECK_DEPS: Omit<
  ConfigStoreDeps,
  | 'plugins'
  | 'files'
  | 'folder'
  | 'platform'
  | 'homeDir'
  | 'appInstance'
  | 'runMode'
  | 'log'
> = {
  defaults: DEFAULTS,
  optionalSettings: { 'fonts.ui': 'string' },
  settingChoices: { transparency: ['system', 'full', 'reduced'] },
  defaultKeymap: DEFAULT_KEYMAP,
  coreCommands: {
    'app.quit': { label: 'Quit', group: 'App', runsIn: 'main' },
    'app.close': { label: 'Close', group: 'App', runsIn: 'page' },
    'window.summon': { label: 'Summon', group: 'Window', runsIn: 'main' },
  },
  coreScopes: [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
  builtInThemes: [
    { name: 'mocha', colorScheme: 'dark', tokens: {} },
    { name: 'dusk', colorScheme: 'light', tokens: {} },
  ],
  coreThemeTokens: {},
  resolveTheme,
  checkTokens: () => null,
};

const CORE_INFO = {
  transparency: { label: 'Transparency', description: 'Glass.' },
  'window.width': { label: 'Width', description: 'Width.' },
  theme: { label: 'Theme', description: 'A theme.' },
  'fonts.ui': { label: 'UI font', description: 'A font.' },
};

// An applied list that switches no plugin off.
const NONE_APPLIED: UserConfigDeps['applied'] = { disabled: () => [] };

// The catalog entries of `manifests` as built-in plugins.
function builtInEntries(
  manifests: readonly PluginManifest[],
): ConfigStoreDeps['plugins'] {
  return manifests.map((manifest) => ({
    manifest,
    origin: 'built-in',
    revision: 0,
    main: null,
    pageUrl: null,
    folder: null,
  }));
}

// A store over `files` for `createUserConfig`, `manifests` its built-in
// entries.
function storeOver(
  files: MemoryFiles,
  manifests: readonly PluginManifest[] = MANIFESTS,
) {
  return loadConfigStore({
    ...CHECK_DEPS,
    plugins: builtInEntries(manifests),
    files,
    folder: FOLDER,
    platform: fakePlatform('macos'),
    homeDir: HOME,
    appInstance: {
      id: 'wigley-ai-gui-dev',
      displayName: 'Auri Dev',
      isDev: true,
    },
    runMode: 'live',
    log: () => undefined,
  });
}

async function create(
  files: MemoryFiles,
  manifests: readonly PluginManifest[] = MANIFESTS,
  store?: ConfigStore,
  applied = NONE_APPLIED,
): Promise<UserConfig> {
  const served = store ?? (await storeOver(files, manifests));
  return createUserConfig({
    files,
    folder: FOLDER,
    store: served,
    settingInfo: CORE_INFO,
    settingControls: {},
    applied,
  });
}

async function createWithFile(file: string, text: string) {
  const files = createMemoryFiles();
  await files.write(`${FOLDER}/${file}`, text);
  return { files, userConfig: await create(files) };
}

// `files` whose `read` of the file at `path` rejects with `EACCES`, as a
// file the user may not read does.
function unreadableAt(files: MemoryFiles, path: string): MemoryFiles {
  return {
    ...files,
    read: async (readPath) => {
      if (readPath === path) {
        throw Object.assign(new Error('permission denied'), {
          code: 'EACCES',
        });
      }
      return files.read(readPath);
    },
  };
}

describe('createUserConfig', () => {
  it('reads both files as ok with null layers when neither exists', async () => {
    const read = await (await create(createMemoryFiles())).read();

    expect(read.settings).toEqual({ state: 'ok', layer: null, text: null });
    expect(read.keymap).toEqual({ state: 'ok', layer: null, text: null });
    expect(read.themes).toEqual(['mocha', 'dusk']);
  });

  it('lists user theme names after the built-ins, sorted, each once', async () => {
    const { files, userConfig } = await createWithFile(
      'themes/b.json',
      JSON.stringify({ name: 'zest', extends: 'mocha' }),
    );
    await files.write(
      `${FOLDER}/themes/a.json`,
      JSON.stringify({ name: 'dusk', extends: 'dusk' }),
    );
    await files.write(
      `${FOLDER}/themes/c.json`,
      JSON.stringify({ name: 'amber', extends: 'mocha' }),
    );

    expect((await userConfig.read()).themes).toEqual([
      'mocha',
      'dusk',
      'amber',
      'zest',
    ]);
  });

  it('writes a valid settings layer as two-space JSON', async () => {
    const files = createMemoryFiles();
    const userConfig = await create(files);

    const result = await userConfig.writeSettings(
      { keySequenceTimeoutMs: 500 },
      null,
    );

    expect(result).toEqual({ type: 'written' });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe(
      '{\n  "keySequenceTimeoutMs": 500\n}\n',
    );
  });

  it('writes an empty layer as an empty object', async () => {
    const { files, userConfig } = await createWithFile(
      'settings.json',
      '{"keySequenceTimeoutMs": 500}',
    );

    const result = await userConfig.writeSettings(
      {},
      '{"keySequenceTimeoutMs": 500}',
    );

    expect(result).toEqual({ type: 'written' });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe('{}\n');
  });

  it('refuses a setting of the wrong kind and leaves the file as it was', async () => {
    const { files, userConfig } = await createWithFile('settings.json', '{}');

    const result = await userConfig.writeSettings(
      { keySequenceTimeoutMs: 'a' },
      '{}',
    );

    expect(result).toEqual({
      type: 'refused',
      problem: '"keySequenceTimeoutMs" must be a number, not a string.',
    });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe('{}');
  });

  it('write_DisablesANeededPlugin_Refused', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{}');
    const userConfig = await create(files, [listPlugin, dependentPlugin]);

    const result = await userConfig.writeSettings(
      { plugins: { disabled: ['p'] } },
      '{}',
    );

    expect(result).toEqual({
      type: 'refused',
      problem: '"plugins.disabled" names "p", which "q" depends on.',
    });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe('{}');
  });

  it.each([
    {
      name: 'a name no theme has',
      themeFiles: {},
      theme: 'nope',
      outcome: 'refused',
    },
    {
      name: 'a built-in name over a broken user theme file',
      themeFiles: { 'themes/bad.json': '{ not json' },
      theme: 'dusk',
      outcome: 'written',
    },
    {
      name: 'the name of a user theme whose file does not parse',
      themeFiles: { 'themes/dawn.json': '{ "name": ' },
      theme: 'dawn',
      outcome: 'written',
    },
    {
      name: 'a name no theme has while every user file parses to a name',
      themeFiles: {
        'themes/half.json': JSON.stringify({
          name: 'half',
          extends: 'mocha',
          tokens: 'oops',
        }),
      },
      theme: 'gone',
      outcome: 'refused',
    },
    {
      name: 'a name no theme has while a user file has no name',
      themeFiles: { 'themes/nameless.json': '{"tokens": {}}' },
      theme: 'lost',
      outcome: 'written',
    },
    {
      name: 'the name of a user theme whose file parses but is broken',
      themeFiles: {
        'themes/half.json': JSON.stringify({
          name: 'half',
          extends: 'mocha',
          tokens: 'oops',
        }),
      },
      theme: 'half',
      outcome: 'written',
    },
  ])(
    'writeSettings of $name is $outcome',
    async ({ themeFiles, theme, outcome }) => {
      const files = createMemoryFiles();
      for (const [file, text] of Object.entries(themeFiles)) {
        await files.write(`${FOLDER}/${file}`, text);
      }
      const userConfig = await create(files);

      const result = await userConfig.writeSettings({ theme }, null);

      if (outcome === 'written') {
        expect(result).toEqual({ type: 'written' });
        expect(await files.read(`${FOLDER}/settings.json`)).toContain(
          `"${theme}"`,
        );
      } else {
        expect(result).toEqual({
          type: 'refused',
          problem: expect.stringContaining(theme),
        });
        expect(await files.stat(`${FOLDER}/settings.json`)).toBeNull();
      }
    },
  );

  it('finds the file changed on disk for an overlapping write expecting the same text', async () => {
    const { files, userConfig } = await createWithFile('settings.json', '{}');

    const [first, second] = await Promise.all([
      userConfig.writeSettings({ keySequenceTimeoutMs: 500 }, '{}'),
      userConfig.writeSettings({ keySequenceTimeoutMs: 700 }, '{}'),
    ]);

    expect(first).toEqual({ type: 'written' });
    expect(second).toEqual({ type: 'changedOnDisk' });
    expect(await files.read(`${FOLDER}/settings.json`)).toContain('500');
  });

  it('runs the next write after one that fails', async () => {
    const memory = createMemoryFiles();
    let writes = 0;
    const files: MemoryFiles = {
      ...memory,
      write: async (path, text) => {
        writes += 1;
        if (writes === 1) {
          throw new Error('disk full');
        }
        return memory.write(path, text);
      },
    };
    const userConfig = await create(files);

    const [first, second] = await Promise.allSettled([
      userConfig.writeSettings({ keySequenceTimeoutMs: 500 }, null),
      userConfig.writeSettings({ keySequenceTimeoutMs: 700 }, null),
    ]);

    expect(first).toMatchObject({ status: 'rejected' });
    expect(second).toEqual({
      status: 'fulfilled',
      value: { type: 'written' },
    });
    expect(await memory.read(`${FOLDER}/settings.json`)).toContain('700');
  });

  it('refuses as changed on disk when the file no longer holds the expected text', async () => {
    const { files, userConfig } = await createWithFile('settings.json', '{}');

    const result = await userConfig.writeSettings(
      { keySequenceTimeoutMs: 500 },
      null,
    );

    expect(result).toEqual({ type: 'changedOnDisk' });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe('{}');
  });

  it('refuses a keymap that fails its check and leaves the file unwritten', async () => {
    const files = createMemoryFiles();
    const userConfig = await create(files);
    const layer = {
      binds: [{ keys: 'x', scope: 'p.nope', command: 'p.down' }],
    };

    const result = await userConfig.writeKeymap(layer, null);

    expect(result).toEqual({
      type: 'refused',
      problem: expect.stringContaining('p.nope'),
    });
    expect(await files.stat(`${FOLDER}/keymap.json`)).toBeNull();
  });

  it('writes a valid keymap layer', async () => {
    const files = createMemoryFiles();
    const userConfig = await create(files);
    const layer = {
      binds: [{ keys: 'x', scope: 'p.list', command: 'p.down' }],
    };

    const result = await userConfig.writeKeymap(layer, null);
    const read = await userConfig.read();

    expect(result).toEqual({ type: 'written' });
    expect(read.keymap).toEqual({
      state: 'ok',
      layer,
      text: `${JSON.stringify(layer, null, 2)}\n`,
    });
  });

  it.each([
    {
      name: 'a settings file that fails its check is broken',
      files: { 'settings.json': '{"nope": 1}' },
      slice: 'settings',
      expected: {
        state: 'broken',
        problem: expect.stringContaining('nope'),
        text: '{"nope": 1}',
      },
    },
    {
      name: 'a settings file naming no theme is broken',
      files: { 'settings.json': '{"theme": "gone"}' },
      slice: 'settings',
      expected: {
        state: 'broken',
        problem: expect.stringContaining('gone'),
        text: '{"theme": "gone"}',
      },
    },
    {
      name: 'a settings file naming the theme of a user file that does not parse is ok',
      files: {
        'settings.json': '{"theme": "dawn"}',
        'themes/dawn.json': '{ "name": ',
      },
      slice: 'settings',
      expected: {
        state: 'ok',
        layer: { theme: 'dawn' },
        text: '{"theme": "dawn"}',
      },
    },
    {
      name: 'a passing settings file is its parsed layer',
      files: { 'settings.json': '{"p": {"timeout": 5}}' },
      slice: 'settings',
      expected: {
        state: 'ok',
        layer: { p: { timeout: 5 } },
        text: '{"p": {"timeout": 5}}',
      },
    },
    {
      name: 'a keymap file that fails its check is broken',
      files: { 'keymap.json': '{"chords": []}' },
      slice: 'keymap',
      expected: {
        state: 'broken',
        problem: expect.stringContaining('chords'),
        text: '{"chords": []}',
      },
    },
  ] as const)('read: $name', async ({ files: written, slice, expected }) => {
    const files = createMemoryFiles();
    for (const [file, text] of Object.entries(written)) {
      await files.write(`${FOLDER}/${file}`, text);
    }
    const userConfig = await create(files);

    const read = await userConfig.read();

    expect(read[slice]).toEqual(expected);
  });

  it("keeps a core setting's row and writes when a settingless plugin's id shares its name", async () => {
    const windowPlugin = definePlugin({
      ...quietPlugin,
      id: 'window',
      settings: {},
      settingInfo: {},
    });
    const files = createMemoryFiles();
    const userConfig = await create(files, [windowPlugin]);

    const schema = userConfig.schema();
    const result = await userConfig.writeSettings(
      { window: { width: 1200 } },
      null,
    );

    expect(schema.sections.map((section) => section.id)).toEqual(['core']);
    expect(
      schema.sections[0].leaves.find((leaf) => leaf.path === 'window.width'),
    ).toMatchObject({
      control: { kind: 'number', choices: null },
      fallback: { value: 900 },
    });
    expect(result).toEqual({ type: 'written' });
  });

  it('gives each leaf the control and fallback its default and kind call for', async () => {
    const schema = (await create(createMemoryFiles())).schema();

    expect(schema.sections).toEqual([
      {
        id: 'core',
        title: 'Core',
        leaves: [
          {
            path: 'transparency',
            label: 'Transparency',
            description: 'Glass.',
            control: { kind: 'choice', choices: ['system', 'full', 'reduced'] },
            fallback: { value: 'system' },
          },
          {
            path: 'window.width',
            label: 'Width',
            description: 'Width.',
            control: { kind: 'number', choices: null },
            fallback: { value: 900 },
          },
          {
            path: 'theme',
            label: 'Theme',
            description: 'A theme.',
            control: { kind: 'theme', choices: null },
            fallback: { value: 'mocha' },
          },
          {
            path: 'fonts.ui',
            label: 'UI font',
            description: 'A font.',
            control: { kind: 'string', choices: null },
            fallback: null,
          },
        ],
      },
      {
        id: 'p',
        title: 'P',
        leaves: [
          {
            path: 'p.list',
            label: 'List',
            description: 'The list.',
            control: { kind: 'json', choices: null },
            fallback: { value: ['a', 'b'] },
          },
          {
            path: 'p.timeout',
            label: 'Timeout',
            description: 'The timeout.',
            control: { kind: 'number', choices: null },
            fallback: { value: null },
          },
        ],
      },
    ]);
  });

  it('reads a settings file it cannot read as broken, with no text', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{}');
    const userConfig = await create(
      unreadableAt(files, `${FOLDER}/settings.json`),
    );

    const read = await userConfig.read();

    expect(read.settings).toEqual({
      state: 'broken',
      problem: 'Could not read the file: permission denied',
      text: null,
    });
  });

  it('refuses to write over a file it cannot read', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{}');
    const userConfig = await create(
      unreadableAt(files, `${FOLDER}/settings.json`),
    );

    const result = await userConfig.writeSettings(
      { keySequenceTimeoutMs: 500 },
      '{}',
    );

    expect(result).toEqual({
      type: 'refused',
      problem: 'Could not read the file: permission denied',
    });
    expect(await files.read(`${FOLDER}/settings.json`)).toBe('{}');
  });

  it('gives a boolean control to a boolean default and a boolean kind', async () => {
    const flagPlugin = definePlugin({
      id: 'f',
      label: 'f',
      description: 'A test plugin.',
      dependsOn: { main: [], page: [] },
      reads: { main: [], page: [] },
      commands: {},
      scopes: {},
      settings: { wrap: true, strict: null as boolean | null },
      optionalSettings: { strict: 'boolean' },
      settingInfo: {
        wrap: { label: 'Wrap', description: 'Wraps.' },
        strict: { label: 'Strict', description: 'Strict.' },
      },
      themeTokens: {},
    });
    const files = createMemoryFiles();
    const store = await storeOver(files, [flagPlugin]);

    const schema = createUserConfig({
      files,
      folder: FOLDER,
      store,
      settingInfo: {},
      settingControls: {},
      applied: NONE_APPLIED,
    }).schema();

    const controls = schema.sections
      .flatMap((section) => section.leaves)
      .map((leaf) => [leaf.path, leaf.control]);
    expect(controls).toEqual([
      ['f.wrap', { kind: 'boolean', choices: null }],
      ['f.strict', { kind: 'boolean', choices: null }],
    ]);
  });

  it.each<
    [
      string,
      readonly PluginManifest[],
      Record<string, string>,
      string,
      SettingControl,
    ]
  >([
    [
      'a plugin binding over an array default',
      [definePlugin({ ...listPlugin, settingControls: { list: 'p-list' } })],
      {},
      'p.list',
      { kind: 'p-list', choices: null },
    ],
    [
      'the core map',
      MANIFESTS,
      { 'fonts.ui': 'font' },
      'fonts.ui',
      { kind: 'font', choices: null },
    ],
  ])(
    'schema_SettingControls_NameTheKindBeforeTheDefaultRules: %s',
    async (_case, manifests, settingControls, path, control) => {
      const files = createMemoryFiles();
      const store = await storeOver(files, manifests);

      const schema = createUserConfig({
        files,
        folder: FOLDER,
        store,
        settingInfo: CORE_INFO,
        settingControls,
        applied: NONE_APPLIED,
      }).schema();

      const leaf = schema.sections
        .flatMap((section) => section.leaves)
        .find((each) => each.path === path);
      expect(leaf?.control).toEqual(control);
    },
  );

  it('adds no section for a plugin without settings', async () => {
    const schema = (await create(createMemoryFiles())).schema();

    expect(schema.sections.map((section) => section.id)).not.toContain('quiet');
  });

  it("lists the default keymap's binds then each plugin's, qualified", async () => {
    const schema = (await create(createMemoryFiles())).schema();

    expect(schema.defaultBindLayers).toEqual([
      [{ keys: '<Leader>q', scope: 'any', command: 'app.close' }],
      [{ keys: 'j', scope: 'p.list', command: 'p.down' }],
      [],
    ]);
    expect(schema.defaultAccelerators).toEqual({
      app: [{ accelerator: 'CommandOrControl+Q', command: 'app.quit' }],
      global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
      intercept: [],
    });
    expect(schema.defaultLeader).toBe('<Space>');
  });

  it("serves a plugin's accelerator in place of the default on its chord", async () => {
    const overPlugin = definePlugin({
      id: 'over',
      label: 'over',
      description: 'A test plugin.',
      dependsOn: { main: [], page: [] },
      reads: { main: [], page: [] },
      commands: { quit: { label: 'Quit', group: 'App', runsIn: 'main' } },
      scopes: {},
      keys: { app: [{ accelerator: 'CmdOrCtrl+Q', command: 'quit' }] },
      settings: {},
      settingInfo: {},
      themeTokens: {},
    });
    const files = createMemoryFiles();
    const store = await storeOver(files, [overPlugin]);

    const schema = createUserConfig({
      files,
      folder: FOLDER,
      store,
      settingInfo: {},
      settingControls: {},
      applied: NONE_APPLIED,
    }).schema();

    expect(schema.defaultAccelerators.app).toEqual([
      { accelerator: 'CmdOrCtrl+Q', command: 'over.quit' },
    ]);
  });

  it.each([
    {
      case: 'one spelling',
      pluginGroups: { '<Leader>x': 'plugin x' },
      groups: { '<Leader>x': 'plugin x', '<Leader>y': 'core y' },
    },
    {
      case: 'the leader spelled out',
      pluginGroups: { '<Space>x': 'plugin x' },
      groups: { '<Space>x': 'plugin x', '<Leader>y': 'core y' },
    },
  ] as { case: string; pluginGroups: KeyGroups; groups: KeyGroups }[])(
    'schema_DefaultGroups_LaterLayerNameWins $case',
    async ({ pluginGroups, groups }) => {
      const namingPlugin = definePlugin({
        id: 'naming',
        label: 'naming',
        description: 'A test plugin.',
        dependsOn: { main: [], page: [] },
        reads: { main: [], page: [] },
        commands: {},
        scopes: {},
        keys: { groups: pluginGroups },
        settings: {},
        settingInfo: {},
        themeTokens: {},
      });
      const deps = {
        ...CHECK_DEPS,
        defaultKeymap: {
          ...DEFAULT_KEYMAP,
          groups: { '<Leader>x': 'core x', '<Leader>y': 'core y' },
        },
        plugins: builtInEntries([namingPlugin]),
      };
      const files = createMemoryFiles();
      const store = await loadConfigStore({
        ...deps,
        files,
        folder: FOLDER,
        platform: fakePlatform('macos'),
        homeDir: HOME,
        appInstance: {
          id: 'wigley-ai-gui-dev',
          displayName: 'Auri Dev',
          isDev: true,
        },
        runMode: 'live',
        log: () => undefined,
      });

      const schema = createUserConfig({
        ...deps,
        files,
        folder: FOLDER,
        store,
        settingInfo: {},
        settingControls: {},
        applied: NONE_APPLIED,
      }).schema();

      expect(schema.defaultGroups).toEqual(groups);
    },
  );

  it('throws on a plugin setting with no declaration', async () => {
    const undeclared = {
      ...listPlugin,
      settingInfo: { timeout: listPlugin.settingInfo.timeout },
    };
    const userConfig = await create(createMemoryFiles(), [undeclared]);

    expect(() => userConfig.schema()).toThrow(/"p".*"list"/);
  });

  it('schema_AfterSetPlugins_ListsTheNewPlugin', async () => {
    const files = createMemoryFiles();
    const store = await storeOver(files);
    const userConfig = await create(files, MANIFESTS, store);
    const added = definePlugin({
      id: 'added',
      label: 'added',
      description: 'A test plugin.',
      dependsOn: { main: [], page: [] },
      reads: { main: [], page: [] },
      commands: { go: { label: 'Go', group: 'Added', runsIn: 'page' } },
      scopes: {},
      settings: { size: 1 },
      settingInfo: { size: { label: 'Size', description: 'The size.' } },
      themeTokens: {},
    });

    await store.setPlugins(
      [...MANIFESTS, added].map((manifest) => ({
        manifest,
        origin: 'user' as const,
        revision: 1,
        main: null,
        pageUrl: null,
        folder: `/plugins/${manifest.id}`,
      })),
    );

    const schema = userConfig.schema();
    expect(schema.sections.map((section) => section.id)).toContain('added');
    expect(Object.keys(schema.commands)).toContain('added.go');
  });

  it('tells its listener when a hand edit changes the served config', async () => {
    const files = createMemoryFiles();
    const userConfig = await create(files);
    const changed = new Promise<void>((resolve) => {
      userConfig.onChanged(resolve);
    });

    await files.write(
      `${FOLDER}/settings.json`,
      '{"keySequenceTimeoutMs": 500}',
    );

    await expect(changed).resolves.toBeUndefined();
  });

  describe('runtime commands', () => {
    const page = {
      ...EMPTY_RUNTIME_CATALOG,
      commands: [
        {
          id: 'p.later',
          plugin: 'p',
          label: 'Later',
          group: 'g',
          runsIn: 'page' as const,
          runtime: true as const,
        },
      ],
      binds: {
        binds: [{ keys: 'l', scope: 'any', command: 'p.later' }],
        app: [],
        intercept: [],
      },
    };

    const main = {
      ...EMPTY_RUNTIME_CATALOG,
      commands: [
        {
          id: 'p.away',
          plugin: 'p',
          label: 'Away',
          group: 'g',
          runsIn: 'main' as const,
          runtime: true as const,
        },
      ],
      binds: {
        binds: [],
        app: [{ accelerator: 'Alt+L', command: 'p.away' }],
        intercept: [],
      },
    };

    it('schema_RuntimeCommands_AreListed', async () => {
      const files = createMemoryFiles();
      const store = await storeOver(files);
      const userConfig = await create(files, MANIFESTS, store);

      store.setRuntime({ main, page });
      await vi.waitFor(() => {
        expect(store.current().commands['p.later']).toBeDefined();
      });

      const schema = userConfig.schema();
      expect(schema.commands['p.later'].label).toBe('Later');
      expect(schema.defaultBindLayers.flat()).toContainEqual(
        page.binds.binds[0],
      );
      expect(schema.defaultAccelerators.app).toEqual([
        ...DEFAULT_KEYMAP.app,
        main.binds.app[0],
      ]);
    });

    it('schema_RuntimeGroups_AreListed', async () => {
      const files = createMemoryFiles();
      const store = await storeOver(files);
      const runtimeGroups = { '<Leader>r': 'runtime r' };
      const userConfig = await create(files, MANIFESTS, {
        ...store,
        runtime: () => {
          const served = store.runtime();
          return {
            ...served,
            layer: { ...served.layer, groups: runtimeGroups },
          };
        },
      });

      expect(userConfig.schema().defaultGroups).toEqual(runtimeGroups);
    });

    it('schema_AppliedPluginCommandsAndScopes_AreNotListed', async () => {
      const otherPlugin = definePlugin({
        id: 'q',
        label: 'q',
        description: 'A test plugin.',
        dependsOn: { main: [], page: [] },
        reads: { main: [], page: [] },
        commands: { go: { label: 'Go', group: 'Moves', runsIn: 'page' } },
        scopes: { view: 'In q' },
        settings: {},
        settingInfo: {},
        themeTokens: {},
      });
      const manifests = [listPlugin, otherPlugin];
      const files = createMemoryFiles();

      const userConfig = await create(files, manifests, undefined, {
        disabled: () => ['p'],
      });

      const schema = userConfig.schema();
      const ids = Object.keys(schema.commands);
      expect(ids.filter((id) => id.startsWith('p.'))).toEqual([]);
      expect(ids).toContain('q.go');
      const scopePlugins = schema.scopes.map((info) => info.plugin);
      expect(scopePlugins).not.toContain('p');
      expect(scopePlugins).toContain('q');
    });

    it('writeKeymap_UnknownCommandBothStarted_WritesAndTheStoreHoldsItBack', async () => {
      const files = createMemoryFiles();
      const store = await storeOver(files);
      const userConfig = await create(files, MANIFESTS, store);
      const started = { ...EMPTY_RUNTIME_CATALOG, started: true };
      store.setRuntime({ main: started, page: { ...page, started: true } });
      await vi.waitFor(() => {
        expect(store.current().commands['p.later']).toBeDefined();
      });
      const layer = {
        binds: [{ keys: 'x', scope: 'p.list', command: 'p.gone' }],
      };

      const result = await userConfig.writeKeymap(layer, null);

      expect(result).toEqual({ type: 'written' });
      expect((await userConfig.read()).keymap.state).toBe('ok');
      await vi.waitFor(() => {
        expect(store.current().problems).toEqual([
          { file: 'keymap.json', message: expect.stringContaining('p.gone') },
        ]);
      });
    });

    it('onChanged_SetRuntimeChangesCommands_Fires', async () => {
      const files = createMemoryFiles();
      const store = await storeOver(files);
      const userConfig = await create(files, MANIFESTS, store);
      const changed = new Promise<void>((resolve) => {
        userConfig.onChanged(resolve);
      });

      store.setRuntime({ main: EMPTY_RUNTIME_CATALOG, page });

      await expect(changed).resolves.toBeUndefined();
    });
  });
});
