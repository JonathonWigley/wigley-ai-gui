import type { AppInstance } from '../../contracts/app-instance';
import type { Disposable } from '../../contracts/disposable';
import type { Files, FileWatch } from '../../contracts/files';
import type { UserKeymap } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type { PluginManifest, RunMode } from '../../contracts/plugin';
import type {
  CatalogEntry,
  CatalogProblem,
  ServedPlugin,
} from '../../contracts/plugin-catalog';
import type { AppConfig, ConfigProblem } from '../../contracts/settings';
import type { Theme, TokenKind } from '../../contracts/theme';
import { errorText } from '../../shared/error-text';
import { requireUnambiguousKeymap } from '../../shared/keymap-checks';
import {
  commandInfos,
  type DefaultKeyLayer,
  pluginThemeTokens,
  scopeInfos,
  withoutUndeclaredDefaults,
} from '../../shared/plugin-manifests';
import { EMPTY_RUNTIME_CATALOG } from '../../shared/runtime-commands';
import { ThemeError, type ThemeFileText } from '../themes/theme-loader';
import {
  type CheckedKeymap,
  checkSettingsText,
  checkUserKeymap,
  type ConfigCheckDeps,
  type ConfigFileText,
  type ConfigSchema,
  configSchema,
  KEYMAP_FILE,
  readConfigFile,
  readUserThemes,
  resolveConfigTheme,
  type RuntimeCatalogs,
  SETTINGS_FILE,
  THEMES_FOLDER,
  usersThemeProblem,
} from './config-checks';
import { parseUserKeymap } from './user-keymap';
import type { UserSettings } from './user-settings';

// The served config, kept current with the user config folder.
// `onChanged` listeners run, in registration order, each time a change to a
// config file changes the served config, after `current` returns the new one.
// `dispose` stops watching the folder and drops every listener; `current`
// keeps returning the last config. A rebuild already running when `dispose`
// is called publishes nothing and runs no further rebuild.
// `setRuntime` hands over both processes' runtime commands and binds, re-serving
// as a file change does, once for a burst in one tick. `runtime` reads those
// catalogs and the runtime binds in force.
// `setPluginsProblem` holds one message about the plugin list, or none: while
// it holds one, the served `problems` carry it under `settings.json`, after the
// watch problem and before the file problems. A changed message re-serves.
// The served config holds the plugins the store admitted (`admit`), not the
// catalog's: a caller hands it entries with `setPlugins`, and a file rebuild
// uses the last admitted ones. Plugin problems serve as `plugins/<id>`, after
// the file problems.
export interface ConfigStore extends Disposable {
  current(): AppConfig;
  onChanged(listener: (config: AppConfig) => void): Disposable;
  setRuntime(runtime: RuntimeCatalogs): void;
  setPluginsProblem(message: string | null): void;
  runtime(): { catalogs: RuntimeCatalogs; layer: DefaultKeyLayer };
  // The entries the served config holds now, in catalog order: what the
  // last `setPlugins` (or the load) admitted.
  plugins(): readonly CatalogEntry[];
  // Hands over the entries to serve, in catalog order. Admits them, rebuilds
  // the schema and the plugin theme tokens, and re-serves. Runs in the store's
  // one rebuild queue with file and runtime rebuilds. Resolves once a rebuild
  // that started after the call has published or failed. Never rejects: a
  // failed rebuild logs `config not read: <error>` and keeps the last admitted
  // entries. The caller reads `plugins()` after it resolves to learn what the
  // store admitted.
  setPlugins(entries: readonly CatalogEntry[]): Promise<void>;
  // The problems of the last admission: an entry the schema refused, or one
  // whose dependency is not admitted.
  pluginProblems(): readonly CatalogProblem[];
  // Problems from outside the store (the catalog's and the switch's), served
  // after the store's own file problems and before `pluginProblems()`. A
  // changed list re-serves.
  setPluginProblems(problems: readonly CatalogProblem[]): void;
  // The check deps and schema over the admitted entries, for user-config.
  checks(): { deps: ConfigCheckDeps; schema: ConfigSchema };
}

// The check deps every admission shares; each admission adds its manifests
// and theme tokens.
type BaseCheckDeps = Omit<ConfigCheckDeps, 'manifests' | 'themeTokens'>;

// `plugins` are the entries at load, in catalog order; `coreThemeTokens` the
// core's theme tokens, which each admission adds the admitted plugins' to.
// `folder` is the absolute user config folder; `log` takes the store's own
// lines.
export interface ConfigStoreDeps extends BaseCheckDeps {
  plugins: readonly CatalogEntry[];
  coreThemeTokens: Readonly<Record<string, TokenKind>>;
  files: Files;
  folder: string;
  platform: Platform;
  homeDir: string;
  appInstance: AppInstance;
  runMode: RunMode;
  log: Log;
}

