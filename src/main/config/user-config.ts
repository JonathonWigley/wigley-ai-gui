import type { Files } from '../../contracts/files';
import type { UserKeymap } from '../../contracts/keymap';
import type { SettingInfo } from '../../contracts/plugin';
import type {
  ConfigFileRead,
  ConfigWriteResult,
  SettingControl,
  SettingLeaf,
  SettingSection,
  UserConfig,
  UserConfigSchema,
} from '../../contracts/user-config';
import { capitalised } from '../../shared/capitalised';
import { errorText } from '../../shared/error-text';
import { isJsonObject } from '../../shared/json';
import {
  appliedCommands,
  appliedScopes,
  defaultKeyLayers,
  mergeKeymap,
  pluginSettingInfo,
} from '../../shared/plugin-manifests';
import type { ThemeFileText } from '../themes/theme-loader';
import {
  checkKeymapText,
  checkSettingsText,
  type ConfigCheckDeps,
  type ConfigSchema,
  KEYMAP_FILE,
  readConfigFile,
  readUserThemes,
  SETTINGS_FILE,
  settingsThemeProblem,
  themeNames,
} from './config-checks';
import type { ConfigStore } from './config-store';
import { settingsFileDefaults } from './user-settings';

// `folder` is the absolute user config folder `store` watches; `settingInfo`
// declares each core setting by its dotted path; the schema lists no command
// or scope of a plugin in `applied`'s list. Every check reads `store.checks()`
// at its call, so it follows the plugins the store admits.
export interface UserConfigDeps {
  files: Files;
  folder: string;
  store: ConfigStore;
  settingInfo: Readonly<Record<string, SettingInfo>>;
  applied: { disabled(): readonly string[] };
}

// A file's check: the problem that refuses the text, or null when it passes.
// A bind naming no command yet passes, as in a hand edit, and the store holds
// it back.
type TextCheck = (
  text: string,
  userThemes: readonly ThemeFileText[],
) => string | null;

const CORE_SECTION = 'core';

// The `userConfig` main service over the user config folder. `schema()`
// builds the schema over the plugins the store admits now, so it throws on a
// plugin setting with no declaration or a declaration naming no setting.
export function createUserConfig(deps: UserConfigDeps): UserConfig {
  const filePath = (file: string) => `${deps.folder}/${file}`;

  const checkSettings: TextCheck = (text, userThemes) => {
    const { deps: checks, schema } = deps.store.checks();
    return settingsProblem(text, userThemes, checks, schema);
  };
  const checkKeymap: TextCheck = (text) => {
    const { deps: checks, schema } = deps.store.checks();
    try {
      checkKeymapText(text, checks, schema, deps.store.runtime().catalogs);
      return null;
    } catch (error) {
      return errorText(error);
    }
  };

  const readLayer = async <L>(
    file: string,
    check: TextCheck,
    userThemes: readonly ThemeFileText[],
  ): Promise<ConfigFileRead<L>> => {
    const read = await readConfigFile(deps.files, deps.folder, file);
    if ('problem' in read) {
      return { state: 'broken', problem: read.problem.message, text: null };
    }
    if (read.text === null) {
      return { state: 'ok', layer: null, text: null };
    }
    const problem = check(read.text, userThemes);
    if (problem !== null) {
      return { state: 'broken', problem, text: read.text };
    }
    return { state: 'ok', layer: JSON.parse(read.text) as L, text: read.text };
  };

  // Writes `layer` as `file` when the file still holds `expectedText` and the
  // new text passes `check`. The themes are read first, so nothing is awaited
  // between comparing the file's text and starting the write.
  const writeLayer = async (
    file: string,
    layer: object,
    expectedText: string | null,
    check: TextCheck,
  ): Promise<ConfigWriteResult> => {
    const userThemes = (await readUserThemes(deps.files, deps.folder)).texts;
    const read = await readConfigFile(deps.files, deps.folder, file);
    if ('problem' in read) {
      return { type: 'refused', problem: read.problem.message };
    }
    if (read.text !== expectedText) {
      return { type: 'changedOnDisk' };
    }
    const text = `${JSON.stringify(layer, null, 2)}\n`;
    const problem = check(text, userThemes);
    if (problem !== null) {
      return { type: 'refused', problem };
    }
    await deps.files.write(filePath(file), text);
    return { type: 'written' };
  };

  // Each write starts once the one before it settles, failed or not, so a
  // second write expecting the text the first replaced finds it changed.
  let lastWrite: Promise<unknown> = Promise.resolve();
  const afterLastWrite = (
    write: () => Promise<ConfigWriteResult>,
  ): Promise<ConfigWriteResult> => {
    const result = lastWrite.then(write);
    lastWrite = result.catch(() => undefined);
    return result;
  };

  return {
    schema: () => {
      const checks = deps.store.checks();
      return withRuntime(
        userConfigSchema(deps.settingInfo, checks.deps, checks.schema),
        checks.deps,
        deps,
      );
    },
    async read() {
      const userThemes = (await readUserThemes(deps.files, deps.folder)).texts;
      return {
        settings: await readLayer<Record<string, unknown>>(
          SETTINGS_FILE,
          checkSettings,
          userThemes,
        ),
        keymap: await readLayer<UserKeymap>(
          KEYMAP_FILE,
          checkKeymap,
          userThemes,
        ),
        themes: themeNames(deps.store.checks().deps.builtInThemes, userThemes),
      };
    },
    writeSettings: (layer, expectedText) =>
      afterLastWrite(() =>
        writeLayer(SETTINGS_FILE, layer, expectedText, checkSettings),
      ),
    writeKeymap: (layer, expectedText) =>
      afterLastWrite(() =>
        writeLayer(KEYMAP_FILE, layer, expectedText, checkKeymap),
      ),
    onChanged: (listener) => deps.store.onChanged(() => listener()),
  };
}

