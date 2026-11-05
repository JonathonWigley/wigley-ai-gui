import type { AppInstance } from '../../contracts/app-instance';
import type { Disposable } from '../../contracts/disposable';
import type { Files, FileWatch } from '../../contracts/files';
import type { Keymap } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type { RunMode } from '../../contracts/plugin';
import type { AppConfig, ConfigProblem } from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { errorText } from '../../shared/error-text';
import { requireUnambiguousKeymap } from '../../shared/keymap-checks';
import { ThemeError, type ThemeFileText } from '../themes/theme-loader';
import {
  checkKeymapText,
  checkSettingsText,
  type ConfigCheckDeps,
  type ConfigFileText,
  configSchema,
  KEYMAP_FILE,
  readConfigFile,
  readUserThemes,
  resolveConfigTheme,
  SETTINGS_FILE,
  THEMES_FOLDER,
  usersThemeProblem,
} from './config-checks';
import type { UserSettings } from './user-settings';

// The served config, kept current with the user config folder.
// `onChanged` listeners run, in registration order, each time a change to a
// config file changes the served config, after `current` returns the new one.
// `dispose` stops watching the folder and drops every listener; `current`
// keeps returning the last config. A rebuild already running when `dispose`
// is called publishes nothing and runs no further rebuild.
export interface ConfigStore extends Disposable {
  current(): AppConfig;
  onChanged(listener: (config: AppConfig) => void): Disposable;
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

// The last good value of each slice, which a broken file leaves in place.
interface Slices {
  settings: UserSettings;
  keymap: Keymap;
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
// clash, a built-in theme is broken, or a plugin's id is a core setting's
// name: each is a bug in the app, not in the user's files.
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
    keymap: fixed.defaultKeymap,
    theme: defaultTheme,
  };
  let watchProblem: ConfigProblem | null = null;
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

  const keymapSlice = (read: ConfigFileText, problems: ConfigProblem[]) => {
    if ('problem' in read) {
      problems.push(read.problem);
      return slices.keymap;
    }
    if (read.text === null) {
      return fixed.defaultKeymap;
    }
    try {
      return checkKeymapText(read.text, deps, fixed);
    } catch (error) {
      problems.push({ file: KEYMAP_FILE, message: errorText(error) });
      return slices.keymap;
    }
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
    const problems: ConfigProblem[] = [];
    const readFile = (relative: string) =>
      readConfigFile(deps.files, deps.folder, relative);
    const settings = settingsSlice(await readFile(SETTINGS_FILE), problems);
    const keymap = keymapSlice(await readFile(KEYMAP_FILE), problems);
    const themeFiles = await readUserThemes(deps.files, deps.folder);
    problems.push(...themeFiles.problems);
    const theme = themeSlice(
      settings.settings.theme,
      themeFiles.texts,
      isFirstRead,
      problems,
    );
    slices = { settings, keymap, theme };
    return {
      settings: settings.settings,
      keymap,
      commands: fixed.commands,
      scopes: fixed.scopes,
      pluginSettings: settings.pluginSettings,
      theme,
      platform: deps.platform,
      homeDir: deps.homeDir,
      appInstance: deps.appInstance,
      runMode: deps.runMode,
      problems: [
        ...(watchProblem === null ? [] : [watchProblem]),
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
  return {
    current: () => current as AppConfig,
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
