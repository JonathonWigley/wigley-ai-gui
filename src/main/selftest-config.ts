import type { SelfTestScript } from '../contracts/plugin';
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
