import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import {
  type FileEntry,
  type Files,
  isMissingFile,
} from '../../contracts/files';
import type { Keymap } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type {
  CommandDecl,
  PluginManifest,
  ScopeInfo,
  SettingKind,
} from '../../contracts/plugin';
import type {
  AppConfig,
  ConfigProblem,
  Settings,
} from '../../contracts/settings';
import type { Theme } from '../../contracts/theme';
import { errorText } from '../../shared/error-text';
import { requireUnambiguousKeymap } from '../../shared/keymap-checks';
import {
  commandInfos,
  mergeKeymap,
  pluginOptionalSettings,
  pluginSettings,
  scopeInfos,
} from '../../shared/plugin-manifests';
import {
  type resolveTheme,
  ThemeError,
  type ThemeFileText,
  type ThemeTokenRegistry,
  type TokenCheck,
} from '../themes/theme-loader';
import { parseUserKeymap } from './user-keymap';
import { mergeUserSettings, type UserSettings } from './user-settings';

// The served config, kept current with the user config folder.
// `onChanged` listeners run, in registration order, each time a change to a
// config file changes the served config, after `current` returns the new one.
export interface ConfigStore {
  current(): AppConfig;
  onChanged(listener: (config: AppConfig) => void): Disposable;
}

// `folder` is the absolute user config folder; `resolveTheme` resolves a
// theme as the theme loader does, running `checkTokens`, the check of the
// tokens the native window takes, on every theme it resolves; `log` takes the
// store's own lines.
export interface ConfigStoreDeps {
  files: Files;
  folder: string;
  defaults: Settings;
  optionalSettings: Readonly<Record<string, SettingKind>>;
  settingChoices: Readonly<Record<string, readonly string[]>>;
  coreKeymap: Keymap;
  coreCommands: Record<CommandId, CommandDecl>;
  coreScopes: readonly ScopeInfo[];
  manifests: readonly PluginManifest[];
  builtInThemes: readonly unknown[];
  themeTokens: ThemeTokenRegistry;
  resolveTheme: (...args: Required<Parameters<typeof resolveTheme>>) => Theme;
  checkTokens: TokenCheck;
  platform: Platform;
  log: Log;
}

const SETTINGS_FILE = 'settings.json';
const KEYMAP_FILE = 'keymap.json';
const THEMES_FOLDER = 'themes';
const THEME_FILE = /^themes\/[^/]+\.json$/;

// A config file's text: null when the file is missing, which overrides
// nothing.
type FileRead = { text: string | null } | { problem: ConfigProblem };

// The last good value of each slice, which a broken file leaves in place.
interface Slices {
  settings: UserSettings;
  keymap: Keymap;
  theme: Theme;
}

// What every rebuild reads with the defaults, worked out once at load.
interface Fixed {
  commands: AppConfig['commands'];
  scopes: AppConfig['scopes'];
  pluginDefaults: Record<string, object>;
  optionalSettings: Readonly<Record<string, SettingKind>>;
  defaultKeymap: Keymap;
}

