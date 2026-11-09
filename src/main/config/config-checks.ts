import type { CommandId } from '../../contracts/commands';
import type { RuntimeCatalog } from '../../contracts/core-state';
import {
  type FileEntry,
  type Files,
  isMissingFile,
} from '../../contracts/files';
import type {
  DefaultKeymap,
  InterceptBind,
  Keymap,
  KeyBind,
  AcceleratorBind,
  UserKeymap,
} from '../../contracts/keymap';
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
import { interceptChordText } from '../../shared/accelerator';
import { checkCommandArg, commandTarget } from '../../shared/command-args';
import { errorText } from '../../shared/error-text';
import { requireUnambiguousKeymap } from '../../shared/keymap-checks';
import {
  commandInfos,
  type DefaultKeyLayer,
  defaultKeyLayers,
  disabledDependencyProblem,
  mergeKeymap,
  pluginOptionalSettings,
  pluginSettings,
  requireNoSettingsUnderCoreNames,
  runtimeLayerClash,
  scopeInfos,
} from '../../shared/plugin-manifests';
import {
  readableName,
  type resolveTheme,
  ThemeError,
  type ThemeFileText,
  type ThemeTokenRegistry,
  type TokenCheck,
} from '../themes/theme-loader';
import { heldBackUserBinds, parseUserKeymap } from './user-keymap';
import { mergeUserSettings, type UserSettings } from './user-settings';

// What the checks of the user config files read: the core settings and keys,
// the manifests of the plugins the ConfigStore admitted, and the themes. `resolveTheme` resolves a theme as
// the theme loader does, running `checkTokens`, the check of the tokens the
// native window takes, on every theme it resolves.
export interface ConfigCheckDeps {
  defaults: Settings;
  optionalSettings: Readonly<Record<string, SettingKind>>;
  settingChoices: Readonly<Record<string, readonly string[]>>;
  defaultKeymap: DefaultKeymap;
  coreCommands: Record<CommandId, CommandDecl>;
  coreScopes: readonly ScopeInfo[];
  manifests: readonly PluginManifest[];
  builtInThemes: readonly unknown[];
  themeTokens: ThemeTokenRegistry;
  resolveTheme: (...args: Required<Parameters<typeof resolveTheme>>) => Theme;
  checkTokens: TokenCheck;
}

// What every check reads with the defaults, worked out once from the deps:
// every command and scope, the plugins' ids, each plugin's defaults by id, every
// optional setting's kind (plugin paths qualified), and the keymap with no user
// layer.
export interface ConfigSchema {
  commands: AppConfig['commands'];
  scopes: AppConfig['scopes'];
  plugins: readonly string[];
  pluginDefaults: Record<string, object>;
  optionalSettings: Readonly<Record<string, SettingKind>>;
  defaultKeymap: Keymap;
  defaultLeader: string;
}

// The user config folder's files and folder, relative to it.
export const SETTINGS_FILE = 'settings.json';
export const KEYMAP_FILE = 'keymap.json';
export const THEMES_FOLDER = 'themes';

// A config file's text: null when the file is missing, which overrides
// nothing.
export type ConfigFileText =
  | { text: string | null }
  | { problem: ConfigProblem };

// Throws on a default or manifest bind whose `arg` its command does not take.
function requireFittingArgs(
  deps: ConfigCheckDeps,
  commands: AppConfig['commands'],
) {
  for (const layer of defaultKeyLayers(deps.defaultKeymap, deps.manifests)) {
    const binds = [
      ...(layer.binds ?? []),
      ...(layer.app ?? []),
      ...(layer.intercept ?? []),
      ...(layer.global ?? []),
    ];
    for (const { command, arg } of binds) {
      const problem = Object.hasOwn(commands, command)
        ? checkCommandArg(command, commands[command].arg, arg)
        : null;
      if (problem !== null) {
        throw new Error(problem);
      }
    }
  }
}

// Throws when a plugin declaring settings has a core setting's name for its id
// or a manifest holds what its own checks reject (a command declared twice, a
// null default with no kind), or a default bind's `arg` does not fit its command;
// each is a bug in the app, not in the user's files.
export function configSchema(deps: ConfigCheckDeps): ConfigSchema {
  requireNoSettingsUnderCoreNames(deps.manifests, deps.defaults);
  const commands = commandInfos(deps.coreCommands, deps.manifests);
  requireFittingArgs(deps, commands);
  return {
    commands,
    scopes: scopeInfos(deps.coreScopes, deps.manifests),
    plugins: deps.manifests.map((manifest) => manifest.id),
    pluginDefaults: pluginSettings(deps.manifests),
    optionalSettings: {
      ...deps.optionalSettings,
      ...pluginOptionalSettings(deps.manifests),
    },
    defaultKeymap: mergeKeymap(deps.defaultKeymap, deps.manifests, {}),
    defaultLeader: deps.defaultKeymap.leader,
  };
}

