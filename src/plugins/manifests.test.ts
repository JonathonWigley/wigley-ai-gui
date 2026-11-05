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

  it('manifests_WorkflowHeavy_ListsItsCommandsAndSettings', () => {
    const heavy = manifests.find(({ id }) => id === 'workflow-heavy');

    expect(Object.keys(heavy?.commands ?? {}).sort()).toEqual(
      [
        'clearAndMake',
        'cancelCountdown',
        'makeInNewSession',
        'resumeMake',
        'openPlan',
        'retro',
        'dismiss',
      ].sort(),
    );
    expect(Object.keys(heavy?.settings ?? {}).sort()).toEqual(
      ['layout', 'autoClearAndMake', 'autoStartSeconds'].sort(),
    );
  });

  it('manifests_WorkflowLight_HasItsLayoutSettingAndBadgeToken', () => {
    const light = manifests.find(({ id }) => id === 'workflow-light');

    expect(Object.keys(light?.settings ?? {})).toEqual(['layout']);
    expect(light?.themeTokens?.badge.default).toBe('var(--wg-status-info)');
  });

  it('manifests_WorkflowMedium_HasItsLayoutSettingAndBadgeToken', () => {
    const medium = manifests.find(({ id }) => id === 'workflow-medium');

    expect(Object.keys(medium?.settings ?? {})).toEqual(['layout']);
    expect(medium?.themeTokens?.badge.default).toBe('var(--wg-accent)');
  });
});
