import type { SelfTestScript, SelfTestStep } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { overrideSettings } from '../shared/plugin-manifests';

// A script as the self-test received it, with the id of the plugin that handed
// it over.
export interface HandedScript {
  pluginId: string;
  script: SelfTestScript;
}

// What the handed scripts add to the config main serves the page.
export type SelfTestConfig = Pick<SelfTestScript, 'pageBinds' | 'settings'>;

// Every script's page binds in hand-over order, and, per settings plugin, the
// union of the settings the scripts set. Throws when two scripts set one
// setting to values whose JSON differs.
export function mergeSelfTestConfigs(
  handed: readonly HandedScript[],
): SelfTestConfig {
  const settings: Record<string, Record<string, unknown>> = {};
  // Which plugin's script set each setting, by `<settings plugin>.<setting>`.
  const setBy = new Map<string, string>();
  for (const { pluginId, script } of handed) {
    for (const [settingsPlugin, values] of Object.entries(script.settings)) {
      const merged = (settings[settingsPlugin] ??= {});
      for (const [name, value] of Object.entries(values)) {
        const setting = `${settingsPlugin}.${name}`;
        const firstPluginId = setBy.get(setting);
        const isSetDifferently =
          firstPluginId !== undefined &&
          JSON.stringify(merged[name]) !== JSON.stringify(value);
        if (isSetDifferently) {
          throw new Error(
            `Self-test scripts of ${firstPluginId} and ${pluginId} set ${setting} to different values`,
          );
        }
        setBy.set(setting, firstPluginId ?? pluginId);
        merged[name] = value;
      }
    }
  }
  return {
    pageBinds: handed.flatMap(({ script }) => script.pageBinds),
    settings,
  };
}

const SCREENSHOT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The PNG file each step with a `screenshot` saves, `<pluginId>-<screenshot>.png`,
// walking the scripts in hand-over order. Throws on a name that is not
// lowercase words joined by `-`, and on two steps that save one file.
export function screenshotFiles(
  handed: readonly HandedScript[],
): Map<SelfTestStep, string> {
  const files = new Map<SelfTestStep, string>();
  const savedFiles = new Set<string>();
  for (const { pluginId, script } of handed) {
    for (const step of script.steps) {
      if (step.screenshot === undefined) {
        continue;
      }
      if (!SCREENSHOT_NAME.test(step.screenshot)) {
        throw new Error(
          `Self-test step of ${pluginId} names screenshot "${step.screenshot}": a screenshot name is lowercase letters and digits in words joined by -`,
        );
      }
      const file = `${pluginId}-${step.screenshot}.png`;
      if (savedFiles.has(file)) {
        throw new Error(`Two self-test steps save ${file}`);
      }
      savedFiles.add(file);
      files.set(step, file);
    }
  }
  return files;
}

// The design primitives' parts that clip their text with an ellipsis on
// purpose, which the fit check lets clip in every script.
export const PRIMITIVE_ELLIPSIS_SELECTORS: readonly string[] = [
  '.ui-row-label',
  '.ui-row-detail',
  '.ui-tab-label',
  '.ui-collapsible-summary',
];

// A script's `scrollsItself` followed by each primitive ellipsis selector it
// does not already hold.
export function withPrimitiveEllipsis(
  scrollsItself: readonly string[],
): string[] {
  return [
    ...scrollsItself,
    ...PRIMITIVE_ELLIPSIS_SELECTORS.filter(
      (selector) => !scrollsItself.includes(selector),
    ),
  ];
}

// `config` as the self-test serves it: the scripts' page binds after every
// bind, and their settings laid over the plugin settings. Throws on a setting
// no plugin holds.
export function applySelfTestConfig(
  config: AppConfig,
  selfTest: SelfTestConfig,
): AppConfig {
  return {
    ...config,
    keymap: {
      ...config.keymap,
      page: [...config.keymap.page, ...selfTest.pageBinds],
    },
    pluginSettings: overrideSettings(config.pluginSettings, selfTest.settings),
  };
}
