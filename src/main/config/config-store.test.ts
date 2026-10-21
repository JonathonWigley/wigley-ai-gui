import { describe, expect, it } from 'vitest';
import type { Keymap } from '../../contracts/keymap';
import type { PluginManifest } from '../../contracts/plugin';
import type { AppConfig, Settings } from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { definePlugin } from '../../shared/define-plugin';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { ThemeError, type ThemeFileText } from '../themes/theme-loader';
import { type ConfigStore, loadConfigStore } from './config-store';

const FOLDER = '/home/.config/wigley-ai-gui';

const DEFAULTS: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: 'claude' },
};

const CORE_KEYMAP: Keymap = {
  editor: { leader: '<Space>', remaps: [], binds: [] },
  page: [],
  app: [],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
};

const listPlugin = definePlugin({
  id: 'p',
  dependsOn: [],
  commands: {
    down: { label: 'Down', group: 'Moves', runsIn: 'page' },
    up: { label: 'Up', group: 'Moves', runsIn: 'page' },
    close: { label: 'Close', group: 'Window', runsIn: 'main' },
  },
  scopes: { list: 'In the list' },
  keys: {
    page: [
      { keys: ['j'], scope: 'list', command: 'down' },
      { keys: ['k'], scope: 'list', command: 'up' },
    ],
    editor: [],
    app: [],
    global: [],
    intercept: [],
  },
  settings: { list: ['a', 'b'], timeout: null as number | null },
  themeTokens: {},
});

// Task 01's signature: a theme named `name`, a user text of that name over a
// built-in, `"broken": true` in the selected user text failing on its file.
function resolveTheme(
  name: string,
  builtIns: readonly unknown[],
  userThemes: readonly ThemeFileText[],
): Theme {
  const user = userThemes.find(
    (theme) => (JSON.parse(theme.text) as { name: string }).name === name,
  );
  if (user !== undefined) {
    if ((JSON.parse(user.text) as { broken?: boolean }).broken) {
      throw new ThemeError(user.file, 'broken');
    }
    return theme(name, user.file);
  }
  if (builtIns.some((builtIn) => (builtIn as { name: string }).name === name)) {
    return theme(name, 'built-in');
  }
  throw new ThemeError(
    'settings.json',
    `"theme" names "${name}", which no theme has`,
  );
}

function theme(name: string, source: string): Theme {
  return { name, colorScheme: 'dark', tokens: { source }, reduced: {} };
}

