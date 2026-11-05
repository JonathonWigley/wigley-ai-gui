import { describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import type { DefaultKeymap } from '../../contracts/keymap';
import type { PluginManifest } from '../../contracts/plugin';
import type { AppConfig, Settings } from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { definePlugin } from '../../shared/define-plugin';
import { errorText } from '../../shared/error-text';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import {
  ThemeError,
  type ThemeFileText,
  type TokenCheck,
} from '../themes/theme-loader';
import {
  type ConfigStore,
  type ConfigStoreDeps,
  loadConfigStore,
} from './config-store';

const HOME = '/home';
const FOLDER = `${HOME}/.config/wigley-ai-gui`;

const DEFAULTS: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: 'claude' },
  shell: { layout: 'default' },
  plugins: { disabled: ['d'] },
};

const DEFAULT_KEYMAP: DefaultKeymap = {
  leader: '<Space>',
  groups: {},
  binds: [],
  remaps: [],
  app: [],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+W', command: 'window.summon' }],
};

const listPlugin = definePlugin({
  id: 'p',
  dependsOn: { main: [], page: [] },
  commands: {
    down: { label: 'Down', group: 'Moves', runsIn: 'page' },
    up: { label: 'Up', group: 'Moves', runsIn: 'page' },
    close: { label: 'Close', group: 'Window', runsIn: 'main' },
  },
  scopes: { list: 'In the list' },
  keys: {
    binds: [
      { keys: 'j', scope: 'list', command: 'down' },
      { keys: 'k', scope: 'list', command: 'up' },
    ],
  },
  settings: { list: ['a', 'b'], timeout: null as number | null },
  optionalSettings: { timeout: 'number' },
  settingInfo: {
    list: { label: 'List', description: 'The list.' },
    timeout: { label: 'Timeout', description: 'The timeout.' },
  },
  themeTokens: {},
});

// Task 01's signature: a theme named `name`, a user text of that name over a
// built-in, a user text that does not parse failing on its file whatever the
// name, `"broken": true` in the selected user text failing on its file
// and in the selected built-in failing on a file of the app's, and `check`'s
// problem failing on the selected theme's file.
function resolveTheme(
  name: string,
  builtIns: readonly unknown[],
  userThemes: readonly ThemeFileText[],
  _tokens: unknown,
  check: TokenCheck,
): Theme {
  const checked = (resolved: Theme, file: string) => {
    const problem = check(resolved.tokens);
    if (problem !== null) {
      throw new ThemeError(file, problem.message);
    }
    return resolved;
  };
  const parsed = userThemes.map(({ file, text }) => {
    try {
      return {
        file,
        json: JSON.parse(text) as { name: string; broken?: boolean },
      };
    } catch (error) {
      throw new ThemeError(file, errorText(error));
    }
  });
  const user = parsed.find((theme) => theme.json.name === name);
  if (user !== undefined) {
    if (user.json.broken) {
      throw new ThemeError(user.file, 'broken');
    }
    return checked(theme(name, user.file), user.file);
  }
  const builtIn = builtIns.find(
    (candidate) => (candidate as { name: string }).name === name,
  ) as { name: string; broken?: boolean } | undefined;
  if (builtIn !== undefined) {
    if (builtIn.broken) {
      throw new ThemeError(`built-in ${name}`, 'broken');
    }
    return checked(theme(name, 'built-in'), `built-in theme ${name}`);
  }
  throw new ThemeError(
    'settings.json',
    `"theme" names "${name}", which no theme has`,
  );
}

function theme(name: string, source: string): Theme {
  return { name, colorScheme: 'dark', tokens: { name, source }, reduced: {} };
}

// A `checkTokens` that rejects the theme named `gloom`.
const rejectGloom: TokenCheck = (tokens) =>
  tokens.name === 'gloom'
    ? { token: 'toolbar-height', message: 'not a px length' }
    : null;

const DEFAULT_PLUGIN_SETTINGS = { p: { list: ['a', 'b'], timeout: null } };

