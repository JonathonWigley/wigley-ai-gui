import { describe, expect, it } from 'vitest';
import { defaultSettingsFor } from '../config/settings';
import { fakePlatform } from '../shared/platform.test-support';
import {
  disabledDependencyProblem,
  pluginSettingInfo,
  requireNoSettingsUnderCoreNames,
} from '../shared/plugin-manifests';
import { manifests } from './manifests';

// The shipped manifests are the subject here: a leaf setting without a
// declaration makes the settings schema throw.
describe('manifests', () => {
  it('manifests_SettingInfo_DeclaresEveryLeafSetting', () => {
    expect(() => pluginSettingInfo(manifests)).not.toThrow();
  });

  it('manifests_CoreSettingNames_HoldNoPluginSettings', () => {
    expect(() =>
      requireNoSettingsUnderCoreNames(
        manifests,
        defaultSettingsFor(fakePlatform('macos').programs),
      ),
    ).not.toThrow();
  });

  it('manifests_DefaultDisabled_BreaksNoDependency', () => {
    expect(
      disabledDependencyProblem(
        defaultSettingsFor(fakePlatform('macos').programs).plugins.disabled,
        manifests,
      ),
    ).toBeNull();
  });
});