const THEME_FILE = /^themes\/[^/]+\.json$/;

// The last good value of each slice, which a broken file leaves in place. The
// keymap's is the user layer that last merged, without the binds held back then. It
// is checked again over the runtime layers, which keep changing, and always merges:
// a bind leaving it uncovers only binds on its own keys. While the file is refused
// only the refusal is reported: this layer's paths are not the file's.
interface Slices {
  settings: UserSettings;
  keptKeymap: UserKeymap;
  theme: Theme;
}

// The checks over one admitted set of plugins. `dropped` has a line for each
// default bind of the core keymap that no admitted plugin declares.
interface AdmittedChecks {
  deps: ConfigCheckDeps;
  schema: ConfigSchema;
  dropped: readonly string[];
}

// What one admission gives: the admitted entries in catalog order, the
// problems in catalog order, and the checks over the admitted entries.
interface Admission extends AdmittedChecks {
  entries: readonly CatalogEntry[];
  problems: readonly CatalogProblem[];
}

// The checks over `manifests`. Throws when they do not build: a command
// declared twice, a theme token's CSS variable taken twice, settings under a
// core setting's name, a default bind's bad `arg` or an ambiguous default
// keymap.
function checksOver(
  base: BaseCheckDeps,
  coreThemeTokens: Readonly<Record<string, TokenKind>>,
  manifests: readonly PluginManifest[],
): AdmittedChecks {
  const declared = withoutUndeclaredDefaults(
    base.defaultKeymap,
    commandInfos(base.coreCommands, manifests),
    scopeInfos(base.coreScopes, manifests),
  );
  const deps: ConfigCheckDeps = {
    ...base,
    defaultKeymap: declared.keymap,
    manifests,
    themeTokens: {
      core: coreThemeTokens,
      plugins: pluginThemeTokens(coreThemeTokens, manifests),
    },
  };
  const schema = configSchema(deps);
  requireUnambiguousKeymap(schema.defaultKeymap);
  return { deps, schema, dropped: declared.dropped };
}

function presentEntries(
  chosen: readonly (CatalogEntry | null)[],
): CatalogEntry[] {
  return chosen.filter((entry) => entry !== null);
}

function manifestsOf(entries: readonly CatalogEntry[]): PluginManifest[] {
  return entries.map((entry) => entry.manifest);
}

// The entries of `entries` the config can serve. Every built-in is taken;
// the checks over them throwing is a bug in the app, so `admit` throws. Each
// other entry, in catalog order, is taken when the checks build with it, and
// else gives a problem and, when `lastAdmitted` holds an entry of its id that
// builds, that entry takes its place. Then each entry whose dependency is not
// taken leaves, until none does.
function admit(
  base: BaseCheckDeps,
  coreThemeTokens: Readonly<Record<string, TokenKind>>,
  entries: readonly CatalogEntry[],
  lastAdmitted: readonly CatalogEntry[],
): Admission {
  const chosen = entries.map((entry) =>
    entry.origin === 'built-in' ? entry : null,
  );
  checksOver(base, coreThemeTokens, manifestsOf(presentEntries(chosen)));
  const problems: CatalogProblem[] = [];
  const refusalOf = (index: number, entry: CatalogEntry): string | null => {
    const tried = [...chosen];
    tried[index] = entry;
    try {
      checksOver(base, coreThemeTokens, manifestsOf(presentEntries(tried)));
      return null;
    } catch (error) {
      return errorText(error);
    }
  };
  entries.forEach((entry, index) => {
    if (entry.origin === 'built-in') {
      return;
    }
    const id = entry.manifest.id;
    const refusal = refusalOf(index, entry);
    if (refusal === null) {
      chosen[index] = entry;
      return;
    }
    problems.push({ id, message: refusal });
    const last = lastAdmitted.find((held) => held.manifest.id === id);
    if (last !== undefined && refusalOf(index, last) === null) {
      chosen[index] = last;
    }
  });
  leaveOutMissingDependents(chosen, problems);
  const admitted = presentEntries(chosen);
  const order = entries.map((entry) => entry.manifest.id);
  return {
    ...checksOver(base, coreThemeTokens, manifestsOf(admitted)),
    entries: admitted,
    problems: [...problems].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
    ),
  };
}