function requireNoCoreSettingIds(
  manifests: readonly PluginManifest[],
  defaults: Settings,
) {
  for (const manifest of manifests) {
    if (Object.hasOwn(defaults, manifest.id)) {
      throw new Error(
        `Plugin "${manifest.id}" has the name of a core setting, so its settings cannot sit under its id`,
      );
    }
  }
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
// last good value when its file is broken. Rejects when the core's or a
// plugin's own keys clash, a built-in theme is broken, or a plugin's id is a
// core setting's name: each is a bug in the app, not in the user's files.
export async function loadConfigStore(
  deps: ConfigStoreDeps,
): Promise<ConfigStore> {
  requireNoCoreSettingIds(deps.manifests, deps.defaults);
  const commands = commandInfos(deps.coreCommands, deps.manifests);
  const fixed: Fixed = {
    commands,
    scopes: scopeInfos(deps.coreScopes, deps.manifests),
    pluginDefaults: pluginSettings(deps.manifests),
    optionalSettings: {
      ...deps.optionalSettings,
      ...pluginOptionalSettings(deps.manifests),
    },
    defaultKeymap: mergeKeymap(deps.coreKeymap, deps.manifests, {}),
  };
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

  const pathOf = (relative: string) => `${deps.folder}/${relative}`;

  const readFile = async (relative: string): Promise<FileRead> => {
    try {
      return { text: await deps.files.read(pathOf(relative)) };
    } catch (error) {
      if (isMissingFile(error)) {
        return { text: null };
      }
      return {
        problem: {
          file: relative,
          message: `Could not read the file: ${errorText(error)}`,
        },
      };
    }
  };

  const readThemeFiles = async (): Promise<{
    texts: ThemeFileText[];
    problems: ConfigProblem[];
  }> => {
    let entries: FileEntry[];
    try {
      entries = await deps.files.list(pathOf(THEMES_FOLDER));
    } catch (error) {
      return {
        texts: [],
        problems: [
          {
            file: THEMES_FOLDER,
            message: `Could not read the folder: ${errorText(error)}`,
          },
        ],
      };
    }
    const names = entries
      .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.json'))
      .filter((entry) => !entry.path.includes('/'))
      .map((entry) => `${THEMES_FOLDER}/${entry.path}`)
      .sort();
    const texts: ThemeFileText[] = [];
    const problems: ConfigProblem[] = [];
    for (const file of names) {
      const read = await readFile(file);
      if ('problem' in read) {
        problems.push(read.problem);
      } else if (read.text !== null) {
        texts.push({ file, text: read.text });
      }
    }
    return { texts, problems };
  };

  const settingsSlice = (read: FileRead, problems: ConfigProblem[]) => {
    if ('problem' in read) {
      problems.push(read.problem);
      return slices.settings;
    }
    if (read.text === null) {
      return { settings: deps.defaults, pluginSettings: fixed.pluginDefaults };
    }
    try {
      return mergeUserSettings(read.text, {
        defaults: deps.defaults,
        pluginDefaults: fixed.pluginDefaults,
        optionalSettings: fixed.optionalSettings,
        settingChoices: deps.settingChoices,
      });
    } catch (error) {
      problems.push({ file: SETTINGS_FILE, message: errorText(error) });
      return slices.settings;
    }
  };

  const keymapSlice = (read: FileRead, problems: ConfigProblem[]) => {
    if ('problem' in read) {
      problems.push(read.problem);
      return slices.keymap;
    }
    if (read.text === null) {
      return fixed.defaultKeymap;
    }
    try {
      const user = parseUserKeymap(read.text, fixed);
      const keymap = mergeKeymap(deps.coreKeymap, deps.manifests, user);
      requireUnambiguousKeymap(keymap);
      return keymap;
    } catch (error) {
      problems.push({ file: KEYMAP_FILE, message: errorText(error) });
      return slices.keymap;
    }
  };

  // A theme error naming `settings.json` or a user file is the user's to fix;
  // any other is the app's, which fails the first read and after it only
  // reports, since a running app never stops on a config edit.
  const themeSlice = (
    name: string,
    userTexts: readonly ThemeFileText[],
    isFirstRead: boolean,
    problems: ConfigProblem[],
  ) => {
    try {
      return deps.resolveTheme(
        name,
        deps.builtInThemes,
        userTexts,
        deps.themeTokens,
        deps.checkTokens,
      );
    } catch (error) {
      const isUsersFile =
        error instanceof ThemeError &&
        (error.file === SETTINGS_FILE ||
          userTexts.some((text) => text.file === error.file));
      if (isFirstRead && !isUsersFile) {
        throw error;
      }
      problems.push(
        error instanceof ThemeError
          ? { file: error.file, message: error.problem }
          : { file: THEMES_FOLDER, message: errorText(error) },
      );
      return slices.theme;
    }
  };

  const rebuild = async (isFirstRead: boolean): Promise<AppConfig> => {
    const problems: ConfigProblem[] = [];
    const settings = settingsSlice(await readFile(SETTINGS_FILE), problems);
    const keymap = keymapSlice(await readFile(KEYMAP_FILE), problems);
    const themeFiles = await readThemeFiles();
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
          publish(await rebuild(false));
        } catch (error) {
          deps.log('config', `config not read: ${errorText(error)}`);
        }
      } while (isQueued);
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
  try {
    deps.files.watch(
      deps.folder,
      (relative) => {
        if (isConfigFile(relative)) {
          requestRebuild();
        }
      },
      (error) => {
        reportWatchFailure(error);
        requestRebuild();
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
  };
}