function load(
  files: Files,
  overrides: Partial<ConfigStoreDeps> = {},
): Promise<ConfigStore> {
  return loadConfigStore({
    files,
    folder: FOLDER,
    defaults: DEFAULTS,
    optionalSettings: { 'fonts.uiSize': 'number' },
    settingChoices: { transparency: ['system', 'full', 'reduced'] },
    defaultKeymap: DEFAULT_KEYMAP,
    coreCommands: {
      'window.summon': { label: 'Summon', group: 'window', runsIn: 'main' },
    },
    coreScopes: [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
    manifests: [listPlugin],
    builtInThemes: [{ name: 'mocha' }, { name: 'dusk' }],
    themeTokens: { core: {}, plugins: {} },
    resolveTheme,
    checkTokens: () => null,
    platform: 'windows',
    homeDir: HOME,
    appInstance: {
      id: 'wigley-ai-gui-dev',
      displayName: 'Auri Dev',
      isDev: true,
    },
    runMode: 'live',
    log: () => undefined,
    ...overrides,
  });
}

// `files` whose reads take the text at the call and, while `hold` is in
// force, return it only on `release`, so a test can change a file mid-read.
// `reads` lists every path read, in call order.
function heldReads(files: MemoryFiles) {
  let held: Promise<void> | null = null;
  let open = () => undefined as void;
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    const text = await files.read(path);
    if (held !== null) {
      await held;
    }
    return text;
  };
  return {
    files: { ...files, read },
    reads,
    hold() {
      held = new Promise((resolve) => {
        open = resolve;
      });
    },
    release() {
      held = null;
      open();
    },
  };
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
    expect(config.pluginSettings).toEqual(DEFAULT_PLUGIN_SETTINGS);
    expect(config.keymap.global).toEqual(DEFAULT_KEYMAP.global);
    expect(pageCommands(config)).toEqual(['j p.down', 'k p.up']);
    expect(config.theme.name).toBe('mocha');
    expect(config.problems).toEqual([]);
    expect(config.platform).toBe('windows');
    expect(config.homeDir).toBe(HOME);
    expect(config.appInstance).toEqual({
      id: 'wigley-ai-gui-dev',
      displayName: 'Auri Dev',
      isDev: true,
    });
    expect(config.runMode).toBe('live');
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

  it.each([
    {
      text: '{"window":{"wdth":1}}',
      problem: 'window.wdth',
      served: { settings: DEFAULTS, pluginSettings: DEFAULT_PLUGIN_SETTINGS },
    },
    {
      text: '{"window":{"width":"wide"}}',
      problem: 'window.width',
      served: { settings: DEFAULTS, pluginSettings: DEFAULT_PLUGIN_SETTINGS },
    },
    {
      text: '{"transparency":"glass"}',
      problem: 'glass',
      served: { settings: DEFAULTS, pluginSettings: DEFAULT_PLUGIN_SETTINGS },
    },
    {
      text: '{"fonts":{"uiSize":14}}',
      problem: null,
      served: { settings: { fonts: { uiSize: 14 } } },
    },
    {
      text: '{"p":{"timeout":5}}',
      problem: null,
      served: { pluginSettings: { p: { list: ['a', 'b'], timeout: 5 } } },
    },
    {
      text: '{"plugins":{"disabled":["nope"]}}',
      problem: null,
      served: { settings: { plugins: { disabled: ['nope'] } } },
    },
    {
      text: '{"plugins":{"disabled":[3]}}',
      problem: 'plugins.disabled[0]',
      served: { settings: DEFAULTS },
    },
  ])(
    'settings.json $text → problem naming $problem',
    async ({ text, problem, served }) => {
      const config = (await loadWithSettings(text)).current();

      expect(config).toMatchObject(served);
      expect(config.problems).toEqual(
        problem === null
          ? []
          : [
              {
                file: 'settings.json',
                message: expect.stringContaining(problem),
              },
            ],
      );
    },
  );

  it('keeps the last good settings when the list disables a needed plugin', async () => {
    const dependent = definePlugin({
      id: 'q',
      dependsOn: { main: ['p'], page: [] },
      commands: {},
      scopes: {},
      settings: {},
      settingInfo: {},
      themeTokens: {},
    });
    const files = createMemoryFiles();
    await files.write(
      `${FOLDER}/settings.json`,
      '{"plugins":{"disabled":["p"]}}',
    );

    const config = (
      await load(files, { manifests: [listPlugin, dependent] })
    ).current();

    expect(config.settings).toEqual(DEFAULTS);
    expect(config.problems).toEqual([
      {
        file: 'settings.json',
        message: '"plugins.disabled" names "p", which "q" depends on.',
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
      '{"binds":[{"keys":"j","scope":"p.list","command":"p.up"}]}',
    );

    expect(pageCommands(store.current())).toEqual(['j p.up', 'k p.up']);
  });

  it('removes a bind the user unbinds', async () => {
    const store = await loadWithKeymap(
      '{"unbind":[{"keys":"j","scope":"p.list"}]}',
    );

    expect(pageCommands(store.current())).toEqual(['k p.up']);
  });

  it.each([
    {
      name: 'two binds on one key in one scope',
      keymap: {
        binds: [
          { keys: 'x', scope: 'p.list', command: 'p.down' },
          { keys: 'x', scope: 'p.list', command: 'p.up' },
        ],
      },
      parts: ['p.down', 'p.up'],
    },
    {
      name: 'a bind naming an unknown command',
      keymap: { binds: [{ keys: 'x', scope: 'p.list', command: 'p.nope' }] },
      parts: ['binds[0].command', 'p.nope'],
    },
    {
      name: 'a bind naming an unknown scope',
      keymap: { binds: [{ keys: 'y', scope: 'p.gone', command: 'p.down' }] },
      parts: ['binds[0].scope', 'p.gone'],
    },
    {
      name: 'a bind naming a command of the other process',
      keymap: { binds: [{ keys: 'z', scope: 'p.list', command: 'p.close' }] },
      parts: ['binds[0].command', 'p.close'],
    },
    {
      name: 'a bind with empty keys',
      keymap: { binds: [{ keys: '', scope: 'p.list', command: 'p.down' }] },
      parts: ['binds[0].keys'],
    },
    {
      name: 'a global unbind on a modifier with no key',
      keymap: { unbind: [{ global: 'Control+Alt' }] },
      parts: ['unbind[0].global'],
    },
  ])(
    'reports $name and keeps the default keymap',
    async ({ keymap, parts }) => {
      const config = (await loadWithKeymap(JSON.stringify(keymap))).current();

      expect(pageCommands(config)).toEqual(['j p.down', 'k p.up']);
      expect(config.keymap.global).toEqual(DEFAULT_KEYMAP.global);
      expect(config.problems).toEqual([
        { file: 'keymap.json', message: expect.any(String) },
      ]);
      for (const part of parts) {
        expect(config.problems[0].message).toContain(part);
      }
    },
  );

  it('keeps the last good keymap over an app bind on an unknown key', async () => {
    const files = createMemoryFiles();
    await files.write(
      `${FOLDER}/keymap.json`,
      '{"app":[{"accelerator":"Command+K","command":"window.summon"}]}',
    );
    const store = await load(files);

    const config = await writeAndWait(
      files,
      store,
      'keymap.json',
      '{"app":[{"accelerator":"Command+Nope","command":"window.summon"}]}',
    );

    expect(config.keymap.app).toEqual([
      { accelerator: 'Command+K', command: 'window.summon' },
    ]);
    expect(config.problems).toEqual([
      {
        file: 'keymap.json',
        message: expect.stringContaining('app[0].accelerator'),
      },
    ]);
  });

  it.each([
    {
      name: 'the selected theme file breaks',
      file: 'themes/dusk.json',
      text: '{"name":"dusk","broken":true}',
      problemFile: 'themes/dusk.json',
    },
    {
      name: 'the native window cannot take the newly selected theme',
      file: 'settings.json',
      text: '{"theme":"gloom"}',
      problemFile: 'themes/gloom.json',
    },
  ])(
    'keeps the last good theme when $name',
    async ({ file, text, problemFile }) => {
      const files = createMemoryFiles();
      await files.write(`${FOLDER}/settings.json`, '{"theme":"dusk"}');
      await files.write(`${FOLDER}/themes/dusk.json`, '{"name":"dusk"}');
      await files.write(`${FOLDER}/themes/gloom.json`, '{"name":"gloom"}');
      const store = await load(files, { checkTokens: rejectGloom });

      const config = await writeAndWait(files, store, file, text);

      expect(config.theme).toEqual(theme('dusk', 'themes/dusk.json'));
      expect(config.problems).toEqual([
        { file: problemFile, message: expect.any(String) },
      ]);
    },
  );

  it('rejects the first read when the selected built-in theme is broken', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"theme":"dusk"}');

    await expect(
      load(files, {
        builtInThemes: [{ name: 'mocha' }, { name: 'dusk', broken: true }],
      }),
    ).rejects.toThrow('broken');
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
        message: expect.stringContaining('nope'),
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
        binds: [
          { keys: 'j', scope: 'list', command: 'down' },
          { keys: 'j', scope: 'list', command: 'up' },
        ],
      },
    };

    await expect(
      load(createMemoryFiles(), { manifests: [clashing] }),
    ).rejects.toThrow();
  });
  it('runs one more rebuild for changes during a rebuild, serving the latest file', async () => {
    const memory = createMemoryFiles();
    const held = heldReads(memory);
    const store = await load(held.files);
    const widths: number[] = [];
    store.onChanged((config) => widths.push(config.settings.window.width));
    const settingsReads = () =>
      held.reads.filter((path) => path.endsWith('/settings.json')).length;
    const readsAtLoad = settingsReads();

    held.hold();
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1000}}');
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1100}}');
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1200}}');
    held.release();

    await vi.waitFor(() => expect(widths).toEqual([1000, 1200]));
    expect(settingsReads() - readsAtLoad).toBe(2);
  });

  it('a rebuild running at dispose publishes nothing and runs no more', async () => {
    const memory = createMemoryFiles();
    const held = heldReads(memory);
    const store = await load(held.files);
    const width = store.current().settings.window.width;
    const settingsReads = () =>
      held.reads.filter((path) => path.endsWith('/settings.json')).length;
    const readsAtLoad = settingsReads();

    held.hold();
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1000}}');
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1100}}');
    store.dispose();
    held.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.current().settings.window.width).toBe(width);
    expect(settingsReads() - readsAtLoad).toBe(1);
  });

  it('applies a change made during the first read once loaded', async () => {
    const memory = createMemoryFiles();
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1000}}');
    const held = heldReads(memory);

    held.hold();
    const loading = load(held.files);
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1200}}');
    held.release();
    const store = await loading;

    await vi.waitFor(() =>
      expect(store.current().settings.window.width).toBe(1200),
    );
  });

  it('reports a folder it cannot watch', async () => {
    const memory = createMemoryFiles();
    const files: Files = {
      ...memory,
      watch: () => {
        throw new Error('no watcher');
      },
    };

    const store = await load(files);

    expect(store.current().problems).toEqual([
      {
        file: FOLDER,
        message: expect.stringContaining('no watcher'),
      },
    ]);
  });

  it('reports a watch that fails after it starts', async () => {
    let fail: (error: unknown) => void = () => undefined;
    const files: Files = {
      ...createMemoryFiles(),
      watch: (_folder, _onChange, options) => {
        fail = options?.onError ?? fail;
        return { dispose: () => undefined };
      },
    };
    const store = await load(files);
    const changed = nextChange(store);

    fail(new Error('watcher died'));

    expect((await changed).problems).toEqual([
      {
        file: FOLDER,
        message: expect.stringContaining('watcher died'),
      },
    ]);
  });

  it('dispose closes the folder watch and drops every listener', async () => {
    const memory = createMemoryFiles();
    let closes = 0;
    const files: Files = {
      ...memory,
      watch: (folder, onChange, options) => {
        const watch = memory.watch(folder, onChange, options);
        return {
          dispose: () => {
            closes++;
            watch.dispose();
          },
        };
      },
    };
    const store = await load(files);
    const heard: AppConfig[] = [];
    store.onChanged((config) => heard.push(config));

    store.dispose();
    await files.write(`${FOLDER}/settings.json`, '{"theme":"dusk"}');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closes).toBe(1);
    expect(heard).toEqual([]);
  });

  it('reports a themes folder it cannot list and applies the rest', async () => {
    const memory = createMemoryFiles();
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1200}}');
    await memory.write(
      `${FOLDER}/keymap.json`,
      '{"unbind":[{"keys":"j","scope":"p.list"}]}',
    );
    const files: Files = {
      ...memory,
      list: async (folder) => {
        if (folder === `${FOLDER}/themes`) {
          throw new Error('not a folder');
        }
        return memory.list(folder);
      },
    };

    const store = await load(files);

    expect(store.current().settings.window.width).toBe(1200);
    expect(pageCommands(store.current())).toEqual(['k p.up']);
    expect(store.current().theme.name).toBe('mocha');
    expect(store.current().problems).toEqual([
      { file: 'themes', message: expect.stringContaining('not a folder') },
    ]);
  });
});
