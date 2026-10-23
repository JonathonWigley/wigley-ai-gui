import { describe, expect, it } from 'vitest';
import type { DefaultKeymap } from '../../contracts/keymap';
import type { Settings } from '../../contracts/settings';
import type { UserConfig } from '../../contracts/user-config';
import { definePlugin } from '../../shared/define-plugin';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { resolveTheme } from '../themes/theme-loader';
import {
  type ConfigCheckDeps,
  checkKeymapText,
  configSchema,
} from './config-checks';
import { loadConfigStore } from './config-store';
import { createUserConfig } from './user-config';

const HOME = '/home';
const FOLDER = `${HOME}/.config/wigley-ai-gui`;

const DEFAULTS: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: 'claude' },
};

const DEFAULT_KEYMAP: DefaultKeymap = {
  leader: '<Space>',
  groups: {},
  binds: [{ keys: '<Leader>q', scope: 'any', command: 'app.quit' }],
  remaps: [],
  app: [{ accelerator: 'CommandOrControl+Q', command: 'app.quit' }],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
};

const listPlugin = definePlugin({
  id: 'p',
  dependsOn: [],
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
  dependsOn: [],
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const CHECK_DEPS: ConfigCheckDeps = {
  defaults: DEFAULTS,
  optionalSettings: { 'fonts.ui': 'string' },
  settingChoices: { transparency: ['system', 'full', 'reduced'] },
  defaultKeymap: DEFAULT_KEYMAP,
  coreCommands: {
    'app.quit': { label: 'Quit', group: 'App', runsIn: 'main' },
    'window.summon': { label: 'Summon', group: 'Window', runsIn: 'main' },
  },
  coreScopes: [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
  manifests: [listPlugin, quietPlugin],
  builtInThemes: [
    { name: 'mocha', colorScheme: 'dark', tokens: {} },
    { name: 'dusk', colorScheme: 'light', tokens: {} },
  ],
  themeTokens: { core: {}, plugins: {} },
  resolveTheme,
  checkTokens: () => null,
};

const CORE_INFO = {
  transparency: { label: 'Transparency', description: 'Glass.' },
  'window.width': { label: 'Width', description: 'Width.' },
  theme: { label: 'Theme', description: 'A theme.' },
  'fonts.ui': { label: 'UI font', description: 'A font.' },
};

async function create(files: MemoryFiles): Promise<UserConfig> {
  const store = await loadConfigStore({
    ...CHECK_DEPS,
    files,
    folder: FOLDER,
    platform: 'macos',
    homeDir: HOME,
    log: () => undefined,
  });
  return createUserConfig({
    ...CHECK_DEPS,
    files,
    folder: FOLDER,
    store,
    settingInfo: CORE_INFO,
  });
}

async function createWithFile(file: string, text: string) {
  const files = createMemoryFiles();
  await files.write(`${FOLDER}/${file}`, text);
  return { files, userConfig: await create(files) };
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

    await userConfig.writeSettings({}, '{"keySequenceTimeoutMs": 500}');

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

  it('refuses a theme name no theme has', async () => {
    const userConfig = await create(createMemoryFiles());

    const result = await userConfig.writeSettings({ theme: 'nope' }, null);

    expect(result).toEqual({
      type: 'refused',
      problem: '"theme" names "nope", which no theme has',
    });
  });

  it("writes over a broken user theme file, which is that file's problem", async () => {
    const { files, userConfig } = await createWithFile(
      'themes/bad.json',
      '{ not json',
    );

    const result = await userConfig.writeSettings({ theme: 'dusk' }, null);

    expect(result).toEqual({ type: 'written' });
    expect(await files.read(`${FOLDER}/settings.json`)).toContain('"dusk"');
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

  it('refuses a keymap with the same keys twice in one scope', async () => {
    const files = createMemoryFiles();
    const userConfig = await create(files);

    const layer = {
      binds: [
        { keys: 'x', scope: 'p.list', command: 'p.down' },
        { keys: 'x', scope: 'p.list', command: 'p.up' },
      ],
    };
    const text = `${JSON.stringify(layer, null, 2)}\n`;
    const thrown = (() => {
      try {
        checkKeymapText(text, CHECK_DEPS, configSchema(CHECK_DEPS));
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    })();

    const result = await userConfig.writeKeymap(layer, null);

    expect(thrown).not.toBeNull();
    expect(result).toEqual({ type: 'refused', problem: thrown });
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

  it('reads a settings file that fails its check as broken, with its text', async () => {
    const { userConfig } = await createWithFile('settings.json', '{"nope": 1}');

    const read = await userConfig.read();

    expect(read.settings).toEqual({
      state: 'broken',
      problem: '"nope" is not a setting.',
      text: '{"nope": 1}',
    });
  });

  it('reads a settings file naming no theme as broken', async () => {
    const { userConfig } = await createWithFile(
      'settings.json',
      '{"theme": "nope"}',
    );

    const read = await userConfig.read();

    expect(read.settings).toEqual({
      state: 'broken',
      problem: '"theme" names "nope", which no theme has',
      text: '{"theme": "nope"}',
    });
  });

  it('reads a passing settings file as its parsed layer', async () => {
    const { userConfig } = await createWithFile(
      'settings.json',
      '{"p": {"timeout": 5}}',
    );

    const read = await userConfig.read();

    expect(read.settings).toEqual({
      state: 'ok',
      layer: { p: { timeout: 5 } },
      text: '{"p": {"timeout": 5}}',
    });
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
            control: { kind: 'number' },
            fallback: { value: 900 },
          },
          {
            path: 'theme',
            label: 'Theme',
            description: 'A theme.',
            control: { kind: 'theme' },
            fallback: { value: 'mocha' },
          },
          {
            path: 'fonts.ui',
            label: 'UI font',
            description: 'A font.',
            control: { kind: 'string' },
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
            control: { kind: 'json' },
            fallback: { value: ['a', 'b'] },
          },
          {
            path: 'p.timeout',
            label: 'Timeout',
            description: 'The timeout.',
            control: { kind: 'number' },
            fallback: { value: null },
          },
        ],
      },
    ]);
  });

  it('adds no section for a plugin without settings', async () => {
    const schema = (await create(createMemoryFiles())).schema();

    expect(schema.sections.map((section) => section.id)).not.toContain('quiet');
  });

  it("lists the default keymap's binds then each plugin's, qualified", async () => {
    const schema = (await create(createMemoryFiles())).schema();

    expect(schema.defaultBinds).toEqual([
      { keys: '<Leader>q', scope: 'any', command: 'app.quit' },
      { keys: 'j', scope: 'p.list', command: 'p.down' },
    ]);
    expect(schema.defaultAccelerators).toEqual({
      app: [{ accelerator: 'CommandOrControl+Q', command: 'app.quit' }],
      global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
      intercept: [],
    });
    expect(schema.defaultLeader).toBe('<Space>');
  });

  it('throws on a plugin setting with no declaration', async () => {
    const store = await loadConfigStore({
      ...CHECK_DEPS,
      files: createMemoryFiles(),
      folder: FOLDER,
      platform: 'macos',
      homeDir: HOME,
      log: () => undefined,
    });
    const undeclared = {
      ...listPlugin,
      settingInfo: { timeout: listPlugin.settingInfo.timeout },
    };

    expect(() =>
      createUserConfig({
        ...CHECK_DEPS,
        manifests: [undeclared],
        files: createMemoryFiles(),
        folder: FOLDER,
        store,
        settingInfo: CORE_INFO,
      }),
    ).toThrow('Plugin "p" setting "list" has no declaration in settingInfo');
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
});
