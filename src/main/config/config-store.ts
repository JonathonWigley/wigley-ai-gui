import type { AppInstance } from '../../contracts/app-instance';
import type { Disposable } from '../../contracts/disposable';
import type { Files, FileWatch } from '../../contracts/files';
import type { UserKeymap } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type { RunMode } from '../../contracts/plugin';
import type { AppConfig, ConfigProblem } from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { errorText } from '../../shared/error-text';
import { requireUnambiguousKeymap } from '../../shared/keymap-checks';
import {
  commandInfos,
  type DefaultKeyLayer,
} from '../../shared/plugin-manifests';
import { EMPTY_RUNTIME_CATALOG } from '../../shared/runtime-commands';
import { ThemeError, type ThemeFileText } from '../themes/theme-loader';
import {
  type CheckedKeymap,
  checkSettingsText,
  checkUserKeymap,
  type ConfigCheckDeps,
  type ConfigFileText,
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
export interface ConfigStore extends Disposable {
  current(): AppConfig;
  onChanged(listener: (config: AppConfig) => void): Disposable;
  setRuntime(runtime: RuntimeCatalogs): void;
  setPluginsProblem(message: string | null): void;
  runtime(): { catalogs: RuntimeCatalogs; layer: DefaultKeyLayer };
}

// `folder` is the absolute user config folder; `log` takes the store's own
// lines.
export interface ConfigStoreDeps extends ConfigCheckDeps {
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
// last good value when its file is broken. Rejects when the default keys
// clash, a default bind's `arg` does not fit its command, a built-in theme is
// broken, or a plugin declaring settings has a core setting's name for its id:
// each is a bug in the app, not in the user's files.
export async function loadConfigStore(
  deps: ConfigStoreDeps,
): Promise<ConfigStore> {
  const fixed = configSchema(deps);
  requireUnambiguousKeymap(fixed.defaultKeymap);
  const defaultTheme = deps.resolveTheme(
    deps.defaults.theme,
    deps.builtInThemes,
    [],
    deps.themeTokens,
    deps.checkTokens,
  );
  let slices: Slices = {
    settings: { settings: deps.defaults, pluginSettings: fixed.pluginDefaults },
    keptKeymap: {},
    theme: defaultTheme,
  };
  let runtime: RuntimeCatalogs = {
    main: EMPTY_RUNTIME_CATALOG,
    page: EMPTY_RUNTIME_CATALOG,
  };
  let runtimeLayer: DefaultKeyLayer = {};
  let loggedDrops: ReadonlySet<string> = new Set();
  let watchProblem: ConfigProblem | null = null;
  let pluginsProblem: string | null = null;
  let current: AppConfig | null = null;
  const listeners = new Set<(config: AppConfig) => void>();
  let isDisposed = false;

  const settingsSlice = (read: ConfigFileText, problems: ConfigProblem[]) => {
    if ('problem' in read) {
      problems.push(read.problem);
      return slices.settings;
    }
    if (read.text === null) {
      return { settings: deps.defaults, pluginSettings: fixed.pluginDefaults };
    }
    try {
      return checkSettingsText(read.text, deps, fixed);
    } catch (error) {
      problems.push({ file: SETTINGS_FILE, message: errorText(error) });
      return slices.settings;
    }
  };

  // A parsed file that the merge refuses is a problem, as a file that does not parse.
  const checkedKeymap = (
    read: ConfigFileText,
    problems: ConfigProblem[],
    catalogs: RuntimeCatalogs,
  ): { kept: UserKeymap; checked: CheckedKeymap } => {
    const lastGood = () => ({
      kept: slices.keptKeymap,
      checked: {
        ...checkUserKeymap(slices.keptKeymap, deps, fixed, catalogs),
        heldBack: [],
      },
    });
    if ('problem' in read) {
      problems.push(read.problem);
      return lastGood();
    }
    try {
      const user = read.text === null ? {} : parseUserKeymap(read.text, fixed);
      const checked = checkUserKeymap(user, deps, fixed, catalogs);
      return { kept: checked.kept, checked };
    } catch (error) {
      problems.push({ file: KEYMAP_FILE, message: errorText(error) });
      return lastGood();
    }
  };

  // Each drop is logged once, and again only after what it dropped came back.
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
  ) => {
    try {
      return resolveConfigTheme(name, userTexts, deps);
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

  const rebuild = async (isFirstRead: boolean): Promise<AppConfig> => {
    const catalogs = runtime;
    const problems: ConfigProblem[] = [];
    const readFile = (relative: string) =>
      readConfigFile(deps.files, deps.folder, relative);
    const settings = settingsSlice(await readFile(SETTINGS_FILE), problems);
    const { kept, checked } = checkedKeymap(
      await readFile(KEYMAP_FILE),
      problems,
      catalogs,
    );
    runtimeLayer = checked.layer;
    const declaredTwice: string[] = [];
    const commands = commandInfos(
      deps.coreCommands,
      deps.manifests,
      [...catalogs.main.commands, ...catalogs.page.commands],
      (_source, line) => declaredTwice.push(line),
    );
    logNewDrops([...checked.dropped, ...declaredTwice]);
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
    );
    slices = { settings, keptKeymap: kept, theme };
    return {
      settings: settings.settings,
      keymap: checked.keymap,
      commands,
      scopes: fixed.scopes,
      pluginSettings: settings.pluginSettings,
      theme,
      platform: deps.platform,
      homeDir: deps.homeDir,
      appInstance: deps.appInstance,
      runMode: deps.runMode,
      problems: [
        ...(watchProblem === null ? [] : [watchProblem]),
        ...(pluginsProblem === null
          ? []
          : [{ file: SETTINGS_FILE, message: pluginsProblem }]),
        ...inServedOrder(problems),
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
  let running: Promise<void> | null = null;
  let isQueued = false;
  const requestRebuild = () => {
    if (running !== null) {
      isQueued = true;
      return;
    }
    running = (async () => {
      do {
        isQueued = false;
        try {
          const config = await rebuild(false);
          if (!isDisposed) {
            publish(config);
          }
        } catch (error) {
          deps.log('config', `config not read: ${errorText(error)}`);
        }
      } while (isQueued && !isDisposed);
      running = null;
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
