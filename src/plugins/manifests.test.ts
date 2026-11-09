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

  it('manifests_LabelsAndDescriptions_FilledAndLabelsUnique', () => {
    const problems: string[] = [];
    const owners = new Map<string, string>();
    for (const { id, label, description } of manifests) {
      if (label.trim() === '') problems.push(`${id} has a blank label`);
      if (description.trim() === '') {
        problems.push(`${id} has a blank description`);
      }
      const other = owners.get(label);
      if (other !== undefined) {
        problems.push(`${other} and ${id} share the label "${label}"`);
      }
      owners.set(label, id);
    }

    expect(problems).toEqual([]);
  });

  it('manifests_WorkflowLarge_ListsItsCommandsAndSettings', () => {
    const large = manifests.find(({ id }) => id === 'workflow-large');

    expect(Object.keys(large?.commands ?? {}).sort()).toEqual(
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
    expect(Object.keys(large?.settings ?? {}).sort()).toEqual(
      ['layout', 'autoClearAndMake', 'autoStartSeconds'].sort(),
    );
  });

  it('manifests_WorkflowSmall_HasItsLayoutSettingAndBadgeToken', () => {
    const small = manifests.find(({ id }) => id === 'workflow-small');

    expect(Object.keys(small?.settings ?? {})).toEqual(['layout']);
    expect(small?.themeTokens?.badge.default).toBe('var(--wg-status-info)');
  });

  it('manifests_WorkflowMedium_HasItsLayoutSettingAndBadgeToken', () => {
    const medium = manifests.find(({ id }) => id === 'workflow-medium');

    expect(Object.keys(medium?.settings ?? {})).toEqual(['layout']);
    expect(medium?.themeTokens?.badge.default).toBe('var(--wg-accent)');
  });

  it('manifests_WorkflowSpike_HasItsLayoutSettingAndBadgeToken', () => {
    const spike = manifests.find(({ id }) => id === 'workflow-spike');

    expect(Object.keys(spike?.settings ?? {})).toEqual(['layout']);
    expect(spike?.themeTokens?.badge.default).toBe('var(--wg-fg-secondary)');
  });
});