// The settings `text`, a `settings.json`, merges over the defaults. Throws an
// Error whose message is the first problem found, as the user reads it: in
// the file, or a `plugins.disabled` naming a plugin a started one depends on.
// The theme it names is not resolved here.
export function checkSettingsText(
  text: string,
  deps: ConfigCheckDeps,
  schema: ConfigSchema,
): UserSettings {
  const merged = mergeUserSettings(text, {
    defaults: deps.defaults,
    pluginDefaults: schema.pluginDefaults,
    optionalSettings: schema.optionalSettings,
    settingChoices: deps.settingChoices,
  });
  const problem = disabledDependencyProblem(
    merged.settings.plugins.disabled,
    deps.manifests,
  );
  if (problem !== null) {
    throw new Error(problem);
  }
  return merged;
}

// Both processes' runtime commands and binds.
export interface RuntimeCatalogs {
  main: RuntimeCatalog;
  page: RuntimeCatalog;
}

// `runtime`'s binds that can sit under `user`, in merge order, main's then the
// page's: a bind that clashes with one kept before it, or with the merge, is dropped
// with one line of text. Throws only when the merge with no runtime layer fails,
// which is a bad user file; a race between processes is no bug in the app.
export function keptRuntimeLayer(
  runtime: RuntimeCatalogs,
  deps: ConfigCheckDeps,
  user: UserKeymap,
): { layer: DefaultKeyLayer; dropped: string[] } {
  const base = mergeKeymap(deps.defaultKeymap, deps.manifests, user);
  requireUnambiguousKeymap(base);
  const leader = base.editor.leader;
  const clashOf = (layer: DefaultKeyLayer): string | null => {
    const inLayer = runtimeLayerClash(layer, leader);
    if (inLayer !== null) {
      return inLayer;
    }
    try {
      requireUnambiguousKeymap(
        mergeKeymap(deps.defaultKeymap, deps.manifests, user, layer),
      );
      return null;
    } catch (error) {
      return errorText(error);
    }
  };
  let layer: Required<Pick<DefaultKeyLayer, 'binds' | 'app' | 'intercept'>> = {
    binds: [],
    app: [],
    intercept: [],
  };
  const dropped: string[] = [];
  const consider = (
    tried: typeof layer,
    keys: string,
    bind: KeyBind | AcceleratorBind | InterceptBind,
  ) => {
    const clash = clashOf(tried);
    if (clash === null) {
      layer = tried;
    } else {
      dropped.push(
        `runtime bind ${keys} of ${commandTarget(bind.command, bind.arg)} dropped: ${clash}`,
      );
    }
  };
  for (const { binds } of [runtime.main, runtime.page]) {
    for (const bind of binds.binds) {
      consider({ ...layer, binds: [...layer.binds, bind] }, bind.keys, bind);
    }
    for (const bind of binds.app) {
      consider({ ...layer, app: [...layer.app, bind] }, bind.accelerator, bind);
    }
    for (const bind of binds.intercept) {
      consider(
        { ...layer, intercept: [...layer.intercept, bind] },
        interceptChordText(bind),
        bind,
      );
    }
  }
  return { layer, dropped };
}

// What a keymap check gives. `heldBack` is a problem for each user bind no command
// can run yet, `kept` the user layer without those binds and those naming a plugin
// that is not loaded, `layer` the runtime binds in force, and `dropped` a line for
// each user entry naming a plugin that is not loaded, then each runtime bind left
// out.
export interface CheckedKeymap {
  keymap: Keymap;
  heldBack: string[];
  kept: UserKeymap;
  layer: DefaultKeyLayer;
  dropped: string[];
}