function load(
  files: MemoryFiles,
  manifests: readonly PluginManifest[] = [listPlugin],
): Promise<ConfigStore> {
  return loadConfigStore({
    files,
    folder: FOLDER,
    defaults: DEFAULTS,
    optionalSettings: { 'fonts.uiSize': 'number' },
    settingChoices: { transparency: ['system', 'full', 'reduced'] },
    coreKeymap: CORE_KEYMAP,
    coreCommands: {
      'window.summon': { label: 'Summon', group: 'window', runsIn: 'main' },
    },
    coreScopes: [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
    manifests,
    builtInThemes: [{ name: 'mocha' }, { name: 'dusk' }],
    themeTokens: { core: {}, plugins: {} },
    resolveTheme,
    platform: 'windows',
    log: () => undefined,
  });
}

function nextChange(store: ConfigStore): Promise<AppConfig> {
  return new Promise((resolve) => {
    const registration = store.onChanged((config) => {
      registration.dispose();
      resolve(config);
    });
  });
}

// Loads the store with `settings.json` holding `text`.
async function loadWithSettings(text: string) {
  const files = createMemoryFiles();
  await files.write(`${FOLDER}/settings.json`, text);
  return load(files);
}

async function loadWithKeymap(text: string) {
  const files = createMemoryFiles();
  await files.write(`${FOLDER}/keymap.json`, text);
  return load(files);
}

async function writeAndWait(
  files: MemoryFiles,
  store: ConfigStore,
  file: string,
  text: string,
): Promise<AppConfig> {
  const changed = nextChange(store);
  await files.write(`${FOLDER}/${file}`, text);
  return changed;
}

function pageCommands(config: AppConfig): string[] {
  return config.keymap.page.map(
    (bind) => `${bind.keys.join(' ')} ${bind.command}`,
  );
}

describe('loadConfigStore', () => {
  it('serves the defaults with no files', async () => {
    const config = (await load(createMemoryFiles())).current();

    expect(config.settings).toEqual(DEFAULTS);
    expect(config.pluginSettings).toEqual({
      p: { list: ['a', 'b'], timeout: null },
    });
    expect(config.keymap.global).toEqual(CORE_KEYMAP.global);
    expect(pageCommands(config)).toEqual(['j p.down', 'k p.up']);
    expect(config.theme.name).toBe('mocha');
    expect(config.problems).toEqual([]);
    expect(config.platform).toBe('windows');
  });

  it('deep-merges settings.json over the defaults', async () => {
    const store = await loadWithSettings('{"window":{"width":1200}}');

    expect(store.current().settings.window).toEqual({
      width: 1200,
      height: 700,
      minWidth: 420,
      minHeight: 360,
    });
  });

  it('replaces arrays and scalars', async () => {
    const store = await loadWithSettings('{"p":{"list":["c"]}}');

    expect(store.current().pluginSettings.p).toEqual({
      list: ['c'],
      timeout: null,
    });
  });

  it('rejects an unknown setting', async () => {
    const files = createMemoryFiles();
    const store = await load(files);

    const config = await writeAndWait(
      files,
      store,
      'settings.json',
      '{"window":{"wdth":1}}',
    );

    expect(config.settings).toEqual(DEFAULTS);
    expect(config.problems).toEqual([
      { file: 'settings.json', message: '"window.wdth" is not a setting.' },
    ]);
  });

  it('rejects a wrong kind', async () => {
    const store = await loadWithSettings('{"window":{"width":"wide"}}');

    expect(store.current().problems).toEqual([
      {
        file: 'settings.json',
        message: '"window.width" must be a number, not a string.',
      },
    ]);
  });

  it('accepts a number over a null default', async () => {
    const store = await loadWithSettings('{"p":{"timeout":5}}');

    expect(store.current().pluginSettings.p).toEqual({
      list: ['a', 'b'],
      timeout: 5,
    });
    expect(store.current().problems).toEqual([]);
  });

  it('rejects an object over a null default', async () => {
    const store = await loadWithSettings('{"p":{"timeout":{}}}');

    expect(store.current().problems).toEqual([
      {
        file: 'settings.json',
        message:
          '"p.timeout" must be a number, a string, a boolean or null, not an object.',
      },
    ]);
  });

  it('accepts an optional font setting', async () => {
    const store = await loadWithSettings('{"fonts":{"uiSize":14}}');

    expect(store.current().settings.fonts).toEqual({ uiSize: 14 });
    expect(store.current().problems).toEqual([]);
  });

  it('rejects a value outside its choices', async () => {
    const store = await loadWithSettings('{"transparency":"glass"}');

    expect(store.current().settings.transparency).toBe('system');
    expect(store.current().problems).toEqual([
      {
        file: 'settings.json',
        message:
          '"transparency" must be one of system, full, reduced, not "glass".',
      },
    ]);
  });

  it('keeps the last good settings on invalid JSON', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"window":{"width":1200}}');
    const store = await load(files);

    const config = await writeAndWait(
      files,
      store,
      'settings.json',
      '{"window":',
    );

    expect(config.settings.window.width).toBe(1200);
    expect(config.problems).toHaveLength(1);
    expect(config.problems[0].file).toBe('settings.json');
    expect(config.problems[0].message).toMatch(/^Not valid JSON: /);
  });

  it('clears the problem once the file is fixed', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"window":{"wdth":1}}');
    const store = await load(files);
    const changes: AppConfig[] = [];
    store.onChanged((config) => changes.push(config));

    await writeAndWait(
      files,
      store,
      'settings.json',
      '{"window":{"width":1200}}',
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].problems).toEqual([]);
    expect(changes[0].settings.window.width).toBe(1200);
  });

  it("replaces a plugin bind with the user's same keys and scope", async () => {
    const store = await loadWithKeymap(
      '{"page":[{"keys":["j"],"scope":"p.list","command":"p.up"}]}',
    );

    expect(pageCommands(store.current())).toEqual(['j p.up', 'k p.up']);
  });

  it('removes a bind the user unbinds', async () => {
    const store = await loadWithKeymap(
      '{"unbind":[{"page":["j"],"scope":"p.list"}]}',
    );

    expect(pageCommands(store.current())).toEqual(['k p.up']);
  });

  it('reports two user binds on one key in one scope', async () => {
    const files = createMemoryFiles();
    const store = await load(files);

    const config = await writeAndWait(
      files,
      store,
      'keymap.json',
      JSON.stringify({
        page: [
          { keys: ['x'], scope: 'p.list', command: 'p.down' },
          { keys: ['x'], scope: 'p.list', command: 'p.up' },
        ],
      }),
    );

    expect(pageCommands(config)).toEqual(['j p.down', 'k p.up']);
    expect(config.problems).toEqual([
      {
        file: 'keymap.json',
        message:
          'Page binds "x" [p.list] p.down and "x" [p.list] p.up share a scope, and one\'s keys begin the other\'s',
      },
    ]);
  });

  it('reports a bind naming an unknown command', async () => {
    const store = await loadWithKeymap(
      '{"page":[{"keys":["x"],"scope":"p.list","command":"p.nope"}]}',
    );

    expect(store.current().problems).toEqual([
      {
        file: 'keymap.json',
        message: '"page[0].command" names no command "p.nope".',
      },
    ]);
  });

  it('reports a bind naming an unknown scope', async () => {
    const store = await loadWithKeymap(
      '{"page":[{"keys":["x"],"scope":"p.nope","command":"p.down"}]}',
    );

    expect(store.current().problems).toEqual([
      {
        file: 'keymap.json',
        message: '"page[0].scope" names no scope "p.nope".',
      },
    ]);
  });

  it('reports a bind naming a command of the other process', async () => {
    const store = await loadWithKeymap(
      '{"page":[{"keys":["x"],"scope":"p.list","command":"p.close"}]}',
    );

    expect(store.current().problems).toEqual([
      {
        file: 'keymap.json',
        message:
          '"page[0].command" names "p.close", which runs in main; a page bind needs a page command.',
      },
    ]);
  });

  it('uses a user theme over a built-in of the same name', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"theme":"dusk"}');
    await files.write(`${FOLDER}/themes/dusk.json`, '{"name":"dusk"}');

    const store = await load(files);

    expect(store.current().theme).toEqual(theme('dusk', 'themes/dusk.json'));
  });

  it('keeps the last good theme when the selected one breaks', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"theme":"dusk"}');
    await files.write(`${FOLDER}/themes/dusk.json`, '{"name":"dusk"}');
    const store = await load(files);

    const config = await writeAndWait(
      files,
      store,
      'themes/dusk.json',
      '{"name":"dusk","broken":true}',
    );

    expect(config.theme).toEqual(theme('dusk', 'themes/dusk.json'));
    expect(config.problems).toEqual([
      { file: 'themes/dusk.json', message: 'broken' },
    ]);
  });

  it('reports a theme name that names no theme', async () => {
    const store = await loadWithSettings(
      '{"theme":"nope","window":{"width":1200}}',
    );

    expect(store.current().theme.name).toBe('mocha');
    expect(store.current().settings.window.width).toBe(1200);
    expect(store.current().problems).toEqual([
      {
        file: 'settings.json',
        message: '"theme" names "nope", which no theme has',
      },
    ]);
  });

  it('ignores changes to other files', async () => {
    const files = createMemoryFiles();
    const store = await load(files);
    const changes: AppConfig[] = [];
    store.onChanged((config) => changes.push(config));

    await files.write(`${FOLDER}/notes.txt`, '{"window":{"width":1}}');
    await writeAndWait(
      files,
      store,
      'settings.json',
      '{"window":{"width":1200}}',
    );

    expect(changes.map((config) => config.settings.window.width)).toEqual([
      1200,
    ]);
  });

  it('stops calling a disposed listener', async () => {
    const files = createMemoryFiles();
    const store = await load(files);
    const heard: AppConfig[] = [];
    store.onChanged((config) => heard.push(config)).dispose();

    await writeAndWait(
      files,
      store,
      'settings.json',
      '{"window":{"width":1200}}',
    );

    expect(heard).toEqual([]);
  });

  it('rejects a plugin layer with a clash inside it', async () => {
    const clashing: PluginManifest = {
      ...listPlugin,
      keys: {
        ...listPlugin.keys,
        page: [
          { keys: ['j'], scope: 'list', command: 'down' },
          { keys: ['j'], scope: 'list', command: 'up' },
        ],
      },
    };

    await expect(load(createMemoryFiles(), [clashing])).rejects.toThrow(
      'share a scope',
    );
  });
});