// Clears each entry of `chosen` whose `dependsOn.main` or `dependsOn.page`
// names an id `chosen` does not hold, with a problem, until none does.
function leaveOutMissingDependents(
  chosen: (CatalogEntry | null)[],
  problems: CatalogProblem[],
): void {
  let isSettled = false;
  while (!isSettled) {
    isSettled = true;
    const ids = new Set(
      presentEntries(chosen).map((entry) => entry.manifest.id),
    );
    chosen.forEach((entry, index) => {
      if (entry === null) {
        return;
      }
      const { main, page } = entry.manifest.dependsOn;
      const missing = [...main, ...page].find((id) => !ids.has(id));
      if (missing !== undefined) {
        problems.push({
          id: entry.manifest.id,
          message: `needs plugin "${missing}", which is not loaded`,
        });
        chosen[index] = null;
        isSettled = false;
      }
    });
  }
}

function servedPlugin(entry: CatalogEntry): ServedPlugin {
  return {
    id: entry.manifest.id,
    origin: entry.origin,
    revision: entry.revision,
    pageUrl: entry.pageUrl,
    manifest: entry.manifest,
  };
}

// The kept settings over the schema of a new admission: each admitted plugin
// with no section takes its defaults, and each section of a plugin no longer
// admitted leaves, with its ignored key once that plugin is admitted.
function rebasedSettings(
  kept: UserSettings,
  schema: ConfigSchema,
): UserSettings {
  const isAdmitted = (id: string) => Object.hasOwn(schema.pluginDefaults, id);
  return {
    settings: kept.settings,
    pluginSettings: Object.fromEntries(
      Object.entries(schema.pluginDefaults).map(([id, defaults]) => [
        id,
        Object.hasOwn(kept.pluginSettings, id)
          ? kept.pluginSettings[id]
          : defaults,
      ]),
    ),
    ignored: kept.ignored.filter((key) => !isAdmitted(key)),
  };
}

function ignoredSettingLine(key: string): string {
  return `settings.json "${key}" names no loaded plugin; kept and ignored`;
}

// File problems in the order the served list holds them: `settings.json`,
// `keymap.json`, then theme files by path.
function fileRank(problem: ConfigProblem): number {
  if (problem.file === SETTINGS_FILE) {
    return 0;
  }
  return problem.file === KEYMAP_FILE ? 1 : 2;
}

function inServedOrder(problems: ConfigProblem[]): ConfigProblem[] {
  return [...problems].sort(
    (a, b) =>
      fileRank(a) - fileRank(b) ||
      (fileRank(a) === 2 ? a.file.localeCompare(b.file) : 0),
  );
}

