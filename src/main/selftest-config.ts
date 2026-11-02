import type { SelfTestScript, SelfTestStep } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { overrideSettings } from '../shared/plugin-manifests';
import { SCREENSHOT_NAME } from './drive/page-driver';

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

// The PNG files each step with a `screenshot` saves, walking the scripts in
// hand-over order and each script's groups in order:
// `<pluginId>-<screenshot>.png`, or for a repeating step one per press,
// `<pluginId>-<screenshot>-<n>.png` for `n` from 1 to its `max`. Throws on a
// name that is not lowercase words joined by `-`, and on two steps that save
// one file.
export function screenshotFiles(
  handed: readonly HandedScript[],
): Map<SelfTestStep, string[]> {
  const files = new Map<SelfTestStep, string[]>();
  const savedFiles = new Set<string>();
  for (const { pluginId, script } of handed) {
    for (const step of script.groups.flatMap((group) => group.steps)) {
      if (step.screenshot === undefined) {
        continue;
      }
      if (!SCREENSHOT_NAME.test(step.screenshot)) {
        throw new Error(
          `Self-test step of ${pluginId} names screenshot "${step.screenshot}": a screenshot name is lowercase letters and digits in words joined by -`,
        );
      }
      const stepFiles = pressFiles(
        `${pluginId}-${step.screenshot}`,
        step.repeat?.max,
      );
      for (const file of stepFiles) {
        if (savedFiles.has(file)) {
          throw new Error(`Two self-test steps save ${file}`);
        }
        savedFiles.add(file);
      }
      files.set(step, stepFiles);
    }
  }
  return files;
}

// `<base>.png`, or with `repeatMax` one file per press, `<base>-<n>.png`.
function pressFiles(base: string, repeatMax: number | undefined): string[] {
  if (repeatMax === undefined) {
    return [`${base}.png`];
  }
  return Array.from(
    { length: repeatMax },
    (_, index) => `${base}-${index + 1}.png`,
  );
}

// Throws on a script whose groups the runner cannot report or run: a group
// with a blank `name` or `why`, two groups of one script with one name, a step
// whose `why` is given but blank, a `repeat` whose `max` is not a whole number
// of at least 2 or whose `until` is blank, a `repeat` beside `alsoExpect`, and
// a `width` that is neither `'start'` nor a positive whole number.
export function checkGroups(handed: readonly HandedScript[]): void {
  for (const { pluginId, script } of handed) {
    const names = new Set<string>();
    for (const group of script.groups) {
      const where = `Self-test group ${pluginId}: ${group.name}`;
      if (group.name.trim() === '') {
        throw new Error(`A self-test group of ${pluginId} has no name`);
      }
      if (group.why.trim() === '') {
        throw new Error(`${where} has no why`);
      }
      if (names.has(group.name)) {
        throw new Error(`${where} is named twice in its script`);
      }
      names.add(group.name);
      for (const step of group.steps) {
        checkStep(where, step);
      }
    }
  }
}

// Throws, naming `where` and the step's line, on a step `checkGroups` rejects.
function checkStep(where: string, step: SelfTestStep): void {
  if (step.why !== undefined && step.why.trim() === '') {
    throw new Error(`${where} has a step (${step.expect}) with no why`);
  }
  const isWidthValid =
    step.width === undefined ||
    step.width === 'start' ||
    (Number.isInteger(step.width) && step.width > 0);
  if (!isWidthValid) {
    throw new Error(
      `${where} has a step (${step.expect}) with width ${step.width}: a width is 'start' or a positive whole number`,
    );
  }
  if (step.repeat === undefined) {
    return;
  }
  if (step.alsoExpect !== undefined) {
    throw new Error(
      `${where} has a step (${step.expect}) repeating with alsoExpect: a repeating step waits for no other lines`,
    );
  }
  const { until, max } = step.repeat;
  if (!Number.isInteger(max) || max < 2) {
    throw new Error(
      `${where} has a step (${step.expect}) repeating with max ${max}: a repeat's max is a whole number of at least 2`,
    );
  }
  if (until.trim() === '') {
    throw new Error(
      `${where} has a step (${step.expect}) repeating with no until line`,
    );
  }
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