// The keymap `user` merges into over the default, plugin and runtime layers. Throws
// an Error whose message is the first problem found, as the user reads it: a key
// bound twice in one scope.
export function checkUserKeymap(
  user: UserKeymap,
  deps: ConfigCheckDeps,
  schema: ConfigSchema,
  runtime: RuntimeCatalogs,
): CheckedKeymap {
  const names = {
    ...schema,
    commands: commandInfos(deps.coreCommands, deps.manifests, [
      ...runtime.main.commands,
      ...runtime.page.commands,
    ]),
  };
  const { kept, problems, ignored } = heldBackUserBinds(
    user,
    names,
    schema.commands,
  );
  const { layer, dropped } = keptRuntimeLayer(runtime, deps, kept);
  return {
    keymap: mergeKeymap(deps.defaultKeymap, deps.manifests, kept, layer),
    heldBack: problems,
    kept,
    layer,
    dropped: [...ignored, ...dropped],
  };
}

// `checkUserKeymap` of the user's `text`, a `keymap.json`. Throws an Error whose
// message is the first problem found, as the user reads it: in the file, or a key
// bound twice in one scope.
export function checkKeymapText(
  text: string,
  deps: ConfigCheckDeps,
  schema: ConfigSchema,
  runtime: RuntimeCatalogs,
): CheckedKeymap {
  return checkUserKeymap(parseUserKeymap(text, schema), deps, schema, runtime);
}

// The text of `relative`, a file in the user config folder `folder`; a file
// that cannot be read is a problem on that file.
export async function readConfigFile(
  files: Files,
  folder: string,
  relative: string,
): Promise<ConfigFileText> {
  try {
    return { text: await files.read(`${folder}/${relative}`) };
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
}

// The `.json` files directly in the `themes` folder of `folder`, by path
// (`themes/<name>.json`) in sorted order, and a problem for each file that
// cannot be read, or one for the folder when it cannot be listed.
export async function readUserThemes(
  files: Files,
  folder: string,
): Promise<{ texts: ThemeFileText[]; problems: ConfigProblem[] }> {
  let entries: FileEntry[];
  try {
    entries = await files.list(`${folder}/${THEMES_FOLDER}`);
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
    const read = await readConfigFile(files, folder, file);
    if ('problem' in read) {
      problems.push(read.problem);
    } else if (read.text !== null) {
      texts.push({ file, text: read.text });
    }
  }
  return { texts, problems };
}

// Each built-in theme's name, then each user theme file's that parses to
// one, sorted, every name once. A user file whose other parts are broken
// still gives its name.
export function themeNames(
  builtInThemes: readonly unknown[],
  userThemes: readonly ThemeFileText[],
): string[] {
  const builtIn = builtInThemes.map(readableName);
  const user = userThemes.map((theme) =>
    readableName(parsedOrNull(theme.text)),
  );
  const names = [
    ...builtIn,
    ...user.filter((name) => name !== null).sort(),
  ].filter((name) => name !== null);
  return [...new Set(names)];
}

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The theme `settings.json` selects as `name`, resolved by the theme loader
// over the built-in themes and `userThemes`. Throws the loader's ThemeError,
// naming the file that set the bad value: a user theme file that does not
// parse or has no name is that file's error, wherever the name points.
export function resolveConfigTheme(
  name: string,
  userThemes: readonly ThemeFileText[],
  deps: ConfigCheckDeps,
): Theme {
  return deps.resolveTheme(
    name,
    deps.builtInThemes,
    userThemes,
    deps.themeTokens,
    deps.checkTokens,
  );
}

// The problem on `settings.json` when it selects the theme `name`: one when
// no theme can hold it, that is when no name in `themeNames` is `name` and
// every user theme file parses to a name. While a user theme file does not,
// that file may be the one meant, so `name` passes and the loader reports
// that file. Matches the error `resolveConfigTheme` throws on
// `settings.json`, without resolving the theme.
export function settingsThemeProblem(
  name: string,
  builtInThemes: readonly unknown[],
  userThemes: readonly ThemeFileText[],
): string | null {
  const isKnown = themeNames(builtInThemes, userThemes).includes(name);
  const everyUserFileNamed = userThemes.every(
    (theme) => readableName(parsedOrNull(theme.text)) !== null,
  );
  return !isKnown && everyUserFileNamed
    ? `"theme" names "${name}", which no theme has`
    : null;
}

// The problem a `resolveConfigTheme` error is in the user's own files: on
// `settings.json` or on one of `userThemes`. Null when the error is the
// app's.
export function usersThemeProblem(
  error: unknown,
  userThemes: readonly ThemeFileText[],
): ConfigProblem | null {
  const isUsersFile =
    error instanceof ThemeError &&
    (error.file === SETTINGS_FILE ||
      userThemes.some((text) => text.file === error.file));
  return isUsersFile ? { file: error.file, message: error.problem } : null;
}