// Reads the user config folder into the served config, keeping each slice's
// last good value when its file is broken. Rejects when the built-in plugins'
// checks do not build (`checksOver`) or a built-in theme is broken: each is a
// bug in the app, not in the user's files. A user plugin's bug is an admission
// problem, never a rejection.
export async function loadConfigStore(
  deps: ConfigStoreDeps,
): Promise<ConfigStore> {
  const base: BaseCheckDeps = {
    defaults: deps.defaults,
    optionalSettings: deps.optionalSettings,
    settingChoices: deps.settingChoices,
    defaultKeymap: deps.defaultKeymap,
    coreCommands: deps.coreCommands,
    coreScopes: deps.coreScopes,
    builtInThemes: deps.builtInThemes,
    resolveTheme: deps.resolveTheme,
    checkTokens: deps.checkTokens,
  };
  let admission = admit(base, deps.coreThemeTokens, deps.plugins, []);
  const defaultTheme = deps.resolveTheme(
    deps.defaults.theme,
    deps.builtInThemes,
    [],
    admission.deps.themeTokens,
    deps.checkTokens,
  );
  let slices: Slices = {
    settings: {
      settings: deps.defaults,
      pluginSettings: admission.schema.pluginDefaults,
      ignored: [],
    },
    keptKeymap: {},
    theme: defaultTheme,
  };
  let runtime: RuntimeCatalogs = {
    main: EMPTY_RUNTIME_CATALOG,
    page: EMPTY_RUNTIME_CATALOG,
  };
  let runtimeLayer: DefaultKeyLayer = {};
  let handedPlugins: readonly CatalogEntry[] | null = null;
  let outsideProblems: readonly CatalogProblem[] = [];
  let loggedDrops: ReadonlySet<string> = new Set();
  let watchProblem: ConfigProblem | null = null;
  let pluginsProblem: string | null = null;
  let current: AppConfig | null = null;
  const listeners = new Set<(config: AppConfig) => void>();
  let isDisposed = false;

  const settingsSlice = (
    read: ConfigFileText,
    problems: ConfigProblem[],
    checks: AdmittedChecks,
  ): UserSettings => {
    if ('problem' in read) {
      problems.push(read.problem);
      return rebasedSettings(slices.settings, checks.schema);
    }
    if (read.text === null) {
      return {
        settings: deps.defaults,
        pluginSettings: checks.schema.pluginDefaults,
        ignored: [],
      };
    }
    try {
      return checkSettingsText(read.text, checks.deps, checks.schema);
    } catch (error) {
      problems.push({ file: SETTINGS_FILE, message: errorText(error) });
      return rebasedSettings(slices.settings, checks.schema);
    }
  };

  // A parsed file that the merge refuses is a problem, as a file that does not parse.
  const checkedKeymap = (
    read: ConfigFileText,
    problems: ConfigProblem[],
    catalogs: RuntimeCatalogs,
    { deps: checkDeps, schema }: AdmittedChecks,
  ): { kept: UserKeymap; checked: CheckedKeymap } => {
    const lastGood = () => ({
      kept: slices.keptKeymap,
      checked: {
        ...checkUserKeymap(slices.keptKeymap, checkDeps, schema, catalogs),
        heldBack: [],
      },
    });
    if ('problem' in read) {
      problems.push(read.problem);
      return lastGood();
    }
    try {
      const user = read.text === null ? {} : parseUserKeymap(read.text, schema);
      const checked = checkUserKeymap(user, checkDeps, schema, catalogs);
      return { kept: checked.kept, checked };
    } catch (error) {
      problems.push({ file: KEYMAP_FILE, message: errorText(error) });
      return lastGood();
    }
  };

  // Each drop is logged once, and again only after what it dropped came back.
  // One call per rebuild, with every drop line of that rebuild.
  const logNewDrops = (dropped: readonly string[]) => {
    for (const line of dropped) {
      if (!loggedDrops.has(line)) {
        deps.log('config', line);
      }
    }
    loggedDrops = new Set(dropped);
  };

  // A theme error in the user's files is theirs to fix; any other is the
  // app's, which fails the first read and after it only reports, since a
  // running app never stops on a config edit.
  const themeSlice = (
    name: string,
    userTexts: readonly ThemeFileText[],
    isFirstRead: boolean,
    problems: ConfigProblem[],
    checkDeps: ConfigCheckDeps,
  ) => {
    try {
      return resolveConfigTheme(name, userTexts, checkDeps);
    } catch (error) {
      const usersProblem = usersThemeProblem(error, userTexts);
      if (isFirstRead && usersProblem === null) {
        throw error;
      }
      problems.push(
        usersProblem ??
          (error instanceof ThemeError
            ? { file: error.file, message: error.problem }
            : { file: THEMES_FOLDER, message: errorText(error) }),
      );
      return slices.theme;
    }
  };

  // Admits the entries handed since the last rebuild, if any; a failed
  // admission drops them, so a later file rebuild uses the last admitted.
  const nextAdmission = (): Admission => {
    const handed = handedPlugins;
    handedPlugins = null;
    return handed === null
      ? admission
      : admit(base, deps.coreThemeTokens, handed, admission.entries);
  };

  const rebuild = async (isFirstRead: boolean): Promise<AppConfig> => {
    const catalogs = runtime;
    const admitted = nextAdmission();
    const problems: ConfigProblem[] = [];
    const readFile = (relative: string) =>
      readConfigFile(deps.files, deps.folder, relative);
    const settings = settingsSlice(
      await readFile(SETTINGS_FILE),
      problems,
      admitted,
    );
    const { kept, checked } = checkedKeymap(
      await readFile(KEYMAP_FILE),
      problems,
      catalogs,
      admitted,
    );
    runtimeLayer = checked.layer;
    const declaredTwice: string[] = [];
    const commands = commandInfos(
      deps.coreCommands,
      admitted.deps.manifests,
      [...catalogs.main.commands, ...catalogs.page.commands],
      (_source, line) => declaredTwice.push(line),
    );
    logNewDrops([
      ...checked.dropped,
      ...declaredTwice,
      ...settings.ignored.map(ignoredSettingLine),
      ...admitted.dropped,
    ]);
    if (catalogs.main.started && catalogs.page.started) {
      problems.push(
        ...checked.heldBack.map((message) => ({ file: KEYMAP_FILE, message })),
      );
    }
    const themeFiles = await readUserThemes(deps.files, deps.folder);
    problems.push(...themeFiles.problems);
    const theme = themeSlice(
      settings.settings.theme,
      themeFiles.texts,
      isFirstRead,
      problems,
      admitted.deps,
    );
    slices = { settings, keptKeymap: kept, theme };
    admission = admitted;
    return {
      settings: settings.settings,
      keymap: checked.keymap,
      commands,
      scopes: admitted.schema.scopes,
      pluginSettings: settings.pluginSettings,
      theme,
      platform: deps.platform,
      homeDir: deps.homeDir,
      appInstance: deps.appInstance,
      runMode: deps.runMode,
      plugins: admitted.entries.map(servedPlugin),
      problems: [
        ...(watchProblem === null ? [] : [watchProblem]),
        ...(pluginsProblem === null
          ? []
          : [{ file: SETTINGS_FILE, message: pluginsProblem }]),
        ...inServedOrder(problems),
        ...[...outsideProblems, ...admitted.problems].map((problem) => ({
          file: `plugins/${problem.id}`,
          message: problem.message,
        })),
      ],
    };
  };

  const publish = (config: AppConfig) => {
    if (JSON.stringify(config) === JSON.stringify(current)) {
      return;
    }
    current = config;
    for (const listener of listeners) {
      try {
        listener(config);
      } catch (error) {
        deps.log('config', `listener failed: ${errorText(error)}`);
      }
    }
  };

  // One rebuild at a time; a change during one queues one more after it.
  // `waiting` holds the `setPlugins` calls no rebuild has started for yet;
  // each settles once the next rebuild to start has published or failed.
  let running: Promise<void> | null = null;
  let isQueued = false;
  let waiting: (() => void)[] = [];
  const requestRebuild = () => {
    if (running !== null) {
      isQueued = true;
      return;
    }
    running = (async () => {
      do {
        isQueued = false;
        const settled = waiting;
        waiting = [];
        try {
          const config = await rebuild(false);
          if (!isDisposed) {
            publish(config);
          }
        } catch (error) {
          deps.log('config', `config not read: ${errorText(error)}`);
        }
        settled.forEach((resolve) => resolve());
      } while (isQueued && !isDisposed);
      running = null;
      const unrun = waiting;
      waiting = [];
      unrun.forEach((resolve) => resolve());
    })();
  };

  const reportWatchFailure = (error: unknown) => {
    watchProblem = {
      file: deps.folder,
      message: `Cannot watch this folder, so edits apply on the next start: ${errorText(error)}`,
    };
  };
  const isConfigFile = (relative: string) =>
    relative === SETTINGS_FILE ||
    relative === KEYMAP_FILE ||
    THEME_FILE.test(relative);
  let watch: FileWatch | null = null;
  try {
    watch = deps.files.watch(
      deps.folder,
      (relative) => {
        if (isConfigFile(relative)) {
          requestRebuild();
        }
      },
      {
        onError: (error) => {
          reportWatchFailure(error);
          requestRebuild();
        },
      },
    );
  } catch (error) {
    reportWatchFailure(error);
  }

  // Changes during the first read queue behind it.
  const firstRead = rebuild(true);
  running = firstRead.then(
    () => undefined,
    () => undefined,
  );
  current = await firstRead;
  running = null;
  if (isQueued) {
    requestRebuild();
  }
  let isRuntimeQueued = false;
  return {
    current: () => current as AppConfig,
    setRuntime(next) {
      runtime = next;
      if (isRuntimeQueued) {
        return;
      }
      isRuntimeQueued = true;
      queueMicrotask(() => {
        isRuntimeQueued = false;
        if (!isDisposed) {
          requestRebuild();
        }
      });
    },
    runtime: () => ({ catalogs: runtime, layer: runtimeLayer }),
    setPluginsProblem(message) {
      if (message === pluginsProblem) {
        return;
      }
      pluginsProblem = message;
      if (!isDisposed) {
        requestRebuild();
      }
    },
    plugins: () => admission.entries,
    setPlugins(entries) {
      if (isDisposed) {
        return Promise.resolve();
      }
      handedPlugins = entries;
      const settled = new Promise<void>((resolve) => waiting.push(resolve));
      requestRebuild();
      return settled;
    },
    pluginProblems: () => admission.problems,
    setPluginProblems(problems) {
      if (JSON.stringify(problems) === JSON.stringify(outsideProblems)) {
        return;
      }
      outsideProblems = [...problems];
      if (!isDisposed) {
        requestRebuild();
      }
    },
    checks: () => ({ deps: admission.deps, schema: admission.schema }),
    onChanged(listener) {
      const registration = (config: AppConfig) => listener(config);
      listeners.add(registration);
      return { dispose: () => listeners.delete(registration) };
    },
    dispose() {
      isDisposed = true;
      watch?.dispose();
      watch = null;
      listeners.clear();
    },
  };
}