// The problem that refuses `settings.json` holding `text`: the merge's, or a
// theme name no theme can hold. A theme error on any other file is that file's,
// which the ConfigStore reports there while keeping the last good theme.
function settingsProblem(
  text: string,
  userThemes: readonly ThemeFileText[],
  deps: ConfigCheckDeps,
  fixed: ConfigSchema,
): string | null {
  let themeName: string;
  try {
    themeName = checkSettingsText(text, deps, fixed).settings.theme;
  } catch (error) {
    return errorText(error);
  }
  return settingsThemeProblem(themeName, deps.builtInThemes, userThemes);
}

function userConfigSchema(
  settingInfo: UserConfigDeps['settingInfo'],
  deps: ConfigCheckDeps,
  fixed: ConfigSchema,
): UserConfigSchema {
  const sections: SettingSection[] = [
    {
      id: CORE_SECTION,
      title: 'Core',
      leaves: Object.entries(settingInfo).map(([path, info]) =>
        settingLeaf(path, info, deps, fixed),
      ),
    },
  ];
  for (const manifest of deps.manifests) {
    const infos = Object.entries(pluginSettingInfo([manifest]));
    if (infos.length > 0) {
      sections.push({
        id: manifest.id,
        title: capitalised(manifest.id),
        leaves: infos.map(([path, info]) =>
          settingLeaf(path, info, deps, fixed),
        ),
      });
    }
  }
  const layers = defaultKeyLayers(deps.defaultKeymap, deps.manifests);
  return {
    sections,
    commands: fixed.commands,
    scopes: fixed.scopes,
    defaultBindLayers: layers.map((layer) => layer.binds ?? []),
    defaultAccelerators: {
      app: fixed.defaultKeymap.app,
      global: fixed.defaultKeymap.global,
      intercept: fixed.defaultKeymap.intercept,
    },
    defaultGroups: fixed.defaultKeymap.groups,
    defaultLeader: fixed.defaultLeader,
  };
}

// `schema` with the runtime commands, binds and group names the store serves
// now, and the commands and scopes of the applied list's plugins left out.
function withRuntime(
  schema: UserConfigSchema,
  checks: ConfigCheckDeps,
  deps: UserConfigDeps,
): UserConfigSchema {
  const { layer } = deps.store.runtime();
  const merged = mergeKeymap(checks.defaultKeymap, checks.manifests, {}, layer);
  const disabled = deps.applied.disabled();
  return {
    ...schema,
    commands: appliedCommands(deps.store.current().commands, disabled),
    scopes: appliedScopes(schema.scopes, disabled),
    defaultBindLayers:
      layer.binds === undefined || layer.binds.length === 0
        ? schema.defaultBindLayers
        : [...schema.defaultBindLayers, layer.binds],
    defaultGroups: merged.groups,
    defaultAccelerators: {
      app: merged.app,
      global: merged.global,
      intercept: merged.intercept,
    },
  };
}

// `path` is the setting's full dotted path, a plugin's under its id.
function settingLeaf(
  path: string,
  info: SettingInfo,
  deps: ConfigCheckDeps,
  fixed: ConfigSchema,
): SettingLeaf {
  const fallback = defaultAt(
    path,
    settingsFileDefaults(deps.defaults, fixed.pluginDefaults),
  );
  return {
    path,
    label: info.label,
    description: info.description,
    control: settingControl(path, fallback, deps, fixed),
    fallback,
  };
}

// The default at the dotted `path` of `defaults`, or null when the defaults
// leave it unset.
function defaultAt(path: string, defaults: object): { value: unknown } | null {
  let value: unknown = defaults;
  for (const key of path.split('.')) {
    if (!isJsonObject(value) || !Object.hasOwn(value, key)) {
      return null;
    }
    value = value[key];
  }
  return { value };
}

// A closed choice, then the core theme, then an array, then by the
// default's kind or the declared kind of an unset or null setting.
function settingControl(
  path: string,
  fallback: { value: unknown } | null,
  deps: ConfigCheckDeps,
  fixed: ConfigSchema,
): SettingControl {
  const choices = deps.settingChoices[path];
  if (choices !== undefined) {
    return { kind: 'choice', choices };
  }
  if (path === 'theme') {
    return { kind: 'theme' };
  }
  const value = fallback?.value;
  if (Array.isArray(value)) {
    return { kind: 'json' };
  }
  const kind = fixed.optionalSettings[path];
  if (typeof value === 'boolean' || kind === 'boolean') {
    return { kind: 'boolean' };
  }
  if (typeof value === 'number' || kind === 'number') {
    return { kind: 'number' };
  }
  return { kind: 'string' };
}
