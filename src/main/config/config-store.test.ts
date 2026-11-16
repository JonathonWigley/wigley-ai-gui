import { describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import type { RuntimeCatalog } from '../../contracts/core-state';
import type {
  DefaultKeymap,
  EditorRemap,
  KeyBind,
} from '../../contracts/keymap';
import type { CommandInfo, PluginManifest } from '../../contracts/plugin';
import type { CatalogEntry } from '../../contracts/plugin-catalog';
import type { AppConfig, Settings } from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { definePlugin } from '../../shared/define-plugin';
import { errorText } from '../../shared/error-text';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { fakePlatform } from '../../shared/platform.test-support';
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
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
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

// A plugin named as a core setting is, declaring no settings.
const coreNamedPlugin = definePlugin({
  id: 'window',
  label: 'window',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

function theme(name: string, source: string): Theme {
  return { name, colorScheme: 'dark', tokens: { name, source }, reduced: {} };
}

// A `checkTokens` that rejects the theme named `gloom`.
const rejectGloom: TokenCheck = (tokens) =>
  tokens.name === 'gloom'
    ? { token: 'toolbar-height', message: 'not a px length' }
    : null;

const DEFAULT_PLUGIN_SETTINGS = { p: { list: ['a', 'b'], timeout: null } };

function builtIn(manifest: PluginManifest): CatalogEntry {
  return {
    manifest,
    origin: 'built-in',
    revision: 0,
    main: null,
    pageUrl: null,
    folder: null,
  };
}

function userEntry(
  manifest: PluginManifest,
  revision = 1,
  origin: 'user' | 'replaces-built-in' = 'user',
): CatalogEntry {
  return {
    manifest,
    origin,
    revision,
    main: null,
    pageUrl: `wigley-plugin://${manifest.id}/~${revision}/page.js`,
    folder: `/plugins/${manifest.id}`,
  };
}

// A test plugin `id` with `overrides` over a manifest that declares nothing.
function plugin(
  id: string,
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id,
    label: id,
    description: 'A test plugin.',
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
    ...overrides,
  };
}

// `<id>@<revision>` of each entry.
function revisions(entries: readonly CatalogEntry[]): string[] {
  return entries.map((entry) => `${entry.manifest.id}@${entry.revision}`);
}

// Loads the store over `files`, `manifests` its built-in entries unless
// `overrides` sets `plugins`.
function load(
  files: Files,
  {
    manifests = [listPlugin],
    ...overrides
  }: Partial<ConfigStoreDeps> & { manifests?: readonly PluginManifest[] } = {},
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
      'modes.show': { label: 'Show', group: 'Modes', runsIn: 'page' },
    },
    coreScopes: [{ id: 'any', title: 'Everywhere', plugin: 'core' }],
    plugins: manifests.map(builtIn),
    builtInThemes: [{ name: 'mocha' }, { name: 'dusk' }],
    coreThemeTokens: {},
    resolveTheme,
    checkTokens: () => null,
    platform: fakePlatform('windows'),
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

function runtimeInfo(
  id: string,
  runsIn: 'page' | 'main' = 'page',
): CommandInfo {
  return { id, plugin: 'r', label: id, group: 'g', runsIn, runtime: true };
}

function catalog(overrides: {
  commands?: CommandInfo[];
  binds?: KeyBind[];
  started?: boolean;
}): RuntimeCatalog {
  return {
    commands: overrides.commands ?? [],
    binds: { binds: overrides.binds ?? [], app: [], intercept: [] },
    started: overrides.started ?? true,
  };
}

const NO_CATALOG = catalog({});

// Hands `store` the catalogs and waits for the re-serve that lists `marker`, a
// command only this call's catalog holds.
async function setRuntimeAndWait(
  store: ConfigStore,
  page: RuntimeCatalog,
  marker: string,
  main: RuntimeCatalog = NO_CATALOG,
) {
  store.setRuntime({
    main,
    page: {
      ...page,
      commands: [...page.commands, runtimeInfo(marker)],
    },
  });
  await vi.waitFor(() => {
    expect(store.current().commands[marker]).toBeDefined();
  });
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
    expect(config.platform).toEqual(fakePlatform('windows'));
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

  it.each<{ name: string; keymap: string | null; expected: EditorRemap[] }>([
    {
      name: "the user keymap's remaps",
      keymap: '{"remaps":[{"mode":"normal","keys":"Y","to":"y$"}]}',
      expected: [{ mode: 'normal', keys: 'Y', to: 'y$' }],
    },
    { name: 'none with no user keymap', keymap: null, expected: [] },
  ])('userRemaps returns $name', async ({ keymap, expected }) => {
    const store =
      keymap === null
        ? await load(createMemoryFiles())
        : await loadWithKeymap(keymap);

    expect(store.userRemaps()).toEqual(expected);
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

  it.each([
    { case: 'built-in', entry: builtIn, isRejected: true },
    { case: 'user', entry: userEntry, isRejected: false },
  ])(
    'rejects a plugin layer with a clash inside it: $case',
    async ({ entry, isRejected }) => {
      const clashing: PluginManifest = {
        ...listPlugin,
        keys: {
          binds: [
            { keys: 'j', scope: 'list', command: 'down' },
            { keys: 'j', scope: 'list', command: 'up' },
          ],
        },
      };

      const loading = load(createMemoryFiles(), {
        plugins: [entry(clashing)],
      });

      if (isRejected) {
        await expect(loading).rejects.toThrow('share a scope');
      } else {
        expect((await loading).plugins()).toEqual([]);
      }
    },
  );
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

  it.each([
    {
      name: 'settings',
      declared: {
        settings: { width: 1 },
        settingInfo: { width: { label: 'Width', description: 'Width.' } },
      },
    },
    {
      name: 'only an optional setting',
      declared: {
        settings: {},
        optionalSettings: { width: 'number' },
        settingInfo: { width: { label: 'Width', description: 'Width.' } },
      },
    },
  ] as const)(
    'rejects a plugin declaring $name under a core name',
    async ({ declared }) => {
      const underCoreName = { ...coreNamedPlugin, ...declared };

      await expect(
        load(createMemoryFiles(), { manifests: [underCoreName] }),
      ).rejects.toThrow('Plugin "window" declares settings');
    },
  );

  it('loads a plugin declaring no settings under a core name', async () => {
    const store = await load(createMemoryFiles(), {
      manifests: [coreNamedPlugin],
    });

    expect(store.current().settings.window).toEqual(DEFAULTS.window);
  });

  it.each([
    { case: 'built-in', entry: builtIn, isRejected: true },
    { case: 'user', entry: userEntry, isRejected: false },
  ])(
    'configSchema_DefaultBindBadArg_Throws: $case',
    async ({ entry, isRejected }) => {
      const badArg = definePlugin({
        ...listPlugin,
        commands: {
          ...listPlugin.commands,
          pick: {
            label: 'Pick',
            group: 'Moves',
            runsIn: 'page',
            arg: 'number',
          },
        },
        keys: {
          binds: [{ keys: 'x', scope: 'list', command: 'pick', arg: 'a' }],
        },
      });

      const loading = load(createMemoryFiles(), { plugins: [entry(badArg)] });

      if (isRejected) {
        await expect(loading).rejects.toThrow(
          'command "p.pick" needs a number',
        );
      } else {
        expect((await loading).pluginProblems()).toEqual([
          { id: 'p', message: expect.stringContaining('needs a number') },
        ]);
      }
    },
  );

  it('setPluginsProblem_HeldMessage_IsServedAfterTheWatchProblem', async () => {
    const memory = createMemoryFiles();
    await memory.write(`${FOLDER}/keymap.json`, '{');
    const held = heldReads({
      ...memory,
      watch: () => {
        throw new Error('no watcher');
      },
    } as MemoryFiles);
    const store = await load(held.files);
    const settingsReads = () =>
      held.reads.filter((path) => path.endsWith('/settings.json')).length;
    const files = () => store.current().problems.map((each) => each.file);

    store.setPluginsProblem('x');
    await nextChange(store);
    const withProblem = files();
    const heldMessage = store
      .current()
      .problems.filter((each) => each.message === 'x');
    store.setPluginsProblem(null);
    await nextChange(store);
    const cleared = store.current().problems.map((each) => each.message);
    store.setPluginsProblem('x');
    await nextChange(store);
    const readsBefore = settingsReads();
    store.setPluginsProblem('x');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(withProblem).toEqual([FOLDER, 'settings.json', 'keymap.json']);
    expect(heldMessage).toEqual([{ file: 'settings.json', message: 'x' }]);
    expect(cleared).not.toContain('x');
    expect(settingsReads()).toBe(readsBefore);
  });

  describe('setRuntime', () => {
    const LATER_BIND = { keys: 'x', scope: 'p.list', command: 'r.later' };
    const LATER_FILE = JSON.stringify({ binds: [LATER_BIND] });

    it('setRuntime_BeforeBothStarted_HoldsBackInSilence', async () => {
      const store = await loadWithKeymap(LATER_FILE);
      expect(store.current().problems).toEqual([]);

      await setRuntimeAndWait(store, catalog({ started: false }), 'r.marker');

      expect(store.current().problems).toEqual([]);
      expect(pageCommands(store.current())).toEqual(['j p.down', 'k p.up']);
    });

    it('setRuntime_BothStarted_ReportsTheHeldBackBind', async () => {
      const store = await loadWithKeymap(
        JSON.stringify({
          binds: [
            LATER_BIND,
            { keys: 'y', scope: 'p.list', command: 'p.down' },
          ],
        }),
      );

      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker');

      expect(store.current().problems).toEqual([
        {
          file: 'keymap.json',
          message: '"binds[0].command" names no command "r.later".',
        },
      ]);
      expect(pageCommands(store.current())).toContain('y p.down');
    });

    it('setRuntime_FileRefused_ReportsOnlyTheRefusal', async () => {
      const files = createMemoryFiles();
      await files.write(
        `${FOLDER}/keymap.json`,
        JSON.stringify({
          binds: [
            { keys: 'x', scope: 'p.list', command: 'r.never' },
            { keys: 'y', scope: 'p.list', command: 'r.later' },
          ],
        }),
      );
      const store = await load(files);
      await setRuntimeAndWait(
        store,
        catalog({ commands: [runtimeInfo('r.later')] }),
        'r.marker',
      );
      await writeAndWait(files, store, 'keymap.json', '{ not json');

      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker2');

      expect(store.current().problems).toEqual([
        { file: 'keymap.json', message: expect.any(String) },
      ]);
    });

    it('setRuntime_CommandArrives_BindAppliesAndProblemGoes', async () => {
      const store = await loadWithKeymap(LATER_FILE);
      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker');

      await setRuntimeAndWait(
        store,
        catalog({ commands: [runtimeInfo('r.later')] }),
        'r.marker2',
      );

      expect(store.current().problems).toEqual([]);
      expect(pageCommands(store.current())).toContain('x r.later');
    });

    it('setRuntime_HeldBackBindCanRunBesideALongerOne_ReportsItAndKeepsServing', async () => {
      const files = createMemoryFiles();
      await files.write(
        `${FOLDER}/keymap.json`,
        JSON.stringify({
          binds: [
            { keys: 'g', scope: 'p.list', command: 'r.later' },
            { keys: 'gg', scope: 'p.list', command: 'p.up' },
          ],
        }),
      );
      const store = await load(files);

      await setRuntimeAndWait(
        store,
        catalog({ commands: [runtimeInfo('r.later')] }),
        'r.marker',
      );

      expect(store.current().problems).toEqual([
        { file: 'keymap.json', message: expect.stringContaining('r.later') },
      ]);
      expect(pageCommands(store.current())).toContain('g g p.up');

      const config = await writeAndWait(
        files,
        store,
        'settings.json',
        '{"window":{"width":1200}}',
      );

      expect(config.settings.window.width).toBe(1200);
    });

    it('setRuntime_BurstInOneTick_RebuildsOnce', async () => {
      const held = heldReads(createMemoryFiles());
      const store = await load(held.files);
      const settingsReads = () =>
        held.reads.filter((path) => path.endsWith('/settings.json')).length;
      const readsAtLoad = settingsReads();

      store.setRuntime({ main: NO_CATALOG, page: NO_CATALOG });
      store.setRuntime({ main: NO_CATALOG, page: NO_CATALOG });
      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker');

      expect(settingsReads() - readsAtLoad).toBe(1);
    });

    it('setRuntime_PageBind_ServedInKeymapAndCommands', async () => {
      const store = await load(createMemoryFiles());
      const info = runtimeInfo('r.go');

      await setRuntimeAndWait(
        store,
        catalog({
          commands: [info],
          binds: [{ keys: 'r', scope: 'any', command: 'r.go' }],
        }),
        'r.marker',
      );

      expect(store.current().commands['r.go']).toEqual(info);
      expect(pageCommands(store.current())).toContain('r r.go');
    });

    it('setRuntime_PageWritesEmptyFirst_OldBindsLeaveTheServedKeymap', async () => {
      const store = await load(createMemoryFiles());
      await setRuntimeAndWait(
        store,
        catalog({
          commands: [runtimeInfo('r.go')],
          binds: [{ keys: 'r', scope: 'any', command: 'r.go' }],
        }),
        'r.marker',
      );

      await setRuntimeAndWait(store, catalog({ started: false }), 'r.marker2');

      expect(store.current().commands['r.go']).toBeUndefined();
      expect(pageCommands(store.current())).toEqual(['j p.down', 'k p.up']);
    });

    it('setRuntime_CollidingRuntimeBinds_DropsTheLaterAndReports', async () => {
      const logs: string[] = [];
      const store = await load(createMemoryFiles(), {
        log: (source, message) => logs.push(`${source}: ${message}`),
      });
      const main = catalog({
        commands: [runtimeInfo('r.first')],
        binds: [{ keys: 'r', scope: 'any', command: 'r.first' }],
      });
      const page = catalog({
        commands: [runtimeInfo('r.second')],
        binds: [{ keys: 'r', scope: 'any', command: 'r.second' }],
      });

      await setRuntimeAndWait(store, page, 'r.marker', main);

      expect(pageCommands(store.current())).toContain('r r.first');
      expect(pageCommands(store.current())).not.toContain('r r.second');
      const isDropLine = (line: string) =>
        line.startsWith('config: runtime bind r of r.second dropped: ');
      expect(logs.filter(isDropLine)).toHaveLength(1);

      await setRuntimeAndWait(store, page, 'r.marker2', main);

      expect(logs.filter(isDropLine)).toHaveLength(1);

      await setRuntimeAndWait(store, page, 'r.marker3');
      await setRuntimeAndWait(store, page, 'r.marker4', main);

      expect(logs.filter(isDropLine)).toHaveLength(2);
    });

    it('setRuntime_CommandInBothCatalogs_LogsOnce', async () => {
      const logs: string[] = [];
      const store = await load(createMemoryFiles(), {
        log: (source, message) => logs.push(`${source}: ${message}`),
      });
      const twice = catalog({ commands: [runtimeInfo('r.twice')] });

      await setRuntimeAndWait(store, twice, 'r.marker', twice);
      await setRuntimeAndWait(store, twice, 'r.marker2', twice);

      expect(logs).toEqual(['config: command r.twice declared twice']);
    });

    it('setRuntime_RuntimeBindPrefixOfUserBind_DropsItAndKeepsTheUserFile', async () => {
      const store = await loadWithKeymap(
        JSON.stringify({
          binds: [{ keys: 'gg', scope: 'any', command: 'p.down' }],
        }),
      );

      await setRuntimeAndWait(
        store,
        catalog({
          commands: [runtimeInfo('r.go')],
          binds: [{ keys: 'g', scope: 'any', command: 'r.go' }],
        }),
        'r.marker',
      );

      expect(store.current().problems).toEqual([]);
      expect(pageCommands(store.current())).toContain('g g p.down');
      expect(pageCommands(store.current())).not.toContain('g r.go');
    });

    it('setRuntime_RefusedFile_KeepsTheLastGoodUserLayerOverTheNewRuntime', async () => {
      const files = createMemoryFiles();
      const store = await load(files);
      await setRuntimeAndWait(
        store,
        catalog({
          commands: [runtimeInfo('r.go')],
          binds: [{ keys: 'r', scope: 'any', command: 'r.go' }],
        }),
        'r.marker',
      );
      await writeAndWait(files, store, 'keymap.json', '{ not json');

      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker2');

      expect(pageCommands(store.current())).toEqual(['j p.down', 'k p.up']);
      expect(store.current().problems).toHaveLength(1);
    });
  });
});

describe('plugin admission', () => {
  const GLOW = { kind: 'color' as const, default: '#fff' };
  // A user plugin whose theme token name no CSS variable can carry.
  const badToken = (id: string, overrides: Partial<PluginManifest> = {}) =>
    plugin(id, { themeTokens: { Bad: GLOW }, ...overrides });
  const extra = plugin('t', {
    commands: { go: { label: 'Go', group: 'T', runsIn: 'page' } },
    settings: { n: 1 },
    settingInfo: { n: { label: 'N', description: 'N.' } },
    themeTokens: { glow: GLOW },
  });

  it.each([
    {
      case: 'command id of a core command',
      entries: [
        builtIn(listPlugin),
        userEntry(
          plugin('modes', {
            commands: { show: { label: 'Show', group: 'M', runsIn: 'page' } },
          }),
        ),
      ],
      ids: ['p'],
      problems: [
        { id: 'modes', message: 'Command "modes.show" is declared twice' },
      ],
    },
    {
      case: "theme token sharing a built-in's CSS variable",
      entries: [
        builtIn(plugin('ab', { themeTokens: { 'c-x': GLOW } })),
        userEntry(plugin('ab-c', { themeTokens: { x: GLOW } })),
      ],
      ids: ['ab'],
      problems: [
        { id: 'ab-c', message: expect.stringContaining('--wg-ab-c-x') },
      ],
    },
    {
      case: 'settings under a core setting name',
      entries: [
        builtIn(listPlugin),
        userEntry(plugin('window', { settings: { a: 1 } })),
      ],
      ids: ['p'],
      problems: [
        { id: 'window', message: expect.stringContaining('declares settings') },
      ],
    },
    {
      case: "default key clashing with a built-in's",
      entries: [
        builtIn(listPlugin),
        userEntry(
          plugin('u', {
            commands: { go: { label: 'Go', group: 'U', runsIn: 'page' } },
            keys: { binds: [{ keys: 'jj', scope: 'any', command: 'go' }] },
          }),
        ),
      ],
      ids: ['p'],
      problems: [
        { id: 'u', message: expect.stringContaining('share a scope') },
      ],
    },
    {
      case: 'dependent of a refused entry',
      entries: [
        builtIn(listPlugin),
        userEntry(badToken('a')),
        userEntry(plugin('b', { dependsOn: { main: ['a'], page: [] } })),
      ],
      ids: ['p'],
      problems: [
        { id: 'a', message: expect.stringContaining('"Bad"') },
        { id: 'b', message: 'needs plugin "a", which is not loaded' },
      ],
    },
    {
      case: 'refused replacement of a built-in and its built-in dependent',
      entries: [
        builtIn(listPlugin),
        userEntry(badToken('a'), 1, 'replaces-built-in'),
        builtIn(plugin('b', { dependsOn: { main: [], page: ['a'] } })),
      ],
      ids: ['p'],
      problems: [
        { id: 'a', message: expect.stringContaining('"Bad"') },
        { id: 'b', message: 'needs plugin "a", which is not loaded' },
      ],
    },
  ])(
    'admission_UserEntry_LeftOutWithAProblem: $case',
    async ({ entries, ids, problems }) => {
      const store = await load(createMemoryFiles(), { plugins: entries });

      expect(store.plugins().map((entry) => entry.manifest.id)).toEqual(ids);
      expect(store.pluginProblems()).toEqual(problems);
    },
  );

  it('setPlugins_RefusedNewRevision_KeepsTheLastAdmitted', async () => {
    const store = await load(createMemoryFiles(), {
      plugins: [builtIn(listPlugin), userEntry(plugin('x'), 1)],
    });

    await store.setPlugins([builtIn(listPlugin), userEntry(badToken('x'), 2)]);

    expect(revisions(store.plugins())).toEqual(['p@0', 'x@1']);
    expect(store.pluginProblems().map((problem) => problem.id)).toEqual(['x']);
  });

  it('setPlugins_RebuildThrows_ResolvesAndKeepsTheAdmitted', async () => {
    const lines: string[] = [];
    const store = await load(createMemoryFiles(), {
      plugins: [builtIn(listPlugin), userEntry(extra)],
      log: (_source, line) => lines.push(line),
    });
    const clashingBuiltIn = plugin('c', {
      commands: { go: { label: 'Go', group: 'C', runsIn: 'page' } },
      scopes: { s: 'S' },
      keys: {
        binds: [
          { keys: 'x', scope: 's', command: 'go' },
          { keys: 'x', scope: 's', command: 'go' },
        ],
      },
    });

    await store.setPlugins([builtIn(listPlugin), builtIn(clashingBuiltIn)]);

    expect(revisions(store.plugins())).toEqual(['p@0', 't@1']);
    expect(lines).toContainEqual(expect.stringMatching(/^config not read: /));
  });

  it.each([
    {
      case: 'add p',
      before: [plugin('q', { settings: { n: 1 } })],
      after: [plugin('q', { settings: { n: 1 } }), listPlugin],
      sections: { q: { n: 2 }, p: DEFAULT_PLUGIN_SETTINGS.p },
    },
    {
      case: 'remove q',
      before: [plugin('q', { settings: { n: 1 } }), listPlugin],
      after: [listPlugin],
      sections: { p: DEFAULT_PLUGIN_SETTINGS.p },
    },
  ])(
    'setPlugins_BrokenSettings_RebasesTheKeptSlice: $case',
    async ({ before, after, sections }) => {
      const files = createMemoryFiles();
      await files.write(`${FOLDER}/settings.json`, '{"q":{"n":2}}');
      const store = await load(files, { manifests: before });
      await writeAndWait(files, store, 'settings.json', '{');

      await store.setPlugins(after.map(builtIn));

      expect(store.current().pluginSettings).toEqual(sections);
    },
  );

  it.each([
    { case: 'readable files', whileAway: null },
    {
      case: 'files broken while it is away',
      whileAway: { settings: '{', keymap: '{' },
    },
  ])(
    'setPlugins_PluginLeavesAndReturns_GetsItsSectionAndBindBack: $case',
    async ({ whileAway }) => {
      const settings = '{"t":{"n":2}}';
      const keymap = JSON.stringify({
        binds: [{ keys: 'y', scope: 'any', command: 't.go' }],
      });
      const files = createMemoryFiles();
      await files.write(`${FOLDER}/settings.json`, settings);
      await files.write(`${FOLDER}/keymap.json`, keymap);
      const withT = [builtIn(listPlugin), userEntry(extra)];
      const store = await load(files, { plugins: withT });
      await store.setPlugins([builtIn(listPlugin)]);
      if (whileAway !== null) {
        await writeAndWait(files, store, 'settings.json', whileAway.settings);
        await writeAndWait(files, store, 'keymap.json', whileAway.keymap);
      }

      await store.setPlugins(withT);

      expect(store.current().pluginSettings.t).toEqual({ n: 2 });
      expect(pageCommands(store.current())).toContainEqual('y t.go');
      expect([
        await files.read(`${FOLDER}/settings.json`),
        await files.read(`${FOLDER}/keymap.json`),
      ]).toEqual([
        whileAway?.settings ?? settings,
        whileAway?.keymap ?? keymap,
      ]);
    },
  );

  it('drops_EveryProducer_LoggedOncePerLine', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/settings.json`, '{"gone":{"x":1}}');
    await files.write(
      `${FOLDER}/keymap.json`,
      JSON.stringify({
        binds: [{ keys: 'y', scope: 'gone.main', command: 'gone.run' }],
      }),
    );
    const lines: string[] = [];
    const store = await load(files, {
      defaultKeymap: {
        ...DEFAULT_KEYMAP,
        binds: [{ keys: 'x', scope: 'any', command: 'p.send' }],
      },
      log: (_source, line) => lines.push(line),
    });
    const atLoad = [...lines];

    store.setPluginsProblem('again');
    await nextChange(store);

    expect(atLoad).toEqual([
      'keymap.json binds[0] names plugin "gone", which is not loaded; kept and ignored',
      'settings.json "gone" names no loaded plugin; kept and ignored',
      'default bind x of p.send dropped: its plugin declares no such command',
    ]);
    expect(lines).toEqual(atLoad);
  });

  it.each([
    {
      case: 'add',
      before: [builtIn(listPlugin)],
      after: [builtIn(listPlugin), userEntry(extra)],
      isServed: true,
    },
    {
      case: 'remove',
      before: [builtIn(listPlugin), userEntry(extra)],
      after: [builtIn(listPlugin)],
      isServed: false,
    },
  ])(
    'setPlugins_AddsAndRemoves_ServesSchemaAndPlugins: $case',
    async ({ before, after, isServed }) => {
      const store = await load(createMemoryFiles(), { plugins: before });

      await store.setPlugins(after);

      const config = store.current();
      expect({
        command: Object.hasOwn(config.commands, 't.go'),
        setting: Object.hasOwn(config.pluginSettings, 't'),
        token: Object.hasOwn(store.checks().deps.themeTokens.plugins, 't.glow'),
        plugin: config.plugins.some((served) => served.id === 't'),
      }).toEqual({
        command: isServed,
        setting: isServed,
        token: isServed,
        plugin: isServed,
      });
    },
  );

  it('setPlugins_DuringAFileRebuild_RunsAfterIt', async () => {
    const memory = createMemoryFiles();
    const held = heldReads(memory);
    const store = await load(held.files);

    held.hold();
    await memory.write(`${FOLDER}/settings.json`, '{"window":{"width":1000}}');
    const setting = store.setPlugins([builtIn(listPlugin), userEntry(extra)]);
    held.release();
    await setting;

    expect(store.current().settings.window.width).toBe(1000);
    expect(store.current().plugins.map((served) => served.id)).toEqual([
      'p',
      't',
    ]);
  });

  it('setPluginProblems_ServedAfterFileProblems', async () => {
    const files = createMemoryFiles();
    await files.write(`${FOLDER}/keymap.json`, '{');
    const store = await load(files, {
      plugins: [builtIn(listPlugin), userEntry(badToken('x'))],
    });

    store.setPluginProblems([{ id: 'y', message: 'm' }]);
    const config = await nextChange(store);

    expect(config.problems).toEqual([
      { file: 'keymap.json', message: expect.any(String) },
      { file: 'plugins/y', message: 'm' },
      { file: 'plugins/x', message: expect.stringContaining('"Bad"') },
    ]);
  });

  it.each([
    {
      case: 'settings object under an absent id',
      file: 'settings.json',
      text: '{"gone":{"x":1}}',
      problems: [],
      line: 'settings.json "gone" names no loaded plugin; kept and ignored',
    },
    {
      case: 'scalar under an unknown key',
      file: 'settings.json',
      text: '{"zz":1}',
      problems: [{ file: 'settings.json', message: '"zz" is not a setting.' }],
      line: null,
    },
    {
      case: "bind to an absent plugin's command",
      file: 'keymap.json',
      text: JSON.stringify({
        binds: [
          { keys: 'y', scope: 'any', command: 'gone.run' },
          { keys: 'z', scope: 'p.list', command: 'p.down' },
        ],
      }),
      problems: [],
      line: 'keymap.json binds[0] names plugin "gone", which is not loaded; kept and ignored',
    },
    {
      case: "bind in an absent plugin's scope",
      file: 'keymap.json',
      text: JSON.stringify({
        binds: [
          { keys: 'y', scope: 'gone.main', command: 'p.up' },
          { keys: 'z', scope: 'p.list', command: 'p.down' },
        ],
      }),
      problems: [],
      line: 'keymap.json binds[0] names plugin "gone", which is not loaded; kept and ignored',
    },
    {
      case: "unbind in an absent plugin's scope",
      file: 'keymap.json',
      text: JSON.stringify({ unbind: [{ keys: 'j', scope: 'gone.main' }] }),
      problems: [],
      line: 'keymap.json unbind[0] names plugin "gone", which is not loaded; kept and ignored',
    },
    {
      case: 'bind to an unknown command of a loaded plugin',
      file: 'keymap.json',
      text: JSON.stringify({
        binds: [{ keys: 'y', scope: 'any', command: 'p.nope' }],
      }),
      problems: [
        {
          file: 'keymap.json',
          message: '"binds[0].command" names no command "p.nope".',
        },
      ],
      line: null,
    },
  ])(
    'absentPlugin_SettingsAndBinds_KeptAndIgnored: $case',
    async ({ file, text, problems, line }) => {
      const files = createMemoryFiles();
      await files.write(`${FOLDER}/${file}`, text);
      const lines: string[] = [];
      const store = await load(files, {
        log: (_source, logged) => lines.push(logged),
      });

      await setRuntimeAndWait(store, NO_CATALOG, 'r.marker');

      expect(store.current().problems).toEqual(problems);
      expect(lines.filter((logged) => logged.includes('ignored'))).toEqual(
        line === null ? [] : [line],
      );
      expect(pageCommands(store.current())).toEqual(
        expect.arrayContaining(['j p.down', 'k p.up']),
      );
      expect(pageCommands(store.current())).not.toContainEqual(
        expect.stringMatching(/^y /),
      );
    },
  );
});
